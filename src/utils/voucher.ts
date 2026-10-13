export const PRESET_AMOUNTS = [50, 100, 150, 200];

export const PAYMENT_ERROR_MESSAGE =
  "לא ניתן להשלים את התשלום כרגע. נסו שוב מאוחר יותר או פנו לשירות הלקוחות.";

const currencyFormatter = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 2,
});

export function formatCurrency(amount: number): string {
  return currencyFormatter.format(amount);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
