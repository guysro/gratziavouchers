import { useEffect, useRef } from "react";
import type { AdminVoucher } from "../../types/voucher";
import { formatCurrency } from "../../utils/voucher";

interface RedeemConfirmationDialogProps {
  voucher: AdminVoucher | null;
  onCancel: () => void;
  onConfirm: (voucher: AdminVoucher) => void;
}

export default function RedeemConfirmationDialog({
  voucher,
  onCancel,
  onConfirm,
}: RedeemConfirmationDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (voucher && !dialog.open) {
      dialog.showModal();
    } else if (!voucher && dialog.open) {
      dialog.close();
    }
  }, [voucher]);

  return (
    <dialog
      ref={dialogRef}
      className="redeem-dialog"
      aria-labelledby="redeem-dialog-title"
      aria-describedby="redeem-dialog-description"
      onClose={onCancel}
    >
      {voucher && (
        <div className="redeem-dialog-content">
          <div className="redeem-dialog-icon" aria-hidden="true">
            !
          </div>
          <h2 id="redeem-dialog-title">לאשר מימוש שובר?</h2>
          <p id="redeem-dialog-description">
            הפעולה תסמן את השובר כממומש ולא ניתן יהיה לבטל אותה.
          </p>
          <div className="redeem-dialog-voucher">
            <span>קוד השובר</span>
            <strong dir="ltr">{voucher.voucherCode}</strong>
            <span>{voucher.name}</span>
            <strong>{formatCurrency(voucher.amount)}</strong>
          </div>
          <div className="redeem-dialog-actions">
            <button
              type="button"
              className="redeem-dialog-cancel"
              onClick={onCancel}
              autoFocus
            >
              ביטול
            </button>
            <button
              type="button"
              className="redeem-dialog-confirm"
              onClick={() => onConfirm(voucher)}
            >
              כן, לממש את השובר
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
