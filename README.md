# Simple mnemonic sweeper

This script connects to eth networks and sweeps the eth balances of a mnemonic to another address.

Add the following config variables to a `.env` file you create:
```
destination_pk - the private key of the destination address.
sweep_mnemonic - the mnemonic you'd like swept
sweep_depth - how deep you'd like to go down the mnemonic derivation path
sweep_frequency - interval between sweeps in ms

# json rpc urls - currently all required
mainnet_rpc
rinkeby_rpc
kovan_rpc
ropsten_rpc
goerli_rpc
```
