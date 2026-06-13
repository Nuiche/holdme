"use client";

import { useState } from "react";
import { useAccount, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { formatUnits } from "viem";
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

function formatDate(ts: bigint): string {
  return new Date(Number(ts) * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function holdStatus(h: HoldStruct): "held" | "ready" | "returned" {
  if (h.returned) return "returned";
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  return h.returnAt <= nowSec ? "ready" : "held";
}

interface HoldRowProps {
  holdId: bigint;
  hold: HoldStruct;
  contractAddress: `0x${string}`;
}

function HoldRow({ holdId, hold, contractAddress }: HoldRowProps) {
  const status = holdStatus(hold);
  const [pendingHash, setPendingHash] = useState<`0x${string}` | undefined>();
  const [txError, setTxError] = useState<string | null>(null);

  const { writeContractAsync } = useWriteContract();
  const { isLoading: confirming, isSuccess: confirmed } = useWaitForTransactionReceipt({
    hash: pendingHash,
  });

  const isBusy = !!pendingHash && !confirmed;

  async function handleBringBack() {
    setTxError(null);
    try {
      const hash = await writeContractAsync({
        address: contractAddress,
        abi: holdMeVaultAbi,
        functionName: "bringBack",
        args: [holdId],
      });
      setPendingHash(hash);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("User rejected") || msg.includes("user rejected") || msg.includes("4001")) {
        setTxError("Transaction declined.");
      } else if (msg.includes("HoldNotReady")) {
        setTxError("Hold is not ready yet.");
      } else {
        setTxError("Something went wrong. Try again.");
      }
    }
  }

  const displayStatus = confirmed ? "returned" : status;

  return (
    <div className="flex flex-col gap-1">
      <HoldCard
        status={displayStatus}
        grossAmount={formatUsdc(hold.grossAmount)}
        returnAmount={formatUsdc(hold.returnAmount)}
        fee={formatUsdc(hold.feeAmount)}
        returnDate={formatDate(hold.returnAt)}
        holdId={holdId.toString()}
        onBringBack={handleBringBack}
        bringBackPending={isBusy || confirming}
      />
      {txError && (
        <p className="text-xs text-rose-500 px-1">{txError}</p>
      )}
    </div>
  );
}

export default function HoldsView() {
  const { address, isConnected, chain } = useAccount();
  const onCorrectChain = isConnected && chain?.id === TARGET_CHAIN.id;
  const contractAddress = getContractAddress();

  // Fetch hold IDs for this wallet
  const { data: holdIds, isLoading: loadingIds } = useReadContract({
    address: contractAddress ?? undefined,
    abi: holdMeVaultAbi,
    functionName: "getHoldsForOwner",
    args: address ? [address] : undefined,
    query: {
      enabled: !!contractAddress && !!address && onCorrectChain,
      refetchInterval: 15_000,
    },
  });

  // Fetch each hold via multicall
  const holdContracts = (holdIds ?? []).map((id) => ({
    address: contractAddress as `0x${string}`,
    abi: holdMeVaultAbi,
    functionName: "getHold" as const,
    args: [id] as [bigint],
  }));

  const { data: holdResults, isLoading: loadingHolds } = useReadContracts({
    contracts: holdContracts,
    query: {
      enabled: !!contractAddress && holdContracts.length > 0 && onCorrectChain,
      refetchInterval: 15_000,
    },
  });

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
          href="/"
          className="text-sm text-violet-600 hover:text-violet-800 underline underline-offset-4"
        >
          Create your first hold
        </Link>
      </div>
    );
  }

  // Build typed holds array
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
            />
          ))}
        </section>
      )}

      {held.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-violet-600">
            Being held
          </h2>
          {held.map(({ id, hold }) => (
            <HoldRow
              key={id.toString()}
              holdId={id}
              hold={hold}
              contractAddress={contractAddress}
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
            />
          ))}
        </section>
      )}
    </div>
  );
}
