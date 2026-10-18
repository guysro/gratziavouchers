import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { FormData, FormErrors, PurchaseDetails } from "../types/voucher";
import {
  isRecord,
  MAX_VOUCHER_AMOUNT,
  MIN_VOUCHER_AMOUNT,
  VOUCHER_AMOUNT_STEP,
} from "../utils/voucher";

export default function usePurchaseForm() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState<FormData>({
    name: "",
    phone: "",
    email: "",
    amount: "100",
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const validate = (): boolean => {
    const newErrors: FormErrors = {};

    if (!formData.name.trim()) {
      newErrors.name = "יש להזין שם מלא";
    } else if (formData.name.trim().length < 2) {
      newErrors.name = "השם חייב להכיל לפחות שני תווים";
    }

    const phoneDigits = formData.phone.replace(/\D/g, "");
    if (!formData.phone.trim()) {
      newErrors.phone = "יש להזין מספר טלפון";
    } else if (phoneDigits.length < 7 || phoneDigits.length > 15) {
      newErrors.phone = "יש להזין מספר טלפון תקין";
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!formData.email.trim()) {
      newErrors.email = "יש להזין כתובת אימייל";
    } else if (!emailRegex.test(formData.email.trim())) {
      newErrors.email = "יש להזין כתובת אימייל תקינה";
    }

    const amount = Number(formData.amount);
    if (!formData.amount || !Number.isFinite(amount)) {
      newErrors.amount = "יש להזין סכום לשובר";
    } else if (amount < MIN_VOUCHER_AMOUNT) {
      newErrors.amount = `הסכום המינימלי לשובר הוא ${MIN_VOUCHER_AMOUNT} ₪`;
    } else if (amount > MAX_VOUCHER_AMOUNT) {
      newErrors.amount = "הסכום המרבי לשובר הוא 10,000 ₪";
    } else if (amount % VOUCHER_AMOUNT_STEP !== 0) {
      newErrors.amount = `ניתן לבחור סכום בקפיצות של ${VOUCHER_AMOUNT_STEP} ₪`;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting || !validate()) return;

    const purchase: PurchaseDetails = {
      name: formData.name.trim(),
      phone: formData.phone.trim(),
      email: formData.email.trim(),
      amount: Number(formData.amount),
    };

    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await fetch("/api/paypal/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: purchase.amount,
          purchase: {
            name: purchase.name,
            phone: purchase.phone,
            email: purchase.email,
          },
        }),
      });
      if (!response.ok) throw new Error("Order creation failed");

      const order: unknown = await response.json();
      if (
        !isRecord(order) ||
        typeof order.id !== "string" ||
        !order.id ||
        typeof order.verificationToken !== "string" ||
        !order.verificationToken
      ) {
        throw new Error("Invalid order response");
      }

      navigate("/payment", {
        state: {
          purchase,
          orderId: order.id,
          verificationToken: order.verificationToken,
        },
      });
    } catch {
      console.error("Order creation request failed.");
      setSubmitError(
        "לא ניתן להכין את התשלום כרגע. נסו שוב בעוד רגע.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const updateField = (field: keyof FormData, value: string) => {
    setFormData((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: undefined }));
  };

  return {
    formData,
    errors,
    submitting,
    submitError,
    handleSubmit,
    updateField,
  };
}
