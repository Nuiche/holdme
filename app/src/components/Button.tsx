import { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "disabled";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
  fullWidth?: boolean;
}

const styles: Record<Variant, string> = {
  primary:
    "bg-violet-600 text-white hover:bg-violet-700 active:bg-violet-800 shadow-sm",
  secondary:
    "bg-white text-stone-700 border border-stone-200 hover:bg-stone-50 active:bg-stone-100 shadow-sm",
  ghost:
    "bg-transparent text-stone-600 hover:bg-stone-100 active:bg-stone-200",
  disabled:
    "bg-stone-100 text-stone-400 cursor-not-allowed border border-stone-200",
};

export default function Button({
  variant = "primary",
  fullWidth = false,
  children,
  className = "",
  disabled,
  ...props
}: ButtonProps) {
  const resolvedVariant: Variant = disabled ? "disabled" : variant;
  return (
    <button
      disabled={disabled || resolvedVariant === "disabled"}
      className={[
        "inline-flex items-center justify-center gap-2",
        "rounded-xl px-5 py-3 text-sm font-medium",
        "transition-all duration-150 select-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2",
        styles[resolvedVariant],
        fullWidth ? "w-full" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {children}
    </button>
  );
}
