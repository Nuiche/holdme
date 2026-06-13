// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title HoldMeVault
/// @notice Holds USDC for a chosen duration and returns it to the original depositor after the hold period.
contract HoldMeVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Constants ────────────────────────────────────────────────────────────

    uint256 public constant FEE_BPS = 100;
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_FEE = 100e6;       // 100 USDC (6 decimals)
    uint256 public constant MIN_AMOUNT = 10e6;     // 10 USDC
    uint256 public constant MAX_AMOUNT = 500e6;    // 500 USDC per hold
    uint256 public constant MIN_HOLD_SECONDS = 1 days;
    uint256 public constant MAX_HOLD_SECONDS = 30 days;
    // Validation wallet may create shorter holds for end-to-end testing.
    uint256 public constant VALIDATION_MIN_HOLD_SECONDS = 60;       // 1 minute
    uint256 public constant VALIDATION_MAX_HOLD_SECONDS = 1 hours;  // UI reference; contract max is still MAX_HOLD_SECONDS

    // ─── Immutables ───────────────────────────────────────────────────────────

    IERC20 public immutable usdc;
    address public immutable feeRecipient;
    /// @notice Only this address may create holds shorter than MIN_HOLD_SECONDS.
    ///         Cannot be changed after deployment.
    address public immutable validationWallet;

    // ─── Storage ──────────────────────────────────────────────────────────────

    struct Hold {
        address owner;
        uint256 grossAmount;
        uint256 feeAmount;
        uint256 returnAmount;
        uint256 createdAt;
        uint256 returnAt;
        bool returned;
    }

    Hold[] public holds;
    mapping(address => uint256[]) private holdsByOwner;

    // ─── Errors ───────────────────────────────────────────────────────────────

    error ZeroAddress();
    error AmountBelowMinimum(uint256 amount, uint256 minimum);
    error AmountAboveMaximum(uint256 amount, uint256 maximum);
    error DurationBelowMinimum(uint256 holdSeconds, uint256 minimum);
    error DurationAboveMaximum(uint256 holdSeconds, uint256 maximum);
    error HoldNotFound(uint256 holdId);
    error NotHoldOwner(uint256 holdId, address caller);
    error HoldNotReady(uint256 holdId, uint256 returnAt, uint256 currentTime);
    error AlreadyReturned(uint256 holdId);

    // ─── Events ───────────────────────────────────────────────────────────────

    event HoldCreated(
        uint256 indexed holdId,
        address indexed owner,
        uint256 grossAmount,
        uint256 feeAmount,
        uint256 returnAmount,
        uint256 createdAt,
        uint256 returnAt
    );

    event HoldReturned(
        uint256 indexed holdId,
        address indexed owner,
        uint256 amount,
        uint256 returnedAt
    );

    // ─── Constructor ──────────────────────────────────────────────────────────

    /// @param _usdc             Address of the USDC token contract on this chain.
    /// @param _feeRecipient     Wallet that receives the upfront hold fee.
    /// @param _validationWallet Wallet allowed to create minute-granularity holds for testing.
    constructor(address _usdc, address _feeRecipient, address _validationWallet) {
        if (_usdc == address(0)) revert ZeroAddress();
        if (_feeRecipient == address(0)) revert ZeroAddress();
        if (_validationWallet == address(0)) revert ZeroAddress();
        usdc = IERC20(_usdc);
        feeRecipient = _feeRecipient;
        validationWallet = _validationWallet;
    }

    // ─── External Functions ───────────────────────────────────────────────────

    /// @notice Creates a new hold. Transfers `amount` USDC from the caller and
    ///         immediately forwards the fee to feeRecipient. The remainder is
    ///         held until `holdSeconds` have elapsed.
    /// @param amount       Gross USDC amount (6-decimal). Must be 10–500 USDC.
    /// @param holdSeconds  Duration of the hold. Must be 1–30 days.
    /// @return holdId      Index of the newly created hold.
    function createHold(uint256 amount, uint256 holdSeconds)
        external
        nonReentrant
        returns (uint256 holdId)
    {
        if (amount < MIN_AMOUNT) revert AmountBelowMinimum(amount, MIN_AMOUNT);
        if (amount > MAX_AMOUNT) revert AmountAboveMaximum(amount, MAX_AMOUNT);

        // validationWallet may use minute-granularity durations; everyone else must use 1–30 days.
        uint256 minSeconds = (msg.sender == validationWallet)
            ? VALIDATION_MIN_HOLD_SECONDS
            : MIN_HOLD_SECONDS;
        if (holdSeconds < minSeconds) revert DurationBelowMinimum(holdSeconds, minSeconds);
        if (holdSeconds > MAX_HOLD_SECONDS) revert DurationAboveMaximum(holdSeconds, MAX_HOLD_SECONDS);

        uint256 fee = (amount * FEE_BPS) / BPS_DENOMINATOR;
        if (fee > MAX_FEE) fee = MAX_FEE;
        uint256 returnAmount = amount - fee;

        uint256 createdAt = block.timestamp;
        uint256 returnAt = createdAt + holdSeconds;

        holdId = holds.length;
        holds.push(Hold({
            owner: msg.sender,
            grossAmount: amount,
            feeAmount: fee,
            returnAmount: returnAmount,
            createdAt: createdAt,
            returnAt: returnAt,
            returned: false
        }));
        holdsByOwner[msg.sender].push(holdId);

        // Transfer full gross amount from caller into this contract, then
        // immediately forward the fee. Remaining returnAmount stays in vault.
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        usdc.safeTransfer(feeRecipient, fee);

        emit HoldCreated(holdId, msg.sender, amount, fee, returnAmount, createdAt, returnAt);
    }

    /// @notice Returns a matured hold to its original owner.
    ///         Only the wallet that created the hold may call this.
    /// @param holdId  The hold to bring back.
    function bringBack(uint256 holdId) external nonReentrant {
        if (holdId >= holds.length) revert HoldNotFound(holdId);

        Hold storage hold = holds[holdId];

        if (msg.sender != hold.owner) revert NotHoldOwner(holdId, msg.sender);
        if (block.timestamp < hold.returnAt) revert HoldNotReady(holdId, hold.returnAt, block.timestamp);
        if (hold.returned) revert AlreadyReturned(holdId);

        // Mark returned before transfer to prevent reentrancy on any unexpected
        // token that calls back into this contract.
        hold.returned = true;

        usdc.safeTransfer(hold.owner, hold.returnAmount);

        emit HoldReturned(holdId, hold.owner, hold.returnAmount, block.timestamp);
    }

    // ─── View Functions ───────────────────────────────────────────────────────

    /// @notice Returns all hold IDs created by `owner`.
    function getHoldsForOwner(address owner) external view returns (uint256[] memory) {
        return holdsByOwner[owner];
    }

    /// @notice Returns the full Hold struct for a given ID.
    function getHold(uint256 holdId) external view returns (Hold memory) {
        if (holdId >= holds.length) revert HoldNotFound(holdId);
        return holds[holdId];
    }

    /// @notice Returns the total number of holds ever created.
    function getHoldCount() external view returns (uint256) {
        return holds.length;
    }
}
