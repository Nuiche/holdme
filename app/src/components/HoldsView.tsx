"use client";

import { useState } from "react";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useReadContracts,
  useWalletClient,
} from "wagmi";
import { encodeFunctionData, formatUnits } from "viem";
import Link from "next/link";
import HoldCard from "./HoldCard";
import { TARGET_CHAIN, getContractAddress } from "@/lib/chain";
import { holdMeVaultAbi, type HoldStruct } from "@/lib/abis/HoldMeVault";

function formatUsdc(raw: bigint): string {
  return parseFloat(formatUnits(raw, 6)).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function holdStatus(h: HoldStruct): "held" | "ready" | "returned" {
  if (h.returned) return "returned";
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  return h.returnAt <= nowSec ? "ready" : "held";
}

// bringBack: Foundry test gas ~275k (mock ERC20) + ~45k real USDC safeTransfer = ~320k actual.
// 400k is a comfortable buffer; unused gas is refunded.
const BRINGBACK_GAS_LIMIT = 400_000n;

type TxPhase = "idle" | "signing" | "pending" | "confirmed" | "error";

function bringBackError(e: unknown): string {
  console.error("[HoldMe] bringBack error:", e);
  const msg = e instanceof Error ? e.message : String(e);
  const low = msg.toLowerCase();

  if (low.includes("user rejected") || low.includes("user denied") || msg.includes("4001"))
    return "Transaction declined. Nothing was moved.";
  if (low.includes("holdnotready") || low.includes("hold not ready"))
    return "This hold isn't ready yet — check the timer.";
  if (low.includes("alreadyreturned") || low.includes("already returned"))
    return "This hold has already been returned.";
  if (low.includes("notholdowner") || low.includes("not hold owner"))
    return "Only the wallet that created this hold can bring it back.";
  if (low.includes("insufficient funds") || low.includes("gas required exceeds"))
    return "Not enough ETH for gas fees.";
  if (low.includes("network") || low.includes("fetch") || low.includes("timeout") || low.includes("could not"))
    return "Network error. Make sure you're on Base and try again.";
  if (low.includes("execution reverted") || low.includes("call_exception") || low.includes("reverted"))
    return "Transaction reverted. Check the hold is ready, then try again.";
  return "Something went wrong. Please try again.";
}

interface HoldRowProps {
  holdId: bigint;
  hold: HoldStruct;
  contractAddress: `0x${string}`;
  onBringBackSuccess: () => void;
}

function HoldRow({ holdId, hold, contractAddress, onBringBackSuccess }: HoldRowProps) {
  const [txPhase, setTxPhase] = useState<TxPhase>("idle");
  const [txError, setTxError] = useState<string | null>(null);

  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();

  async function handleBringBack() {
    if (txPhase !== "idle" && txPhase !== "error") return;
    if (!address || !walletClient || !publicClient) return;

    setTxError(null);
    setTxPhase("signing");

    const bringBackData = encodeFunctionData({
      abi: holdMeVaultAbi,
      functionName: "bringBack",
      args: [holdId],
    });

    // Send raw tx — bypasses wagmi writeContract wrapper and Phantom's simulation layer.
    let hash: `0x${string}`;
    try {
      hash = await walletClient.sendTransaction({
        account: address,
        to: contractAddress,
        data: bringBackData,
        gas: BRINGBACK_GAS_LIMIT,
        chain: TARGET_CHAIN,
      });
      setTxPhase("pending");
    } catch (e) {
      setTxError(bringBackError(e));
      setTxPhase("error");
      return;
    }

    // Wait for on-chain confirmation via public RPC.
    try {
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status === "reverted") {
        setTxError("Transaction reverted on-chain. Please try again.");
        setTxPhase("error");
        return;
      }
      setTxPhase("confirmed");
      onBringBackSuccess();
    } catch (e) {
      setTxError(bringBackError(e));
      setTxPhase("error");
    }
  }

  const status = txPhase === "confirmed" ? "returned" : holdStatus(hold);
  const isBusy = txPhase === "signing" || txPhase === "pending";

  return (
    <div className="flex flex-col gap-1">
      <HoldCard
        status={status}
        grossAmount={formatUsdc(hold.grossAmount)}
        returnAmount={formatUsdc(hold.returnAmount)}
        fee={formatUsdc(hold.feeAmount)}
        returnAtSeconds={hold.returnAt}
        holdId={holdId.toString()}
        onBringBack={handleBringBack}
        bringBackPending={isBusy}
      />
      {txPhase === "error" && txError && (
        <div className="flex flex-col gap-0.5 px-1">
          <p className="text-xs text-rose-500">{txError}</p>
          <button
            onClick={() => {
              setTxPhase("idle");
              setTxError(null);
            }}
            className="text-xs text-stone-400 underline underline-offset-2 text-left hover:text-stone-600"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

export default function HoldsView() {
  const { address, isConnected, chain } = useAccount();
  const onCorrectChain = isConnected && chain?.id === TARGET_CHAIN.id;
  const contractAddress = getContractAddress();

  const {
    data: holdIds,
    isLoading: loadingIds,
    refetch: refetchIds,
  } = useReadContract({
    address: contractAddress ?? undefined,
    abi: holdMeVaultAbi,
    functionName: "getHoldsForOwner",
    args: address ? [address] : undefined,
    query: {
      enabled: !!contractAddress && !!address && onCorrectChain,
      refetchInterval: 15_000,
    },
  });

  const holdContracts = (holdIds ?? []).map((id) => ({
    address: contractAddress as `0x${string}`,
    abi: holdMeVaultAbi,
    functionName: "getHold" as const,
    args: [id] as [bigint],
  }));

  const { data: holdResults, isLoading: loadingHolds, refetch: refetchHolds } = useReadContracts({
    contracts: holdContracts,
    query: {
      enabled: !!contractAddress && holdContracts.length > 0 && onCorrectChain,
      refetchInterval: 15_000,
    },
  });

  function refetchAll() {
    refetchIds();
    refetchHolds();
  }

  // ── Not connected ─────────────────────────────────────────────────────────
  if (!isConnected) {
    return (
      <div className="rounded-2xl border border-dashed border-stone-200 bg-white p-8 text-center flex flex-col gap-2">
        <p className="text-sm text-stone-500">Connect your wallet to view your holds.</p>
        <p className="text-xs text-stone-400">Use the Connect wallet button in the header.</p>
      </div>
    );
  }

  if (!onCorrectChain) {
    return (
      <div className="rounded-2xl border border-dashed border-amber-100 bg-amber-50 p-8 text-center">
        <p className="text-sm text-amber-700">Switch to {TARGET_CHAIN.name} to view your holds.</p>
      </div>
    );
  }

  if (!contractAddress) {
    return (
      <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">
        Contract not yet deployed. Set NEXT_PUBLIC_HOLDME_CONTRACT_ADDRESS in .env.
      </div>
    );
  }

  const isLoading = loadingIds || (holdContracts.length > 0 && loadingHolds);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        {[1, 2].map((i) => (
          <div key={i} className="h-36 rounded-2xl bg-stone-100 animate-pulse" />
        ))}
      </div>
    );
  }

  if (!holdIds || holdIds.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-stone-200 bg-white p-8 text-center flex flex-col gap-3">
        <p className="text-sm text-stone-500">No holds yet.</p>
        <Link
          href="/create"
          className="text-sm text-emerald-600 hover:text-emerald-800 underline underline-offset-4"
        >
          Create your first hold
        </Link>
      </div>
    );
  }

  const holds: Array<{ id: bigint; hold: HoldStruct }> = [];
  holdIds.forEach((id, i) => {
    const result = holdResults?.[i];
    if (result?.status === "success" && result.result) {
      holds.push({ id, hold: result.result as HoldStruct });
    }
  });

  const ready = holds.filter((h) => holdStatus(h.hold) === "ready");
  const held = holds.filter((h) => holdStatus(h.hold) === "held");
  const returned = holds.filter((h) => holdStatus(h.hold) === "returned");

  return (
    <div className="flex flex-col gap-8">
      {ready.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-emerald-600">
            Ready to bring back
          </h2>
          {ready.map(({ id, hold }) => (
            <HoldRow
              key={id.toString()}
              holdId={id}
              hold={hold}
              contractAddress={contractAddress}
              onBringBackSuccess={refetchAll}
            />
          ))}
        </section>
      )}

      {held.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-500">
            Being held
          </h2>
          {held.map(({ id, hold }) => (
            <HoldRow
              key={id.toString()}
              holdId={id}
              hold={hold}
              contractAddress={contractAddress}
              onBringBackSuccess={refetchAll}
            />
          ))}
        </section>
      )}

      {returned.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-stone-400">
            Returned
          </h2>
          {returned.map(({ id, hold }) => (
            <HoldRow
              key={id.toString()}
              holdId={id}
              hold={hold}
              contractAddress={contractAddress}
              onBringBackSuccess={refetchAll}
            />
          ))}
        </section>
      )}
    </div>
  );
}
