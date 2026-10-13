import type { ReactNode } from "react";

interface SummaryRowProps {
  label: string;
  children: ReactNode;
  className?: string;
}

export default function SummaryRow({
  label,
  children,
  className = "",
}: SummaryRowProps) {
  return (
    <div className={`summary-row ${className}`.trim()}>
      <span className="summary-label">{label}</span>
      <span className="summary-value">{children}</span>
    </div>
  );
}
