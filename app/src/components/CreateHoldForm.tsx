"use client";

import { useState, useEffect, startTransition } from "react";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { erc20Abi, formatUnits } from "viem";
import Link from "next/link";
import Button from "./Button";
import ReviewCard from "./ReviewCard";
import { MIN_HOLD_USDC, MAX_HOLD_USDC, toUsdc } from "@/lib/constants";
import { TARGET_CHAIN, getContractAddress, getUsdcAddress, explorerTxUrl } from "@/lib/chain";
import { holdMeVaultAbi } from "@/lib/abis/HoldMeVault";

const MINUTE_OPTIONS = [1, 5, 15, 30, 60] as const;
const MAX_DAYS = 365;
const MAX_HOLD_SECONDS = MAX_DAYS * 86400;
const MIN_HOLD_SECONDS = 60;

type TxState = "idle" | "approving" | "approvePending" | "creating" | "createPending" | "success" | "error";

// Maps any wallet/viem/contract error to a user-facing message.
// Always console.error the full error so we can diagnose in the browser.
function userFacingError(e: unknown): string {
  console.error("[HoldMe] transaction error:", e);

  const msg = e instanceof Error ? e.message : String(e);
  const low = msg.toLowerCase();

  // User cancelled in wallet
  if (low.includes("user rejected") || low.includes("user denied") || msg.includes("4001"))
    return "Transaction declined. No funds were moved.";

  // ERC20 allowance — must check before generic "allowance" hits balance case
  if (low.includes("allowance") || low.includes("transfer amount exceeds") || low.includes("safeerc20"))
    return "USDC approval needed. Please approve first, then hold.";

  // ETH gas balance
  if (low.includes("insufficient funds") || low.includes("gas required exceeds"))
    return "Not enough ETH in your wallet for gas fees.";

  // USDC balance (after allowance check above)
  if (low.includes("insufficient") || low.includes("exceeds balance") || low.includes("transfer amount"))
    return "Insufficient USDC balance.";

  // Our own contract custom errors (viem decodes these once errors are in ABI)
  if (low.includes("amountbelowminimum")) return "Minimum hold is 10 USDC.";
  if (low.includes("amountabovemaximum")) return "Amount exceeds the maximum.";
  if (low.includes("durationbelowminimum")) return "Minimum hold is 1 minute.";
  if (low.includes("durationabovemaximum")) return "Maximum hold is 365 days.";
  if (low.includes("holdnotready")) return "This hold is not ready yet.";
  if (low.includes("notholdowner")) return "Only the wallet that created this hold can bring it back.";
  if (low.includes("alreadyreturned")) return "This hold has already been returned.";

  // Generic contract revert — viem strings
  if (low.includes("execution reverted") || low.includes("call_exception") || low.includes("reverted"))
    return "Transaction reverted. Check the amount and duration and try again.";

  // Network / RPC
  if (low.includes("network") || low.includes("fetch") || low.includes("timeout") || low.includes("could not"))
    return "Network error. Make sure you're on Base and try again.";

  return "Something went wrong. Please try again.";
}

export default function CreateHoldForm() {
  const { address, isConnected, chain } = useAccount();
  const onCorrectChain = isConnected && chain?.id === TARGET_CHAIN.id;

  const contractAddress = getContractAddress();
  const usdcAddress = getUsdcAddress();

  const [rawAmount, setRawAmount] = useState("");
  const [rawDays, setRawDays] = useState("");
  const [selectedMinutes, setSelectedMinutes] = useState(0);
  const [txState, setTxState] = useState<TxState>("idle");
  const [txError, setTxError] = useState<string | null>(null);
  const [lastTxHash, setLastTxHash] = useState<`0x${string}` | undefined>();

  const amount = parseFloat(rawAmount) || 0;
  const days = Math.max(0, parseInt(rawDays) || 0);
  const totalHoldSeconds = days * 86400 + selectedMinutes * 60;

  const amountValid = amount >= MIN_HOLD_USDC && amount <= MAX_HOLD_USDC;
  const durationValid = totalHoldSeconds >= MIN_HOLD_SECONDS && totalHoldSeconds <= MAX_HOLD_SECONDS;
  const canSubmit = amountValid && durationValid && onCorrectChain;

  const amountError =
    rawAmount !== "" && !amountValid
      ? amount < MIN_HOLD_USDC
        ? `Minimum hold is ${MIN_HOLD_USDC} USDC.`
        : "This amount is above the maximum."
      : null;

  const daysError =
    rawDays !== "" && days > MAX_DAYS ? "Maximum is 365 days." : null;

  // ── USDC balance ──────────────────────────────────────────────────────────
  const { data: rawBalance, refetch: refetchBalance } = useReadContract({
    address: usdcAddress ?? undefined,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!usdcAddress && !!address && onCorrectChain },
  });

  const displayBalance = rawBalance !== undefined
    ? parseFloat(formatUnits(rawBalance, 6)).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : null;

  const insufficientBalance =
    rawBalance !== undefined && amount > 0 ? rawBalance < toUsdc(amount) : false;

  // ── USDC allowance ────────────────────────────────────────────────────────
  const allowanceQueryEnabled =
    !!usdcAddress && !!address && !!contractAddress && onCorrectChain;

  const { data: rawAllowance, refetch: refetchAllowance } = useReadContract({
    address: usdcAddress ?? undefined,
    abi: erc20Abi,
    functionName: "allowance",
    args: address && contractAddress ? [address, contractAddress] : undefined,
    query: { enabled: allowanceQueryEnabled },
  });

  // True while we haven't received the allowance read result yet.
  // Prevents "Hold Me" from firing before we know if approval is needed.
  const allowanceLoading = allowanceQueryEnabled && rawAllowance === undefined;

  const needsApproval =
    amountValid && rawAllowance !== undefined && rawAllowance < toUsdc(amount);

  // ── Write: approve ────────────────────────────────────────────────────────
  const { writeContractAsync: approveAsync } = useWriteContract();

  const { isLoading: approveConfirming, isSuccess: approveConfirmed } =
    useWaitForTransactionReceipt({
      hash: txState === "approvePending" ? lastTxHash : undefined,
    });

  // ── Write: createHold ─────────────────────────────────────────────────────
  const { writeContractAsync: createHoldAsync } = useWriteContract();

  const { isLoading: createConfirming, isSuccess: createConfirmed, data: createReceipt } =
    useWaitForTransactionReceipt({
      hash: txState === "createPending" ? lastTxHash : undefined,
    });

  // Advance state on confirmations
  useEffect(() => {
    if (txState === "approvePending" && approveConfirmed) {
      startTransition(() => {
        refetchAllowance();
        setTxState("idle");
        setLastTxHash(undefined);
      });
    }
  }, [approveConfirmed, txState, refetchAllowance]);

  useEffect(() => {
    if (txState === "createPending" && createConfirmed) {
      startTransition(() => {
        refetchBalance();
        setTxState("success");
      });
    }
  }, [createConfirmed, txState, refetchBalance]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  async function handleApprove() {
    if (!usdcAddress || !contractAddress || !amount) return;
    setTxError(null);
    setTxState("approving");
    try {
      const hash = await approveAsync({
        address: usdcAddress,
        abi: erc20Abi,
        functionName: "approve",
        args: [contractAddress, toUsdc(amount)],
      });
      setLastTxHash(hash);
      setTxState("approvePending");
    } catch (e) {
      setTxError(userFacingError(e));
      setTxState("error");
    }
  }

  async function handleCreateHold() {
    if (!contractAddress || !amountValid || !durationValid) return;
    setTxError(null);
    setTxState("creating");
    try {
      const hash = await createHoldAsync({
        address: contractAddress,
        abi: holdMeVaultAbi,
        functionName: "createHold",
        args: [toUsdc(amount), BigInt(totalHoldSeconds)],
      });
      setLastTxHash(hash);
      setTxState("createPending");
    } catch (e) {
      setTxError(userFacingError(e));
      setTxState("error");
    }
  }

  const isBusy =
    txState === "approving" ||
    txState === "approvePending" ||
    txState === "creating" ||
    txState === "createPending";

  // ── Render: success ───────────────────────────────────────────────────────
  if (txState === "success") {
    return (
      <div className="flex flex-col gap-4 items-center text-center py-4">
        <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center text-2xl">
          ✓
        </div>
        <p className="text-base font-semibold text-stone-800">Hold created.</p>
        <p className="text-sm text-stone-500">
          Your USDC is set aside. Come back when it&apos;s ready.
        </p>
        {createReceipt?.transactionHash && explorerTxUrl(createReceipt.transactionHash) && (
          <a
            href={explorerTxUrl(createReceipt.transactionHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-emerald-600 underline underline-offset-2"
          >
            View on explorer
          </a>
        )}
        <Link
          href="/holds"
          className="rounded-xl bg-emerald-600 text-white px-5 py-2.5 text-sm font-medium hover:bg-emerald-700 transition-colors"
        >
          View my holds
        </Link>
        <button
          onClick={() => {
            setTxState("idle");
            setRawAmount("");
            setRawDays("");
            setSelectedMinutes(0);
            setLastTxHash(undefined);
          }}
          className="text-sm text-stone-400 underline underline-offset-2 hover:text-stone-600"
        >
          Create another hold
        </button>
      </div>
    );
  }

  // ── Render: not connected / wrong chain ───────────────────────────────────
  if (!isConnected) {
    return (
      <div className="flex flex-col gap-3 items-center py-6 text-center">
        <p className="text-sm text-stone-500">Connect your wallet to create a hold.</p>
        <p className="text-xs text-stone-400">USDC on Base only.</p>
      </div>
    );
  }

  if (!onCorrectChain) {
    return (
      <div className="flex flex-col gap-2 items-center py-6 text-center">
        <p className="text-sm text-stone-500">Switch to {TARGET_CHAIN.name} to continue.</p>
        <p className="text-xs text-stone-400">Use the button in the header.</p>
      </div>
    );
  }

  if (!contractAddress || !usdcAddress) {
    return (
      <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">
        Contract not yet deployed. Set NEXT_PUBLIC_HOLDME_CONTRACT_ADDRESS and NEXT_PUBLIC_USDC_ADDRESS in .env.
      </div>
    );
  }

  // ── Render: form ──────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-5">
      {/* Amount */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-stone-700" htmlFor="amount">
            Amount
          </label>
          {displayBalance !== null && (
            <span className="text-xs text-stone-400">
              Balance:{" "}
              <span className="font-medium text-stone-600">{displayBalance} USDC</span>
            </span>
          )}
        </div>
        <div className="relative">
          <input
            id="amount"
            type="number"
            inputMode="decimal"
            placeholder="0.00"
            min={MIN_HOLD_USDC}
            step="0.01"
            value={rawAmount}
            onChange={(e) => {
              setRawAmount(e.target.value);
              if (txState === "error") setTxState("idle");
            }}
            disabled={isBusy}
            className={[
              "w-full rounded-xl border px-4 py-3 pr-20 text-lg font-medium",
              "bg-white text-stone-900 placeholder-stone-300",
              "focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent",
              "disabled:opacity-60 transition-all",
              amountError || insufficientBalance
                ? "border-rose-300 focus:ring-rose-400"
                : "border-stone-200",
            ].join(" ")}
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-stone-400 pointer-events-none">
            USDC
          </span>
        </div>
        {amountError && <p className="text-xs text-rose-500">{amountError}</p>}
        {!amountError && insufficientBalance && (
          <p className="text-xs text-rose-500">Insufficient USDC balance.</p>
        )}
        <p className="text-xs text-stone-400">10 USDC minimum · USDC on Base only</p>
      </div>

      {/* Days */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-stone-700" htmlFor="days">
          Days
        </label>
        <input
          id="days"
          type="number"
          inputMode="numeric"
          placeholder="0"
          min={0}
          max={MAX_DAYS}
          step={1}
          value={rawDays}
          onChange={(e) => {
            const val = e.target.value.replace(/[^0-9]/g, "");
            setRawDays(val);
            if (txState === "error") setTxState("idle");
          }}
          disabled={isBusy}
          className={[
            "w-full rounded-xl border px-4 py-3 text-lg font-medium",
            "bg-white text-stone-900 placeholder-stone-300",
            "focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent",
            "disabled:opacity-60 transition-all",
            daysError ? "border-rose-300 focus:ring-rose-400" : "border-stone-200",
          ].join(" ")}
        />
        {daysError && <p className="text-xs text-rose-500">{daysError}</p>}
      </div>

      {/* Minutes */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-stone-700">
          Minutes{" "}
          <span className="text-stone-400 font-normal">(optional)</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {MINUTE_OPTIONS.map((min) => {
            const active = selectedMinutes === min;
            return (
              <button
                key={min}
                type="button"
                onClick={() => setSelectedMinutes(active ? 0 : min)}
                disabled={isBusy}
                className={[
                  "rounded-xl px-3.5 py-2 text-sm font-medium transition-all",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                  active
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "bg-white border border-stone-200 text-stone-600 hover:border-emerald-300 hover:text-emerald-700",
                ].join(" ")}
              >
                {min} min
              </button>
            );
          })}
        </div>
        {totalHoldSeconds > 0 &&
          !durationValid &&
          totalHoldSeconds < MIN_HOLD_SECONDS && (
            <p className="text-xs text-rose-500">Minimum hold is 1 minute.</p>
          )}
        {totalHoldSeconds > MAX_HOLD_SECONDS && (
          <p className="text-xs text-rose-500">Maximum hold is 365 days.</p>
        )}
      </div>

      {/* Review card */}
      {canSubmit && (
        <ReviewCard grossAmount={amount} holdSeconds={totalHoldSeconds} />
      )}

      {/* Error */}
      {txState === "error" && txError && (
        <div className="rounded-xl bg-rose-50 border border-rose-100 px-4 py-3">
          <p className="text-sm text-rose-600">{txError}</p>
          <p className="text-xs text-rose-400 mt-1">
            Check the browser console for full details.
          </p>
        </div>
      )}

      {/* CTA */}
      <div className="flex flex-col gap-2">
        {canSubmit && needsApproval ? (
          <Button
            variant="secondary"
            fullWidth
            onClick={handleApprove}
            disabled={isBusy || insufficientBalance}
          >
            {txState === "approving"
              ? "Waiting for wallet…"
              : txState === "approvePending" || approveConfirming
              ? "Confirming approval…"
              : "Approve USDC"}
          </Button>
        ) : (
          <Button
            variant="primary"
            fullWidth
            disabled={!canSubmit || isBusy || insufficientBalance || allowanceLoading}
            onClick={handleCreateHold}
          >
            {allowanceLoading
              ? "Checking allowance…"
              : txState === "creating"
              ? "Waiting for wallet…"
              : txState === "createPending" || createConfirming
              ? "Confirming…"
              : "Hold Me"}
          </Button>
        )}
      </div>
    </div>
  );
}
