import Link from "next/link";
import HoldsView from "@/components/HoldsView";

export default function HoldsPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-10 flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">
          My holds
        </h1>
        <p className="text-sm text-stone-400">
          Holds you&apos;ve created from this wallet.
        </p>
      </div>

      <HoldsView />

      <div className="text-center">
        <Link
          href="/"
          className="text-sm text-violet-600 hover:text-violet-800 underline underline-offset-4 transition-colors"
        >
          + Create a new hold
        </Link>
      </div>
    </div>
  );
}
