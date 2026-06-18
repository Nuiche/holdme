"use client";

import { useState, useEffect, startTransition } from "react";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { erc20Abi, formatUnits } from "viem";
import Link from "next/link";
import Button from "./Button";
import ReviewCard from "./ReviewCard";
import { MIN_HOLD_USDC, MAX_HOLD_USDC, toUsdc, formatReadyTime } from "@/lib/constants";
import { TARGET_CHAIN, getContractAddress, getUsdcAddress, explorerTxUrl } from "@/lib/chain";
import { holdMeVaultAbi } from "@/lib/abis/HoldMeVault";

const MINUTE_OPTIONS = [1, 5, 15, 30, 60] as const;
const MAX_DAYS = 365;
const MAX_HOLD_SECONDS = MAX_DAYS * 86400;
const MIN_HOLD_SECONDS = 60;

type TxState =
  | "idle"
  | "approving"
  | "approvePending"
  | "creating"
  | "createPending"
  | "success"
  | "error";

interface CapturedHold {
  grossAmount: number;
  fee: number;
  returnAmount: number;
  holdSeconds: number;
  createdAt: number; // unix seconds at submission time
}

function calcFee(amount: number): number {
  return Math.min(amount * 0.01, 100);
}

function formatUSDC(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ShieldIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path
        d="M14 2.5L3.5 7v8.5C3.5 22 8.3 27.1 14 28.5 19.7 27.1 24.5 22 24.5 15.5V7L14 2.5z"
        fill="#d1fae5"
        stroke="#059669"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 14.5l3 3 6-6"
        stroke="#059669"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Maps any wallet/viem/contract error to a user-facing message.
// Always console.error the full error so it's diagnosable in the browser.
function userFacingError(e: unknown): string {
  console.error("[HoldMe] transaction error:", e);
  const msg = e instanceof Error ? e.message : String(e);
  const low = msg.toLowerCase();

  if (low.includes("user rejected") || low.includes("user denied") || msg.includes("4001"))
    return "Transaction declined. No funds were moved.";
  if (low.includes("allowance") || low.includes("transfer amount exceeds") || low.includes("safeerc20"))
    return "USDC approval needed. Please approve first, then hold.";
  if (low.includes("insufficient funds") || low.includes("gas required exceeds"))
    return "Not enough ETH in your wallet for gas fees.";
  if (low.includes("insufficient") || low.includes("exceeds balance") || low.includes("transfer amount"))
    return "Insufficient USDC balance.";
  if (low.includes("amountbelowminimum")) return "Minimum hold is 10 USDC.";
  if (low.includes("amountabovemaximum")) return "Amount exceeds the maximum.";
  if (low.includes("durationbelowminimum")) return "Minimum hold is 1 minute.";
  if (low.includes("durationabovemaximum")) return "Maximum hold is 365 days.";
  if (low.includes("holdnotready")) return "This hold is not ready yet.";
  if (low.includes("notholdowner")) return "Only the wallet that created this hold can bring it back.";
  if (low.includes("alreadyreturned")) return "This hold has already been returned.";
  if (low.includes("execution reverted") || low.includes("call_exception") || low.includes("reverted"))
    return "Transaction reverted. Check the amount and duration and try again.";
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
  const [capturedHold, setCapturedHold] = useState<CapturedHold | null>(null);

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

  const daysError = rawDays !== "" && days > MAX_DAYS ? "Maximum is 365 days." : null;

  // ── USDC balance ──────────────────────────────────────────────────────────
  const { data: rawBalance, refetch: refetchBalance } = useReadContract({
    address: usdcAddress ?? undefined,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!usdcAddress && !!address && onCorrectChain },
  });

  const displayBalance =
    rawBalance !== undefined
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

  // Prevent "Hold Me" from firing before we know the allowance.
  const allowanceLoading = allowanceQueryEnabled && rawAllowance === undefined;
  const needsApproval = amountValid && rawAllowance !== undefined && rawAllowance < toUsdc(amount);

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
    const fee = calcFee(amount);
    setCapturedHold({
      grossAmount: amount,
      fee,
      returnAmount: amount - fee,
      holdSeconds: totalHoldSeconds,
      createdAt: Math.floor(Date.now() / 1000),
    });
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
  if (txState === "success" && capturedHold) {
    const readyAt = capturedHold.createdAt + capturedHold.holdSeconds;
    const txHash =
      createReceipt?.transactionHash ?? lastTxHash;
    const explorerUrl = txHash ? explorerTxUrl(txHash) : "";

    return (
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div className="flex flex-col items-center text-center gap-2 pt-2">
          <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
              <path d="M4 11l5 5 9-9" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-stone-900">You&apos;re all set.</h2>
          <p className="text-sm text-stone-400">
            We&apos;ll hold this until it&apos;s ready to bring back.
          </p>
        </div>

        {/* Summary */}
        <div className="rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-4 flex flex-col gap-2.5">
          {[
            { label: "Set aside", value: `${formatUSDC(capturedHold.grossAmount)} USDC` },
            { label: "HoldMe fee (1%)", value: `${formatUSDC(capturedHold.fee)} USDC` },
            {
              label: "Ready to bring back",
              value: `${formatUSDC(capturedHold.returnAmount)} USDC`,
              bold: true,
            },
            { label: "Ready on", value: formatReadyTime(readyAt), highlight: true },
          ].map(({ label, value, bold, highlight }) => (
            <div key={label} className="flex items-baseline justify-between gap-4">
              <span className="text-sm text-stone-500 shrink-0">{label}</span>
              <span
                className={[
                  "text-sm text-right",
                  bold ? "font-semibold text-stone-900" : "text-stone-700",
                  highlight ? "text-emerald-700 font-medium" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {value}
              </span>
            </div>
          ))}
        </div>

        {/* Explorer link */}
        {explorerUrl && (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-center text-emerald-600 underline underline-offset-2 hover:text-emerald-800"
          >
            View transaction on explorer
          </a>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-3">
          <Link
            href="/holds"
            className="inline-flex items-center justify-center rounded-xl bg-emerald-600 text-white px-5 py-3 text-sm font-medium hover:bg-emerald-700 transition-colors shadow-sm"
          >
            View Holds
          </Link>
          <button
            onClick={() => {
              setTxState("idle");
              setRawAmount("");
              setRawDays("");
              setSelectedMinutes(0);
              setLastTxHash(undefined);
              setCapturedHold(null);
              setTxError(null);
            }}
            className="text-sm text-stone-400 underline underline-offset-2 hover:text-stone-600 transition-colors"
          >
            Start another hold
          </button>
        </div>
      </div>
    );
  }

  // ── Render: not connected ─────────────────────────────────────────────────
  if (!isConnected) {
    return (
      <div className="flex flex-col gap-6">
        <FormHeader />
        <div className="h-px bg-stone-100" />
        <div className="flex flex-col gap-3 items-center py-4 text-center">
          <p className="text-sm text-stone-500">Connect your wallet to create a hold.</p>
          <p className="text-xs text-stone-400">USDC on Base only.</p>
        </div>
      </div>
    );
  }

  // ── Render: wrong chain ───────────────────────────────────────────────────
  if (!onCorrectChain) {
    return (
      <div className="flex flex-col gap-6">
        <FormHeader />
        <div className="h-px bg-stone-100" />
        <div className="flex flex-col gap-2 items-center py-4 text-center">
          <p className="text-sm text-stone-500">Switch to {TARGET_CHAIN.name} to continue.</p>
          <p className="text-xs text-stone-400">Use the button in the header.</p>
        </div>
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
      <FormHeader />
      <div className="h-px bg-stone-100" />

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
            setRawDays(e.target.value.replace(/[^0-9]/g, ""));
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
                onClick={() => {
                  setSelectedMinutes(active ? 0 : min);
                  if (txState === "error") setTxState("idle");
                }}
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
        {totalHoldSeconds > 0 && !durationValid && totalHoldSeconds < MIN_HOLD_SECONDS && (
          <p className="text-xs text-rose-500">Minimum hold is 1 minute.</p>
        )}
        {totalHoldSeconds > MAX_HOLD_SECONDS && (
          <p className="text-xs text-rose-500">Maximum hold is 365 days.</p>
        )}
      </div>

      {/* Review card */}
      {canSubmit && <ReviewCard grossAmount={amount} holdSeconds={totalHoldSeconds} />}

      {/* Error */}
      {txState === "error" && txError && (
        <div className="rounded-xl bg-rose-50 border border-rose-100 px-4 py-3">
          <p className="text-sm text-rose-600">{txError}</p>
          <p className="text-xs text-rose-400 mt-1">Check the browser console for full details.</p>
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

function FormHeader() {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 shrink-0">
        <ShieldIcon />
      </div>
      <div>
        <h1 className="text-lg font-semibold text-stone-900 leading-tight">
          How much should we hold?
        </h1>
        <p className="text-sm text-stone-400 mt-0.5">
          Set aside USDC and bring it back when you&apos;re ready.
        </p>
      </div>
    </div>
  );
}
