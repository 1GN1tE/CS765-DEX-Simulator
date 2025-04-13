// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.26;

import "./DEX.sol";

contract Arbitrage {
    DEX dexA;
    DEX dexB;

    IERC20 tokenA;
    IERC20 tokenB;

    uint256 MIN_PROFIT_THRESHOLD = 1e15;

    event ArbitrageExecuted(uint256 amountChosen, uint256 actionType, uint256 profitAchieved);

    constructor(address addrDexA, address addrDexB) {
        dexA = DEX(addrDexA);
        dexB = DEX(addrDexB);

        // token address will be same for both DEXs
        tokenA = IERC20(dexA.tokenA());
        tokenB = IERC20(dexB.tokenB());
    }

    function performArbitrage() external returns (uint256 amountChosen, uint256 actionType, uint256 profitAchieved) {
        amountChosen = 0;
        actionType = 0;
        profitAchieved = 0;

        address user = msg.sender;
        uint256 userTokenABalance = tokenA.balanceOf(user);
        uint256 userTokenBBalance = tokenB.balanceOf(user);

        uint256 spotPriceDexA = dexA.getSpotPriceForA();
        uint256 spotPriceDexB = dexB.getSpotPriceForA();
        // require(spotPriceDexA != spotPriceDexB, "Arbitrage opportunity currently does not exits!");

        (uint256 reserveA1, uint256 reserveB1) = dexA.getReserves();
        (uint256 reserveA2, uint256 reserveB2) = dexB.getReserves();

        if (spotPriceDexA > spotPriceDexB) {
            // 1. try arbitrage from B -> A -> B, from dexA to dexB
            (uint256 amountB, uint256 profitB) = findOpportunity(userTokenBBalance, reserveB1, reserveA1, reserveA2, reserveB2);
            // 2. try arbitrage from A -> B -> A, from dexB to dexA
            (uint256 amountA, uint256 profitA) = findOpportunity(userTokenABalance, reserveA2, reserveB2, reserveB1, reserveA1);

            if (profitB > profitA) {
                profitAchieved = profitB;
                amountChosen = amountB;
                actionType = 1;
            } else {
                profitAchieved = profitA;
                amountChosen = amountA;
                actionType = 2;
            }
        } else if (spotPriceDexA < spotPriceDexB) {
            // try arbitrage from B -> A -> B from dexB to dexA
            (uint256 amountB, uint256 profitB) = findOpportunity(userTokenBBalance, reserveB2, reserveA2, reserveA1, reserveB1);
            // try arbitrage from A -> B -> A from dexA to dexB
            (uint256 amountA, uint256 profitA) = findOpportunity(userTokenABalance, reserveA1, reserveB1, reserveB2, reserveA2);
            if(profitB > profitA) {
                profitAchieved = profitB;
                amountChosen = amountB;
                actionType = 3;
            } else {
                profitAchieved = profitA;
                amountChosen = amountA;
                actionType = 4;
            }
        }
        // when opportunity exists but not profitable enough
        if (profitAchieved < MIN_PROFIT_THRESHOLD) {
            if (spotPriceDexA == spotPriceDexB) {
                actionType = 0;
            } else {
                actionType = 5;
            }
        }
        // when opportunity exists and is profitable
        else {
            performSwap(amountChosen, actionType, user);
        }
        emit ArbitrageExecuted(amountChosen, actionType, profitAchieved);

        return (amountChosen, actionType, profitAchieved);
    }

    function performSwap(uint256 amount, uint256 actionType, address user) internal {
        // B -> A -> B, from dexA to dexB
        if (actionType == 1) {
            tokenB.transferFrom(user, address(this), amount);
            tokenB.approve(address(dexA), amount);
            uint256 firstSwapAmount = dexA.swapBToA(amount);
            tokenA.approve(address(dexB), firstSwapAmount);
            uint256 finalAmount = dexB.swapAToB(firstSwapAmount);
            tokenB.transfer(user, finalAmount);
        }
        // A -> B -> A, from dexB to dexA
        else if (actionType == 2) {
            tokenA.transferFrom(user, address(this), amount);
            tokenA.approve(address(dexB), amount);
            uint256 firstSwapAmount = dexB.swapAToB(amount);
            tokenB.approve(address(dexA), firstSwapAmount);
            uint256 finalAmount = dexA.swapBToA(firstSwapAmount);
            tokenA.transfer(user, finalAmount);
        }
        // B -> A -> B from dexB to dexA
        else if (actionType == 3) {
            tokenB.transferFrom(user, address(this), amount);
            tokenB.approve(address(dexB), amount);
            uint256 firstSwapAmount = dexB.swapBToA(amount);
            tokenA.approve(address(dexA), firstSwapAmount);
            uint256 finalAmount = dexA.swapAToB(firstSwapAmount);
            tokenB.transfer(user, finalAmount);
        }
        // A -> B -> A from dexA to dexB
        else if (actionType == 4) {
            tokenA.transferFrom(user, address(this), amount);
            tokenA.approve(address(dexA), amount);
            uint256 firstSwapAmount = dexA.swapAToB(amount);
            tokenB.approve(address(dexB), firstSwapAmount);
            uint256 finalAmount = dexB.swapBToA(firstSwapAmount);
            tokenA.transfer(user, finalAmount);
        }
    }

    function findOpportunity(uint256 userBalance, uint256 reserveIn1, uint256 reserveOut1, uint256 reserveIn2, uint256 reserveOut2) internal pure returns(uint256 finalAmount, uint256 profit) {
        finalAmount = 0;
        profit = 0;

        uint256 tolerance = 1e9;
        uint256 start = 1e18;
        uint256 end = userBalance > reserveIn1 ? reserveIn1 : userBalance;

        while (start + tolerance < end) {
            uint256 amount1 = start + (end - start) / 3;
            uint256 amount2 = end - (end - start) / 3;

            uint256 finalAmount1 = calcAfterSwapAmount(amount1, reserveIn1, reserveOut1, reserveIn2, reserveOut2);
            uint256 finalAmount2 = calcAfterSwapAmount(amount2, reserveIn1, reserveOut1, reserveIn2, reserveOut2);

            uint256 profit1 = finalAmount1 > amount1 ? finalAmount1 - amount1 : 0;
            uint256 profit2 = finalAmount2 > amount2 ? finalAmount2 - amount2 : 0;

            if (profit1 < profit2) {
                finalAmount = amount2;
                profit = profit2;
                start = amount1;
            } else {
                finalAmount = amount2;
                profit = profit2;
                end = amount2;
            }
        }

        return (finalAmount, profit);
    }

    function calcAfterSwapAmount(uint256 amount, uint256 reserveIn1, uint256 reserveOut1, uint256 reserveIn2, uint256 reserveOut2) internal pure returns(uint256 finalAmount) {
        uint256 fees1 = (amount * 3) / 1000;
        uint256 midAmount1 = reserveOut1 - (reserveIn1 * reserveOut1) / (reserveIn1 + amount - fees1);

        uint256 fees2 = (midAmount1 * 3) / 1000;
        finalAmount = reserveOut2 - (reserveIn2 * reserveOut2) / (reserveIn2 + midAmount1 - fees2);
    }
}
