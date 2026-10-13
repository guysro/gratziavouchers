import type { AdminVoucher } from "../../types/voucher";
import { formatCurrency } from "../../utils/voucher";

interface AdminVoucherCardProps {
  voucher: AdminVoucher;
  busy: boolean;
  onRedeem: (voucher: AdminVoucher) => void;
}

export default function AdminVoucherCard({
  voucher,
  busy,
  onRedeem,
}: AdminVoucherCardProps) {
  return (
    <article className="admin-voucher">
      <div className="admin-voucher-heading">
        <strong className="voucher-ticket-code" dir="ltr">
          {voucher.voucherCode}
        </strong>
        <span className={`voucher-status ${voucher.status}`}>
          {voucher.status === "redeemed" ? "מומש" : "בתוקף"}
        </span>
      </div>
      <div className="admin-voucher-details">
        <span>{voucher.name}</span>
        <span dir="ltr">{voucher.phone}</span>
        <span dir="ltr">{voucher.email}</span>
        <strong>{formatCurrency(voucher.amount)}</strong>
        <span>
          נרכש:{" "}
          {new Date(voucher.createdAt).toLocaleDateString("he-IL")}
        </span>
        {voucher.redeemedAt && (
          <span>
            מומש:{" "}
            {new Date(voucher.redeemedAt).toLocaleDateString("he-IL")}
          </span>
        )}
      </div>
      {voucher.status === "paid" && (
        <button
          type="button"
          className="redeem-btn"
          onClick={() => onRedeem(voucher)}
          disabled={busy}
        >
          מימוש שובר
        </button>
      )}
    </article>
  );
}
