// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HoldMeVault} from "../src/HoldMeVault.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

// ─── Fee-cap harness ──────────────────────────────────────────────────────────
// Exposes the fee calculation so we can verify the MAX_FEE cap branch directly.
contract FeeCapHarness is HoldMeVault {
    constructor(address _usdc, address _feeRecipient)
        HoldMeVault(_usdc, _feeRecipient) {}

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

    address internal alice   = makeAddr("alice");
    address internal bob     = makeAddr("bob");
    address internal charlie = makeAddr("charlie");
    address internal feeDest = makeAddr("feeDest");

    uint256 internal constant ONE_MINUTE           = 60;
    uint256 internal constant FIVE_MINUTES         = 5 * 60;
    uint256 internal constant FIFTEEN_MINUTES      = 15 * 60;
    uint256 internal constant ONE_HOUR             = 1 hours;
    uint256 internal constant ONE_DAY              = 1 days;
    uint256 internal constant SEVEN_DAYS           = 7 days;
    uint256 internal constant THREE_SIXTY_FIVE_DAYS = 365 days;

    uint256 internal constant MIN_AMT = 10e6;              // 10 USDC
    uint256 internal constant MAX_AMT = 50_000_000e6;      // 50,000,000 USDC

    function setUp() public {
        usdc    = new MockUSDC();
        vault   = new HoldMeVault(address(usdc), feeDest);
        harness = new FeeCapHarness(address(usdc), feeDest);

        // Mint generous balances; individual tests mint more when needed.
        usdc.mint(alice,   200_000_000e6);
        usdc.mint(bob,     200_000_000e6);
        usdc.mint(charlie, 200_000_000e6);

        vm.prank(alice);   usdc.approve(address(vault), type(uint256).max);
        vm.prank(bob);     usdc.approve(address(vault), type(uint256).max);
        vm.prank(charlie); usdc.approve(address(vault), type(uint256).max);
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
        uint256 raw = amount * 100 / 10_000;
        return raw > 100e6 ? 100e6 : raw;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    function test_constructor_revertsZeroUsdc() public {
        vm.expectRevert(HoldMeVault.ZeroAddress.selector);
        new HoldMeVault(address(0), feeDest);
    }

    function test_constructor_revertsZeroFeeRecipient() public {
        vm.expectRevert(HoldMeVault.ZeroAddress.selector);
        new HoldMeVault(address(usdc), address(0));
    }

    function test_constructor_setsImmutables() public view {
        assertEq(address(vault.usdc()), address(usdc));
        assertEq(vault.feeRecipient(), feeDest);
    }

    // ─── Duration: any wallet can use minute holds ────────────────────────────

    function test_anyWallet_canCreate1MinuteHold() public {
        uint256 id = _createHold(alice, 100e6, ONE_MINUTE);
        HoldMeVault.Hold memory h = vault.getHold(id);
        assertEq(h.owner, alice);
        assertEq(h.returnAt - h.createdAt, ONE_MINUTE);
    }

    function test_anyWallet_canBringBackAfter1Minute() public {
        uint256 ts = 1_000_000;
        vm.warp(ts);
        uint256 id = _createHold(alice, 100e6, ONE_MINUTE);
        vm.warp(ts + ONE_MINUTE);
        vm.prank(alice);
        vault.bringBack(id);
        assertTrue(vault.getHold(id).returned);
    }

    function test_anyWallet_cannotBringBackBefore1Minute() public {
        uint256 ts = 2_000_000;
        vm.warp(ts);
        uint256 id = _createHold(alice, 100e6, ONE_MINUTE);
        uint256 oneSecEarly = ts + ONE_MINUTE - 1;
        vm.warp(oneSecEarly);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                HoldMeVault.HoldNotReady.selector, id, ts + ONE_MINUTE, oneSecEarly
            )
        );
        vault.bringBack(id);
    }

    function test_anyWallet_canCreate5MinuteHold() public {
        uint256 id = _createHold(bob, 100e6, FIVE_MINUTES);
        assertEq(vault.getHold(id).returnAt - vault.getHold(id).createdAt, FIVE_MINUTES);
    }

    function test_anyWallet_canCreate15MinuteHold() public {
        uint256 id = _createHold(charlie, 100e6, FIFTEEN_MINUTES);
        assertEq(vault.getHold(id).returnAt - vault.getHold(id).createdAt, FIFTEEN_MINUTES);
    }

    // ─── Duration: boundaries ─────────────────────────────────────────────────

    function test_createHold_reverts0Seconds() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(HoldMeVault.DurationBelowMinimum.selector, 0, ONE_MINUTE)
        );
        vault.createHold(100e6, 0);
    }

    function test_createHold_reverts59Seconds() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(HoldMeVault.DurationBelowMinimum.selector, 59, ONE_MINUTE)
        );
        vault.createHold(100e6, 59);
    }

    function test_createHold_exactly60Seconds() public {
        uint256 id = _createHold(alice, 100e6, ONE_MINUTE);
        assertEq(vault.getHold(id).returnAt - vault.getHold(id).createdAt, ONE_MINUTE);
    }

    function test_createHold_exactly365Days() public {
        uint256 id = _createHold(alice, 100e6, THREE_SIXTY_FIVE_DAYS);
        HoldMeVault.Hold memory h = vault.getHold(id);
        assertEq(h.returnAt - h.createdAt, THREE_SIXTY_FIVE_DAYS);
    }

    function test_createHold_revertsAbove365Days() public {
        uint256 bad = THREE_SIXTY_FIVE_DAYS + 1;
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(HoldMeVault.DurationAboveMaximum.selector, bad, THREE_SIXTY_FIVE_DAYS)
        );
        vault.createHold(100e6, bad);
    }

    function test_createHold_exactlyOneDay() public {
        uint256 id = _createHold(alice, 100e6, ONE_DAY);
        HoldMeVault.Hold memory h = vault.getHold(id);
        assertEq(h.returnAt - h.createdAt, ONE_DAY);
    }

    function test_createHold_3DayPlusMinutes() public {
        uint256 dur = 3 * ONE_DAY + FIFTEEN_MINUTES;
        uint256 id = _createHold(alice, 100e6, dur);
        assertEq(vault.getHold(id).returnAt - vault.getHold(id).createdAt, dur);
    }

    // ─── Amount: boundaries ───────────────────────────────────────────────────

    function test_createHold_minAmount() public {
        uint256 id = _createHold(alice, MIN_AMT, ONE_DAY);
        assertEq(vault.getHold(id).grossAmount, MIN_AMT);
    }

    function test_createHold_revertsAmountBelowMin() public {
        uint256 bad = MIN_AMT - 1;
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(HoldMeVault.AmountBelowMinimum.selector, bad, MIN_AMT)
        );
        vault.createHold(bad, ONE_DAY);
    }

    function test_createHold_maxAmount() public {
        uint256 id = _createHold(alice, MAX_AMT, ONE_DAY);
        assertEq(vault.getHold(id).grossAmount, MAX_AMT);
    }

    function test_createHold_revertsAmountAboveMax() public {
        uint256 bad = MAX_AMT + 1;
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(HoldMeVault.AmountAboveMaximum.selector, bad, MAX_AMT)
        );
        vault.createHold(bad, ONE_DAY);
    }

    function test_createHold_multipleMaxHoldsFromSameWallet() public {
        // MAX_AMOUNT is per-hold, not per-wallet
        vm.startPrank(alice);
        uint256 id0 = vault.createHold(MAX_AMT, ONE_DAY);
        uint256 id1 = vault.createHold(MAX_AMT, SEVEN_DAYS);
        uint256 id2 = vault.createHold(MAX_AMT, THREE_SIXTY_FIVE_DAYS);
        vm.stopPrank();

        assertEq(vault.getHoldCount(), 3);
        uint256[] memory ids = vault.getHoldsForOwner(alice);
        assertEq(ids.length, 3);
        assertEq(ids[0], id0);
        assertEq(ids[1], id1);
        assertEq(ids[2], id2);
    }

    // ─── Fee: 1% with cap at 100 USDC ────────────────────────────────────────

    function test_createHold_feeIs1PctSmallAmount() public {
        uint256 amount = 100e6;
        uint256 id = _createHold(alice, amount, ONE_DAY);
        HoldMeVault.Hold memory h = vault.getHold(id);
        assertEq(h.feeAmount,    1e6);
        assertEq(h.returnAmount, 99e6);
        assertEq(h.grossAmount,  amount);
    }

    function test_createHold_feeIs1PctMidAmount() public {
        uint256 amount = 1_000e6;  // 1,000 USDC → fee = 10 USDC
        uint256 id = _createHold(alice, amount, ONE_DAY);
        HoldMeVault.Hold memory h = vault.getHold(id);
        assertEq(h.feeAmount,    10e6);
        assertEq(h.returnAmount, 990e6);
    }

    function test_createHold_feeCapAt10kUsdc() public {
        // 10,000 USDC → raw fee = 100 USDC = exactly at cap
        uint256 amount = 10_000e6;
        uint256 id = _createHold(alice, amount, ONE_DAY);
        HoldMeVault.Hold memory h = vault.getHold(id);
        assertEq(h.feeAmount,    100e6);
        assertEq(h.returnAmount, 9_900e6);
    }

    function test_createHold_feeCapAt50MUsdc() public {
        // 50,000,000 USDC → raw fee would be 500,000 USDC → capped at 100 USDC
        uint256 id = _createHold(alice, MAX_AMT, ONE_DAY);
        HoldMeVault.Hold memory h = vault.getHold(id);
        assertEq(h.feeAmount,    100e6);
        assertEq(h.returnAmount, MAX_AMT - 100e6);
    }

    function test_createHold_feeCapAtHalfMUsdc() public {
        // 500,000 USDC → raw fee = 5,000 USDC → capped at 100 USDC
        uint256 amount = 500_000e6;
        uint256 id = _createHold(alice, amount, ONE_DAY);
        HoldMeVault.Hold memory h = vault.getHold(id);
        assertEq(h.feeAmount,    100e6);
        assertEq(h.returnAmount, amount - 100e6);
    }

    function test_createHold_feeTransferredToRecipient() public {
        uint256 before = usdc.balanceOf(feeDest);
        _createHold(alice, 100e6, ONE_DAY);
        assertEq(usdc.balanceOf(feeDest) - before, 1e6);
    }

    function test_createHold_feeCapTransferredToRecipient() public {
        uint256 before = usdc.balanceOf(feeDest);
        _createHold(alice, MAX_AMT, ONE_DAY);
        assertEq(usdc.balanceOf(feeDest) - before, 100e6);
    }

    function test_createHold_vaultRetainsReturnAmount() public {
        _createHold(alice, 100e6, ONE_DAY);
        assertEq(usdc.balanceOf(address(vault)), 99e6);
    }

    function test_createHold_vaultRetainsReturnAmountLargeHold() public {
        _createHold(alice, MAX_AMT, ONE_DAY);
        assertEq(usdc.balanceOf(address(vault)), MAX_AMT - 100e6);
    }

    function test_createHold_deductsFullAmountFromCaller() public {
        uint256 before = usdc.balanceOf(alice);
        _createHold(alice, 100e6, ONE_DAY);
        assertEq(usdc.balanceOf(alice), before - 100e6);
    }

    // ─── Fee cap harness ──────────────────────────────────────────────────────

    function test_feeCap_capActivatesViaHarness() public view {
        // 15,000 USDC → raw fee = 150 USDC → capped at 100 USDC
        uint256 capped = harness.computeFee(15_000e6);
        assertEq(capped, 100e6);
    }

    function test_feeCap_capBoundaryViaHarness() public view {
        // Exactly 10,000 USDC → raw fee = 100 USDC (boundary, not over)
        uint256 atBoundary = harness.computeFee(10_000e6);
        assertEq(atBoundary, 100e6);
    }

    function test_feeCap_belowCapViaHarness() public view {
        // 9,999 USDC → raw fee = 99.99 USDC → no cap
        uint256 belowCap = harness.computeFee(9_999e6);
        assertEq(belowCap, 99_990_000);
        assertLt(belowCap, 100e6);
    }

    function test_feeCap_maxAmountViaHarness() public view {
        // 50,000,000 USDC → raw fee = 500,000 USDC → capped at 100 USDC
        uint256 capped = harness.computeFee(MAX_AMT);
        assertEq(capped, 100e6);
    }

    // ─── createHold – data storage ────────────────────────────────────────────

    function test_createHold_holdIdIncrements() public {
        uint256 id0 = _createHold(alice, 100e6, ONE_DAY);
        uint256 id1 = _createHold(alice, 200e6, SEVEN_DAYS);
        uint256 id2 = _createHold(alice, 50e6,  THREE_SIXTY_FIVE_DAYS);
        assertEq(id0, 0);
        assertEq(id1, 1);
        assertEq(id2, 2);
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

    // ─── bringBack – happy paths ──────────────────────────────────────────────

    function test_bringBack_ownerCanBringBackAtReturnAt() public {
        uint256 ts = 1_000_000;
        vm.warp(ts);
        uint256 id = _createHold(alice, 100e6, ONE_DAY);
        vm.warp(ts + ONE_DAY);
        vm.prank(alice);
        vault.bringBack(id);
    }

    function test_bringBack_ownerCanBringBackAfterReturnAt() public {
        uint256 id = _createHold(alice, 100e6, ONE_DAY);
        vm.warp(block.timestamp + ONE_DAY + ONE_HOUR);
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

    function test_bringBack_exactReturnAmountLargeHold() public {
        uint256 id = _createHold(alice, MAX_AMT, ONE_DAY);
        uint256 before = usdc.balanceOf(alice);
        vm.warp(block.timestamp + ONE_DAY);
        vm.prank(alice);
        vault.bringBack(id);
        // fee = 100 USDC (capped), return = 50,000,000 - 100 USDC
        assertEq(usdc.balanceOf(alice) - before, MAX_AMT - 100e6);
    }

    function test_bringBack_after1MinuteHold() public {
        uint256 ts = 5_000_000;
        vm.warp(ts);
        uint256 id = _createHold(alice, 100e6, ONE_MINUTE);
        vm.warp(ts + ONE_MINUTE);
        vm.prank(alice);
        vault.bringBack(id);
        assertTrue(vault.getHold(id).returned);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function test_bringBack_after365DayHold() public {
        uint256 id = _createHold(alice, 200e6, THREE_SIXTY_FIVE_DAYS);
        vm.warp(block.timestamp + THREE_SIXTY_FIVE_DAYS);
        vm.prank(alice);
        vault.bringBack(id);
        assertTrue(vault.getHold(id).returned);
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

    // ─── bringBack – no early return ─────────────────────────────────────────

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

    function test_bringBack_revertsOneSecondBefore1MinuteHold() public {
        uint256 ts = 5_000_000;
        vm.warp(ts);
        uint256 id = _createHold(alice, 100e6, ONE_MINUTE);
        uint256 oneSecEarly = ts + ONE_MINUTE - 1;
        vm.warp(oneSecEarly);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                HoldMeVault.HoldNotReady.selector, id, ts + ONE_MINUTE, oneSecEarly
            )
        );
        vault.bringBack(id);
    }

    // ─── bringBack – security reverts ────────────────────────────────────────

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
        vm.startPrank(alice);
        uint256 id0 = vault.createHold(MAX_AMT, ONE_DAY);
        uint256 id1 = vault.createHold(MAX_AMT, SEVEN_DAYS);
        uint256 id2 = vault.createHold(MAX_AMT, THREE_SIXTY_FIVE_DAYS);
        vm.stopPrank();

        assertEq(vault.getHoldCount(), 3);
        uint256[] memory ids = vault.getHoldsForOwner(alice);
        assertEq(ids.length, 3);
        assertEq(ids[0], id0);
        assertEq(ids[1], id1);
        assertEq(ids[2], id2);

        // Each large hold has fee capped at 100 USDC
        uint256 expectedInVault = 3 * (MAX_AMT - 100e6);
        assertEq(usdc.balanceOf(address(vault)), expectedInVault);
    }

    function test_multipleHolds_sameUser_differentAmounts() public {
        uint256 id0 = _createHold(alice, 100e6,  ONE_DAY);
        uint256 id1 = _createHold(alice, 200e6,  SEVEN_DAYS);
        uint256 id2 = _createHold(alice, 300e6,  THREE_SIXTY_FIVE_DAYS);

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

        assertEq(usdc.balanceOf(alice) - aliceBefore, 99e6);
        assertEq(usdc.balanceOf(bob),   bobBefore);

        vm.prank(bob);
        vault.bringBack(bobId);
        assertEq(usdc.balanceOf(bob) - bobBefore, 198e6);
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

    function test_getHoldsForOwner_works() public {
        uint256 id0 = _createHold(alice, 100e6, ONE_DAY);
        uint256 id1 = _createHold(alice, 200e6, SEVEN_DAYS);
        uint256[] memory ids = vault.getHoldsForOwner(alice);
        assertEq(ids.length, 2);
        assertEq(ids[0], id0);
        assertEq(ids[1], id1);
    }

    function test_getHold_works() public {
        uint256 ts = 3_000_000;
        vm.warp(ts);
        uint256 id = _createHold(alice, 150e6, SEVEN_DAYS);
        HoldMeVault.Hold memory h = vault.getHold(id);
        assertEq(h.owner,        alice);
        assertEq(h.grossAmount,  150e6);
        assertEq(h.feeAmount,    1_500_000);
        assertEq(h.returnAmount, 148_500_000);
        assertEq(h.createdAt,    ts);
        assertEq(h.returnAt,     ts + SEVEN_DAYS);
        assertFalse(h.returned);
    }
}
