function SafeIcon() {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <rect x="6" y="10" width="52" height="42" rx="7" fill="#d1fae5" stroke="#059669" strokeWidth="2.5"/>
      <rect x="6" y="10" width="22" height="42" rx="7" fill="#a7f3d0" stroke="#059669" strokeWidth="2.5"/>
      <circle cx="43" cy="31" r="9" fill="white" stroke="#059669" strokeWidth="2"/>
      <circle cx="43" cy="31" r="3.5" fill="#059669"/>
      <rect x="8" y="20" width="6" height="5" rx="1.5" fill="#059669"/>
      <rect x="8" y="38" width="6" height="5" rx="1.5" fill="#059669"/>
      <line x1="28" y1="14" x2="28" y2="52" stroke="#059669" strokeWidth="1.5"/>
    </svg>
  );
}

export default function HomePage() {
  return (
    <div className="min-h-[calc(100svh-3.5rem)] flex flex-col items-center justify-center px-6 py-12">
      <div className="flex flex-col items-center gap-8 w-full max-w-xs">
        <SafeIcon />

        <p className="text-sm text-stone-400 text-center">
          Only you can bring it back.
        </p>

        <div className="flex flex-col gap-3 w-full">
          <a
            href="/create"
            className="inline-flex items-center justify-center rounded-xl bg-emerald-600 text-white px-5 py-3.5 text-sm font-medium hover:bg-emerald-700 transition-colors shadow-sm"
          >
            Start Hold
          </a>
          <a
            href="/holds"
            className="inline-flex items-center justify-center rounded-xl border border-stone-200 bg-white text-stone-700 px-5 py-3.5 text-sm font-medium hover:bg-stone-50 transition-colors shadow-sm"
          >
            View Holds
          </a>
        </div>
      </div>
    </div>
  );
}
