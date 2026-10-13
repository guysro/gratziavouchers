import FormField from "../components/forms/FormField";
import VoucherAmountField from "../components/forms/VoucherAmountField";
import BrandHeader from "../components/layout/BrandHeader";
import PaymentStatus from "../components/payment/PaymentStatus";
import usePurchaseForm from "../hooks/usePurchaseForm";
import { formatCurrency } from "../utils/voucher";

export default function PurchasePage() {
  const {
    formData,
    errors,
    submitting,
    submitError,
    handleSubmit,
    updateField,
    handlePresetClick,
  } = usePurchaseForm();

  return (
    <main className="voucher-app" dir="rtl">
      <div className="voucher-container">
        <BrandHeader
          title="שוברי מתנה גרציא"
          description="רכישת שובר מתנה דיגיטלי בכמה צעדים פשוטים"
        />

        <section className="voucher-card">
          <form onSubmit={handleSubmit} noValidate>
            <FormField
              id="name"
              label="שם מלא"
              type="text"
              autoComplete="name"
              placeholder="לדוגמה: ישראל ישראלי"
              error={errors.name}
              value={formData.name}
              onChange={(event) => updateField("name", event.target.value)}
            />

            <FormField
              id="phone"
              label="מספר טלפון"
              type="tel"
              dir="ltr"
              autoComplete="tel"
              placeholder="לדוגמה: 050-123-4567"
              error={errors.phone}
              value={formData.phone}
              onChange={(event) => updateField("phone", event.target.value)}
            />

            <FormField
              id="email"
              label="כתובת אימייל"
              type="email"
              dir="ltr"
              autoComplete="email"
              placeholder="name@example.com"
              error={errors.email}
              value={formData.email}
              onChange={(event) => updateField("email", event.target.value)}
            />
            <VoucherAmountField
              value={formData.amount}
              error={errors.amount}
              onChange={(event) => updateField("amount", event.target.value)}
              onPresetSelect={handlePresetClick}
            />

            {submitting && (
              <PaymentStatus message="מכינים את התשלום המאובטח..." />
            )}
            {submitError && (
              <p className="payment-error" role="alert">
                {submitError}
              </p>
            )}
            <button type="submit" className="submit-btn" disabled={submitting}>
              {submitting ? "מכינים תשלום..." : "מעבר לתשלום"}
              {!submitting &&
              formData.amount &&
              Number.isFinite(Number(formData.amount)) &&
              Number(formData.amount) > 0
                ? ` · ${formatCurrency(Number(formData.amount))}`
                : ""}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
