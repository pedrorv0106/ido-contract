const  { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time } = require('@openzeppelin/test-helpers');
const { utils } = require('ethers');
const BN = require("bn.js");
const {
  isCallTrace,
} = require("hardhat/internal/hardhat-network/stack-traces/message-trace");

const e18 = 1 + '0'.repeat(18)
const e26 = 1 + '0'.repeat(26)
const e24 = 1 + '0'.repeat(24)

const bigNum = num=>(num + '0'.repeat(18))
const smallNum = num=>(parseInt(num)/bigNum(1))

describe("MonoX IDO", function () {
  before(async function () {
    [
      this.owner, 
      this.alice,
      this.bob,
      this.carol,
      this.feeTo,
      this.minter,
      ...addrs
    ] = await ethers.getSigners()
    this.IDO = await ethers.getContractFactory("IDO")
    this.MockERC20 = await ethers.getContractFactory('MockERC20')
  })

  beforeEach(async function () {
    this.ido = await this.IDO.connect(this.minter).deploy()
    this.yfi = await this.MockERC20.deploy('YFI', 'YFI', e26);
    this.dai = await this.MockERC20.deploy('DAI', 'DAI', e26);

    this.ido.connect(this.minter).setFeeTo(this.feeTo.address)
    await this.yfi.transfer(this.alice.address, bigNum(10000000))
    await this.dai.transfer(this.alice.address, bigNum(10000000))
    await this.yfi.transfer(this.bob.address, bigNum(10000000))
    await this.dai.transfer(this.bob.address, bigNum(10000000))
    await this.yfi.transfer(this.carol.address, bigNum(10000000))
    await this.dai.transfer(this.carol.address, bigNum(10000000))
    
    await this.yfi.connect(this.alice).approve(this.ido.address, e26)
    await this.dai.connect(this.alice).approve(this.ido.address, e26)

    await this.yfi.connect(this.bob).approve(this.ido.address, e26)
    await this.dai.connect(this.bob).approve(this.ido.address, e26)

    await this.yfi.connect(this.carol).approve(this.ido.address, e26)
    await this.dai.connect(this.carol).approve(this.ido.address, e26)
    const timestamp = await time.latest() + 0
    await this.ido.connect(this.alice).createPool("YFI-DAI Pool", this.yfi.address, this.dai.address, bigNum(10), bigNum(100000), bigNum(10000), timestamp, timestamp + 10000000)
    await this.ido.connect(this.alice).createPool("YFI-ETH Pool", this.yfi.address, this.ido.address, bigNum(1), bigNum(100000), bigNum(10000), timestamp, timestamp + 10000000)
    expect(await this.dai.balanceOf((await this.ido.poolInfo(0)).owner)).to.equal(bigNum(10000000))
  });

  it("should purchase sale token with erc20 token", async function () {
    await this.ido.connect(this.bob).purchaseSaleToken(0, bigNum(10000))
    expect(await this.yfi.balanceOf(this.bob.address)).to.equal(bigNum(10000000 + 1000))
    expect(await this.dai.balanceOf(this.bob.address)).to.equal(bigNum(10000000 - 10000))
    expect(await this.dai.balanceOf(this.feeTo.address)).to.equal(bigNum(100))
    expect(await this.dai.balanceOf((await this.ido.poolInfo(0)).owner)).to.equal(bigNum(10000000 + 10000 - 100))
    await expect(this.ido.connect(this.bob).purchaseSaleToken(0, bigNum(100000)))
      .to.be.revertedWith("VM Exception while processing transaction: revert IDO: exceed limited amount")
  })

  it("should purchase sale token with erc20 token (referrer)", async function () {
    await this.ido.connect(this.bob).setReferralAddress(this.carol.address)
    await this.ido.connect(this.bob).purchaseSaleToken(0, bigNum(10000))
    expect(await this.yfi.balanceOf(this.bob.address)).to.equal(bigNum(10000000 + 1000))
    expect(await this.dai.balanceOf(this.bob.address)).to.equal(bigNum(10000000 - 10000))
    expect(await this.dai.balanceOf(this.feeTo.address)).to.equal(bigNum(100))
    expect(await this.dai.balanceOf(await this.ido.referralInfo(this.bob.address))).to.equal(bigNum(10000000 + 100))
    expect(await this.dai.balanceOf((await this.ido.poolInfo(0)).owner)).to.equal(bigNum(10000000 + 10000 - 200))
    await expect(this.ido.connect(this.bob).purchaseSaleToken(0, bigNum(100000)))
      .to.be.revertedWith("VM Exception while processing transaction: revert IDO: exceed limited amount")
  })

  it("should purchase sale token with eth", async function () {
    await this.ido.connect(this.bob).purchaseSaleTokenWithEth(1,  {value: bigNum(1000),})
    expect(await this.yfi.balanceOf(this.bob.address)).to.equal(bigNum(10000000 + 1000))
    await expect(this.ido.connect(this.bob).purchaseSaleToken(0, bigNum(1000000)))
      .to.be.revertedWith("VM Exception while processing transaction: revert IDO: exceed limited amount")
  })

  it("should purchase sale token with eth (referrer)", async function () {
    await this.ido.connect(this.bob).setReferralAddress(this.carol.address)
    const initialBobEthAmount = smallNum((await ethers.provider.getBalance(this.bob.address)).toString())
    const initialOwnerEthAmount = smallNum((await ethers.provider.getBalance((await this.ido.poolInfo(0)).owner)).toString())
    const initialFeeEthAmount = smallNum((await ethers.provider.getBalance(this.feeTo.address)).toString())
    await this.ido.connect(this.bob).purchaseSaleTokenWithEth(1,  {value: bigNum(1000),})
    expect(initialBobEthAmount - smallNum((await ethers.provider.getBalance(this.bob.address)).toString())).to.greaterThan(1000)
    expect(initialBobEthAmount - smallNum((await ethers.provider.getBalance(this.bob.address)).toString())).to.lessThan(1001)
    expect(smallNum((await ethers.provider.getBalance((await this.ido.poolInfo(0)).owner)).toString()) - initialOwnerEthAmount).to.equal(980)
    expect(smallNum((await ethers.provider.getBalance(this.feeTo.address)).toString()) - initialFeeEthAmount).to.greaterThan(9)
    expect(smallNum((await ethers.provider.getBalance(this.feeTo.address)).toString()) - initialFeeEthAmount).to.lessThan(10)
    expect(smallNum((await ethers.provider.getBalance(await this.ido.referralInfo(this.bob.address))).toString())).to.greaterThan(10000 + 9)
    expect(smallNum((await ethers.provider.getBalance(await this.ido.referralInfo(this.bob.address))).toString())).to.lessThan(10000 + 10)
    expect(await this.yfi.balanceOf(this.bob.address)).to.equal(bigNum(10000000 + 1000))
    await expect(this.ido.connect(this.bob).purchaseSaleToken(0, bigNum(1000000)))
      .to.be.revertedWith("VM Exception while processing transaction: revert IDO: exceed limited amount")
  })
});