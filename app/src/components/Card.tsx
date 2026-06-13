import { ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
  padding?: "sm" | "md" | "lg";
}

const paddingMap = {
  sm: "p-4",
  md: "p-5",
  lg: "p-6",
};

export default function Card({ children, className = "", padding = "md" }: CardProps) {
  return (
    <div
      className={[
        "bg-white rounded-2xl border border-stone-100 shadow-sm",
        paddingMap[padding],
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}
