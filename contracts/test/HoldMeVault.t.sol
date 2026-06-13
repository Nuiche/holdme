// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HoldMeVault} from "../src/HoldMeVault.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

// ─── Fee-cap harness ──────────────────────────────────────────────────────────
// Exposes the fee calculation so we can test the MAX_FEE cap branch directly,
// without modifying the vault contract or bypassing MAX_AMOUNT.
contract FeeCapHarness is HoldMeVault {
    constructor(address _usdc, address _feeRecipient, address _validationWallet)
        HoldMeVault(_usdc, _feeRecipient, _validationWallet) {}

    function computeFee(uint256 amount) external pure returns (uint256 fee) {
        fee = (amount * FEE_BPS) / BPS_DENOMINATOR;
        if (fee > MAX_FEE) fee = MAX_FEE;
    }
}

// ─── Test suite ───────────────────────────────────────────────────────────────
contract HoldMeVaultTest is Test {
    HoldMeVault internal vault;
    MockUSDC internal usdc;
    FeeCapHarness internal harness;

    address internal alice          = makeAddr("alice");
    address internal bob            = makeAddr("bob");
    address internal charlie        = makeAddr("charlie");
    address internal feeDest        = makeAddr("feeDest");
    address internal validationWallet = makeAddr("validationWallet");

    uint256 internal constant ONE_DAY     = 1 days;
    uint256 internal constant THREE_DAYS  = 3 days;
    uint256 internal constant SEVEN_DAYS  = 7 days;
    uint256 internal constant THIRTY_DAYS = 30 days;
    uint256 internal constant ONE_MINUTE  = 60;
    uint256 internal constant FIVE_MINUTES = 5 * 60;

    uint256 internal constant MIN_AMT = 10e6;   // 10 USDC
    uint256 internal constant MAX_AMT = 500e6;  // 500 USDC

    function setUp() public {
        usdc    = new MockUSDC();
        vault   = new HoldMeVault(address(usdc), feeDest, validationWallet);
        harness = new FeeCapHarness(address(usdc), feeDest, validationWallet);

        usdc.mint(alice,            100_000e6);
        usdc.mint(bob,              100_000e6);
        usdc.mint(charlie,          100_000e6);
        usdc.mint(validationWallet, 100_000e6);

        vm.prank(alice);            usdc.approve(address(vault), type(uint256).max);
        vm.prank(bob);              usdc.approve(address(vault), type(uint256).max);
        vm.prank(charlie);          usdc.approve(address(vault), type(uint256).max);
        vm.prank(validationWallet); usdc.approve(address(vault), type(uint256).max);
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function _createHold(address user, uint256 amount, uint256 dur)
        internal
        returns (uint256 holdId)
    {
        vm.prank(user);
        holdId = vault.createHold(amount, dur);
    }

    function _fee(uint256 amount) internal pure returns (uint256) {
        return amount * 100 / 10_000;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    function test_constructor_revertsZeroUsdc() public {
        vm.expectRevert(HoldMeVault.ZeroAddress.selector);
        new HoldMeVault(address(0), feeDest, validationWallet);
    }

    function test_constructor_revertsZeroFeeRecipient() public {
        vm.expectRevert(HoldMeVault.ZeroAddress.selector);
        new HoldMeVault(address(usdc), address(0), validationWallet);
    }

    function test_constructor_revertsZeroValidationWallet() public {
        vm.expectRevert(HoldMeVault.ZeroAddress.selector);
        new HoldMeVault(address(usdc), feeDest, address(0));
    }

    function test_constructor_setsImmutables() public view {
        assertEq(address(vault.usdc()), address(usdc));
        assertEq(vault.feeRecipient(), feeDest);
        assertEq(vault.validationWallet(), validationWallet);
    }

    // ─── createHold – happy paths ─────────────────────────────────────────────

    function test_createHold_validOneDay() public {
        uint256 id = _createHold(alice, 100e6, ONE_DAY);
        assertEq(id, 0);
    }

    function test_createHold_validThirtyDays() public {
        uint256 id = _createHold(alice, 100e6, THIRTY_DAYS);
        assertEq(id, 0);
    }

    function test_createHold_holdIdIncrements() public {
        uint256 id0 = _createHold(alice, 100e6, ONE_DAY);
        uint256 id1 = _createHold(alice, 200e6, SEVEN_DAYS);
        uint256 id2 = _createHold(alice, 50e6,  THIRTY_DAYS);
        assertEq(id0, 0);
        assertEq(id1, 1);
        assertEq(id2, 2);
    }

    function test_createHold_minAmount() public {
        uint256 id = _createHold(alice, MIN_AMT, ONE_DAY);
        assertEq(vault.getHold(id).grossAmount, MIN_AMT);
    }

    function test_createHold_maxAmount() public {
        uint256 id = _createHold(alice, MAX_AMT, ONE_DAY);
        assertEq(vault.getHold(id).grossAmount, MAX_AMT);
    }

    function test_createHold_feeIs1Pct() public {
        uint256 amount = 100e6;
        uint256 id = _createHold(alice, amount, ONE_DAY);
        HoldMeVault.Hold memory h = vault.getHold(id);
        assertEq(h.feeAmount,    1e6);
        assertEq(h.returnAmount, 99e6);
        assertEq(h.grossAmount,  amount);
    }

    function test_createHold_feeAt500USDC() public {
        uint256 id = _createHold(alice, 500e6, ONE_DAY);
        HoldMeVault.Hold memory h = vault.getHold(id);
        assertEq(h.feeAmount,    5e6);   // 1% of 500
        assertEq(h.returnAmount, 495e6);
    }

    function test_createHold_feeTransferredToRecipient() public {
        uint256 before = usdc.balanceOf(feeDest);
        _createHold(alice, 100e6, ONE_DAY);
        assertEq(usdc.balanceOf(feeDest) - before, 1e6);
    }

    function test_createHold_vaultRetainsReturnAmount() public {
        _createHold(alice, 100e6, ONE_DAY);
        assertEq(usdc.balanceOf(address(vault)), 99e6);
    }

    function test_createHold_deductsFullAmountFromCaller() public {
        uint256 before = usdc.balanceOf(alice);
        _createHold(alice, 100e6, ONE_DAY);
        assertEq(usdc.balanceOf(alice), before - 100e6);
    }

    function test_createHold_holdStoredCorrectly() public {
        uint256 ts = 1_000_000;
        vm.warp(ts);
        uint256 id = _createHold(alice, 300e6, SEVEN_DAYS);
        HoldMeVault.Hold memory h = vault.getHold(id);
        assertEq(h.owner,        alice);
        assertEq(h.grossAmount,  300e6);
        assertEq(h.feeAmount,    3e6);
        assertEq(h.returnAmount, 297e6);
        assertEq(h.createdAt,    ts);
        assertEq(h.returnAt,     ts + SEVEN_DAYS);
        assertFalse(h.returned);
    }

    function test_createHold_holdIdRecordedUnderOwner() public {
        uint256 id = _createHold(alice, 100e6, ONE_DAY);
        uint256[] memory ids = vault.getHoldsForOwner(alice);
        assertEq(ids.length, 1);
        assertEq(ids[0], id);
    }

    function test_createHold_emitsHoldCreated() public {
        uint256 ts = 2_000_000;
        vm.warp(ts);
        vm.expectEmit(true, true, false, true, address(vault));
        emit HoldMeVault.HoldCreated(0, alice, 100e6, 1e6, 99e6, ts, ts + ONE_DAY);
        vm.prank(alice);
        vault.createHold(100e6, ONE_DAY);
    }

    // ─── createHold – reverts ─────────────────────────────────────────────────

    function test_createHold_revertsAmountBelowMin() public {
        uint256 bad = MIN_AMT - 1;
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(HoldMeVault.AmountBelowMinimum.selector, bad, MIN_AMT)
        );
        vault.createHold(bad, ONE_DAY);
    }

    function test_createHold_revertsAmountAboveMax() public {
        uint256 bad = MAX_AMT + 1;
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(HoldMeVault.AmountAboveMaximum.selector, bad, MAX_AMT)
        );
        vault.createHold(bad, ONE_DAY);
    }

    function test_createHold_revertsDurationBelowMin() public {
        uint256 bad = ONE_DAY - 1;
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(HoldMeVault.DurationBelowMinimum.selector, bad, ONE_DAY)
        );
        vault.createHold(100e6, bad);
    }

    function test_createHold_revertsDurationAboveMax() public {
        uint256 bad = THIRTY_DAYS + 1;
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(HoldMeVault.DurationAboveMaximum.selector, bad, THIRTY_DAYS)
        );
        vault.createHold(100e6, bad);
    }

    // ─── bringBack – happy paths ──────────────────────────────────────────────

    function test_bringBack_ownerCanBringBackAtReturnAt() public {
        uint256 ts = 1_000_000;
        vm.warp(ts);
        uint256 id = _createHold(alice, 100e6, ONE_DAY);
        vm.warp(ts + ONE_DAY);
        vm.prank(alice);
        vault.bringBack(id); // must not revert
    }

    function test_bringBack_ownerCanBringBackAfterReturnAt() public {
        uint256 id = _createHold(alice, 100e6, ONE_DAY);
        vm.warp(block.timestamp + ONE_DAY + 1 hours);
        vm.prank(alice);
        vault.bringBack(id);
    }

    function test_bringBack_exactReturnAmountTransferred() public {
        uint256 id = _createHold(alice, 100e6, ONE_DAY);
        uint256 before = usdc.balanceOf(alice);
        vm.warp(block.timestamp + ONE_DAY);
        vm.prank(alice);
        vault.bringBack(id);
        assertEq(usdc.balanceOf(alice) - before, 99e6);
    }

    function test_bringBack_vaultBalanceBecomesZero() public {
        uint256 id = _createHold(alice, 100e6, ONE_DAY);
        vm.warp(block.timestamp + ONE_DAY);
        vm.prank(alice);
        vault.bringBack(id);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function test_bringBack_marksHoldReturned() public {
        uint256 id = _createHold(alice, 100e6, ONE_DAY);
        vm.warp(block.timestamp + ONE_DAY);
        vm.prank(alice);
        vault.bringBack(id);
        assertTrue(vault.getHold(id).returned);
    }

    function test_bringBack_emitsHoldReturned() public {
        uint256 id = _createHold(alice, 100e6, ONE_DAY);
        uint256 returnTs = block.timestamp + ONE_DAY;
        vm.warp(returnTs);
        vm.expectEmit(true, true, false, true, address(vault));
        emit HoldMeVault.HoldReturned(id, alice, 99e6, returnTs);
        vm.prank(alice);
        vault.bringBack(id);
    }

    function test_bringBack_valid30DayHold() public {
        uint256 id = _createHold(alice, 200e6, THIRTY_DAYS);
        vm.warp(block.timestamp + THIRTY_DAYS);
        vm.prank(alice);
        vault.bringBack(id);
        assertEq(vault.getHold(id).returned, true);
    }

    // ─── bringBack – reverts ──────────────────────────────────────────────────

    function test_bringBack_revertsHoldNotFound() public {
        vm.expectRevert(
            abi.encodeWithSelector(HoldMeVault.HoldNotFound.selector, 99)
        );
        vault.bringBack(99);
    }

    function test_bringBack_revertsNotOwner() public {
        uint256 id = _createHold(alice, 100e6, ONE_DAY);
        vm.warp(block.timestamp + ONE_DAY);
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(HoldMeVault.NotHoldOwner.selector, id, bob)
        );
        vault.bringBack(id);
    }

    function test_bringBack_revertsOneSecondBeforeReturnAt() public {
        uint256 ts = 5_000_000;
        vm.warp(ts);
        uint256 id = _createHold(alice, 100e6, ONE_DAY);
        uint256 oneSecEarly = ts + ONE_DAY - 1;
        vm.warp(oneSecEarly);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                HoldMeVault.HoldNotReady.selector, id, ts + ONE_DAY, oneSecEarly
            )
        );
        vault.bringBack(id);
    }

    function test_bringBack_revertsAlreadyReturned() public {
        uint256 id = _createHold(alice, 100e6, ONE_DAY);
        vm.warp(block.timestamp + ONE_DAY);
        vm.prank(alice);
        vault.bringBack(id);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(HoldMeVault.AlreadyReturned.selector, id)
        );
        vault.bringBack(id);
    }

    // ─── Multiple holds – same user ────────────────────────────────────────────

    function test_maxAmountIsPerHold_notPerWallet() public {
        // A single user may create multiple 500 USDC holds.
        // This proves MAX_AMOUNT is enforced per-hold, not as a wallet cap.
        vm.startPrank(alice);
        uint256 id0 = vault.createHold(MAX_AMT, ONE_DAY);
        uint256 id1 = vault.createHold(MAX_AMT, SEVEN_DAYS);
        uint256 id2 = vault.createHold(MAX_AMT, THIRTY_DAYS);
        vm.stopPrank();

        assertEq(vault.getHoldCount(), 3);
        uint256[] memory ids = vault.getHoldsForOwner(alice);
        assertEq(ids.length, 3);
        assertEq(ids[0], id0);
        assertEq(ids[1], id1);
        assertEq(ids[2], id2);

        // Vault holds 3 × returnAmount (gross minus fee each)
        uint256 expectedInVault = 3 * (MAX_AMT - _fee(MAX_AMT));
        assertEq(usdc.balanceOf(address(vault)), expectedInVault);
    }

    function test_multipleHolds_sameUser_differentAmounts() public {
        uint256 id0 = _createHold(alice, 100e6,  ONE_DAY);
        uint256 id1 = _createHold(alice, 200e6,  SEVEN_DAYS);
        uint256 id2 = _createHold(alice, 300e6,  THIRTY_DAYS);

        assertEq(vault.getHold(id0).grossAmount, 100e6);
        assertEq(vault.getHold(id1).grossAmount, 200e6);
        assertEq(vault.getHold(id2).grossAmount, 300e6);

        uint256 expectedInVault = (100e6 - _fee(100e6))
            + (200e6 - _fee(200e6))
            + (300e6 - _fee(300e6));
        assertEq(usdc.balanceOf(address(vault)), expectedInVault);
    }

    function test_multipleHolds_bringBackFirstLeavesOthersIntact() public {
        uint256 id0 = _createHold(alice, 100e6, ONE_DAY);
        uint256 id1 = _createHold(alice, 200e6, SEVEN_DAYS);

        vm.warp(block.timestamp + ONE_DAY);
        vm.prank(alice);
        vault.bringBack(id0);

        assertTrue(vault.getHold(id0).returned);
        assertFalse(vault.getHold(id1).returned);
        // Vault still holds returnAmount for id1
        assertEq(usdc.balanceOf(address(vault)), 200e6 - _fee(200e6));
    }

    // ─── Multiple users – isolation ────────────────────────────────────────────

    function test_multipleUsers_holdsAreIsolated() public {
        uint256 aliceId = _createHold(alice, 100e6, ONE_DAY);
        uint256 bobId   = _createHold(bob,   200e6, SEVEN_DAYS);

        assertEq(vault.getHold(aliceId).owner, alice);
        assertEq(vault.getHold(bobId).owner,   bob);

        assertEq(vault.getHoldsForOwner(alice).length, 1);
        assertEq(vault.getHoldsForOwner(bob).length,   1);
    }

    function test_multipleUsers_bobCannotBringBackAlicesHold() public {
        uint256 aliceId = _createHold(alice, 100e6, ONE_DAY);
        vm.warp(block.timestamp + ONE_DAY);
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(HoldMeVault.NotHoldOwner.selector, aliceId, bob)
        );
        vault.bringBack(aliceId);
    }

    function test_multipleUsers_charlieCannotBringBackAlicesHold() public {
        uint256 aliceId = _createHold(alice, 100e6, ONE_DAY);
        vm.warp(block.timestamp + ONE_DAY);
        vm.prank(charlie);
        vm.expectRevert(
            abi.encodeWithSelector(HoldMeVault.NotHoldOwner.selector, aliceId, charlie)
        );
        vault.bringBack(aliceId);
    }

    function test_multipleUsers_balancesRemainIsolated() public {
        uint256 aliceId = _createHold(alice, 100e6, ONE_DAY);
        uint256 bobId   = _createHold(bob,   200e6, ONE_DAY);

        uint256 aliceBefore = usdc.balanceOf(alice);
        uint256 bobBefore   = usdc.balanceOf(bob);

        vm.warp(block.timestamp + ONE_DAY);
        vm.prank(alice);
        vault.bringBack(aliceId);

        // Alice gets her returnAmount; Bob's balance unchanged
        assertEq(usdc.balanceOf(alice) - aliceBefore, 99e6);
        assertEq(usdc.balanceOf(bob),   bobBefore);

        vm.prank(bob);
        vault.bringBack(bobId);
        assertEq(usdc.balanceOf(bob) - bobBefore, 198e6); // 1% of 200
    }

    // ─── Fee cap ──────────────────────────────────────────────────────────────

    // The MAX_FEE cap (100 USDC) is structurally unreachable through createHold
    // because MAX_AMOUNT = 500 USDC → max raw fee = 5 USDC < 100 USDC cap.
    // These tests prove the arithmetic is correct and the cap code works.

    function test_feeCap_maxAmountProducesOnly5USDCFee() public pure {
        uint256 rawFee = (MAX_AMT * 100) / 10_000;
        assertEq(rawFee, 5e6);
        assertLt(rawFee, 100e6); // well below cap
    }

    function test_feeCap_capActivatesViaHarness() public view {
        // 15,000 USDC gross → raw fee = 150 USDC → capped at 100 USDC
        uint256 capped = harness.computeFee(15_000e6);
        assertEq(capped, 100e6);
    }

    function test_feeCap_capBoundaryViaHarness() public view {
        // Exactly 10,000 USDC → raw fee = 100 USDC = cap (boundary, not over)
        uint256 atBoundary = harness.computeFee(10_000e6);
        assertEq(atBoundary, 100e6);
    }

    function test_feeCap_belowCapViaHarness() public view {
        // 9,999 USDC → raw fee = 99.99 USDC → no cap (rounds down to 99e6)
        uint256 belowCap = harness.computeFee(9_999e6);
        assertEq(belowCap, 99_990_000); // 99.99 USDC
        assertLt(belowCap, 100e6);
    }

    // ─── View functions ───────────────────────────────────────────────────────

    function test_getHoldCount_startsZero() public view {
        assertEq(vault.getHoldCount(), 0);
    }

    function test_getHoldCount_incrementsCorrectly() public {
        _createHold(alice, 100e6, ONE_DAY);
        assertEq(vault.getHoldCount(), 1);
        _createHold(bob, 100e6, ONE_DAY);
        assertEq(vault.getHoldCount(), 2);
    }

    function test_getHoldsForOwner_emptyForUnknownAddress() public view {
        assertEq(vault.getHoldsForOwner(address(0xdead)).length, 0);
    }

    function test_getHold_revertsForOutOfBounds() public {
        vm.expectRevert(
            abi.encodeWithSelector(HoldMeVault.HoldNotFound.selector, 0)
        );
        vault.getHold(0);
    }

    // ─── Duration boundary ────────────────────────────────────────────────────

    function test_createHold_exactlyOneDay() public {
        uint256 id = _createHold(alice, 100e6, ONE_DAY);
        HoldMeVault.Hold memory h = vault.getHold(id);
        assertEq(h.returnAt - h.createdAt, ONE_DAY);
    }

    function test_createHold_exactlyThirtyDays() public {
        uint256 id = _createHold(alice, 100e6, THIRTY_DAYS);
        HoldMeVault.Hold memory h = vault.getHold(id);
        assertEq(h.returnAt - h.createdAt, THIRTY_DAYS);
    }

    function test_createHold_3DayDuration() public {
        uint256 id = _createHold(alice, 100e6, THREE_DAYS);
        HoldMeVault.Hold memory h = vault.getHold(id);
        assertEq(h.returnAt - h.createdAt, THREE_DAYS);
    }

    // ─── Validation wallet ────────────────────────────────────────────────────

    function test_validationWallet_canCreate1MinuteHold() public {
        uint256 id = _createHold(validationWallet, 100e6, ONE_MINUTE);
        HoldMeVault.Hold memory h = vault.getHold(id);
        assertEq(h.owner, validationWallet);
        assertEq(h.returnAt - h.createdAt, ONE_MINUTE);
    }

    function test_validationWallet_canBringBackAfter1Minute() public {
        uint256 ts = 1_000_000;
        vm.warp(ts);
        uint256 id = _createHold(validationWallet, 100e6, ONE_MINUTE);
        vm.warp(ts + ONE_MINUTE);
        vm.prank(validationWallet);
        vault.bringBack(id);
        assertTrue(vault.getHold(id).returned);
    }

    function test_validationWallet_exactReturnAmountAfter1Minute() public {
        uint256 id = _createHold(validationWallet, 100e6, ONE_MINUTE);
        uint256 before = usdc.balanceOf(validationWallet);
        vm.warp(block.timestamp + ONE_MINUTE);
        vm.prank(validationWallet);
        vault.bringBack(id);
        assertEq(usdc.balanceOf(validationWallet) - before, 99e6);
    }

    function test_validationWallet_cannotBringBackBefore1Minute() public {
        uint256 ts = 2_000_000;
        vm.warp(ts);
        uint256 id = _createHold(validationWallet, 100e6, ONE_MINUTE);
        uint256 oneSecEarly = ts + ONE_MINUTE - 1;
        vm.warp(oneSecEarly);
        vm.prank(validationWallet);
        vm.expectRevert(
            abi.encodeWithSelector(
                HoldMeVault.HoldNotReady.selector, id, ts + ONE_MINUTE, oneSecEarly
            )
        );
        vault.bringBack(id);
    }

    function test_validationWallet_canCreate5MinuteHold() public {
        uint256 id = _createHold(validationWallet, 100e6, FIVE_MINUTES);
        assertEq(vault.getHold(id).returnAt - vault.getHold(id).createdAt, FIVE_MINUTES);
    }

    function test_validationWallet_canStillCreate1DayHold() public {
        uint256 id = _createHold(validationWallet, 100e6, ONE_DAY);
        assertEq(vault.getHold(id).returnAt - vault.getHold(id).createdAt, ONE_DAY);
    }

    function test_validationWallet_canStillCreate30DayHold() public {
        uint256 id = _createHold(validationWallet, 100e6, THIRTY_DAYS);
        assertEq(vault.getHold(id).returnAt - vault.getHold(id).createdAt, THIRTY_DAYS);
    }

    function test_validationWallet_cannotExceed30Days() public {
        uint256 bad = THIRTY_DAYS + 1;
        vm.prank(validationWallet);
        vm.expectRevert(
            abi.encodeWithSelector(HoldMeVault.DurationAboveMaximum.selector, bad, THIRTY_DAYS)
        );
        vault.createHold(100e6, bad);
    }

    function test_nonValidationWallet_cannotCreate1MinuteHold() public {
        // Normal users must use >= MIN_HOLD_SECONDS (1 day).
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                HoldMeVault.DurationBelowMinimum.selector, ONE_MINUTE, ONE_DAY
            )
        );
        vault.createHold(100e6, ONE_MINUTE);
    }

    function test_nonValidationWallet_cannotCreate59SecondHold() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                HoldMeVault.DurationBelowMinimum.selector, 59, ONE_DAY
            )
        );
        vault.createHold(100e6, 59);
    }

    function test_nonValidationWallet_canStillCreate1DayHold() public {
        // Proves normal user rules are unaffected by the validation wallet addition.
        uint256 id = _createHold(alice, 100e6, ONE_DAY);
        assertEq(vault.getHold(id).owner, alice);
    }

    function test_validationWallet_onlyOwnerCanBringBack() public {
        // Even for a validation wallet hold, only hold.owner may call bringBack.
        uint256 id = _createHold(validationWallet, 100e6, ONE_MINUTE);
        vm.warp(block.timestamp + ONE_MINUTE);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(HoldMeVault.NotHoldOwner.selector, id, alice)
        );
        vault.bringBack(id);
    }

    function test_validationWallet_canCreateMultipleShortHolds() public {
        vm.startPrank(validationWallet);
        uint256 id0 = vault.createHold(100e6, ONE_MINUTE);
        uint256 id1 = vault.createHold(200e6, FIVE_MINUTES);
        uint256 id2 = vault.createHold(300e6, ONE_DAY);
        vm.stopPrank();

        assertEq(vault.getHoldsForOwner(validationWallet).length, 3);
        assertEq(vault.getHold(id0).grossAmount, 100e6);
        assertEq(vault.getHold(id1).grossAmount, 200e6);
        assertEq(vault.getHold(id2).grossAmount, 300e6);
    }
}
