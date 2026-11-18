import type { ChangeEvent } from "react";
import {
  MAX_VOUCHER_AMOUNT,
  MIN_VOUCHER_AMOUNT,
  VOUCHER_AMOUNT_STEP,
} from "../../utils/voucher";

interface VoucherAmountFieldProps {
  value: string;
  error?: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onAmountChange: (amount: string) => void;
}

export default function VoucherAmountField({
  value,
  error,
  onChange,
  onAmountChange,
}: VoucherAmountFieldProps) {
  const errorId = "amount-error";
  const amount = Number(value);
  const normalizedAmount =
    Number.isFinite(amount) &&
    amount >= MIN_VOUCHER_AMOUNT &&
    amount <= MAX_VOUCHER_AMOUNT
      ? MIN_VOUCHER_AMOUNT +
        Math.round((amount - MIN_VOUCHER_AMOUNT) / VOUCHER_AMOUNT_STEP) *
          VOUCHER_AMOUNT_STEP
      : MIN_VOUCHER_AMOUNT;
  const canDecrease = normalizedAmount > MIN_VOUCHER_AMOUNT;
  const canIncrease = normalizedAmount < MAX_VOUCHER_AMOUNT;

  const adjustAmount = (direction: -1 | 1) => {
    const nextAmount = Math.min(
      MAX_VOUCHER_AMOUNT,
      Math.max(
        MIN_VOUCHER_AMOUNT,
        normalizedAmount + direction * VOUCHER_AMOUNT_STEP,
      ),
    );
    onAmountChange(nextAmount.toString());
  };

  return (
    <div className="form-group">
      <label htmlFor="amount">סכום השובר (₪)</label>
      <div className="amount-stepper">
        <button
          type="button"
          className="amount-stepper-button"
          aria-label={`הגדלת הסכום ב-${VOUCHER_AMOUNT_STEP} שקלים`}
          onClick={() => adjustAmount(1)}
          disabled={!canIncrease}
        >
          +
        </button>
        <div className="amount-input-wrapper">
          <span className="currency-prefix" aria-hidden="true">
            ₪
          </span>
          <input
            id="amount"
            type="number"
            min={MIN_VOUCHER_AMOUNT}
            max={MAX_VOUCHER_AMOUNT}
            step={VOUCHER_AMOUNT_STEP}
            inputMode="numeric"
            placeholder="סכום אחר"
            className={`form-control ${error ? "is-invalid" : ""}`}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : "amount-help"}
            value={value}
            onChange={onChange}
          />
        </div>
        <button
          type="button"
          className="amount-stepper-button"
          aria-label={`הפחתת הסכום ב-${VOUCHER_AMOUNT_STEP} שקלים`}
          onClick={() => adjustAmount(-1)}
          disabled={!canDecrease}
        >
          −
        </button>
      </div>
      {error && (
        <div id={errorId} className="error-message">
          {error}
        </div>
      )}
    </div>
  );
}
