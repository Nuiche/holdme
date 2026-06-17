import Card from "./Card";
import StatusPill from "./StatusPill";
import Button from "./Button";
import { formatReadyTime, formatRelativeTime } from "@/lib/constants";

type HoldStatus = "held" | "ready" | "returned";

interface HoldCardProps {
  status: HoldStatus;
  grossAmount: string;
  returnAmount: string;
  fee: string;
  returnAtSeconds: bigint;
  holdId: string;
  onBringBack?: () => void;
  bringBackPending?: boolean;
}

export default function HoldCard({
  status,
  grossAmount,
  returnAmount,
  fee,
  returnAtSeconds,
  holdId,
  onBringBack,
  bringBackPending = false,
}: HoldCardProps) {
  const readyTime = formatReadyTime(returnAtSeconds);

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-2xl font-semibold text-stone-900 tracking-tight">
            {returnAmount}
            <span className="text-base font-normal text-stone-400 ml-1">USDC</span>
          </p>
          <p className="text-xs text-stone-400 mt-0.5">
            {grossAmount} held · {fee} fee · Hold #{holdId}
          </p>
        </div>
        <StatusPill status={status} />
      </div>

      <div className="h-px bg-stone-100" />

      {status === "held" && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <p className="text-sm text-stone-500">
              Ready to bring back on{" "}
              <span className="font-medium text-stone-700">{readyTime}</span>
            </p>
            <p className="text-xs text-stone-400">{formatRelativeTime(returnAtSeconds)}</p>
          </div>
          <Button variant="disabled" fullWidth disabled>
            Not ready yet
          </Button>
        </div>
      )}

      {status === "ready" && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <p className="text-sm text-emerald-700 font-medium">This hold is ready.</p>
            <p className="text-xs text-stone-400">
              Ready since <span className="font-medium">{readyTime}</span>
            </p>
          </div>
          <Button
            variant="primary"
            fullWidth
            onClick={onBringBack}
            disabled={bringBackPending}
          >
            {bringBackPending ? "Confirming…" : "Bring it back"}
          </Button>
        </div>
      )}

      {status === "returned" && (
        <div className="flex flex-col gap-0.5">
          <p className="text-sm text-stone-400">Returned to your wallet.</p>
          <p className="text-xs text-stone-300">
            Was ready {readyTime}
          </p>
        </div>
      )}
    </Card>
  );
}
