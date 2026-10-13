import type { ChangeEvent } from "react";
import { PRESET_AMOUNTS, formatCurrency } from "../../utils/voucher";

interface VoucherAmountFieldProps {
  value: string;
  error?: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onPresetSelect: (amount: number) => void;
}

export default function VoucherAmountField({
  value,
  error,
  onChange,
  onPresetSelect,
}: VoucherAmountFieldProps) {
  const errorId = "amount-error";

  return (
    <div className="form-group">
      <label htmlFor="amount">סכום השובר (₪)</label>
      <div className="preset-amounts">
        {PRESET_AMOUNTS.map((preset) => (
          <button
            key={preset}
            type="button"
            className={`preset-btn ${value === preset.toString() ? "active" : ""}`}
            onClick={() => onPresetSelect(preset)}
          >
            {formatCurrency(preset)}
          </button>
        ))}
      </div>
      <div className="amount-input-wrapper">
        <span className="currency-prefix" aria-hidden="true">
          ₪
        </span>
        <input
          id="amount"
          type="number"
          min="10"
          max="10000"
          step="1"
          inputMode="decimal"
          placeholder="סכום אחר"
          className={`form-control ${error ? "is-invalid" : ""}`}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          value={value}
          onChange={onChange}
        />
      </div>
      {error && (
        <div id={errorId} className="error-message">
          {error}
        </div>
      )}
    </div>
  );
}
