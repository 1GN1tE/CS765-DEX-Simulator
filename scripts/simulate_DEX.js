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

async function simulateDEX(dis, N) {
    try {
        console.log('Starting Simulation.......');

        let tokenMetadata = JSON.parse(await remix.call('fileManager', 'getFile', 'browser/contracts/artifacts/Token.json'));
        let dexMetadata = JSON.parse(await remix.call('fileManager', 'getFile', 'browser/contracts/artifacts/DEX.json'));
        let lpTokenMetadata = JSON.parse(await remix.call('fileManager', 'getFile', 'browser/contracts/artifacts/LPToken.json'));

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

        // Deploying DEX
        let DEX = new web3.eth.Contract(dexABI);
        let dexInstance = await DEX.deploy({
            data: dexByteCode,
            arguments: [tokenAInstance.options.address, tokenBInstance.options.address]
        }).send({ from: deployer, gas: 30000000 });

        console.log('DEX deployed at ', dexInstance.options.address);

        // Get LPToken address from DEX
        let lpTokenAddress = await dexInstance.methods.lpToken().call();
        let lpTokenInstance = new web3.eth.Contract(LPTokenABI, lpTokenAddress);
        console.log('LPToken deployed at ', lpTokenInstance.options.address);

        // Distributing Tokens
        let perUserAmount = Math.floor(dis / allUsers.length);
        perUserAmount = scaleUpBN(perUserAmount.toString());

        for (let user of allUsers) {
            await tokenAInstance.methods.transfer(user, perUserAmount).send({ from: deployer });
            await tokenBInstance.methods.transfer(user, perUserAmount).send({ from: deployer });
        }

        console.log(`Token A and Token B ${scaleDownBN(perUserAmount)} has been distributed among all users`);

        // Providing approve to DEX
        for (let user of allUsers) {
            await tokenAInstance.methods.approve(dexInstance.options.address, perUserAmount).send({ from: user });
            await tokenBInstance.methods.approve(dexInstance.options.address, perUserAmount).send({ from: user });
        }
        console.log('DEX is ready to take tokens from anyone');

        // Initializing the DEX Liquidity Pool
        initalAmountA = scaleUpBN('1000');
        initalAmountB = scaleUpBN('1500');
        await dexInstance.methods.depositTokens(initalAmountA, initalAmountB).send({ from: LPs[0] });
        let token = await lpTokenInstance.methods.balanceOf(LPs[0]).call();
        console.log(`First liquidity provider has send liquidity ${LPs[0]}: LP Token : ${scaleDownBN(token)} tokenA: ${scaleDownBN(initalAmountA)} and tokenB: ${scaleDownBN(initalAmountB)}`);

        // Metrics
        let totalSwapVolumeA = new Array(N).fill(0);
        let totalSwapVolumeB = new Array(N).fill(0);
        let totalFeesA = new Array(N).fill(0);
        let totalFeesB = new Array(N).fill(0);
        let reserveRatio = new Array(N).fill(0);
        reserveRatio[0] = initalAmountA / initalAmountB;
        let slippageAtoB = new Array(N).fill(0);
        let slippageBtoA = new Array(N).fill(0);
        let tvl = new Array(N).fill(0);
        tvl[0] = parseFloat(scaleDownBN(initalAmountA)) * 2; // Fix this
        let lpTokenDistribution = {};
        for (let lp of LPs) {
            lpTokenDistribution[lp] = new Array(N).fill(0);
        }

        // Simulating Transactions
        for (let i = 1; i < N; i++) {
            // Decide the action first: 0:deposit, 1:withdraw, 2:swap
            let action = Math.floor(Math.random() * 3);
            console.log(`----------------ITERATION: ${i} ---------------------`);
            console.log(`Action: ${action === 0 ? 'DEPOSIT' : action === 1 ? 'WITHDRAWAL' : 'SWAPPING'}`);

            // Select user based on action type:
            let user;
            if (action === 0 || action === 1) {
                // Only LPs can deposit or withdraw
                user = LPs[Math.floor(Math.random() * LPs.length)];
            } else if (action === 2) {
                // Only traders can swap
                user = traders[Math.floor(Math.random() * traders.length)];
            }

            // Propagate previous iteration's metrics
            // totalSwapVolumeA[i] = totalSwapVolumeA[i - 1];
            // totalSwapVolumeB[i] = totalSwapVolumeB[i - 1];
            // slippageAtoB[i] = slippageAtoB[i - 1];
            // slippageBtoA[i] = slippageBtoA[i - 1];
            // totalFeesA[i] = totalFeesA[i - 1];
            // totalFeesB[i] = totalFeesB[i - 1];
            // reserveRatio[i] = reserveRatio[i - 1];

            try {
                let balanceA = web3.utils.toBN(await tokenAInstance.methods.balanceOf(user).call({ from: user }));
                let balanceB = web3.utils.toBN(await tokenBInstance.methods.balanceOf(user).call({ from: user }));
                let resA = web3.utils.toBN(await dexInstance.methods.reserveA().call({ from: user }));
                let resB = web3.utils.toBN(await dexInstance.methods.reserveB().call({ from: user }));

                let _resA = parseFloat(scaleDownBN(resA));
                let _resB = parseFloat(scaleDownBN(resB));
                reserveRatio[i] = _resA / _resB;

                console.log(`ReserveA: ${_resA.toFixed(18)} ReserveB: ${_resB.toFixed(18)} Ratio: ${reserveRatio[i].toFixed(18)}`);

                if (action === 0) {
                    console.log('Processing deposit...');
                    if (resA.gt(web3.utils.toBN(0)) && resB.gt(web3.utils.toBN(0))) {
                        // Generate random deposit amount for Token A
                        let randomMultiplier = Math.floor(Math.random() * 10) + 1; // 1 to 10
                        let depositAValue = randomMultiplier * 100;

                        // Compute deposit amounts as floating values using the pool's ratio.
                        let resAValue = parseFloat(scaleDownBN(resA));
                        let resBValue = parseFloat(scaleDownBN(resB));
                        let expectedRatio = resBValue / resAValue;
                        let depositBValue = depositAValue * expectedRatio;

                        // Convert these values to BN (wei)
                        let amountA = scaleUpBN(depositAValue.toString());
                        let amountB = scaleUpBN(depositBValue.toString());

                        // Check if user has enough tokens to cover the deposit amounts
                        if (amountA.gt(balanceA) || amountB.gt(balanceB)) {
                            console.log(`Insufficient balance. Required: tokenA: ${scaleDownBN(amountA)} & tokenB: ${scaleDownBN(amountB)}, Available: tokenA: ${scaleDownBN(balanceA)} & tokenB: ${scaleDownBN(balanceB)}`);
                            i--;
                            continue;
                        }

                        // Epsilon tolerance check on the computed ratio.
                        let computedRatio = parseFloat(scaleDownBN(amountB)) / depositAValue;
                        let epsilon = 0.0001;
                        if (Math.abs(expectedRatio - computedRatio) > epsilon) {
                            console.log(`Ratio mismatch: expected ${expectedRatio} vs computed ${computedRatio}. Skipping deposit.`);
                            i--;
                            continue;
                        }

                        if (amountA.gt(web3.utils.toBN(0)) && amountB.gt(web3.utils.toBN(0))) {
                            // Verify LP tokens minted by comparing before and after deposit
                            let beforeLP = web3.utils.toBN(await lpTokenInstance.methods.balanceOf(user).call());
                            await dexInstance.methods.depositTokens(amountA, amountB).send({ from: user });
                            let afterLP = web3.utils.toBN(await lpTokenInstance.methods.balanceOf(user).call());
                            let mintedLP = afterLP.sub(beforeLP);
                            console.log(`Deposited tokenA: ${scaleDownBN(amountA)}, tokenB: ${scaleDownBN(amountB)}; LP tokens received: ${scaleDownBN(mintedLP.toString())}`);
                        }
                    }
                } else if (action === 1) {
                    console.log('Processing withdrawal...');
                    // Retrieve the user's LP token balance in human-readable format.
                    let lpTokenBalanceBN = web3.utils.toBN(await lpTokenInstance.methods.balanceOf(user).call({ from: user }));
                    let lpTokenBalance = parseFloat(scaleDownBN(lpTokenBalanceBN));

                    if (lpTokenBalance >= 0.1) {
                        let steps = Math.floor(lpTokenBalance * 10);
                        let randomStep = Math.floor(Math.random() * steps) + 1;
                        let randomWithdrawal = randomStep / 10;
                        let withdrawLPToken = scaleUpBN(randomWithdrawal.toString());

                        await dexInstance.methods.withdrawTokens(withdrawLPToken.toString()).send({ from: user });
                        let amountA = web3.utils.toBN(await dexInstance.methods.returnA().call({ from: user }));
                        let amountB = web3.utils.toBN(await dexInstance.methods.returnB().call({ from: user }));
                        console.log(`Withdrew ${randomWithdrawal} LP tokens - received tokenA: ${scaleDownBN(amountA)}, tokenB: ${scaleDownBN(amountB)}`);
                    } else {
                        console.log('User has insufficient LP tokens to perform a withdrawal.');
                        i--;
                        continue;
                    }
                } else if (action === 2) {
                    console.log('Processing swap...');
                    let swapAtoB = Math.random() < 0.5;
                    if (swapAtoB && resA.gt(web3.utils.toBN(0)) && resB.gt(web3.utils.toBN(0))) {
                        console.log(`A->B`);
                        // Determine the maximum allowed swap (10% of reserve)
                        let maxSwapCandidate = balanceA.lt(resA.div(web3.utils.toBN(10))) ? balanceA : resA.div(web3.utils.toBN(10));
                        let maxSwap = parseFloat(scaleDownBN(maxSwapCandidate));
                        // Ensure that maxSwap is at least 10; if not, skip the swap
                        if (maxSwap < 10) {
                            console.log('Max swap amount is less than minimum swap (10). Skipping swap.');
                            i--;
                            continue;
                        } else {
                            let randomSwapA = Math.floor(Math.random() * (maxSwap - 10 + 1)) + 10;
                            let amountA = scaleUpBN(randomSwapA.toString());
                            // Only execute swap if the generated amount is non-zero and within the user's balance
                            if (amountA.gt(web3.utils.toBN(0)) && amountA.lte(balanceA)) {
                                await dexInstance.methods.swapAToB(amountA).send({ from: user });
                                let amountB = web3.utils.toBN(await dexInstance.methods.returnB().call({ from: user }));
                                let fees = web3.utils.toBN(await dexInstance.methods.swapFees().call({ from: user }));

                                // Scaling down values for metric calculations
                                amountA = parseFloat(scaleDownBN(amountA));
                                amountB = parseFloat(scaleDownBN(amountB));
                                resA = parseFloat(scaleDownBN(resA));
                                resB = parseFloat(scaleDownBN(resB));
                                fees = parseFloat(scaleDownBN(fees));

                                reserveRatio[i] = amountA / amountB;
                                slippageAtoB[i] = ((amountB / amountA - resB / resA) / (resB / resA)) * 100;
                                totalSwapVolumeA[i] += amountA;
                                totalSwapVolumeB[i] += amountB;
                                totalFeesA[i] += fees;

                                console.log(`Swapped: given amountA: ${amountA} and received amountB: ${amountB}`);
                            } else {
                                console.log('Insufficient balance to perform swap A→B with amount:', randomSwapA);
                                i--;
                                continue;
                            }
                        }
                    } else if (resA.gt(web3.utils.toBN(0)) && resB.gt(web3.utils.toBN(0))) {
                        console.log(`B->A`);
                        // Determine the maximum allowed swap for token B (10% of reserve)
                        let maxSwapCandidate = balanceB.lt(resB.div(web3.utils.toBN(10))) ? balanceB : resB.div(web3.utils.toBN(10));
                        let maxSwap = parseFloat(scaleDownBN(maxSwapCandidate));
                        if (maxSwap < 10) {
                            console.log('Max swap amount is less than minimum swap (10). Skipping swap.');
                            i--;
                            continue;
                        } else {
                            let upperBound = Math.min(1000, maxSwap);
                            let randomSwapB = Math.floor(Math.random() * (upperBound - 10 + 1)) + 10;
                            let amountB = scaleUpBN(randomSwapB.toString());
                            if (amountB.gt(web3.utils.toBN(0)) && amountB.lte(balanceB)) {
                                await dexInstance.methods.swapBToA(amountB).send({ from: user });
                                let amountA = web3.utils.toBN(await dexInstance.methods.returnA().call({ from: user }));
                                let fees = web3.utils.toBN(await dexInstance.methods.swapFees().call({ from: user }));

                                // Scaling down values for metric calculations
                                amountA = parseFloat(scaleDownBN(amountA));
                                amountB = parseFloat(scaleDownBN(amountB));
                                resA = parseFloat(scaleDownBN(resA));
                                resB = parseFloat(scaleDownBN(resB));
                                fees = parseFloat(scaleDownBN(fees));

                                reserveRatio[i] = amountA / amountB;
                                slippageBtoA[i] = ((amountA / amountB - resA / resB) / (resA / resB)) * 100;
                                totalSwapVolumeA[i] += amountA;
                                totalSwapVolumeB[i] += amountB;
                                totalFeesB[i] += fees;

                                console.log(`Swapped: given amountB: ${amountB} and received amountA: ${amountA}`);
                            } else {
                                console.log('Insufficient balance to perform swap B→A with amount:', randomSwapB);
                                i--;
                                continue;
                            }
                        }
                    }
                }
            } catch (error) {
                console.error('Error during transaction at iteration ', i, error);
            }

            // Update TVL and LP token distribution after each transaction
            let resA = web3.utils.toBN(await dexInstance.methods.reserveA().call());
            // let resB = web3.utils.toBN(await dexInstance.methods.reserveB().call());
            // let temp = resA.add(resB);
            tvl[i] = parseFloat(scaleDownBN(resA)) * 2; // Fix this
            for (let lp of LPs) {
                let l = web3.utils.toBN(await lpTokenInstance.methods.balanceOf(lp).call({ from: lp }));
                lpTokenDistribution[lp][i] = scaleDownBN(l.toString());
            }
        }

        console.log('DEX simulation complete!');
        console.log('==== Final Metrics ====');
        console.log('Total Swap Volume A:', totalSwapVolumeA);
        console.log('Total Swap Volume B:', totalSwapVolumeB);
        console.log('Total Fees A:', totalFeesA);
        console.log('Total Fees B:', totalFeesB);
        console.log('Reserve Ratio:', reserveRatio);
        console.log('Slippage A to B:', slippageAtoB);
        console.log('Slippage B to A:', slippageBtoA);
        console.log('TVL:', tvl);

        console.log('LP Token Distribution:');
        for (let lp of LPs) {
            console.log(`LP ${lp}:`, lpTokenDistribution[lp]);
        }
    } catch (error) {
        console.error('Error in simulation ', error);
    }
}

simulateDEX(15 * 10 ** 12, 80);
