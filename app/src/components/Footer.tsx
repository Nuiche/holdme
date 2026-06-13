import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-stone-200 mt-16">
      <div className="max-w-2xl mx-auto px-4 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-stone-400">
        <span>© {new Date().getFullYear()} HoldMe</span>
        <div className="flex items-center gap-5">
          <Link href="/how-it-works" className="hover:text-stone-600 transition-colors">
            How it works
          </Link>
          <Link href="/holds" className="hover:text-stone-600 transition-colors">
            My holds
          </Link>
        </div>
        <span className="text-xs text-stone-400 text-center sm:text-right">
          USDC on Base only. Not financial advice.
        </span>
      </div>
    </footer>
  );
}
