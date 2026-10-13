import type { ReactNode } from "react";
import SummaryRow from "./SummaryRow";

interface VoucherSummaryItem {
  label: string;
  value: ReactNode;
  dir?: "ltr" | "rtl";
  className?: string;
}

interface VoucherSummaryProps {
  items: VoucherSummaryItem[];
}

export default function VoucherSummary({ items }: VoucherSummaryProps) {
  return (
    <div className="summary-details">
      {items.map((item) => (
        <SummaryRow
          key={item.label}
          label={item.label}
          className={item.className}
        >
          <span dir={item.dir}>{item.value}</span>
        </SummaryRow>
      ))}
    </div>
  );
}
