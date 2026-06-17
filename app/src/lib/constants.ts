export const MIN_HOLD_USDC = 10;
export const MAX_HOLD_USDC = 50_000_000;

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

/**
 * Format a contract timestamp (seconds) as a local date/time string.
 * Example: "Jun 12, 2026 at 10:47 PM EDT"
 */
export function formatReadyTime(tsSeconds: number | bigint): string {
  const d = new Date(Number(tsSeconds) * 1000);
  const datePart = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timePart = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return `${datePart} at ${timePart}`;
}

/**
 * Format the time remaining until a contract timestamp (seconds) as a
 * human-readable relative string. Returns "Ready now" if already past.
 */
export function formatRelativeTime(tsSeconds: number | bigint): string {
  const diffMs = Number(tsSeconds) * 1000 - Date.now();
  if (diffMs <= 0) return "Ready now";
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay >= 2) return `About ${diffDay} days left`;
  if (diffDay === 1) return "About 1 day left";
  if (diffHour >= 2) return `About ${diffHour} hours left`;
  if (diffHour === 1) return "About 1 hour left";
  if (diffMin >= 2) return `About ${diffMin} minutes left`;
  if (diffMin === 1) return "About 1 minute left";
  return "Less than a minute left";
}
