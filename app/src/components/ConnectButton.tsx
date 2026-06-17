"use client";

import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { TARGET_CHAIN } from "@/lib/chain";

function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function ConnectButton() {
  const { address, isConnected, chain } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();

  const onWrongChain = isConnected && chain?.id !== TARGET_CHAIN.id;

  if (!isConnected) {
    return (
      <button
        onClick={() => connect({ connector: connectors[0] })}
        disabled={isConnecting}
        className="rounded-xl bg-emerald-600 text-white px-3.5 py-1.5 text-sm font-medium hover:bg-emerald-700 disabled:opacity-60 transition-colors"
      >
        {isConnecting ? "Connecting…" : "Connect wallet"}
      </button>
    );
  }

  if (onWrongChain) {
    return (
      <button
        onClick={() => switchChain({ chainId: TARGET_CHAIN.id })}
        disabled={isSwitching}
        className="rounded-xl bg-amber-500 text-white px-3.5 py-1.5 text-sm font-medium hover:bg-amber-600 disabled:opacity-60 transition-colors"
      >
        {isSwitching ? "Switching…" : `Switch to ${TARGET_CHAIN.name}`}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-stone-500 font-mono hidden sm:block">
        {shortAddress(address!)}
      </span>
      <button
        onClick={() => disconnect()}
        className="rounded-xl border border-stone-200 text-stone-500 px-3 py-1.5 text-sm hover:bg-stone-100 transition-colors"
      >
        Disconnect
      </button>
    </div>
  );
}
