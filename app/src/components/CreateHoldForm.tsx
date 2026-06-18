"use client";

import { useState, useEffect, startTransition, useRef, Fragment } from "react";
import {
  useAccount,
  useBalance,
  useChainId,
  usePublicClient,
  useReadContract,
  useWalletClient,
} from "wagmi";
import { erc20Abi, formatEther, formatUnits, encodeFunctionData } from "viem";
import Link from "next/link";
import Button from "./Button";
import ReviewCard from "./ReviewCard";
import { MIN_HOLD_USDC, MAX_HOLD_USDC, toUsdc, fromUsdc, formatReadyTime } from "@/lib/constants";
import { TARGET_CHAIN, getContractAddress, getUsdcAddress, explorerTxUrl } from "@/lib/chain";
import { holdMeVaultAbi } from "@/lib/abis/HoldMeVault";

const MINUTE_OPTIONS = [1, 5, 15, 30, 60] as const;
const MAX_DAYS = 365;
const MAX_HOLD_SECONDS = MAX_DAYS * 86400;
const MIN_HOLD_SECONDS = 60;

// Soft warning threshold only — never blocks approval.
const GAS_WARN = 50_000_000_000_000n; // 0.00005 ETH

// Explicit gas limit for USDC approve to bypass eth_estimateGas.
// USDC approve uses ~46k gas; 100k is a safe 2× buffer.
const APPROVE_GAS_LIMIT = 100_000n;

// Explicit gas limit for createHold to bypass eth_estimateGas on mobile.
// Foundry test gas: ~262k (mock ERC20). Real Base USDC (FiatToken v2.2)
// adds ~80k for two complex transfers (safeTransferFrom + safeTransfer).
// 500k provides a comfortable buffer; unused gas is refunded.
const CREATEHOLD_GAS_LIMIT = 500_000n;

type TxState =
  | "idle"
  | "approving"
  | "approvePending"
  | "awaitingAllowance"
  | "creating"
  | "createPending"
  | "success"
  | "error";

// "pre-wallet" — error before we reached approveAsync (chain guard, etc.)
// "wallet-returned-error-no-hash" — wallet was reached, user may have approved,
//   but wallet returned an error instead of a tx hash
// "post-hash" — tx was submitted on-chain but reverted
type ErrorStage = "pre-wallet" | "wallet-returned-error-no-hash" | "post-hash";

// Phase for the diagnostic-only approval test buttons
type DiagPhase = "idle" | "waiting" | "success" | "error";

interface CapturedHold {
  grossAmount: number;
  fee: number;
  returnAmount: number;
  holdSeconds: number;
  createdAt: number;
}

interface ErrorDiag {
  // viem error fields
  errorName: string;
  shortMessage: string;
  details: string;
  contractErrorName: string | null;
  contractErrorArgs: string | null;
  // ETH / gas context
  nativeBalanceRaw: string;
  nativeBalanceEth: string;
  nativeBalanceStatus: string;
  nativeBalanceFreshMs: number | null;
  // Chain context
  activeChainId: number;
  walletChainId: number | null;
  publicClientChainId: number | null;
  // Approve tx request fields
  approveSpender: string | null;
  approveAmountRaw: string | null;
  approveCalldata: string | null;
  approveGasLimit: string | null;
  walletPromptShown: boolean;
  wasRefreshedBeforeApprove: boolean;
  // CreateHold tx context
  createHoldCalldata: string | null;
  createHoldGasLimit: string | null;
  wasRefreshedBeforeCreateHold: boolean;
  errorStage: ErrorStage;
  // USDC context
  rawAmount: string;
  rawAllowance: string;
  rawBalance: string;
  holdSeconds: number;
  daysInput: string;
  minutesSel: number;
  wallet: string;
  contractAddr: string;
  usdcAddr: string;
  chainId: number;
  phase: string;
  txHash: string | null;
}

function extractViemError(e: unknown): Pick<
  ErrorDiag,
  "errorName" | "shortMessage" | "details" | "contractErrorName" | "contractErrorArgs"
> {
  const out = {
    errorName: "UnknownError",
    shortMessage: "",
    details: "",
    contractErrorName: null as string | null,
    contractErrorArgs: null as string | null,
  };

  if (!e || typeof e !== "object") {
    out.shortMessage = String(e);
    return out;
  }

  const err = e as Record<string, unknown>;
  if (typeof err.name === "string") out.errorName = err.name;
  if (typeof err.message === "string") out.details = err.message;
  if (typeof err.shortMessage === "string") out.shortMessage = err.shortMessage;
  if (typeof err.details === "string") out.details = err.details;

  function walk(node: unknown, depth = 0): void {
    if (depth > 8 || !node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    if (n.data && typeof n.data === "object") {
      const d = n.data as Record<string, unknown>;
      if (typeof d.errorName === "string" && !out.contractErrorName) {
        out.contractErrorName = d.errorName;
        if (d.args !== undefined) {
          try {
            const serialisable = Array.isArray(d.args)
              ? d.args.map((a) => (typeof a === "bigint" ? `${a}n` : a))
              : d.args;
            out.contractErrorArgs = JSON.stringify(serialisable);
          } catch {
            out.contractErrorArgs = String(d.args);
          }
        }
      }
    }
    if (n.cause) walk(n.cause, depth + 1);
  }
  walk(e);

  if (!out.shortMessage) {
    out.shortMessage = out.details.split("\n")[0].slice(0, 300);
  }

  return out;
}

function buildDiagText(d: ErrorDiag): string {
  const fmt6 = (raw: string) => {
    const n = Number(raw);
    return isNaN(n) ? raw : (n / 1e6).toFixed(6) + " USDC";
  };
  const ageStr = d.nativeBalanceFreshMs !== null
    ? `${d.nativeBalanceFreshMs}ms ago`
    : "unknown";
  return [
    "=== HoldMe Diagnostic Report ===",
    `Time:             ${new Date().toISOString()}`,
    "",
    "--- Error ---",
    `Error name:       ${d.errorName}`,
    `Short msg:        ${d.shortMessage}`,
    `Details:          ${d.details.slice(0, 500)}`,
    d.contractErrorName ? `Contract err:     ${d.contractErrorName}` : null,
    d.contractErrorArgs ? `Error args:       ${d.contractErrorArgs}` : null,
    d.txHash ? `TX hash:          ${d.txHash}` : null,
    "",
    "--- Transaction context ---",
    `Phase:            ${d.phase}`,
    `Error stage:      ${d.errorStage}`,
    `Wallet reached:   ${d.walletPromptShown}`,
    `Refreshed(appr):  ${d.wasRefreshedBeforeApprove}`,
    `Refreshed(hold):  ${d.wasRefreshedBeforeCreateHold}`,
    d.approveSpender    ? `Approve spender:  ${d.approveSpender}` : null,
    d.approveAmountRaw  ? `Approve amount:   ${d.approveAmountRaw} (${fmt6(d.approveAmountRaw)})` : null,
    d.approveGasLimit   ? `Approve gas:      ${d.approveGasLimit}` : null,
    d.approveCalldata   ? `Approve calldata: ${d.approveCalldata}` : null,
    d.createHoldCalldata  ? `CreateHold data:  ${d.createHoldCalldata}` : null,
    d.createHoldGasLimit  ? `CreateHold gas:   ${d.createHoldGasLimit}` : null,
    `Amount raw:       ${d.rawAmount} (${fmt6(d.rawAmount)})`,
    `Allowance:        ${d.rawAllowance} (${fmt6(d.rawAllowance)})`,
    `USDC balance:     ${d.rawBalance} (${fmt6(d.rawBalance)})`,
    "",
    "--- ETH / gas context ---",
    `ETH balance:      ${d.nativeBalanceRaw} wei (${d.nativeBalanceEth} ETH)`,
    `ETH read status:  ${d.nativeBalanceStatus}`,
    `ETH read age:     ${ageStr}`,
    "",
    "--- Chain context ---",
    `Active chain ID:  ${d.activeChainId} (from useChainId)`,
    `Wallet chain ID:  ${d.walletChainId ?? "—"}  (from useAccount)`,
    `PublicClient ch:  ${d.publicClientChainId ?? "—"}  (from usePublicClient)`,
    "",
    "--- Hold params ---",
    `Hold seconds:     ${d.holdSeconds}`,
    `Days input:       ${d.daysInput || "0"}`,
    `Minutes sel:      ${d.minutesSel}`,
    "",
    "--- Addresses ---",
    `Wallet:           ${d.wallet}`,
    `Contract:         ${d.contractAddr}`,
    `USDC:             ${d.usdcAddr}`,
    `Chain ID:         ${d.chainId}`,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

// Wrapper so Date.now never appears in component-scope functions (react-hooks/purity).
function nowMs(): number { return Date.now(); }

function calcFee(amount: number): number {
  return Math.min(amount * 0.01, 100);
}

function formatUSDC(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

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
  // Wallet reached but returned error without tx hash — likely a wallet/RPC
  // simulation issue inside Phantom after the user approved.
  if (low.includes("unexpected error"))
    return "The wallet returned an error after approval but before submitting the transaction. This is likely a Phantom / WalletConnect simulation issue. Please try again, or use the raw approval option in diagnostics.";
  if (low.includes("network") || low.includes("fetch") || low.includes("timeout") || low.includes("could not"))
    return "Network error. Make sure you're on Base and try again.";
  if (low.includes("execution reverted") || low.includes("call_exception") || low.includes("reverted"))
    return "The wallet or contract rejected this step.";
  return "Something went wrong. Please try again.";
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

export default function CreateHoldForm() {
  const { address, isConnected, chain } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const onCorrectChain = isConnected && chain?.id === TARGET_CHAIN.id;

  const contractAddress = getContractAddress();
  const usdcAddress = getUsdcAddress();

  // ── State ─────────────────────────────────────────────────────────────────
  const [rawAmount, setRawAmount] = useState("");
  const [rawDays, setRawDays] = useState("");
  const [selectedMinutes, setSelectedMinutes] = useState(0);
  const [txState, setTxState] = useState<TxState>("idle");
  const [txError, setTxError] = useState<string | null>(null);
  const [lastTxHash, setLastTxHash] = useState<`0x${string}` | undefined>();
  const [capturedHold, setCapturedHold] = useState<CapturedHold | null>(null);

  const [showDiag, setShowDiag] = useState(false);
  const [showErrDetails, setShowErrDetails] = useState(false);
  const [errorDiag, setErrorDiag] = useState<ErrorDiag | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied">("idle");

  // Diagnostic-only test button (does not affect main flow)
  const [diagRawPhase, setDiagRawPhase] = useState<DiagPhase>("idle");
  const [diagRawResult, setDiagRawResult] = useState<string | null>(null);

  // ── Refs ──────────────────────────────────────────────────────────────────
  // Tracks whether approveAsync() was called — distinguishes "pre-wallet" errors
  // from "wallet returned error without hash" errors.
  const walletPromptSentRef = useRef(false);
  // Same tracking for createHoldAsync().
  const createHoldWalletSentRef = useRef(false);

  // ── Derived form state ────────────────────────────────────────────────────
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

  // ── Native ETH balance ────────────────────────────────────────────────────
  const {
    data: ethBalanceData,
    status: ethBalanceStatus,
    dataUpdatedAt: ethBalanceUpdatedAt,
    refetch: refetchEthBalance,
  } = useBalance({
    address: address ?? undefined,
    query: { enabled: !!address && onCorrectChain },
  });

  const ethBalanceWei: bigint | undefined = ethBalanceData?.value;
  const displayEthBalance = ethBalanceWei !== undefined
    ? parseFloat(formatEther(ethBalanceWei)).toFixed(6) + " ETH"
    : null;

  const gasKnownLow = ethBalanceWei !== undefined && ethBalanceWei < GAS_WARN;

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

  const allowanceLoading = allowanceQueryEnabled && rawAllowance === undefined;
  const needsApproval = amountValid && rawAllowance !== undefined && rawAllowance < toUsdc(amount);

  // ── Effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (txState !== "awaitingAllowance") return;
    const target = amountValid ? toUsdc(amount) : 0n;
    if (rawAllowance !== undefined && rawAllowance >= target) {
      startTransition(() => { setTxState("idle"); });
      return;
    }
    const timer = setInterval(() => { refetchAllowance(); }, 1500);
    return () => clearInterval(timer);
  }, [txState, rawAllowance, amount, amountValid, refetchAllowance]);

  // ── Diagnostic helper ─────────────────────────────────────────────────────
  interface CaptureOpts {
    txHash?: string;
    errorStage?: ErrorStage;
    approveSpender?: string;
    approveAmountRaw?: string;
    approveCalldata?: string;
    approveGasLimit?: string;
    walletPromptShown?: boolean;
    wasRefreshedBeforeApprove?: boolean;
    createHoldCalldata?: string;
    createHoldGasLimit?: string;
    wasRefreshedBeforeCreateHold?: boolean;
  }

  function captureErrorDiag(e: unknown, phase: string, opts: CaptureOpts = {}) {
    const viemPart = extractViemError(e);
    setErrorDiag({
      ...viemPart,
      nativeBalanceRaw: ethBalanceWei?.toString() ?? "unknown",
      nativeBalanceEth: ethBalanceWei !== undefined ? formatEther(ethBalanceWei) : "unknown",
      nativeBalanceStatus: ethBalanceStatus,
      nativeBalanceFreshMs: ethBalanceUpdatedAt ? nowMs() - ethBalanceUpdatedAt : null,
      activeChainId: chainId,
      walletChainId: chain?.id ?? null,
      publicClientChainId: publicClient?.chain?.id ?? null,
      approveSpender: opts.approveSpender ?? null,
      approveAmountRaw: opts.approveAmountRaw ?? null,
      approveCalldata: opts.approveCalldata ?? null,
      approveGasLimit: opts.approveGasLimit ?? null,
      walletPromptShown: opts.walletPromptShown ?? false,
      wasRefreshedBeforeApprove: opts.wasRefreshedBeforeApprove ?? false,
      createHoldCalldata: opts.createHoldCalldata ?? null,
      createHoldGasLimit: opts.createHoldGasLimit ?? null,
      wasRefreshedBeforeCreateHold: opts.wasRefreshedBeforeCreateHold ?? false,
      errorStage: opts.errorStage ?? "pre-wallet",
      rawAmount: amountValid ? toUsdc(amount).toString() : "0",
      rawAllowance: rawAllowance?.toString() ?? "unknown",
      rawBalance: rawBalance?.toString() ?? "unknown",
      holdSeconds: totalHoldSeconds,
      daysInput: rawDays,
      minutesSel: selectedMinutes,
      wallet: address ?? "not connected",
      contractAddr: contractAddress ?? "not set",
      usdcAddr: usdcAddress ?? "not set",
      chainId,
      phase,
      txHash: opts.txHash ?? null,
    });
    setShowErrDetails(true);
  }

  // ── Main flow: approve ────────────────────────────────────────────────────
  async function handleApprove() {
    if (!usdcAddress || !contractAddress || !amount || !walletClient || !publicClient || !address) return;
    setTxError(null);
    setErrorDiag(null);
    setTxState("approving");

    try {
      await Promise.all([refetchEthBalance(), refetchAllowance()]);
    } catch {
      // non-fatal — stale data is acceptable
    }

    if (chain?.id !== TARGET_CHAIN.id) {
      setTxError(`Please switch to ${TARGET_CHAIN.name} and try again.`);
      setTxState("error");
      return;
    }

    // Encode calldata; hard-fail if this throws (invalid args would make sendTransaction useless).
    let approveCalldata: `0x${string}`;
    try {
      approveCalldata = encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [contractAddress, toUsdc(amount)],
      });
    } catch (e) {
      captureErrorDiag(e, "approving", {
        errorStage: "pre-wallet",
        walletPromptShown: false,
        wasRefreshedBeforeApprove: true,
      });
      setTxError("Failed to encode transaction. Please try again.");
      setTxState("error");
      return;
    }

    // Send raw tx — bypasses wagmi writeContract wrapper and Phantom's simulation layer.
    let approveHash: `0x${string}`;
    walletPromptSentRef.current = true;
    try {
      approveHash = await walletClient.sendTransaction({
        account: address,
        to: usdcAddress,
        data: approveCalldata,
        gas: APPROVE_GAS_LIMIT,
        chain: TARGET_CHAIN,
      });
      walletPromptSentRef.current = false;
      setLastTxHash(approveHash);
      setTxState("approvePending");
    } catch (e) {
      const walletWasReached = walletPromptSentRef.current;
      walletPromptSentRef.current = false;
      captureErrorDiag(e, "approving", {
        errorStage: walletWasReached ? "wallet-returned-error-no-hash" : "pre-wallet",
        walletPromptShown: walletWasReached,
        approveSpender: contractAddress,
        approveAmountRaw: toUsdc(amount).toString(),
        approveCalldata,
        approveGasLimit: APPROVE_GAS_LIMIT.toString(),
        wasRefreshedBeforeApprove: true,
      });
      setTxError(userFacingError(e));
      setTxState("error");
      return;
    }

    // Wait for on-chain confirmation via public RPC (not wallet relay).
    try {
      const receipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });
      if (receipt.status === "reverted") {
        setTxError("USDC approval was rejected on-chain. Please try again.");
        setTxState("error");
        return;
      }
      // Kick allowance polling — the awaitingAllowance effect handles the rest.
      await refetchAllowance();
      setTxState("awaitingAllowance");
      setLastTxHash(undefined);
    } catch (e) {
      captureErrorDiag(e, "approveReceipt", {
        errorStage: "post-hash",
        walletPromptShown: true,
        txHash: approveHash,
        approveSpender: contractAddress,
        approveAmountRaw: toUsdc(amount).toString(),
        approveCalldata,
        approveGasLimit: APPROVE_GAS_LIMIT.toString(),
        wasRefreshedBeforeApprove: true,
      });
      setTxError("Approval submitted but confirmation timed out. Check your wallet history and try again.");
      setTxState("error");
    }
  }

  // ── Diagnostic: test sendTransaction (same path as main flow) ───────────
  async function handleDiagRaw() {
    if (!usdcAddress || !contractAddress || !amount || !address || !walletClient) return;
    setDiagRawPhase("waiting");
    setDiagRawResult(null);

    let calldata: `0x${string}`;
    try {
      calldata = encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [contractAddress, toUsdc(amount)],
      });
    } catch (e) {
      setDiagRawPhase("error");
      setDiagRawResult("Failed to encode calldata: " + String(e));
      return;
    }

    console.log("[diag-raw] sendTransaction", {
      to: usdcAddress,
      data: calldata,
      gas: APPROVE_GAS_LIMIT.toString(),
      chain: TARGET_CHAIN.id,
    });

    try {
      const hash = await walletClient.sendTransaction({
        account: address,
        to: usdcAddress,
        data: calldata,
        gas: APPROVE_GAS_LIMIT,
        chain: TARGET_CHAIN,
      });
      console.log("[diag-raw] hash returned:", hash);
      setDiagRawPhase("success");
      setDiagRawResult(`OK — hash: ${hash}`);
    } catch (e) {
      const { shortMessage, details, errorName } = extractViemError(e);
      const msg = `${errorName}: ${shortMessage || details}`;
      console.error("[diag-raw] error:", e);
      setDiagRawPhase("error");
      setDiagRawResult(msg);
    }
  }

  async function handleCreateHold() {
    if (!contractAddress || !usdcAddress || !amountValid || !durationValid || !walletClient || !publicClient || !address) return;

    setTxError(null);
    setErrorDiag(null);
    setTxState("creating");

    // Force-refresh allowance, USDC balance, and ETH before touching the wallet.
    // Use the return values directly — React state for rawAllowance/rawBalance may
    // not have propagated yet by the time we check below.
    const [allowanceResult, balanceResult] = await Promise.allSettled([
      refetchAllowance(),
      refetchBalance(),
    ]);
    refetchEthBalance().catch(() => {});

    const freshAllowance =
      allowanceResult.status === "fulfilled" ? allowanceResult.value.data : rawAllowance;
    const freshBalance =
      balanceResult.status === "fulfilled" ? balanceResult.value.data : rawBalance;

    // Chain guard
    if (chain?.id !== TARGET_CHAIN.id) {
      setTxError(`Please switch to ${TARGET_CHAIN.name} and try again.`);
      setTxState("error");
      return;
    }

    // Fresh allowance check
    if (freshAllowance !== undefined && freshAllowance < toUsdc(amount)) {
      const guard = new Error(
        `Fresh allowance insufficient: allowance=${freshAllowance}, required=${toUsdc(amount)}`
      );
      captureErrorDiag(guard, "pre-createHold", {
        errorStage: "pre-wallet",
        wasRefreshedBeforeCreateHold: true,
      });
      setTxError("Allowance check failed. Please approve USDC spending first.");
      setTxState("error");
      return;
    }

    // Fresh balance check
    if (freshBalance !== undefined && freshBalance < toUsdc(amount)) {
      const guard = new Error(
        `Fresh balance insufficient: balance=${freshBalance}, required=${toUsdc(amount)}`
      );
      captureErrorDiag(guard, "pre-createHold", {
        errorStage: "pre-wallet",
        wasRefreshedBeforeCreateHold: true,
      });
      setTxError("Insufficient USDC balance.");
      setTxState("error");
      return;
    }

    // Encode calldata; hard-fail if this throws (invalid args would make sendTransaction useless).
    let createHoldCalldata: `0x${string}`;
    try {
      createHoldCalldata = encodeFunctionData({
        abi: holdMeVaultAbi,
        functionName: "createHold",
        args: [toUsdc(amount), BigInt(totalHoldSeconds)],
      });
    } catch (e) {
      captureErrorDiag(e, "creating", {
        errorStage: "pre-wallet",
        wasRefreshedBeforeCreateHold: true,
      });
      setTxError("Failed to encode transaction. Please try again.");
      setTxState("error");
      return;
    }

    const fee = calcFee(amount);
    setCapturedHold({
      grossAmount: amount,
      fee,
      returnAmount: amount - fee,
      holdSeconds: totalHoldSeconds,
      createdAt: Math.floor(nowMs() / 1000),
    });

    // Send raw tx — bypasses wagmi writeContract wrapper and Phantom's simulation layer.
    // Test gas: ~262k (mock ERC20) + ~80k real USDC overhead = ~342k actual.
    // 500k is a comfortable buffer; unused gas is refunded by the EVM.
    let createHash: `0x${string}`;
    createHoldWalletSentRef.current = true;
    try {
      createHash = await walletClient.sendTransaction({
        account: address,
        to: contractAddress,
        data: createHoldCalldata,
        gas: CREATEHOLD_GAS_LIMIT,
        chain: TARGET_CHAIN,
      });
      createHoldWalletSentRef.current = false;
      setLastTxHash(createHash);
      setTxState("createPending");
    } catch (e) {
      const walletWasReached = createHoldWalletSentRef.current;
      createHoldWalletSentRef.current = false;
      captureErrorDiag(e, "creating", {
        errorStage: walletWasReached ? "wallet-returned-error-no-hash" : "pre-wallet",
        walletPromptShown: walletWasReached,
        createHoldCalldata,
        createHoldGasLimit: CREATEHOLD_GAS_LIMIT.toString(),
        wasRefreshedBeforeCreateHold: true,
      });
      setTxError(userFacingError(e));
      setTxState("error");
      return;
    }

    // Wait for on-chain confirmation via public RPC.
    try {
      const receipt = await publicClient.waitForTransactionReceipt({ hash: createHash });
      if (receipt.status === "reverted") {
        captureErrorDiag(new Error("createHold reverted on-chain"), "createReceipt", {
          errorStage: "post-hash",
          walletPromptShown: true,
          txHash: createHash,
          createHoldCalldata,
          createHoldGasLimit: CREATEHOLD_GAS_LIMIT.toString(),
          wasRefreshedBeforeCreateHold: true,
        });
        setShowErrDetails(true);
        setTxError("The hold transaction was rejected on-chain. Please try again.");
        setTxState("error");
        return;
      }
      refetchBalance();
      setTxState("success");
    } catch (e) {
      captureErrorDiag(e, "createReceipt", {
        errorStage: "post-hash",
        walletPromptShown: true,
        txHash: createHash,
        createHoldCalldata,
        createHoldGasLimit: CREATEHOLD_GAS_LIMIT.toString(),
        wasRefreshedBeforeCreateHold: true,
      });
      setTxError("Hold submitted but confirmation timed out. Check your wallet history — your USDC may have been moved.");
      setTxState("error");
    }
  }

  async function handleCopyDiag() {
    if (!errorDiag) return;
    try {
      await navigator.clipboard.writeText(buildDiagText(errorDiag));
      setCopyStatus("copied");
      setTimeout(() => setCopyStatus("idle"), 2500);
    } catch {
      setCopyStatus("idle");
    }
  }

  // ── Before early returns: values safe to compute here ─────────────────────
  const isBusy =
    txState === "approving" ||
    txState === "approvePending" ||
    txState === "awaitingAllowance" ||
    txState === "creating" ||
    txState === "createPending";

  const ethBalanceReadTime = ethBalanceUpdatedAt
    ? new Date(ethBalanceUpdatedAt).toLocaleTimeString()
    : null;

  // CreateHold tx request — shown in diagnostics panel (no secrets: only amount + holdSeconds)
  const createHoldCalldataPreview = amountValid && durationValid && contractAddress
    ? (() => {
        try {
          return encodeFunctionData({
            abi: holdMeVaultAbi,
            functionName: "createHold",
            args: [toUsdc(amount), BigInt(totalHoldSeconds)],
          });
        } catch {
          return null;
        }
      })()
    : null;

  // Approve tx request — shown in diagnostics panel (no secrets: only spender + amount)
  const approveCalldataPreview = amountValid && usdcAddress && contractAddress
    ? (() => {
        try {
          return encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [contractAddress, toUsdc(amount)],
          });
        } catch {
          return null;
        }
      })()
    : null;

  // ── Render: success ───────────────────────────────────────────────────────
  if (txState === "success" && capturedHold) {
    const readyAt = capturedHold.createdAt + capturedHold.holdSeconds;
    const explorerUrl = lastTxHash ? explorerTxUrl(lastTxHash) : "";

    return (
      <div className="flex flex-col gap-6">
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

        <div className="rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-4 flex flex-col gap-2.5">
          {[
            { label: "Set aside", value: `${formatUSDC(capturedHold.grossAmount)} USDC` },
            { label: "HoldMe fee (1%)", value: `${formatUSDC(capturedHold.fee)} USDC` },
            { label: "Ready to bring back", value: `${formatUSDC(capturedHold.returnAmount)} USDC`, bold: true },
            { label: "Ready on", value: formatReadyTime(readyAt), highlight: true },
          ].map(({ label, value, bold, highlight }) => (
            <div key={label} className="flex items-baseline justify-between gap-4">
              <span className="text-sm text-stone-500 shrink-0">{label}</span>
              <span
                className={[
                  "text-sm text-right",
                  bold ? "font-semibold text-stone-900" : "text-stone-700",
                  highlight ? "text-emerald-700 font-medium" : "",
                ].filter(Boolean).join(" ")}
              >
                {value}
              </span>
            </div>
          ))}
        </div>

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
              setErrorDiag(null);
              setDiagRawPhase("idle");
              setDiagRawResult(null);
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
  const displayAllowance = rawAllowance !== undefined ? fromUsdc(rawAllowance) : null;

  return (
    <div className="flex flex-col gap-5">
      <FormHeader />
      <div className="h-px bg-stone-100" />

      {/* Soft gas warning — informational only, never blocks */}
      {gasKnownLow && (
        <div className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-2.5 flex items-start gap-2">
          <span className="text-amber-500 text-sm leading-none pt-0.5" aria-hidden="true">⚠</span>
          <p className="text-xs text-amber-700">
            Low ETH balance detected ({displayEthBalance}).
            You may need a small amount of ETH on Base for gas.
          </p>
        </div>
      )}

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
              if (txState === "error") { setTxState("idle"); setErrorDiag(null); }
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
            if (txState === "error") { setTxState("idle"); setErrorDiag(null); }
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
                  if (txState === "error") { setTxState("idle"); setErrorDiag(null); }
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

      {canSubmit && <ReviewCard grossAmount={amount} holdSeconds={totalHoldSeconds} />}

      {/* Error box with expandable diagnostics */}
      {txState === "error" && txError && (
        <div className="rounded-xl bg-rose-50 border border-rose-100 px-4 py-3 flex flex-col gap-2">
          <p className="text-sm font-medium text-rose-700">{txError}</p>

          <button
            type="button"
            onClick={() => setShowErrDetails((v) => !v)}
            className="text-xs text-rose-400 underline underline-offset-2 text-left w-fit"
          >
            {showErrDetails ? "Hide details ▴" : "Show error details ▾"}
          </button>

          {showErrDetails && errorDiag && (
            <div className="flex flex-col gap-2 pt-1">
              <pre className="text-xs text-rose-800 bg-rose-100 rounded-lg px-3 py-3 overflow-x-auto whitespace-pre-wrap break-words leading-relaxed select-all font-mono">
                {buildDiagText(errorDiag)}
              </pre>
              <button
                type="button"
                onClick={handleCopyDiag}
                className="self-start text-xs px-3 py-1.5 rounded-lg bg-rose-200 text-rose-700 hover:bg-rose-300 active:bg-rose-400 transition-colors font-medium"
              >
                {copyStatus === "copied" ? "✓ Copied!" : "Copy diagnostics"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* CTA */}
      <div className="flex flex-col gap-1.5">
        {canSubmit && (needsApproval || txState === "awaitingAllowance") ? (
          <>
            <Button
              variant="secondary"
              fullWidth
              onClick={handleApprove}
              disabled={isBusy || insufficientBalance}
            >
              {txState === "approving"
                ? "Waiting for wallet…"
                : txState === "approvePending"
                ? "Confirming approval…"
                : txState === "awaitingAllowance"
                ? "Approval confirmed. Checking allowance…"
                : "Approve USDC"}
            </Button>
            <p className="text-xs text-stone-400 text-center">
              USDC covers the hold. ETH on Base covers network gas.
            </p>
          </>
        ) : (
          <Button
            variant="primary"
            fullWidth
            disabled={!canSubmit || isBusy || insufficientBalance || allowanceLoading}
            onClick={handleCreateHold}
          >
            {allowanceLoading
              ? "Checking allowance…"
              : txState === "awaitingAllowance"
              ? "Approval confirmed. Checking allowance…"
              : txState === "creating"
              ? "Waiting for wallet…"
              : txState === "createPending"
              ? "Confirming…"
              : "Hold Me"}
          </Button>
        )}
      </div>

      {/* Preflight diagnostics — collapsible */}
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => setShowDiag((v) => !v)}
          className="text-xs text-stone-400 underline underline-offset-2 text-left w-fit"
        >
          {showDiag ? "Hide diagnostics ▴" : "Show diagnostics ▾"}
        </button>

        {showDiag && (
          <div className="rounded-xl bg-stone-50 border border-stone-100 px-3 py-3 text-xs text-stone-500 flex flex-col gap-4">

            {/* State grid */}
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
              {([
                ["ETH balance",    displayEthBalance ?? "—"],
                ["ETH status",     ethBalanceStatus + (ethBalanceReadTime ? ` @ ${ethBalanceReadTime}` : "")],
                ["USDC balance",   displayBalance !== null ? `${displayBalance} USDC` : "—"],
                ["Allowance",      displayAllowance !== null ? `${displayAllowance} USDC` : allowanceLoading ? "loading…" : "—"],
                ["Needs approval", rawAllowance !== undefined ? (needsApproval ? "Yes" : "No") : "—"],
                ["Hold seconds",   totalHoldSeconds > 0 ? String(totalHoldSeconds) : "—"],
                ["Active chain",   `${chainId}${chainId === TARGET_CHAIN.id ? " ✓" : " ✗ wrong"}`],
                ["Wallet chain",   chain?.id !== undefined ? `${chain.id}${chain.id === TARGET_CHAIN.id ? " ✓" : " ✗ wrong"}` : "—"],
                ["PubClient ch",   publicClient?.chain?.id !== undefined ? String(publicClient.chain.id) : "—"],
                ["Contract",       contractAddress ? `${contractAddress.slice(0, 8)}…${contractAddress.slice(-6)}` : "—"],
                ["USDC addr",      usdcAddress ? `${usdcAddress.slice(0, 8)}…${usdcAddress.slice(-6)}` : "—"],
                ["Wallet",         address ? `${address.slice(0, 8)}…${address.slice(-6)}` : "—"],
                ["Phase",          txState],
              ] as [string, string][]).map(([label, value]) => (
                <Fragment key={label}>
                  <span className="text-stone-400 shrink-0">{label}</span>
                  <span className="font-mono text-stone-600 break-all">{value}</span>
                </Fragment>
              ))}
            </div>

            {/* Approve tx request fields */}
            {amountValid && (
              <div className="flex flex-col gap-1">
                <p className="text-stone-400 font-medium">Approve tx request</p>
                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono">
                  {([
                    ["to",       usdcAddress],
                    ["function", "approve(address,uint256)"],
                    ["selector", "0x095ea7b3"],
                    ["spender",  contractAddress],
                    ["amount",   toUsdc(amount).toString()],
                    ["gas",      APPROVE_GAS_LIMIT.toString()],
                    ["chainId",  String(TARGET_CHAIN.id)],
                    ["account",  address ?? "—"],
                    ["calldata", approveCalldataPreview ?? "—"],
                  ] as [string, string][]).map(([label, value]) => (
                    <Fragment key={label}>
                      <span className="text-stone-400 shrink-0">{label}</span>
                      <span className="text-stone-600 break-all">{value}</span>
                    </Fragment>
                  ))}
                </div>
              </div>
            )}

            {/* CreateHold tx request fields */}
            {amountValid && durationValid && (
              <div className="flex flex-col gap-1">
                <p className="text-stone-400 font-medium">CreateHold tx request</p>
                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono">
                  {([
                    ["to",         contractAddress],
                    ["function",   "createHold(uint256,uint256)"],
                    ["selector",   createHoldCalldataPreview ? createHoldCalldataPreview.slice(0, 10) : "—"],
                    ["amount",     toUsdc(amount).toString()],
                    ["holdSecs",   String(totalHoldSeconds)],
                    ["gas",        CREATEHOLD_GAS_LIMIT.toString()],
                    ["chainId",    String(TARGET_CHAIN.id)],
                    ["account",    address ?? "—"],
                    ["calldata",   createHoldCalldataPreview ?? "—"],
                  ] as [string, string][]).map(([label, value]) => (
                    <Fragment key={label}>
                      <span className="text-stone-400 shrink-0">{label}</span>
                      <span className="text-stone-600 break-all">{value}</span>
                    </Fragment>
                  ))}
                </div>
                <p className="text-stone-400 mt-1">
                  ⚠ No test button — createHold moves real USDC. Use the main Hold Me button.
                </p>
              </div>
            )}

            {/* Diagnostic test button */}
            {amountValid && (
              <div className="flex flex-col gap-3 pt-1">
                <p className="text-stone-400 font-medium">Approval test (diagnostic only — do not create a hold)</p>
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={handleDiagRaw}
                    disabled={diagRawPhase === "waiting" || !walletClient}
                    className="self-start text-xs px-3 py-1.5 rounded-lg bg-stone-200 text-stone-700 hover:bg-stone-300 disabled:opacity-50 font-medium transition-colors"
                  >
                    {diagRawPhase === "waiting" ? "Waiting for wallet…" : "Test approve (sendTransaction)"}
                  </button>
                  {diagRawResult && (
                    <p className={[
                      "text-xs font-mono break-all",
                      diagRawPhase === "success" ? "text-emerald-700" : "text-rose-600",
                    ].join(" ")}>
                      {diagRawResult}
                    </p>
                  )}
                  <p className="text-xs text-stone-400">
                    Same path as the main Approve USDC button — raw sendTransaction with encoded calldata.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
