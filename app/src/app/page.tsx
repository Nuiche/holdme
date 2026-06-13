import Link from "next/link";
import Card from "@/components/Card";
import CreateHoldForm from "@/components/CreateHoldForm";

export default function HomePage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-12 flex flex-col gap-14">
      {/* Hero */}
      <section className="flex flex-col gap-4 text-center">
        <div className="inline-flex items-center justify-center mx-auto rounded-full bg-violet-100 px-3 py-1 text-xs font-medium text-violet-700">
          USDC on Base only
        </div>
        <h1 className="text-4xl sm:text-5xl font-semibold text-stone-900 tracking-tight leading-tight">
          Hold it for{" "}
          <span className="text-violet-600">future-you.</span>
        </h1>
        <p className="text-lg text-stone-500 max-w-md mx-auto leading-relaxed">
          Choose an amount, choose a return day, and let HoldMe keep it out of
          reach until then.
        </p>
        <div className="flex items-center justify-center gap-3 mt-2">
          <Link
            href="/holds"
            className="text-sm text-stone-500 hover:text-stone-700 underline underline-offset-4 transition-colors"
          >
            View my holds
          </Link>
        </div>
      </section>

      {/* Create hold form */}
      <section>
        <Card padding="lg" className="flex flex-col gap-1">
          <div className="flex flex-col gap-1 mb-4">
            <h2 className="text-base font-semibold text-stone-800">
              Create a hold
            </h2>
            <p className="text-sm text-stone-400">
              Set aside USDC and bring it back when you&apos;re ready.
            </p>
          </div>
          <CreateHoldForm />
        </Card>
      </section>

      {/* Trust callout */}
      <section>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            {
              icon: "✦",
              title: "Only you can bring it back",
              body: "Only the wallet that created a hold can return it. No third parties, no admin access.",
            },
            {
              icon: "◷",
              title: "No early return",
              body: "Your hold stays out of reach until the return day arrives. That's the whole point.",
            },
            {
              icon: "◈",
              title: "1% upfront fee",
              body: "A small fee is taken when you create a hold. No hidden costs, no recurring charges.",
            },
          ].map(({ icon, title, body }) => (
            <Card key={title} padding="md" className="flex flex-col gap-2">
              <span className="text-lg text-violet-400 font-light">{icon}</span>
              <p className="text-sm font-semibold text-stone-800">{title}</p>
              <p className="text-xs text-stone-500 leading-relaxed">{body}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* Disclaimer strip */}
      <section>
        <p className="text-xs text-center text-stone-400 leading-relaxed max-w-lg mx-auto">
          HoldMe supports USDC on Base only. Do not manually send funds to any
          address — use the form above.{" "}
          <Link
            href="/how-it-works"
            className="underline underline-offset-2 hover:text-stone-600"
          >
            How it works →
          </Link>
        </p>
      </section>
    </div>
  );
}
