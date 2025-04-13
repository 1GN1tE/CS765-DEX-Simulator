// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./LPToken.sol";

contract DEX {
    IERC20 public tokenA;
    IERC20 public tokenB;
    LPToken public lpToken;

    // maintaining internal reserve of tokenA and tokenB
    uint256 public reserveA;
    uint256 public reserveB;
    uint256 public returnA;
    uint256 public returnB;
    uint256 public swapFees;

    address[] public LPaddress;

    constructor(address _tokenA, address _tokenB) {
        tokenA = IERC20(_tokenA);
        tokenB = IERC20(_tokenB);
        lpToken = new LPToken();
    }

    // function to add tokens into DEX pool
    function depositTokens(uint256 tokenAAmount, uint256 tokenBAmount) external {

        require(tokenAAmount > 0 && tokenBAmount > 0, "Amounts must be positive");

        // address of liquidity provider
        address user = msg.sender;
        // address of DEX contract
        address dex = address(this);


        // no amount has been deposited into DEX pool yet
        if (reserveA == 0 && reserveB == 0) {
            
            // Transfer tokenA and tokenB from user(liquidity provider) to DEX pool
            require(tokenA.transferFrom(user, dex, tokenAAmount), "Failed to add tokenA into DEX pool");
            require(tokenB.transferFrom(user, dex, tokenBAmount), "Failed to add tokenB into DEX pool");

            // set initial reserve token amount
            reserveA = tokenAAmount;
            reserveB = tokenBAmount;

            /* 
                mint LP tokens and give to user(liquidity provider)
                starting conversion rate -> 1LP token = 100 tokenA
            */
            uint256 lpAmount = getLpTokenAmountFromTokenA(tokenAAmount);
            lpToken.mint(user, lpAmount);
            addToLPaddressList(user);
            return;
        }

        /* 
            some amount of tokens were already deposited before. Now we need to mint LP tokens
            in proportion.
        */

        // ratio of deposited amount must be same.
        // i.e reserveA/reserveB = tokenAAmount/tokenBAmount
        require(reserveA/reserveB == tokenAAmount/tokenBAmount, "Token not deposited in correct proportion");

        // Transfer tokenA and tokenB from user(liquidity provider) to DEX pool
        require(tokenA.transferFrom(user, dex, tokenAAmount), "Failed to add tokenA into DEX pool");
        require(tokenB.transferFrom(user, dex, tokenBAmount), "Failed to add tokenB into DEX pool");

        
        uint256 lpTokenAmount = getLpTokenAmountFromTokenA(tokenAAmount);
        lpToken.mint(user, lpTokenAmount);

        // update reserve token amount
        reserveA += tokenAAmount;
        reserveB += tokenBAmount;

    }

    // function to add tokens into DEX pool
    function withdrawTokens(uint256 lpTokenAmount) external {
        // address of liquidity provider
        address user = msg.sender;
        // address of DEX contract
        // address dex = address(this);

        require(lpTokenAmount > 0, "LP token must be positive number");
        require(reserveA > 0, "DEX pool not initialized");

        // calculate amount of tokens to sent to user(liquidity provider)
        uint256 amountA = getTokenAFromLpToken(lpTokenAmount);
        uint256 amountB = (amountA * reserveB) / reserveA;

        // transfer tokens from DEX pool to user
        tokenA.transfer(user, amountA);
        tokenB.transfer(user, amountB);

        // update token reserves
        reserveA -= amountA;
        reserveB -= amountB;
        returnA=amountA;
        returnB=amountB;
        // burn lpToken of user
        lpToken.burn(user, lpTokenAmount);

    }

    /*
        function to swap tokenA for tokenB
        need to preserve constant product during swapping i.e x * y = k
        So, here (x + xa)(y - ya) = x * y -> ya = y - x*y/(x + xa)
    */
    function swapAToB(uint256 amountA) external returns (uint256) {
        // address of liquidity provider
        address user = msg.sender;
        // address of DEX contract
        address dex = address(this);

        
        require(amountA > 0, "Insufficient tokenA provided");

        require(tokenA.transferFrom(user, dex, amountA), "TokenA transfer failed");

        // deduct 3% swap fee
        swapFees = (amountA * 3) / 1000;
        amountA = amountA - swapFees;
        
        uint256 amountBToSend = reserveB - (reserveA * reserveB) / (amountA + reserveA);
        require(amountBToSend > 0, "Insufficient tokenB present for transfer");
        require(tokenB.transfer(user, amountBToSend), "TokenB transfer failed");

        reserveA += amountA;
        reserveB -= amountBToSend;
        returnB=amountBToSend;
        
        distributeSwapFees(swapFees, true, user);
        return amountBToSend;
    }

    /*
        function to swap tokenB for tokenA
        need to preserve constant product during swapping i.e x * y = k
        So, here (x - xa)(y + ya) = x * y -> xa = x - x*y/(y + ya)
    */
    function swapBToA(uint256 amountB) external returns (uint256) {
        // address of liquidity provider
        address user = msg.sender;
        // address of DEX contract
        address dex = address(this);

        
        require(amountB > 0, "Insufficient tokenB provided");
        require(tokenB.transferFrom(user, dex, amountB), "TokenB transfer failed");

        // deduct 3% swap fee
        swapFees = (amountB * 3) / 1000;
        amountB = amountB - swapFees;

        uint256 amountAToSend = reserveA - (reserveA * reserveB) / (amountB + reserveB);
        require(amountAToSend > 0, "Insufficient tokenA present for transfer");

        require(tokenA.transfer(user, amountAToSend), "TokenA transfer failed");

        reserveA -= amountAToSend;
        reserveB += amountB;
        returnB=amountAToSend;
        distributeSwapFees(swapFees, false, user);
        return amountAToSend;

    }

    // function to distribute swap fees to LPs
    function distributeSwapFees(uint256 fees, bool isTokenA, address receiverAddr) internal {
        uint256 totalLPSupply = lpToken.totalSupply();
        if(totalLPSupply == 0) {
            return;
        }
        for(uint256 i = 0; i < LPaddress.length; ++i) {
            uint256 lpTokens = lpToken.balanceOf(LPaddress[i]);
            if(lpTokens <= 0) {
                continue;
            }
            uint256 feeReward = (lpTokens * fees) / totalLPSupply;
            if(isTokenA) {
                tokenA.transfer(receiverAddr, feeReward);
            } else {
                tokenB.transfer(receiverAddr, feeReward);
            }
        }
    }

    function addToLPaddressList(address addr) internal {
        bool found = false;
        for(uint256 i = 0; i < LPaddress.length; ++i) {
            if(LPaddress[i] == addr) {
                found = true;
                break;
            }
        }
        if(!found) {
            LPaddress.push(addr);
        }
    }


    /*
        convert LP tokens in correct proportion and give to user(liquidity provider)
        starting conversion formula currently used -> 1LP token = 100 tokenA
        lpTokenMinted = reserveA / (totalLpTokenSupply * tokenAAmount)
    */
    function getLpTokenAmountFromTokenA(uint256 amountA) internal view returns (uint256) {

        uint256 totalLPTokenSupply = lpToken.totalSupply();
        if(totalLPTokenSupply == 0) {
            return amountA / 100;
        }
        require(reserveA > 0, "reserveB cannot be zero");
        uint256 totalLpMinted = (totalLPTokenSupply * amountA) / reserveA;
        return totalLpMinted;
    }

    /*
        convert LP tokens to tokenA
        amountA = (lpAmount * reserveA) / totalLpTokenSupply;
    */
    function getTokenAFromLpToken(uint256 lpAmount) internal view returns (uint256) {

        uint256 totalLPTokenSupply = lpToken.totalSupply();

        require(totalLPTokenSupply > 0, "No LP tokens exist");

        uint256 amountA = (lpAmount * reserveA) / totalLPTokenSupply;
        return amountA;
    }

    // function to calculate reserve ratio of A to B
    function getSpotPriceForA() public view returns (uint256){
        require(reserveB > 0, "reserveB cannot be zero");
        return (reserveA * 1e18) / reserveB;
    }

    // function to calculate reserve ratio of B to A
    function getSpotPriceForB() public view returns (uint256){
        require(reserveA > 0, "reserveA cannot be zero");
        return (reserveB * 1e18) / reserveA;
    }

    function getLpTokenAmount() external view returns(uint256) {
        return lpToken.totalSupply();
    }

    function getReserves() public view returns(uint256, uint256) {
        return (reserveA, reserveB);
    }

    function getReserveA() public view returns(uint256) {
        return reserveA;
    }

    function getReserveB() public view returns(uint256) {
        return reserveB;
    }
}
