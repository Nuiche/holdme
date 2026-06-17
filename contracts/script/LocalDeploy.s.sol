// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {HoldMeVault} from "../src/HoldMeVault.sol";
import {MockUSDC} from "../test/mocks/MockUSDC.sol";

/// Deploys MockUSDC + HoldMeVault on a local Anvil node and mints test USDC.
/// Required env vars: FEE_RECIPIENT_ADDRESS
/// Optional env vars: MINT_TO (default = FEE_RECIPIENT_ADDRESS), MINT_AMOUNT (default = 10000 USDC)
contract LocalDeploy is Script {
    function run() external {
        address feeRecipient = vm.envAddress("FEE_RECIPIENT_ADDRESS");
        address mintTo       = vm.envOr("MINT_TO", feeRecipient);
        uint256 mintAmount   = vm.envOr("MINT_AMOUNT", uint256(10_000e6));

        vm.startBroadcast();

        MockUSDC usdc = new MockUSDC();
        HoldMeVault vault = new HoldMeVault(address(usdc), feeRecipient);
        usdc.mint(mintTo, mintAmount);

        vm.stopBroadcast();

        console.log("MockUSDC deployed   :", address(usdc));
        console.log("HoldMeVault deployed:", address(vault));
        console.log("Minted", mintAmount / 1e6, "USDC to", mintTo);
        console.log("");
        console.log("Add to app/.env.local:");
        console.log("  NEXT_PUBLIC_CHAIN_ID=31337");
        console.log("  NEXT_PUBLIC_USDC_ADDRESS=", address(usdc));
        console.log("  NEXT_PUBLIC_HOLDME_CONTRACT_ADDRESS=", address(vault));
    }
}
