const chai = require("chai");
const { solidity } = require("ethereum-waffle");
chai.use(solidity);
const  { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");
const { time } = require('@openzeppelin/test-helpers');
const { getBigNumber, ADDRESS_ZERO} = require("./utils");

const {
  isCallTrace,
} = require("hardhat/internal/hardhat-network/stack-traces/message-trace");

const e18 = 1 + '0'.repeat(18)
const e26 = 1 + '0'.repeat(26)
const e24 = 1 + '0'.repeat(24)

const PriceCurve = {
  DEFAULT: 0,
  LINEAR: 1
}
describe("IDO", function () {
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
    await this.yfi.transfer(this.alice.address, getBigNumber(10000000))
    await this.dai.transfer(this.alice.address, getBigNumber(10000000))
    await this.yfi.transfer(this.bob.address, getBigNumber(10000000))
    await this.dai.transfer(this.bob.address, getBigNumber(10000000))
    await this.yfi.transfer(this.carol.address, getBigNumber(10000000))
    await this.dai.transfer(this.carol.address, getBigNumber(10000000))
    
    await this.yfi.connect(this.alice).approve(this.ido.address, e26)
    await this.dai.connect(this.alice).approve(this.ido.address, e26)

    await this.yfi.connect(this.bob).approve(this.ido.address, e26)
    await this.dai.connect(this.bob).approve(this.ido.address, e26)

    await this.yfi.connect(this.carol).approve(this.ido.address, e26)
    await this.dai.connect(this.carol).approve(this.ido.address, e26)
    this.timestamp = await time.latest() + 0
  });

  context("Default(Static) Price Curve", function() {
    this.beforeEach(async function () {
      await this.ido.connect(this.alice).createPool("YFI-DAI Pool", this.yfi.address, this.dai.address, getBigNumber(10), getBigNumber(100000), getBigNumber(10000), this.timestamp, this.timestamp + 10000000, PriceCurve.DEFAULT, [])
      await this.ido.connect(this.alice).createPool("YFI-ETH Pool", this.yfi.address, this.ido.address, getBigNumber(1), getBigNumber(100000), getBigNumber(10000), this.timestamp, this.timestamp + 10000000, PriceCurve.DEFAULT, [])
      expect(await this.dai.balanceOf((await this.ido.poolInfo(0)).owner)).to.equal(getBigNumber(10000000))  
    })
    it("should purchase sale token with erc20 token", async function () {
      await this.ido.connect(this.bob).purchaseSaleToken(0, getBigNumber(10000))
      expect(await this.yfi.balanceOf(this.bob.address)).to.equal(getBigNumber(10000000 + 1000))
      expect(await this.dai.balanceOf(this.bob.address)).to.equal(getBigNumber(10000000 - 10000))
      expect(await this.dai.balanceOf(this.feeTo.address)).to.equal(getBigNumber(100))
      expect(await this.dai.balanceOf((await this.ido.poolInfo(0)).owner)).to.equal(getBigNumber(10000000 + 10000 - 100))
      await expect(this.ido.connect(this.bob).purchaseSaleToken(0, getBigNumber(100000)))
        .to.be.revertedWith("VM Exception while processing transaction: revert IDO: exceed limited amount")
    })
  
    it("should purchase sale token with erc20 token (referrer)", async function () {
      await this.ido.connect(this.bob).setReferralAddress(this.carol.address)
      await this.ido.connect(this.bob).purchaseSaleToken(0, getBigNumber(10000))
      expect(await this.yfi.balanceOf(this.bob.address)).to.equal(getBigNumber(10000000 + 1000))
      expect(await this.dai.balanceOf(this.bob.address)).to.equal(getBigNumber(10000000 - 10000))
      expect(await this.dai.balanceOf(this.feeTo.address)).to.equal(getBigNumber(100))
      expect(await this.dai.balanceOf(await this.ido.referralInfo(this.bob.address))).to.equal(getBigNumber(10000000 + 100))
      expect(await this.dai.balanceOf((await this.ido.poolInfo(0)).owner)).to.equal(getBigNumber(10000000 + 10000 - 200))
      await expect(this.ido.connect(this.bob).purchaseSaleToken(0, getBigNumber(100000)))
        .to.be.revertedWith("VM Exception while processing transaction: revert IDO: exceed limited amount")
    })
  
    it("should purchase sale token with eth", async function () {
      await this.ido.connect(this.bob).purchaseSaleTokenWithEth(1,  {value: getBigNumber(1000),})
      expect(await this.yfi.balanceOf(this.bob.address)).to.equal(getBigNumber(10000000 + 1000))
    })
  
    it("should purchase sale token with eth (referrer)", async function () {
      await this.ido.connect(this.bob).setReferralAddress(this.carol.address)
      const initialBobEthAmount = await ethers.provider.getBalance(this.bob.address)
      const initialOwnerEthAmount = await ethers.provider.getBalance((await this.ido.poolInfo(0)).owner)
      const initialFeeEthAmount = await ethers.provider.getBalance(this.feeTo.address)
      const initialReferrerEthAmount = await ethers.provider.getBalance(await this.ido.referralInfo(this.bob.address))
      await this.ido.connect(this.bob).purchaseSaleTokenWithEth(1,  {value: getBigNumber(1000),})
      
      expect(initialBobEthAmount.sub(await ethers.provider.getBalance(this.bob.address))).to.within(getBigNumber(1000), getBigNumber(1001))
      expect((await ethers.provider.getBalance((await this.ido.poolInfo(0)).owner)).sub(initialOwnerEthAmount)).to.eq(getBigNumber(980))
      
      expect((await ethers.provider.getBalance(this.feeTo.address)).sub(initialFeeEthAmount)).to.eq(getBigNumber(10))
      expect((await ethers.provider.getBalance(await this.ido.referralInfo(this.bob.address))).sub(initialReferrerEthAmount)).to.eq(getBigNumber(10))
      
      expect(await this.yfi.balanceOf(this.bob.address)).to.equal(getBigNumber(10000000 + 1000))
    })
  })

  context("Linear Price Curve", function() {
    this.beforeEach(async function () {
      await this.ido.connect(this.alice).createPool("YFI-DAI Pool with Linear Price Curve", this.yfi.address, this.dai.address, getBigNumber(100), getBigNumber(500), getBigNumber(500), this.timestamp, this.timestamp + 10000000, PriceCurve.LINEAR, [getBigNumber(100), getBigNumber(225)])
      await this.ido.connect(this.alice).createPool("YFI-ETH Pool with Linear Price Curve", this.yfi.address, this.ido.address, getBigNumber(100), getBigNumber(50), getBigNumber(50), this.timestamp, this.timestamp + 10000000, PriceCurve.LINEAR, [getBigNumber(100), getBigNumber(225)])
      expect(await this.dai.balanceOf((await this.ido.poolInfo(0)).owner)).to.equal(getBigNumber(10000000))  
    })
    
    it("should purchase sale token with erc20 token", async function () {
      /** 
       * If user send 17812.5 base token, user will get 150 sale token.
       * If user send 81250 base token, user will get all(500) sale token. 
       */
      await this.ido.connect(this.bob).purchaseSaleToken(0, getBigNumber(178125, 17)) //17812.5 tokens
      expect(await this.yfi.balanceOf(this.bob.address)).to.equal(getBigNumber(10000000 + 150))
      expect(await this.dai.balanceOf(this.bob.address)).to.equal(getBigNumber(10000000).sub(getBigNumber(178125, 17)))
      expect(await this.dai.balanceOf(this.feeTo.address)).to.equal(getBigNumber(178125, 15)) // 1%
      expect(await this.dai.balanceOf((await this.ido.poolInfo(0)).owner)).to.equal(getBigNumber(10000000).add(getBigNumber(178125, 17).sub(getBigNumber(178125, 15)))) // 99%
      await this.ido.connect(this.bob).purchaseSaleToken(0, getBigNumber(634375, 17)) //63437.5 tokens
      expect(await this.yfi.balanceOf(this.bob.address)).to.equal(getBigNumber(10000000 + 500))
      expect(await this.dai.balanceOf(this.bob.address)).to.equal(getBigNumber(10000000).sub(getBigNumber(81250)))
      expect(await this.dai.balanceOf(this.feeTo.address)).to.equal(getBigNumber(81250, 16)) // 1%
      expect(await this.dai.balanceOf((await this.ido.poolInfo(0)).owner)).to.equal(getBigNumber(10000000).add(getBigNumber(81250).sub(getBigNumber(81250, 16)))) // 99%
      await expect(this.ido.connect(this.bob).purchaseSaleToken(0, getBigNumber(1000)))
        .to.be.revertedWith("VM Exception while processing transaction: revert IDO: exceed offering amount")
    })
  
    it("should purchase sale token with erc20 token (referrer)", async function () {
      /** 
       * If user send 17812.5 base token, user will get 150 sale token.
       * owner - 98% of base token
       * referrer - 1% of base token
       * feeTo - 1% of base token
       */
      await this.ido.connect(this.bob).setReferralAddress(this.carol.address)
      await this.ido.connect(this.bob).purchaseSaleToken(0, getBigNumber(178125, 17)) //17812.5 tokens
      expect(await this.yfi.balanceOf(this.bob.address)).to.equal(getBigNumber(10000000 + 150))
      expect(await this.dai.balanceOf(this.bob.address)).to.equal(getBigNumber(10000000).sub(getBigNumber(178125, 17)))
      expect(await this.dai.balanceOf(this.feeTo.address)).to.equal(getBigNumber(178125, 15)) // 1%
      expect(await this.dai.balanceOf(await this.ido.referralInfo(this.bob.address))).to.equal(getBigNumber(10000000).add(getBigNumber(178125, 15)))
      expect(await this.dai.balanceOf((await this.ido.poolInfo(0)).owner)).to.equal(getBigNumber(10000000).add(getBigNumber(178125, 17).sub(getBigNumber(178125 * 2, 15)))) // 98%
      await expect(this.ido.connect(this.bob).purchaseSaleToken(0, getBigNumber(100000)))
        .to.be.revertedWith("VM Exception while processing transaction: revert IDO: exceed offering amount")
    })
  
    it("should purchase sale token with eth", async function () {
      /** 
       * If user send 1781.25 eth, user will get 15 sale token.
       */
      await this.ido.connect(this.bob).purchaseSaleTokenWithEth(1,  {value: getBigNumber(178125, 16),})
      expect(await this.yfi.balanceOf(this.bob.address)).to.equal(getBigNumber(10000000).add(getBigNumber(15)))
    })
  
    it("should purchase sale token with eth (referrer)", async function () {
      /** 
       * If user send 1781.25 eth, user will get 15 sale token.
       * owner - 98% of eth
       * referrer - 1% of eth
       * feeTo - 1% of eth
       */
      await this.ido.connect(this.bob).setReferralAddress(this.carol.address)
      const initialBobEthAmount = await ethers.provider.getBalance(this.bob.address)
      const initialOwnerEthAmount = await ethers.provider.getBalance((await this.ido.poolInfo(0)).owner)
      const initialFeeEthAmount = await ethers.provider.getBalance(this.feeTo.address)
      const initialReferrerEthAmount = await ethers.provider.getBalance(await this.ido.referralInfo(this.bob.address))
      await this.ido.connect(this.bob).purchaseSaleTokenWithEth(1,  {value: getBigNumber(178125, 16),})
      
      expect(initialBobEthAmount.sub(await ethers.provider.getBalance(this.bob.address))).to.within(getBigNumber(178125, 16), getBigNumber(178126, 16))
      expect((await ethers.provider.getBalance((await this.ido.poolInfo(0)).owner)).sub(initialOwnerEthAmount)).to.eq(getBigNumber(178125, 16).sub(getBigNumber(178125 * 2, 14))) // 98%
      
      expect((await ethers.provider.getBalance(this.feeTo.address)).sub(initialFeeEthAmount)).to.eq(getBigNumber(178125, 14)) // 1%
      expect((await ethers.provider.getBalance(await this.ido.referralInfo(this.bob.address))).sub(initialReferrerEthAmount)).to.eq(getBigNumber(178125, 14)) // 1%
      
      expect(await this.yfi.balanceOf(this.bob.address)).to.equal(getBigNumber(10000000 + 15))
    })
  })
});