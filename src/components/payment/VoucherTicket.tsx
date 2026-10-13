import type { CompletedVoucher } from "../../types/voucher";
import { formatCurrency } from "../../utils/voucher";

interface VoucherTicketProps {
  voucher: CompletedVoucher;
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
        <span>{voucher.date}</span>
      </div>
    </div>
  );
}
