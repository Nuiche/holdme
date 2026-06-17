// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {HoldMeVault} from "../src/HoldMeVault.sol";

/// Deploys HoldMeVault to any EVM chain.
/// Required env vars: USDC_ADDRESS, FEE_RECIPIENT_ADDRESS
contract Deploy is Script {
    function run() external {
        address usdc         = vm.envAddress("USDC_ADDRESS");
        address feeRecipient = vm.envAddress("FEE_RECIPIENT_ADDRESS");

        vm.startBroadcast();
        HoldMeVault vault = new HoldMeVault(usdc, feeRecipient);
        vm.stopBroadcast();

        console.log("HoldMeVault deployed:", address(vault));
        console.log("  usdc        :", usdc);
        console.log("  feeRecipient:", feeRecipient);
    }
}
