import Link from "next/link";
import Card from "@/components/Card";

const FLOW_STEPS = [
  "Connect your wallet to Base.",
  "Enter an amount (10–500 USDC) and choose a return period (1–30 days).",
  "Review the fee and return amount.",
  "Approve USDC and confirm the hold transaction.",
  "Come back on or after the return day and tap Bring it back.",
  "Your USDC is returned to your wallet.",
];

interface Section {
  number: string;
  title: string;
  body: string;
}

const SECTIONS: Section[] = [
  {
    number: "01",
    title: "What HoldMe does",
    body: "HoldMe lets you set aside USDC on Base and bring it back after a chosen return period. You pick an amount, pick a number of days, and HoldMe holds your funds in a smart contract until the return time arrives. Then you come back and bring it back.",
  },
  {
    number: "02",
    title: "USDC on Base only",
    body: "HoldMe currently supports USDC on the Base network only. No other tokens. No other chains. Make sure your wallet is connected to Base before creating a hold.",
  },
  {
    number: "03",
    title: "Do not manually send funds",
    body: "Never send USDC directly to any address shown in this app. Always use the Hold it for me button in the app to create a hold. Funds sent manually cannot be recovered.",
  },
  {
    number: "04",
    title: "Only your wallet can bring it back",
    body: "Only the wallet that created the hold can bring funds back. There is no admin, no support team, and no override. If you lose access to your wallet before the hold matures, your funds may become inaccessible. Keep your wallet safe.",
  },
  {
    number: "05",
    title: "No early return",
    body: "Holds cannot be brought back before the return time you chose. This is enforced by the smart contract, not just the app. There are no exceptions, no override codes, and no support escalation paths. Choose your return period carefully.",
  },
  {
    number: "06",
    title: "Crypto transactions are irreversible",
    body: "Once a hold is created, the transaction is on-chain and cannot be undone. Once the hold is returned, that transaction is also final. Always double-check the amount, the duration, and the network before confirming.",
  },
  {
    number: "07",
    title: "HoldMe is not a bank",
    body: "HoldMe is a crypto tool, not a bank, financial institution, or custodian. Your funds are held in a smart contract on the Base blockchain. HoldMe does not custody your funds or guarantee their safety beyond what the smart contract provides.",
  },
  {
    number: "08",
    title: "No financial, legal, or medical advice",
    body: "HoldMe does not provide financial, legal, investment, medical, or gambling-treatment advice. If you need support related to compulsive spending or problem gambling, please reach out to a qualified professional or support organization.",
  },
];

export default function HowItWorksPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-10 flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">
          How it works
        </h1>
        <p className="text-sm text-stone-500">
          Plain English. No jargon. Read before using.
        </p>
      </div>

      <Card padding="lg" className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold text-stone-800">The flow</h2>
          <ol className="flex flex-col gap-3 mt-2">
            {FLOW_STEPS.map((step, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-stone-600">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-semibold text-violet-700">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </div>

        <div className="h-px bg-stone-100" />

        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold text-stone-800">The fee</h2>
          <p className="text-sm text-stone-500 leading-relaxed">
            HoldMe charges a 1% fee on the amount held, capped at 100 USDC. The
            fee is taken upfront when you create the hold. No recurring charges.
          </p>
        </div>
      </Card>

      <div className="flex flex-col gap-4">
        {SECTIONS.map(({ number, title, body }) => (
          <div key={number} className="flex gap-4 items-start">
            <span className="mt-0.5 text-xs font-mono font-semibold text-stone-300 w-6 shrink-0">
              {number}
            </span>
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold text-stone-800">{title}</h3>
              <p className="text-sm text-stone-500 leading-relaxed">{body}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col items-center gap-3 py-4">
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-xl bg-violet-600 text-white px-6 py-3 text-sm font-medium hover:bg-violet-700 transition-colors shadow-sm"
        >
          Hold it for me
        </Link>
        <p className="text-xs text-stone-400 text-center max-w-sm">
          By using HoldMe you acknowledge you have read and understood the above.
        </p>
      </div>
    </div>
  );
}
