import { BigNumber } from '@ethersproject/bignumber'
import { Deferrable } from '@ethersproject/properties'
import { JsonRpcProvider, TransactionRequest } from '@ethersproject/providers'
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

const ChainIds: Record<Networks, number> = {
  mainnet: 1,
  rinkeby: 4,
  kovan: 42,
  ropsten: 3,
  goerli: 5,
}

const SWEEP_FREQ = !!process.env.sweep_frequency ? parseInt(process.env.sweep_frequency) : 30 * 1000
const WALLET_DEPTH = parseInt(process.env.sweep_depth) || 3

function checkEnvironment(): void {
  const requiredVars = [
    'destination',
    'sweep_mnemonic',
    'sweep_depth',
    'sweep_frequency',
    'mainnet_rpc',
    'rinkeby_rpc',
    'kovan_rpc',
    'ropsten_rpc',
    'goerli_rpc',
  ]
  const hasRequiredEnvVars = requiredVars.reduce((acc, cur) => (Boolean(process.env[cur]) ? acc : false), true)

  if (!hasRequiredEnvVars) {
    const missing = requiredVars.reduce((acc, cur) => (process.env[cur] === undefined ? [...acc, cur] : acc), [])
    throw new Error(`Missing required environment variables. Make your own .env file and include: ${missing}.`)
  }
}
async function getWallets(providers: Record<Networks, JsonRpcProvider>): Promise<Record<Networks, Wallet[]>> {
  const wallets = {}
  const numNetworks = Object.values(Networks).length
  for (let i = 0; i < numNetworks; i++) {
    const network = Object.values(Networks)[i]
    for (let j = 0; j < WALLET_DEPTH; j++) {
      const path = `m/44'/60'/0'/0/${j}`
      const provider = providers[network]
      await provider.ready
      const w = Wallet.fromMnemonic(process.env.sweep_mnemonic, path).connect(provider)
      if (wallets[network]) {
        wallets[network].push(w)
      } else {
        wallets[network] = [w]
      }
    }
  }
  return wallets as Record<Networks, Wallet[]>
}

async function estimateGasPrice(provider: JsonRpcProvider): Promise<BigNumber | void> {
  try {
    const network = await provider.getNetwork()
    if (network.name === 'homestead') {
      try {
        const response = await fetch('https://www.gasnow.org/api/v3/gas/price')
        if (response.ok) {
          const { data } = await response.json()
          console.log(`gas price estimate for ${network.name}: ${utils.formatUnits(data.fast, 'gwei')}`)
          return data.fast
        }
      } catch (error) {
        console.error(`gasnow api call failed`, error)
      }
    }
    const block = await provider.getBlockWithTransactions('latest')
    const block1 = await provider.getBlockWithTransactions(-1)
    const block2 = await provider.getBlockWithTransactions(-2)
    const transactions = [...block.transactions, ...block1.transactions, ...block2.transactions]
    const filteredTxList = transactions.filter((tx) => tx.gasPrice.gt(0))
    const gasPrices = filteredTxList.map((tx) => tx.gasPrice)
    const gasSum = gasPrices.reduce((acc, cur) => acc.add(cur), BigNumber.from(0))
    const divisor = gasPrices.length || 1
    const average = gasSum.div(divisor).mul(102).div(100) // 2% gas price buffer over average rate
    console.log(`gas price estimate for ${network.name}: ${utils.formatUnits(average, 'gwei')}`)
    return average
  } catch (error) {
    console.error(`failed gas estimation: ${error}`)
  }
}

async function main() {
  checkEnvironment()
  const providers: Record<Networks, JsonRpcProvider> = {
    [Networks.mainnet]: new JsonRpcProvider(process.env.mainnet_rpc, ChainIds[Networks.mainnet]),
    [Networks.rinkeby]: new JsonRpcProvider(process.env.rinkeby_rpc, ChainIds[Networks.rinkeby]),
    [Networks.kovan]: new JsonRpcProvider(process.env.kovan_rpc, ChainIds[Networks.kovan]),
    [Networks.ropsten]: new JsonRpcProvider(process.env.ropsten_rpc, ChainIds[Networks.ropsten]),
    [Networks.goerli]: new JsonRpcProvider(process.env.goerli_rpc, ChainIds[Networks.goerli]),
  }

  const networkValues = Object.values(Networks)
  const gasPriceEstimates = {}

  networkValues.forEach(async (network) => {
    gasPriceEstimates[network] = await estimateGasPrice(providers[network])
  })

  let wallets = await getWallets(providers)
  const transferGasCost = BigNumber.from('21000')
  async function sweep(network: Networks): Promise<void> {
    try {
      for (let i = 0; i < WALLET_DEPTH; i++) {
        const wallet = wallets[network][i]
        const address = await wallet.getAddress()
        console.log(`scanning ${network}-${i}: ${address}`)
        const balance = await wallet.getBalance()
        const transferCost = transferGasCost.mul(gasPriceEstimates[network])
        if (balance.gt(transferCost)) {
          console.log(`worth transacting on ${network}${i} as ${address}`)
          console.log(`balance: ${balance.toString()}`)
          console.log(`transferCost: ${transferCost.toString()}`)
          const transaction: Deferrable<TransactionRequest> = {
            to: process.env.destination,
            from: wallet.address,
            gasLimit: transferGasCost,
            gasPrice: gasPriceEstimates[network],
            value: balance.sub(transferCost),
            chainId: ChainIds[network],
          }
          console.log(`transaction prepared for ${network}`, transaction)
          await wallet.sendTransaction(transaction)
        }
      }
    } catch (error) {
      console.error('error sweeping', error)
    }
  }
  async function handleBlock(network: Networks, blocknumber: number): Promise<any> {
    if (!gasPriceEstimates[network]) {
      return
    }
    if (blocknumber % 4 !== 0) {
      try {
        estimateGasPrice(providers[network]).then((price) => (gasPriceEstimates[network] = price))
      } catch (error) {
        console.error('error setting gas estimate', error)
      }
    }
    return sweep(network)
  }

  return new Promise<void>(() => {
    providers[Networks.mainnet].on('block', async (blockNumber) => await handleBlock(Networks.mainnet, blockNumber))
    const testnets = networkValues.filter((network) => network !== Networks.mainnet)
    setInterval(async () => {
      const sweeps = testnets.map(sweep)
      await Promise.all(sweeps)
    }, SWEEP_FREQ)
    setInterval(() => {
      testnets.forEach((network) => {
        estimateGasPrice(providers[network]).then((price) => (gasPriceEstimates[network] = price))
      })
    }, SWEEP_FREQ ^ 1.06)
  })
}

main()
  .then(() => process.exit(0))
  .catch(console.error)
