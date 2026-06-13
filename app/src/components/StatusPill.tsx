type Status = "held" | "ready" | "returned";

interface StatusPillProps {
  status: Status;
}

const config: Record<Status, { label: string; classes: string }> = {
  held: {
    label: "Being held",
    classes: "bg-violet-50 text-violet-700 border border-violet-100",
  },
  ready: {
    label: "Ready",
    classes: "bg-emerald-50 text-emerald-700 border border-emerald-100",
  },
  returned: {
    label: "Returned",
    classes: "bg-stone-100 text-stone-500 border border-stone-200",
  },
};

export default function StatusPill({ status }: StatusPillProps) {
  const { label, classes } = config[status];
  return (
    <span
      className={[
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        classes,
      ].join(" ")}
    >
      {label}
    </span>
  );
}
