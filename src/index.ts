import { JsonRpcProvider } from '@ethersproject/providers'
import { Wallet } from '@ethersproject/wallet'
import { config } from 'dotenv'
config({})

async function main() {
  const provider = new JsonRpcProvider(process.env.rpc)
  const wallet = Wallet.fromMnemonic(process.env.sweep_mnemonic).connect(provider)
  return new Promise((resolve, reject) => {})
}

main()
  .then(() => process.exit(0))
  .catch(console.error)
