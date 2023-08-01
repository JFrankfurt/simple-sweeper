import { config } from 'dotenv'
import { FeeData, HDNodeWallet, JsonRpcProvider, TransactionRequest, Wallet } from 'ethers'

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

const WALLET_DEPTH = parseInt(process.env.sweep_depth) || 3

function checkEnvironment(): void {
  const requiredVars = ['destination', 'sweep_mnemonic', 'sweep_depth']
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
      const hdWallet = HDNodeWallet.fromPhrase(process.env.sweep_mnemonic, path)
      const connectedWallet = hdWallet.connect(provider)
      if (wallets[network]) {
        wallets[network].push(connectedWallet)
      } else {
        wallets[network] = [connectedWallet]
      }
    }
  }
  return wallets as Record<Networks, Wallet[]>
}

async function main() {
  checkEnvironment()
  const providers: { [key in keyof typeof Networks]?: JsonRpcProvider } = {
    [Networks.goerli]: new JsonRpcProvider(process.env.goerli_rpc, ChainIds[Networks.goerli]),
    [Networks.sepolia]: new JsonRpcProvider(process.env.sepolia_rpc, ChainIds[Networks.sepolia]),
    [Networks.base]: new JsonRpcProvider(process.env.base_rpc, ChainIds[Networks.base]),
  }

  const networkValues = Object.values(Networks)
  const gasPriceEstimates = {} as Record<Networks, FeeData>

  networkValues.forEach((network) => {
    if (!providers[network]) {
      return
    }
    providers[network].getFeeData().then((feeData) => {
      gasPriceEstimates[network] = feeData
    })
  })

  let wallets = await getWallets(providers)
  const transferGasCost = 21000n
  async function sweep(network: Networks): Promise<void> {
    try {
      for (let i = 0; i < WALLET_DEPTH; i++) {
        const wallet = wallets[network][i]
        const address = await wallet.getAddress()
        const balance = await wallet.provider.getBalance(address)
        const { maxFeePerGas, maxPriorityFeePerGas } = gasPriceEstimates[network]
        const transferCost = transferGasCost * maxFeePerGas
        if (balance > transferCost) {
          console.log('balance', balance)
          console.log('maxFeePerGas', maxFeePerGas)
          console.log('maxPriorityFeePerGas', maxPriorityFeePerGas)
          console.log('transferCost', transferCost)
          console.log(`worth transacting on ${network}${i} as ${address} to ${process.env.destination}`)
          console.log(`attempting to sweep: ${(balance - transferCost).toString()}`)
          const transaction: TransactionRequest = {
            to: process.env.destination,
            from: wallet.address,
            gasLimit: transferGasCost,
            maxFeePerGas,
            maxPriorityFeePerGas,
            value: balance - transferCost,
            chainId: ChainIds[network],
          }
          await wallet.sendTransaction(transaction)
          console.log((new Date()).toUTCString())
        }
      }
    } catch (error) {
      console.error('error sweeping', error)
    }
  }

  return new Promise<void>(() => {
    providers[Networks.goerli].on('block', () => sweep(Networks.goerli))
    providers[Networks.sepolia].on('block', () => sweep(Networks.sepolia))
    providers[Networks.base].on('block', () => sweep(Networks.base))
    setInterval(() => {
      networkValues.forEach((network) => {
        providers[network].getFeeData().then((feeData) => gasPriceEstimates[network] = feeData)
      })
    }, 30*1000)
  })
}

main()
  .then(() => process.exit(0))
  .catch(console.error)
