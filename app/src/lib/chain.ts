import { base, baseSepolia, foundry } from "wagmi/chains";
import type { Chain } from "viem";

export const TARGET_CHAIN_ID = parseInt(
  process.env.NEXT_PUBLIC_CHAIN_ID ?? "84532",
  10
);

export const TARGET_CHAIN: Chain =
  TARGET_CHAIN_ID === 8453  ? base :
  TARGET_CHAIN_ID === 31337 ? foundry :
  baseSepolia;

export const EXPLORER_URL =
  TARGET_CHAIN.blockExplorers?.default?.url ?? "";

export function explorerTxUrl(hash: string): string {
  return EXPLORER_URL ? `${EXPLORER_URL}/tx/${hash}` : "";
}

export function isValidAddress(addr: string): addr is `0x${string}` {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

export function getContractAddress(): `0x${string}` | null {
  const addr = process.env.NEXT_PUBLIC_HOLDME_CONTRACT_ADDRESS ?? "";
  return isValidAddress(addr) ? addr : null;
}

export function getUsdcAddress(): `0x${string}` | null {
  const addr = process.env.NEXT_PUBLIC_USDC_ADDRESS ?? "";
  return isValidAddress(addr) ? addr : null;
}
