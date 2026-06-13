import Card from "./Card";

interface ReviewCardProps {
  grossAmount: number;
  durationDays: number;
}

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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

export default function ReviewCard({ grossAmount, durationDays }: ReviewCardProps) {
  const fee = calcFee(grossAmount);
  const returnAmount = grossAmount - fee;
  const returnDate = addDays(durationDays);

  const rows = [
    { label: "You're setting aside", value: `${formatUSDC(grossAmount)} USDC` },
    { label: "HoldMe fee (1%)", value: `${formatUSDC(fee)} USDC` },
    { label: "You'll receive back", value: `${formatUSDC(returnAmount)} USDC`, bold: true },
    { label: "Ready to bring back", value: returnDate, highlight: true },
  ];

  return (
    <Card className="flex flex-col gap-3 bg-violet-50 border-violet-100">
      <p className="text-xs font-semibold uppercase tracking-wider text-violet-500">
        Review
      </p>
      <div className="flex flex-col gap-2.5">
        {rows.map(({ label, value, bold, highlight }) => (
          <div key={label} className="flex items-center justify-between gap-4">
            <span className="text-sm text-stone-500">{label}</span>
            <span
              className={[
                "text-sm text-right",
                bold ? "font-semibold text-stone-900" : "text-stone-700",
                highlight ? "text-violet-700 font-medium" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {value}
            </span>
          </div>
        ))}
      </div>
      <p className="text-xs text-stone-400 pt-1 border-t border-violet-100">
        Only this wallet can bring it back after the return time.
      </p>
    </Card>
  );
}
