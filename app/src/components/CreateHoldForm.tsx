"use client";

import { useState, useEffect, startTransition } from "react";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { erc20Abi, formatUnits } from "viem";
import Link from "next/link";
import Button from "./Button";
import ReviewCard from "./ReviewCard";
import { VALIDATION_WALLET, MIN_HOLD_USDC, MAX_HOLD_USDC, toUsdc } from "@/lib/constants";
import { TARGET_CHAIN, getContractAddress, getUsdcAddress, explorerTxUrl } from "@/lib/chain";
import { holdMeVaultAbi } from "@/lib/abis/HoldMeVault";

interface Duration {
  label: string;
  holdSeconds: number;
  displayDays: number;
}

const NORMAL_DURATIONS: Duration[] = [
  { label: "1 day",   holdSeconds: 86_400,    displayDays: 1  },
  { label: "3 days",  holdSeconds: 259_200,   displayDays: 3  },
  { label: "7 days",  holdSeconds: 604_800,   displayDays: 7  },
  { label: "14 days", holdSeconds: 1_209_600, displayDays: 14 },
  { label: "30 days", holdSeconds: 2_592_000, displayDays: 30 },
];

const VALIDATION_DURATIONS: Duration[] = [
  { label: "1 min",  holdSeconds: 60,    displayDays: 1 / 1440 },
  { label: "5 min",  holdSeconds: 300,   displayDays: 5 / 1440 },
  { label: "15 min", holdSeconds: 900,   displayDays: 15 / 1440 },
  { label: "30 min", holdSeconds: 1_800, displayDays: 30 / 1440 },
  { label: "60 min", holdSeconds: 3_600, displayDays: 60 / 1440 },
];

function isValidationWallet(addr?: string): boolean {
  if (!addr) return false;
  return addr.toLowerCase() === VALIDATION_WALLET.toLowerCase();
}

type TxState = "idle" | "approving" | "approvePending" | "creating" | "createPending" | "success" | "error";

export default function CreateHoldForm() {
  const { address, isConnected, chain } = useAccount();
  const onCorrectChain = isConnected && chain?.id === TARGET_CHAIN.id;

  const contractAddress = getContractAddress();
  const usdcAddress = getUsdcAddress();

  const [rawAmount, setRawAmount] = useState("");
  const [selected, setSelected] = useState<Duration | null>(null);
  const [txState, setTxState] = useState<TxState>("idle");
  const [txError, setTxError] = useState<string | null>(null);
  const [lastTxHash, setLastTxHash] = useState<`0x${string}` | undefined>();

  const amount = parseFloat(rawAmount) || 0;
  const amountValid = amount >= MIN_HOLD_USDC && amount <= MAX_HOLD_USDC;
  const canReview = amountValid && selected !== null && onCorrectChain;

  const amountError =
    rawAmount !== "" && !amountValid
      ? amount < MIN_HOLD_USDC
        ? `Minimum hold is ${MIN_HOLD_USDC} USDC.`
        : `Maximum hold is ${MAX_HOLD_USDC} USDC per hold.`
      : null;

  // ── USDC balance ──────────────────────────────────────────────────────────
  const { data: rawBalance, refetch: refetchBalance } = useReadContract({
    address: usdcAddress ?? undefined,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!usdcAddress && !!address && onCorrectChain },
  });

  const displayBalance = rawBalance !== undefined
    ? parseFloat(formatUnits(rawBalance, 6)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : null;

  const insufficientBalance = rawBalance !== undefined && amount > 0
    ? rawBalance < toUsdc(amount)
    : false;

  // ── USDC allowance ────────────────────────────────────────────────────────
  const { data: rawAllowance, refetch: refetchAllowance } = useReadContract({
    address: usdcAddress ?? undefined,
    abi: erc20Abi,
    functionName: "allowance",
    args: address && contractAddress ? [address, contractAddress] : undefined,
    query: { enabled: !!usdcAddress && !!address && !!contractAddress && onCorrectChain },
  });

  const needsApproval = amountValid && rawAllowance !== undefined && rawAllowance < toUsdc(amount);

  // ── Write: approve ────────────────────────────────────────────────────────
  const {
    writeContractAsync: approveAsync,
  } = useWriteContract();

  const { isLoading: approveConfirming, isSuccess: approveConfirmed } =
    useWaitForTransactionReceipt({
      hash: txState === "approvePending" ? lastTxHash : undefined,
    });

  // ── Write: createHold ─────────────────────────────────────────────────────
  const {
    writeContractAsync: createHoldAsync,
  } = useWriteContract();

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
    if (!contractAddress || !amountValid || !selected) return;
    setTxError(null);
    setTxState("creating");
    try {
      const hash = await createHoldAsync({
        address: contractAddress,
        abi: holdMeVaultAbi,
        functionName: "createHold",
        args: [toUsdc(amount), BigInt(selected.holdSeconds)],
      });
      setLastTxHash(hash);
      setTxState("createPending");
    } catch (e) {
      setTxError(userFacingError(e));
      setTxState("error");
    }
  }

  function userFacingError(e: unknown): string {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("User rejected") || msg.includes("user rejected") || msg.includes("4001"))
      return "Transaction declined. No funds were moved.";
    if (msg.includes("insufficient funds") || msg.includes("Insufficient"))
      return "Your USDC balance is too low for this hold.";
    if (msg.includes("HoldNotReady")) return "This hold is not ready yet.";
    if (msg.includes("NotHoldOwner")) return "Only the wallet that created this hold can bring it back.";
    if (msg.includes("AlreadyReturned")) return "This hold has already been returned.";
    return "Something went wrong. Please try again.";
  }

  const isBusy = txState === "approving" || txState === "approvePending"
    || txState === "creating" || txState === "createPending";

  // ── Render: success ───────────────────────────────────────────────────────
  if (txState === "success") {
    return (
      <div className="flex flex-col gap-4 items-center text-center py-4">
        <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center text-2xl">✓</div>
        <p className="text-base font-semibold text-stone-800">Hold created.</p>
        <p className="text-sm text-stone-500">
          Your USDC is set aside. Come back when it&apos;s ready.
        </p>
        {createReceipt?.transactionHash && explorerTxUrl(createReceipt.transactionHash) && (
          <a
            href={explorerTxUrl(createReceipt.transactionHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-violet-600 underline underline-offset-2"
          >
            View on explorer
          </a>
        )}
        <Link
          href="/holds"
          className="rounded-xl bg-violet-600 text-white px-5 py-2.5 text-sm font-medium hover:bg-violet-700 transition-colors"
        >
          View my holds
        </Link>
        <button
          onClick={() => { setTxState("idle"); setRawAmount(""); setSelected(null); setLastTxHash(undefined); }}
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
  const showValidation = isValidationWallet(address);

  function DurationButton({ dur }: { dur: Duration }) {
    const active = selected?.holdSeconds === dur.holdSeconds;
    return (
      <button
        onClick={() => setSelected(dur)}
        disabled={isBusy}
        className={[
          "rounded-xl py-2.5 text-sm font-medium transition-all",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          active
            ? "bg-violet-600 text-white shadow-sm"
            : "bg-white border border-stone-200 text-stone-600 hover:border-violet-300 hover:text-violet-700",
        ].join(" ")}
      >
        {dur.label}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Amount */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-stone-700" htmlFor="amount">
            How much would you like to set aside?
          </label>
          {displayBalance !== null && (
            <span className="text-xs text-stone-400">
              Balance: <span className="font-medium text-stone-600">{displayBalance} USDC</span>
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
            max={MAX_HOLD_USDC}
            step="0.01"
            value={rawAmount}
            onChange={(e) => { setRawAmount(e.target.value); if (txState === "error") setTxState("idle"); }}
            disabled={isBusy}
            className={[
              "w-full rounded-xl border px-4 py-3 pr-20 text-lg font-medium",
              "bg-white text-stone-900 placeholder-stone-300",
              "focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent",
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
        <p className="text-xs text-stone-400">10–500 USDC per hold · USDC on Base only</p>
      </div>

      {/* Normal durations */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-stone-700">
          How long should HoldMe keep it?
        </label>
        <div className="grid grid-cols-5 gap-2">
          {NORMAL_DURATIONS.map((dur) => <DurationButton key={dur.holdSeconds} dur={dur} />)}
        </div>
      </div>

      {/* Validation durations */}
      {showValidation && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-amber-600 uppercase tracking-wider">
            Validation options
          </label>
          <div className="grid grid-cols-5 gap-2">
            {VALIDATION_DURATIONS.map((dur) => <DurationButton key={dur.holdSeconds} dur={dur} />)}
          </div>
          <p className="text-xs text-amber-500">
            Minute-based holds for validation testing only. Enforced on-chain for this wallet.
          </p>
        </div>
      )}

      {/* Review card */}
      {canReview && <ReviewCard grossAmount={amount} durationDays={selected!.displayDays} />}

      {/* Error */}
      {txState === "error" && txError && (
        <p className="text-sm text-rose-600 rounded-xl bg-rose-50 border border-rose-100 px-4 py-2.5">
          {txError}
        </p>
      )}

      {/* CTA */}
      <div className="flex flex-col gap-2">
        {canReview && needsApproval ? (
          <Button
            variant="secondary"
            fullWidth
            onClick={handleApprove}
            disabled={isBusy || insufficientBalance}
          >
            {txState === "approving" ? "Waiting for wallet…" :
             txState === "approvePending" || approveConfirming ? "Confirming approval…" :
             "Approve this amount"}
          </Button>
        ) : (
          <Button
            variant="primary"
            fullWidth
            disabled={!canReview || isBusy || insufficientBalance}
            onClick={handleCreateHold}
          >
            {txState === "creating" ? "Waiting for wallet…" :
             txState === "createPending" || createConfirming ? "Confirming…" :
             "Hold it for me"}
          </Button>
        )}

        {!canReview && (
          <p className="text-xs text-center text-stone-400">
            {!isConnected ? "Connect your wallet to continue." :
             !amountValid ? "Enter an amount and choose a return period." :
             "Choose a return period to continue."}
          </p>
        )}
      </div>
    </div>
  );
}
