import type { AdminVoucher, WhatsAppStatus } from "../../types/voucher";
import { formatCurrency } from "../../utils/voucher";

const WHATSAPP_STATUS_LABELS: Record<WhatsAppStatus, string> = {
  sending: "בשליחה",
  sent: "נשלח",
  failed: "השליחה נכשלה",
  retry: "השליחה נכשלה זמנית",
};

interface AdminVoucherCardProps {
  voucher: AdminVoucher;
  busy: boolean;
  onRedeem: (voucher: AdminVoucher) => void;
  onSendWhatsApp: (voucher: AdminVoucher) => void;
}

export default function AdminVoucherCard({
  voucher,
  busy,
  onRedeem,
  onSendWhatsApp,
}: AdminVoucherCardProps) {
  const whatsappStatus = voucher.whatsapp?.status;
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
        {voucher.source === "admin" && <span>הונפק ללא תשלום</span>}
        <span>
          {voucher.source === "admin" ? "נוצר: " : "נרכש: "}
          {new Date(voucher.createdAt).toLocaleDateString("he-IL")}
        </span>
        {voucher.redeemedAt && (
          <span>
            מומש:{" "}
            {new Date(voucher.redeemedAt).toLocaleDateString("he-IL")}
          </span>
        )}
        <span>
          וואטסאפ:{" "}
          {whatsappStatus ? WHATSAPP_STATUS_LABELS[whatsappStatus] : "לא נשלח"}
        </span>
      </div>
      {voucher.status === "paid" && (
        <a
          className="admin-voucher-download"
          href={`/api/admin/vouchers/${encodeURIComponent(voucher.voucherCode)}/pdf`}
        >
          הורדת השובר
        </a>
      )}
      {voucher.status === "paid" && (
        <button
          type="button"
          className="admin-voucher-whatsapp"
          onClick={() => onSendWhatsApp(voucher)}
          disabled={busy || whatsappStatus === "sending"}
        >
          {whatsappStatus === "sent"
            ? "שליחה חוזרת בוואטסאפ"
            : "שליחה בוואטסאפ"}
        </button>
      )}
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
