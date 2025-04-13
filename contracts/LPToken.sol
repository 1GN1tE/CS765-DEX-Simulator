// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.26;


import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract LPToken is ERC20 {

    constructor() ERC20("LP Token", "LPT") {}
    
    // mint token 
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
    
    // burn token
    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }
}