// Helper: convert human-readable (e.g., "1.5") to BN in wei
// 1.5 ether => BN("1500000000000000000")

function scaleUpBN(amount) {
    // Limit precision to 18 decimal places
    amount = parseFloat(amount).toFixed(18);
    return web3.utils.toBN(web3.utils.toWei(amount.toString(), 'ether'));
}

// Helper: convert BN in wei to human-readable string
function scaleDownBN(bn) {
    return web3.utils.fromWei(bn, 'ether');
}

function printOutput(amountChosen, actionType, profitAchieved) {
    amountChosen = web3.utils.toBN(amountChosen);
    actionType = parseInt(actionType);
    profitAchieved = web3.utils.toBN(profitAchieved);
    //scale down
    amountChosen = scaleDownBN(amountChosen);
    profitAchieved = scaleDownBN(profitAchieved);
    switch (actionType) {
        case 0: console.log(`No profit exist`);
            return;
        case 1: console.log(`B -> A -> B, from dexA to dexB`);
            break;
        case 2: console.log(`A -> B -> A, from dexB to dexA`);
            break;
        case 3: console.log(`B -> A -> B from dexB to dexA`);
            break;
        case 4: console.log(`A -> B -> A from dexA to dexB`);
            break;
        case 5: console.log(`Opportunity exists but not profitable enough`);
            return;
        default: console.log(`Something wrong`);

    }    console.log(`Amount chosen for swapping ${amountChosen} and profit acheived ${profitAchieved} `);
}

async function simulateDEX(dis, N) {
    try {
        console.log("Starting Simulation for Arbitrage.......");

        let tokenMetadata = JSON.parse(await remix.call('fileManager', 'getFile', 'browser/contracts/artifacts/Token.json'));
        let dexMetadata = JSON.parse(await remix.call('fileManager', 'getFile', 'browser/contracts/artifacts/DEX.json'));
        let lpTokenMetadata = JSON.parse(await remix.call('fileManager', 'getFile', 'browser/contracts/artifacts/LPToken.json'));
        let arbitrageMetadata = JSON.parse(await remix.call('fileManager', 'getFile', 'browser/contracts/artifacts/Arbitrage.json'));
        if (!tokenMetadata || !dexMetadata || !lpTokenMetadata) {
            throw new Error('Missing Compiled artifact: compile all smart contracts');
        }

        // ABI → used to interact with the contract
        // bytecode → used to deploy the contract
        let tokenABI = tokenMetadata.abi;
        let tokenByteCode = tokenMetadata.data?.bytecode?.object || tokenMetadata.bytecode;
        let dexABI = dexMetadata.abi;
        let dexByteCode = dexMetadata.data?.bytecode?.object || dexMetadata.bytecode;
        let LPTokenABI = lpTokenMetadata.abi;
        let LPTokenByteCode = lpTokenMetadata.data?.bytecode?.object || lpTokenMetadata.bytecode;
        let arbitrageABI = arbitrageMetadata.abi;
        let arbitrageByteCode = arbitrageMetadata.data?.bytecode?.object || arbitrageMetadata.bytecode;

        let accounts = await web3.eth.getAccounts();
        let deployer = accounts[0];
        let LPs = accounts.slice(1, 6);
        let traders = accounts.slice(6, 14);
        let allUsers = LPs.concat(traders);

        // Deploying Token A
        let TokenA = new web3.eth.Contract(tokenABI);
        let initialDistribution = scaleUpBN(dis.toString());
        let tokenAInstance = await TokenA.deploy({
            data: tokenByteCode,
            arguments: ['TokenA', 'TKA', initialDistribution]
        }).send({ from: deployer, gas: 30000000 });

        // Deploying Token B
        let TokenB = new web3.eth.Contract(tokenABI);
        let tokenBInstance = await TokenB.deploy({
            data: tokenByteCode,
            arguments: ['TokenB', 'TKB', initialDistribution]
        }).send({ from: deployer, gas: 30000000 });

        console.log('TokenA deployed at: ', tokenAInstance.options.address);
        console.log('TokenB deployed at: ', tokenBInstance.options.address);

        // Deploying DEX1
        let DEX1 = new web3.eth.Contract(dexABI);
        let dex1Instance = await DEX1.deploy({
            data: dexByteCode,
            arguments: [tokenAInstance.options.address, tokenBInstance.options.address]
        }).send({ from: deployer, gas: 300000000 });

        console.log("DEX1 deployed at ", dex1Instance.options.address);

        // Get LPToken address from DEX
        let lpToken1Address = await dex1Instance.methods.lpToken().call();
        let lpToken1Instance = new web3.eth.Contract(LPTokenABI, lpToken1Address);
        console.log("LPToken deployed at ", lpToken1Instance.options.address);
        // Distributing Tokens
        let perUserAmount = initialDistribution.div(web3.utils.toBN(accounts.length));
        // let balance=tokenAInstance.methods.balanceOf(deployer.options.address).call({from:deployer});
        // console.log(balance);
        // console.log(perUserAmount);
        for (let user of allUsers) {
            await tokenAInstance.methods.transfer(user, perUserAmount).send({ from: deployer });
            await tokenBInstance.methods.transfer(user, perUserAmount).send({ from: deployer });
        }

        console.log(`Token A and Token B ${scaleDownBN(perUserAmount)} has been distributed among all users`);
        // Providing approve to DEX1
        for (let user of allUsers) {
            await tokenAInstance.methods.approve(dex1Instance.options.address, perUserAmount).send({ from: user });
            await tokenBInstance.methods.approve(dex1Instance.options.address, perUserAmount).send({ from: user });
        }

        // Deploying DEX2
        let DEX2 = new web3.eth.Contract(dexABI);
        let dex2Instance = await DEX2.deploy({
            data: dexByteCode,
            arguments: [tokenAInstance.options.address, tokenBInstance.options.address]
        }).send({ from: deployer, gas: 300000000 });

        console.log("DEX2 deployed at ", dex2Instance.options.address);
        // Get LPToken address from DEX
        let lpToken2Address = await dex2Instance.methods.lpToken().call();
        let lpToken2Instance = new web3.eth.Contract(LPTokenABI, lpToken2Address);
        console.log("LPToken deployed at ", lpToken2Instance.options.address);
        // Providing approve to DEX2
        for (let user of allUsers) {
            await tokenAInstance.methods.approve(dex2Instance.options.address, perUserAmount).send({ from: user });
            await tokenBInstance.methods.approve(dex2Instance.options.address, perUserAmount).send({ from: user });
        }

        // Providing Liquidity to dex1 and dex2

        let a = perUserAmount.div(web3.utils.toBN(4));
        let liquidity = parseInt(scaleDownBN(a));
        liquidity = Math.floor(Math.random() * liquidity);
        let randomLiquidity = scaleUpBN(liquidity.toString());

        console.log("Adding Liquidity for DEX1");
        for (let lp of LPs) {
            await dex1Instance.methods.depositTokens(randomLiquidity, randomLiquidity).send({ from: lp })
            let token = await lpToken1Instance.methods.balanceOf(lp).call();
            console.log(`Liquidity provider ${lp} has sended liquidity. LP Token : ${scaleDownBN(token)} tokenA and tokenB: ${scaleDownBN(randomLiquidity)}`);
        }

        console.log("Adding Liquidity for DEX2");
        for (let lp of LPs) {
            await dex2Instance.methods.depositTokens(randomLiquidity, randomLiquidity).send({ from: lp });
            let token = await lpToken2Instance.methods.balanceOf(lp).call();
            console.log(`Liquidity provider ${lp} has sended liquidity. LP Token: ${scaleDownBN(token)} tokenA and tokenB: ${scaleDownBN(randomLiquidity)}`);
        }
        console.log("DEX1 and DEX2 is ready to take tokens from anyone");

        // Deploying arbitrage
        let arbitrage = new web3.eth.Contract(arbitrageABI);
        let arbitrageInstance = await arbitrage.deploy({
            data: arbitrageByteCode,
            arguments: [dex1Instance.options.address, dex2Instance.options.address]
        }).send({ from: deployer });
        for (let user of accounts) {
            await tokenAInstance.methods.approve(arbitrageInstance.options.address, perUserAmount).send({ from: user });
            await tokenBInstance.methods.approve(arbitrageInstance.options.address, perUserAmount).send({ from: user });
        }
        console.log(`Arbitrage has been deployed at ${arbitrageInstance.options.address} and approve is also done`);

        
        // Case 1: No arbitrage opportunity
        console.log(`----------------- Case 1: -------------------`);
        console.log(`No arbitrage opportunity`);

        let rA1 = web3.utils.toBN(await dex1Instance.methods.reserveA().call({ from: deployer }));
        rA1 = scaleDownBN(rA1);
        let rB1 = web3.utils.toBN(await dex1Instance.methods.reserveB().call({ from: deployer }));
        rB1 = scaleDownBN(rB1);
        let rA2 = web3.utils.toBN(await dex2Instance.methods.reserveA().call({ from: deployer }));
        rA2 = scaleDownBN(rA2);
        let rB2 = web3.utils.toBN(await dex2Instance.methods.reserveB().call({ from: deployer }));
        rB2 = scaleDownBN(rB2);
        console.log(`Reserve in different DEX pools ${rA1}, ${rB1} and ${rA2}, ${rB2}`);
        console.log(`Ratio in different DEX pools ${rA1 / rB1}:1 and ${rA2 / rB2}:1`);
        console.log(`Trying to perform arbitrage`);
        
        try {
            const res = await arbitrageInstance.methods.performArbitrage().send({ from: traders[0] });

            if (res.events && res.events.ArbitrageExecuted) {
                const eventData = res.events.ArbitrageExecuted.returnValues;
                printOutput(eventData.amountChosen, eventData.actionType, eventData.profitAchieved);
            } else {
                console.log("ArbitrageExecuted event not found in transaction result.");
            }
        }
        catch (error) {
            console.log(`Something went wrong`);
        }
        
        console.log(`---------------------------------------------`);

        // Swapping in one DEX to create arbitrage opportunity
        console.log(`Performing swaping in one dex to create arbitrage oppertunity`);
        await dex2Instance.methods.swapAToB(web3.utils.toBN("1000000000000000000000")).send({ from: traders[0] });

        // Case 2: Arbitrage opportunity exists but not profitable enough
        console.log(`----------------- Case 2: -------------------`);
        console.log(`Arbitrage opportunity exists but not profitable enough`);

        rA1 = web3.utils.toBN(await dex1Instance.methods.reserveA().call({ from: deployer }));
        rA1 = scaleDownBN(rA1);
        rB1 = web3.utils.toBN(await dex1Instance.methods.reserveB().call({ from: deployer }));
        rB1 = scaleDownBN(rB1);
        rA2 = web3.utils.toBN(await dex2Instance.methods.reserveA().call({ from: deployer }));
        rA2 = scaleDownBN(rA2);
        rB2 = web3.utils.toBN(await dex2Instance.methods.reserveB().call({ from: deployer }));
        rB2 = scaleDownBN(rB2);
        console.log(`Reserve in different DEX pools ${rA1}, ${rB1} and ${rA2}, ${rB2}`);
        console.log(`Ratio in different DEX pools ${rA1 / rB1}:1 and ${rA2 / rB2}:1`);
        console.log(`Trying to perform arbitrage`);

        let trader = traders[Math.floor(Math.random() * traders.length)];

        try {
            const res = await arbitrageInstance.methods.performArbitrage().send({ from: traders[0] });

            if (res.events && res.events.ArbitrageExecuted) {
                const eventData = res.events.ArbitrageExecuted.returnValues;
                printOutput(eventData.amountChosen, eventData.actionType, eventData.profitAchieved);
            }
            else {
                console.log("ArbitrageExecuted event not found in transaction result.");
            }
        } catch (error) {
            console.log(`Something went wrong`);
        }

        console.log(`---------------------------------------------`);

        // Case 3: Arbitrage opportunity exists
        console.log(`----------------- Case 3: -------------------`);
        console.log(`Arbitrage opportunity exists`);

        for (let i = 1; i < N; i++) {
            // Swapping in both DEX to create some randomness
            console.log(`Swapping in both DEX to create some randomness`);

            console.log(`Swapping in DEX1`);
            for (let trader of traders) {
                let balanceA = web3.utils.toBN(await tokenAInstance.methods.balanceOf(trader).call({ from: trader }));
                let balanceB = web3.utils.toBN(await tokenBInstance.methods.balanceOf(trader).call({ from: trader }));
                let resA = web3.utils.toBN(await dex1Instance.methods.reserveA().call({ from: trader }));
                let resB = web3.utils.toBN(await dex1Instance.methods.reserveB().call({ from: trader }));

                let swapAtoB = Math.random() < 0.5;
                if (swapAtoB && resA.gt(web3.utils.toBN(0)) && resB.gt(web3.utils.toBN(0))) {
                    // console.log(`A->B`);
                    let maxSwap = balanceA.lt(resA.div(web3.utils.toBN(10))) ? balanceA : resA.div(web3.utils.toBN(10));
                    if (maxSwap.gt(web3.utils.toBN(0))) {
                        let n = parseFloat(scaleDownBN(maxSwap));
                        n = Math.random() * n;
                        let amountA = scaleUpBN(n.toString());
                        await dex1Instance.methods.swapAToB(amountA).send({ from: trader });
                    }
                } else if (resA.gt(web3.utils.toBN(0)) && resB.gt(web3.utils.toBN(0))) {
                    // console.log(`B->A`);
                    let maxSwap = balanceB.lt(resB.div(web3.utils.toBN(10))) ? balanceB : resB.div(web3.utils.toBN(10));
                    if (maxSwap.gt(web3.utils.toBN(0))) {
                        let n = parseFloat(scaleDownBN(maxSwap));
                        n = Math.random() * n + 1;
                        let amountB = scaleUpBN(n.toString());
                        await dex1Instance.methods.swapBToA(amountB).send({ from: trader });
                    }
                }
            }

            console.log(`Swapping in DEX2`);
            for (let trader of traders) {
                let balanceA = web3.utils.toBN(await tokenAInstance.methods.balanceOf(trader).call({ from: trader }));
                let balanceB = web3.utils.toBN(await tokenBInstance.methods.balanceOf(trader).call({ from: trader }));
                let resA = web3.utils.toBN(await dex2Instance.methods.reserveA().call({ from: trader }));
                let resB = web3.utils.toBN(await dex2Instance.methods.reserveB().call({ from: trader }));

                let swapAtoB = Math.random() < 0.5;
                if (swapAtoB && resA.gt(web3.utils.toBN(0)) && resB.gt(web3.utils.toBN(0))) {
                    // console.log(`A->B`);
                    let maxSwap = balanceA.lt(resA.div(web3.utils.toBN(10))) ? balanceA : resA.div(web3.utils.toBN(10));
                    if (maxSwap.gt(web3.utils.toBN(0))) {
                        let n = parseFloat(scaleDownBN(maxSwap));
                        n = Math.random() * n;
                        let amountA = scaleUpBN(n.toString());
                        await dex2Instance.methods.swapAToB(amountA).send({ from: trader });
                    }

                } else if (resA.gt(web3.utils.toBN(0)) && resB.gt(web3.utils.toBN(0))) {
                    // console.log(`B->A`);
                    let maxSwap = balanceB.lt(resB.div(web3.utils.toBN(10))) ? balanceB : resB.div(web3.utils.toBN(10));
                    if (maxSwap.gt(web3.utils.toBN(0))) {
                        let n = parseFloat(scaleDownBN(maxSwap));
                        n = Math.random() * n + 1;
                        let amountB = scaleUpBN(n.toString());
                        await dex2Instance.methods.swapBToA(amountB).send({ from: trader });
                    }
                }
            }

            console.log(`-----We are at iteration ${i}-----`);

            rA1 = web3.utils.toBN(await dex1Instance.methods.reserveA().call({ from: deployer }));
            rA1 = scaleDownBN(rA1);
            rB1 = web3.utils.toBN(await dex1Instance.methods.reserveB().call({ from: deployer }));
            rB1 = scaleDownBN(rB1);
            rA2 = web3.utils.toBN(await dex2Instance.methods.reserveA().call({ from: deployer }));
            rA2 = scaleDownBN(rA2);
            rB2 = web3.utils.toBN(await dex2Instance.methods.reserveB().call({ from: deployer }));
            rB2 = scaleDownBN(rB2);

            console.log(`Reserve in different DEX pools ${rA1}, ${rB1} and ${rA2}, ${rB2}`);
            console.log(`Ratio in different DEX pools ${rA1 / rB1}:1 and ${rA2 / rB2}:1`);

            try {
                let trader = traders[Math.floor(Math.random() * traders.length)];
                console.log(`Random trader selected: ${trader}`)
                let balanceA = await tokenAInstance.methods.balanceOf(trader).call({ from: trader });
                let balanceB = await tokenBInstance.methods.balanceOf(trader).call({ from: trader });
                const res = await arbitrageInstance.methods.performArbitrage().send({ from: trader });

                if (res.events && res.events.ArbitrageExecuted) {
                    const eventData = res.events.ArbitrageExecuted.returnValues;
                    printOutput(eventData.amountChosen, eventData.actionType, eventData.profitAchieved);
                }
                else {
                    console.log("ArbitrageExecuted event not found in transaction result.");
                }

                let _balanceA = await tokenAInstance.methods.balanceOf(trader).call({ from: trader });
                let _balanceB = await tokenBInstance.methods.balanceOf(trader).call({ from: trader });
                console.log(`INITIAL BALANCE: ${scaleDownBN(balanceA)} and ${scaleDownBN(balanceB)}`);
                console.log(`FINAL BALANCE: ${scaleDownBN(_balanceA)} and ${scaleDownBN(_balanceB)}`);
            } catch (error) {
                console.log(`Something went wrong`);
            }
        }

        console.log(`---------------------------------------------`);
    }
    catch (error) {
        console.error("Error in simulation ", error);
    }
}

simulateDEX(15 * 10 ** 6, 5);
