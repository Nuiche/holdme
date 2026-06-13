// Wallet allowed to create minute-granularity holds for validation testing.
// Enforced by the contract; used here only for UI feature-gating.
export const VALIDATION_WALLET = "0xB8166521a602bF4Dd4748D76864Dc06336EB5729";

export const MIN_HOLD_USDC = 10;
export const MAX_HOLD_USDC = 500;

export const USDC_DECIMALS = 6;
export const USDC_SCALE = 10 ** USDC_DECIMALS; // 1_000_000

/** Convert a human USDC string/number to a 6-decimal BigInt. */
export function toUsdc(amount: number): bigint {
  return BigInt(Math.round(amount * USDC_SCALE));
}

/** Format a 6-decimal BigInt to a readable USDC string (e.g. "99.50"). */
export function fromUsdc(raw: bigint, decimals = 2): string {
  const n = Number(raw) / USDC_SCALE;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
