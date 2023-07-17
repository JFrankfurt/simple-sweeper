import { BigNumber } from '@ethersproject/bignumber'
import { Deferrable } from '@ethersproject/properties'
import { JsonRpcProvider, TransactionRequest } from '@ethersproject/providers'
import { formatUnits } from '@ethersproject/units'
import { Wallet } from '@ethersproject/wallet'
import { config } from 'dotenv'

config({})

enum Networks {
  goerli = 'goerli',
  sepolia = 'sepolia',
  base = 'base',
}

const ChainIds: Record<Networks, number> = {
  goerli: 5,
  sepolia: 11155111,
  base: 8453,
}

const SWEEP_FREQ = !!process.env.sweep_frequency ? parseInt(process.env.sweep_frequency) : 30 * 1000
const WALLET_DEPTH = parseInt(process.env.sweep_depth) || 3

function checkEnvironment(): void {
  const requiredVars = ['destination', 'sweep_mnemonic', 'sweep_depth', 'sweep_frequency']
  const hasRequiredEnvVars = requiredVars.reduce((acc, cur) => (Boolean(process.env[cur]) ? acc : false), true)

  if (!hasRequiredEnvVars) {
    const missing = requiredVars.reduce((acc, cur) => (process.env[cur] === undefined ? [...acc, cur] : acc), [])
    throw new Error(`Missing required environment variables. Make your own .env file and include: ${missing}.`)
  }
}
async function getWallets(
  providers: { [key in keyof typeof Networks]?: JsonRpcProvider }
): Promise<Record<Networks, Wallet[]>> {
  const wallets = {}
  for (let i = 0; i < Object.values(Networks).length; i++) {
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

async function estimateGasPrice(
  provider: JsonRpcProvider
): Promise<{
  maxFeePerGas: BigNumber | undefined
  maxPriorityFeePerGas: BigNumber | undefined
}> {
  let maxPriorityFeePerGas, maxFeePerGas
  try {
    const network = await provider.getNetwork()
    // todo: cache prior blocks
    const block = await provider.getBlockWithTransactions('latest')
    const block1 = await provider.getBlockWithTransactions(-1)
    const transactions = [...block.transactions, ...block1.transactions]
    const filteredTxList = transactions.filter((tx) => tx.gasPrice.gt(0)) // filter out miner stuff
    const gasPrices = filteredTxList.map((tx) => tx.gasPrice)
    const gasSum = gasPrices.reduce((acc, cur) => acc.add(cur), BigNumber.from(0))
    const divisor = gasPrices.length || 1
    const average = gasSum.div(divisor).mul(105).div(100) // 5% gas price buffer over average rate
    console.log(`gas price estimate for ${network.name}: ${formatUnits(average, 'gwei')}`)
  } catch (error) {
    console.error(`failed gas estimation: ${error}`)
  }
  return { maxPriorityFeePerGas, maxFeePerGas }
}

async function main() {
  checkEnvironment()
  const providers: { [key in keyof typeof Networks]?: JsonRpcProvider } = {
    [Networks.goerli]: new JsonRpcProvider(process.env.goerli_rpc, ChainIds[Networks.goerli]),
    [Networks.sepolia]: new JsonRpcProvider(process.env.sepolia_rpc, ChainIds[Networks.sepolia]),
    [Networks.base]: new JsonRpcProvider(process.env.base_rpc, ChainIds[Networks.base]),
  }

  const networkValues = Object.values(Networks)
  const gasPriceEstimates = {}

  networkValues.forEach((network) => {
    if (!providers[network]) {
      return
    }
    estimateGasPrice(providers[network]).then(
      ({ maxFeePerGas, maxPriorityFeePerGas }) => (gasPriceEstimates[network] = { maxFeePerGas, maxPriorityFeePerGas })
    )
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
          const { maxFeePerGas, maxPriorityFeePerGas } = gasPriceEstimates[network]
          console.log(`worth transacting on ${network}${i} as ${address}`)
          console.log(`balance: ${balance.toString()}`)
          console.log(`transferCost: ${transferCost.toString()}`)
          const transaction: Deferrable<TransactionRequest> = {
            to: process.env.destination,
            from: wallet.address,
            gasLimit: transferGasCost,
            maxFeePerGas,
            maxPriorityFeePerGas,
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

  return new Promise<void>(() => {
    // providers[Networks.base].on('block', async (blockNumber) => await handleBlock(Networks.base, blockNumber))
    setInterval(async () => {
      const sweeps = networkValues.map(sweep)
      await Promise.all(sweeps)
    }, SWEEP_FREQ)
    setInterval(() => {
      networkValues.forEach((network) => {
        estimateGasPrice(providers[network]).then((price) => (gasPriceEstimates[network] = price))
      })
    }, SWEEP_FREQ ^ 1.06)
  })
}

main()
  .then(() => process.exit(0))
  .catch(console.error)
