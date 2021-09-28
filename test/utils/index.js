const { BigNumber } = require("ethers")

const BASE_TEN = 10
const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000"


// Defaults to e18 using amount * 10^18
function getBigNumber(amount, decimals = 18) {
  return BigNumber.from(amount).mul(BigNumber.from(BASE_TEN).pow(decimals))
}

module.exports = {
  getBigNumber,
  ADDRESS_ZERO
}

