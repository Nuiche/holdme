import Link from "next/link";
import ConnectButton from "./ConnectButton";

export default function Header() {
  return (
    <header className="w-full border-b border-stone-200 bg-[#f8f7f5]/90 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
        <Link
          href="/"
          className="text-lg font-semibold text-stone-900 tracking-tight hover:text-violet-700 transition-colors shrink-0"
        >
          HoldMe
        </Link>
        <nav className="flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-5 text-sm text-stone-500">
            <Link href="/holds" className="hover:text-stone-900 transition-colors">
              My holds
            </Link>
            <Link href="/how-it-works" className="hover:text-stone-900 transition-colors">
              How it works
            </Link>
          </div>
          <ConnectButton />
        </nav>
      </div>
    </header>
  );
}
