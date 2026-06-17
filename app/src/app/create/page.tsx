import Card from "@/components/Card";
import CreateHoldForm from "@/components/CreateHoldForm";

function ShieldIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path
        d="M14 2.5L3.5 7v8.5C3.5 22 8.3 27.1 14 28.5 19.7 27.1 24.5 22 24.5 15.5V7L14 2.5z"
        fill="#d1fae5"
        stroke="#059669"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 14.5l3 3 6-6"
        stroke="#059669"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function CreatePage() {
  return (
    <div className="max-w-lg mx-auto px-4 py-10">
      <Card padding="lg" className="flex flex-col gap-6">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 shrink-0">
            <ShieldIcon />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-stone-900 leading-tight">
              How much should we hold?
            </h1>
            <p className="text-sm text-stone-400 mt-0.5">
              Set aside USDC and bring it back when you&apos;re ready.
            </p>
          </div>
        </div>

        <div className="h-px bg-stone-100" />

        <CreateHoldForm />
      </Card>
    </div>
  );
}
