import Card from "./Card";
import { formatReadyTime } from "@/lib/constants";

interface ReviewCardProps {
  grossAmount: number;
  holdSeconds: number;
}

function formatUSDC(amount: number, decimals = 2): string {
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function calcFee(amount: number): number {
  return Math.min(amount * 0.01, 100);
}

function computeReturnAt(holdSeconds: number): number {
  return Math.floor(Date.now() / 1000) + holdSeconds;
}

export default function ReviewCard({ grossAmount, holdSeconds }: ReviewCardProps) {
  const fee = calcFee(grossAmount);
  const returnAmount = grossAmount - fee;
  const readyTime = formatReadyTime(computeReturnAt(holdSeconds));

  const rows = [
    { label: "You're setting aside", value: `${formatUSDC(grossAmount)} USDC` },
    { label: "HoldMe fee (1%)", value: `${formatUSDC(fee)} USDC` },
    { label: "You'll receive back", value: `${formatUSDC(returnAmount)} USDC`, bold: true },
    { label: "Ready to bring back", value: readyTime, highlight: true },
  ];

  return (
    <Card className="flex flex-col gap-3 bg-emerald-50 border-emerald-100">
      <p className="text-xs font-semibold uppercase tracking-wider text-emerald-600">
        Review
      </p>
      <div className="flex flex-col gap-2.5">
        {rows.map(({ label, value, bold, highlight }) => (
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
      <p className="text-xs text-stone-400 pt-1 border-t border-emerald-100">
        Only this wallet can bring it back after the return time.
      </p>
    </Card>
  );
}
