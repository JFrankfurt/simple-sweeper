import { BigNumber } from '@ethersproject/bignumber'
import { JsonRpcProvider } from '@ethersproject/providers'
import { Wallet } from '@ethersproject/wallet'
import { config } from 'dotenv'
import { utils } from 'ethers'
import fetch from 'node-fetch'
config({})

enum Networks {
  mainnet = 'mainnet',
  rinkeby = 'rinkeby',
  kovan = 'kovan',
  ropsten = 'ropsten',
  goerli = 'goerli',
}

const WALLET_DEPTH = process.env.sweep_depth || 3

function getWallets(providers: Record<Networks, JsonRpcProvider>): Record<Networks, Wallet[]> {
  const wallets = {}
  Object.values(Networks).forEach((network) => {
    for (let i = 0; i < WALLET_DEPTH; i++) {
      const path = `m/44'/60'/0'/0/${i}`
      const provider = providers[network]
      const w = Wallet.fromMnemonic(process.env.sweep_mnemonic, path).connect(provider)
      if (wallets[network]) {
        wallets[network].push(w)
      } else {
        wallets[network] = [w]
      }
    }
  })
  return wallets as Record<Networks, Wallet[]>
}

async function estimateGasPrice(provider: JsonRpcProvider): Promise<BigNumber> {
  const network = await provider.getNetwork()
  // if (network.name === 'homestead') {
  //   const response = await fetch('https://www.gasnow.org/api/v3/gas/price')
  //   const { data } = await response.json()
  //   console.log(`gas price estimate for ${network.name}: ${utils.formatUnits(data.fast, 'gwei')}`)
  //   return data.fast
  // }
  const block = await provider.getBlockWithTransactions('latest')
  const block1 = await provider.getBlockWithTransactions(-1)
  const block2 = await provider.getBlockWithTransactions(-2)
  const transactions = [...block.transactions, ...block1.transactions, ...block2.transactions]
  const filteredTxList = transactions.filter((tx) => tx.gasPrice.gt(0))
  const gasPrices = filteredTxList.map((tx) => tx.gasPrice)
  const gasSum = gasPrices.reduce((acc, cur) => acc.add(cur), BigNumber.from(0))
  const divisor = Math.floor(gasPrices.length * 0.99) || gasPrices.length || 1
  const average = gasSum.div(divisor)
  console.log(`gas price estimate for ${network.name}: ${utils.formatUnits(average, 'gwei')}`)
  return average
}

async function main() {
  const providers: Record<Networks, JsonRpcProvider> = {
    [Networks.mainnet]: new JsonRpcProvider(process.env.mainnet_rpc),
    [Networks.rinkeby]: new JsonRpcProvider(process.env.rinkeby_rpc),
    [Networks.kovan]: new JsonRpcProvider(process.env.kovan_rpc),
    [Networks.ropsten]: new JsonRpcProvider(process.env.ropsten_rpc),
    [Networks.goerli]: new JsonRpcProvider(process.env.goerli_rpc),
  }

  const networkValues = Object.values(Networks)
  const gasPriceEstimates = {}
  
  networkValues.forEach(async (network) => {
    gasPriceEstimates[network] = await estimateGasPrice(providers[network])
  })


  return new Promise<void>(() => {
    let wallets = getWallets(providers)
    const transferGasCost = BigNumber.from('21000')
    const destination = new Wallet(process.env.destination_pk).connect(providers.mainnet)
    const SWEEP_FREQ = !!process.env.sweep_frequency ? parseInt(process.env.sweep_frequency) : 30 * 1000
    setInterval(async () => {
      try {
        const networkValues = Object.values(Networks)
        networkValues.forEach(async (network) => {
          gasPriceEstimates[network] = await estimateGasPrice(providers[network])
        })
      } catch (error) {
        console.error('error setting gas estimate', error)
      }
      try {
        const networkValues = Object.values(Networks)
        for (let h = 0; h < networkValues.length; h++) {
          const network = networkValues[h]
          for (let i = 0; i < WALLET_DEPTH; i++) {
            console.log(`scanning ${network}-${i}`)
            const balance = await wallets[network][i].getBalance()
            const transferCost = transferGasCost.mul(gasPriceEstimates[network])
            if (balance.gt(transferCost)) {
              const address = await wallets[network][i].getAddress()
              console.log(`worth transacting on ${network}${i} as ${address}`)
              console.log(`balance: ${balance.toString()}`)
              console.log(`transferCost: ${transferCost.toString()}`)

              const transaction = {
                to: destination.address,
                from: wallets[network][i].address,
                gasPrice: gasPriceEstimates[network],
                value: balance.sub(transferCost),
                gasLimit: transferGasCost,
              }
              console.log(`transaction prepared for ${network}`, transaction)
              const txResponse = await wallets[network][i].sendTransaction(transaction)
              const txReceipt = await txResponse.wait()
              console.log(`txReceipt on ${network} for ${address}`, txReceipt)
            }
          }
        }
      } catch (error) {
        console.error('error sweeping', error)
      }
    }, SWEEP_FREQ)
  })
}

main()
  .then(() => process.exit(0))
  .catch(console.error)
