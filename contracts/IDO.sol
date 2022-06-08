pragma solidity 0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "hardhat/console.sol";

contract IDO is Ownable {
    using SafeERC20 for IERC20;

    // Info of each user.
    struct UserInfo {
        uint256 purchasedAmount; // How many tokens the user purchased.
    }

    struct PoolInfo {
        string poolName;
        address owner;
        address saleToken;
        address baseToken;
        uint256 price; // if price is 1e17, 1 SaleToken = 0.1 BaseToken. times by 1e18
        uint256 offeringAmount;
        uint256 userLimitedAmount;
        uint256 saledAmount;
        uint256 startTime;
        uint256 expiryTime;
        PriceCurve curveType;
        uint256[] curveParams;
        /**
            LINEAR:
                [0]: initila price
                [1]: final price
         */
    }

    enum PriceCurve {
        DEFAULT,
        LINEAR
    }
    
    PoolInfo[] public poolInfo;
    mapping(uint256 => mapping(uint256 => uint256)) curveParams;

    // Info of each user that purchased tokens.
    mapping(uint256 => mapping(address => UserInfo)) public userInfo;

    mapping(address => address) public referralInfo;

    address public feeTo;
    uint16 public fee; // over 1e5, 1000 means 1%
    uint16 referralFee; // over 1e5, 1000 means 1%

    bool unlocked;

    event PurchaseSaleToken(
        uint256 _pid,
        address saleToken,
        uint256 saleAmount,
        address baseToken,
        uint256 baseAmount
    );

    event PurchaseSaleTokenWithEth(
        uint256 _pid,
        address saleToken,
        uint256 saleAmount,
        uint256 baseAmount
    );

    constructor() public {
        unlocked = true;
        fee = 1000;
        referralFee = 1000; 
        feeTo = msg.sender;
    }

    modifier validPool(uint256 _pid) {
        require(_pid < poolInfo.length, "IDO: pool not exist");
        _;
    }

    modifier lock() {
        require(unlocked == true, "IDO: locked");
        unlocked = false;
        _;
        unlocked = true;
    }

    function setFeeTo(address _feeTo) external onlyOwner {
        feeTo = _feeTo;
    }

    function setFee(uint16 _fee) external onlyOwner {
        require(_fee < 1e3);
        fee = _fee;
    }

    function setReferralFee(uint16 _referralFee) external onlyOwner {
        require(_referralFee < 1e3);
        referralFee = _referralFee;
    }

    function setReferralAddress(address _referralAddress) external {
        referralInfo[msg.sender] = _referralAddress;
    }

    function createPool(
        string memory _poolName,
        address _saleToken,
        address _baseToken,
        uint256 _price,
        uint256 _offeringAmount,
        uint256 _userLimitedAmount,
        uint256 _startTime,
        uint256 _expiryTime,
        PriceCurve _curveType,
        uint256[] memory _curveParams
    ) external lock returns (uint256 _pid) {
        require(_saleToken != address(0), "IDO: zero address");
        require(_baseToken != address(0), "IDO: zero address");
        require(_startTime >= block.timestamp, "IDO: wrong startTime");
        require(_expiryTime >= _startTime, "IDO: wrong endTime");
        if (_curveType == PriceCurve.LINEAR) {
            require(_curveParams[0] < _curveParams[1], "IDO: final price should be gt initial price");
        }
        _transferAndCheck(
            msg.sender,
            address(this),
            _saleToken,
            _offeringAmount
        );

        _pid = poolInfo.length;
        poolInfo.push(
            PoolInfo({
                poolName: _poolName,
                owner: msg.sender,
                saleToken: _saleToken,
                baseToken: _baseToken,
                price: _price,
                offeringAmount: _offeringAmount,
                userLimitedAmount: _userLimitedAmount,
                saledAmount: 0,
                startTime: _startTime,
                expiryTime: _expiryTime,
                curveType: _curveType,
                curveParams: _curveParams
            })
        );
    }


    function purchaseSaleToken(uint256 _pid, uint256 _baseAmount)
        external
        validPool(_pid)
        lock
    {
        PoolInfo storage pool = poolInfo[_pid];
        require(pool.startTime >= block.timestamp, "IDO: not launched pool");
        require(pool.expiryTime >= block.timestamp, "IDO: expired pool");
        UserInfo storage user = userInfo[_pid][msg.sender];
        uint256 saleAmount;
        if (pool.curveType == PriceCurve.DEFAULT) {
            saleAmount = (_baseAmount * 1e18) / pool.price;
        } else {
            saleAmount = getLinearAmount(
                _baseAmount, pool.curveParams[0], pool.curveParams[1], pool.offeringAmount, pool.saledAmount);
        }
        require(pool.saledAmount + saleAmount <= pool.offeringAmount, 
            "IDO: exceed offering amount"
        );
        require(
            user.purchasedAmount + saleAmount <= pool.userLimitedAmount,
            "IDO: exceed limited amount"
        );
        user.purchasedAmount += saleAmount;
        pool.saledAmount += saleAmount;

        uint256 feeAmount = _baseAmount / 100;
        uint256 referrerAmount = referralInfo[msg.sender] != address(0) ? _baseAmount / 100 : 0;
        uint256 ownerAmount;
        unchecked {
             ownerAmount = _baseAmount - feeAmount - referrerAmount;
        }
        _transferAndCheck(
            msg.sender,
            pool.owner,
            pool.baseToken,
            ownerAmount
        );
        _transferAndCheck(
            msg.sender,
            feeTo,
            pool.baseToken,
            feeAmount
        );
        if (referralInfo[msg.sender] != address(0)) {
            _transferAndCheck(
                msg.sender,
                referralInfo[msg.sender],
                pool.baseToken,
                referrerAmount
            );
        }

        IERC20(pool.saleToken).safeTransfer(msg.sender, saleAmount);

        emit PurchaseSaleToken(
            _pid,
            pool.saleToken,
            saleAmount,
            pool.baseToken,
            _baseAmount
        );
    }

    function purchaseSaleTokenWithEth(uint256 _pid)
        external
        payable
        validPool(_pid)
        lock
    {
        PoolInfo storage pool = poolInfo[_pid];
        require(pool.baseToken == address(this), "IDO: wrong pool");
        require(pool.startTime >= block.timestamp, "IDO: not launched pool");
        require(pool.expiryTime >= block.timestamp, "IDO: expired pool");
        UserInfo storage user = userInfo[_pid][msg.sender];
        uint256 saleAmount;
        if (pool.curveType == PriceCurve.DEFAULT) {
            saleAmount = (msg.value * 1e18) / pool.price;
        } else {
            saleAmount = getLinearAmount(
                msg.value, pool.curveParams[0], pool.curveParams[1], pool.offeringAmount, pool.saledAmount);
        }
        require(
            user.purchasedAmount + saleAmount <= pool.userLimitedAmount,
            "IDO: exceed limited amount"
        );
        user.purchasedAmount += saleAmount;
        pool.saledAmount += saleAmount;

        uint256 feeAmount = msg.value / 100;
        uint256 referrerAmount = referralInfo[msg.sender] != address(0) ? msg.value / 100 : 0;
        uint256 ownerAmount;
        unchecked {
             ownerAmount = msg.value - feeAmount - referrerAmount;
        }
        payable(pool.owner).transfer(ownerAmount);
        payable(feeTo).transfer(feeAmount);

        if (referralInfo[msg.sender] != address(0)) {
            payable(referralInfo[msg.sender]).transfer(referrerAmount);
        }

        IERC20(pool.saleToken).safeTransfer(msg.sender, saleAmount);

        emit PurchaseSaleTokenWithEth(
            _pid,
            pool.saleToken,
            saleAmount,
            msg.value
        );
    }

    function _transferAndCheck(
        address from,
        address to,
        address _token,
        uint256 amount
    ) internal {
        uint256 balanceIn0 = IERC20(_token).balanceOf(to);
        IERC20(_token).safeTransferFrom(from, to, amount);
        uint256 balanceIn1 = IERC20(_token).balanceOf(to);
        require(
            balanceIn1 - balanceIn0 == amount,
            "IDO: insufficient token amount"
        );
    }

    // tokens sold
    // uint256 tokensSold;
    // // tokens to be sold in total

    // uint tokensToBeSold = 100000000*(10**18);    // uint ip = 5000;
    // uint fp = 10000;
    // final price - initial price
    // uint256 pd = fp - ip;
    // total supply * initial price
    

    // helper token emission functions
    function getLinearAmount(uint256 amount, uint256 ip, uint256 fp, uint256 offeringAmount, uint256 saledAmount) public pure returns (uint256){
        // , uint256 ip, uint256 fp
        uint256 tsip = offeringAmount * ip / 1e18;
        uint256 pd = fp - ip;
        uint256 a = sqrt(4 * ((tsip + pd * saledAmount / 1e18) ** 2) + amount * 8 * pd * offeringAmount / 1e18);
        uint256 b = 2 * (tsip + pd * saledAmount / 1e18);
        uint256 c = 2 * pd;

        // get a result with
        
        return round(((a - b)* 10) * 1e18 / c);
    }

    // Babylonian method
    function sqrt(uint x) public pure returns (uint y) {
        uint z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }
    // Rounding function for the first decimal
    function round(uint x) public pure returns (uint y) {
        uint z = x % 10;

        if (z < 5) {
            return x / 10;
        }

        else {
            return (x / 10) + 1;
        }
    }
}
