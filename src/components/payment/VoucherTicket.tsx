import type { CompletedVoucher } from "../../types/voucher";
import { formatCurrency } from "../../utils/voucher";

interface VoucherTicketProps {
  voucher: Pick<
    CompletedVoucher,
    "voucherCode" | "name" | "phone" | "email" | "amount" | "date"
  >;
}

export default function VoucherTicket({ voucher }: VoucherTicketProps) {
  return (
    <div className="voucher-ticket">
      <div className="voucher-ticket-brand">
        <span>שובר מתנה גרציא</span>
        <span className="voucher-ticket-code" dir="ltr">
          {voucher.voucherCode}
        </span>
      </div>
      <div className="voucher-ticket-amount">
        {formatCurrency(voucher.amount)}
      </div>
      <div className="voucher-ticket-recipient">
        <span>הונפק עבור: {voucher.name}</span>
        <span>
          {new Date(voucher.date).toLocaleDateString("he-IL", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </span>
      </div>
    </div>
  );
}
