import { useEffect, useRef, useState } from "react";
import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import BrandHeader from "../components/layout/BrandHeader";
import PaymentStatus from "../components/payment/PaymentStatus";
import VoucherSummary from "../components/payment/VoucherSummary";
import VoucherTicket from "../components/payment/VoucherTicket";
import type {
  CompletedVoucher,
  PaymentNavigationState,
} from "../types/voucher";
import {
  formatCurrency,
  isRecord,
  MAX_VOUCHER_AMOUNT,
  MIN_VOUCHER_AMOUNT,
  PAYMENT_ERROR_MESSAGE,
  VOUCHER_AMOUNT_STEP,
} from "../utils/voucher";

export default function PaymentPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const checkout = location.state as PaymentNavigationState | null;
  const purchase = checkout?.purchase;
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentStage, setPaymentStage] = useState<
    "starting" | "confirming" | null
  >(null);
  const paymentStageTimeoutRef = useRef<number | null>(null);
  const orderVerificationTokenRef = useRef<string | null>(null);
  const [paypalClientId, setPaypalClientId] = useState<string | null>(null);
  const [paypalConfigLoading, setPaypalConfigLoading] = useState(true);
  const [completedVoucher, setCompletedVoucher] =
    useState<CompletedVoucher | null>(null);

  const clearPaymentStageTimeout = () => {
    if (paymentStageTimeoutRef.current !== null) {
      window.clearTimeout(paymentStageTimeoutRef.current);
      paymentStageTimeoutRef.current = null;
    }
  };

  useEffect(() => {
    let cancelled = false;

    const loadPayPalConfig = async () => {
      try {
        const response = await fetch("/api/paypal/config");
        if (!response.ok) throw new Error("PayPal configuration unavailable");

        const config: unknown = await response.json();
        if (
          !config ||
          typeof config !== "object" ||
          !("clientId" in config) ||
          typeof config.clientId !== "string" ||
          !config.clientId.trim()
        ) {
          throw new Error("Invalid PayPal configuration");
        }

        if (!cancelled) setPaypalClientId(config.clientId);
      } catch {
        if (!cancelled) {
          console.error("Payment configuration unavailable.");
          setPaymentError(PAYMENT_ERROR_MESSAGE);
        }
      } finally {
        if (!cancelled) setPaypalConfigLoading(false);
      }
    };

    void loadPayPalConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      clearPaymentStageTimeout();
    },
    [],
  );

  if (
    !checkout ||
    !purchase ||
    typeof purchase.name !== "string" ||
    typeof purchase.phone !== "string" ||
    typeof purchase.email !== "string" ||
    !Number.isFinite(purchase.amount) ||
    purchase.amount < MIN_VOUCHER_AMOUNT ||
    purchase.amount > MAX_VOUCHER_AMOUNT ||
    purchase.amount % VOUCHER_AMOUNT_STEP !== 0 ||
    !checkout.orderId ||
    !checkout.verificationToken
  ) {
    return <Navigate to="/" replace />;
  }

  return (
    <main className="voucher-app" dir="rtl">
      <div className="voucher-container">
        <BrandHeader
          title={completedVoucher ? "התשלום הושלם" : "תשלום מאובטח"}
          description={
            completedVoucher
              ? "תודה על הרכישה, השובר שלך מוכן"
              : "בדקו את פרטי השובר והשלימו את התשלום"
          }
        />

        <section className="voucher-card payment-card">
          {completedVoucher ? (
            <div className="success-card">
              <div className="success-icon-badge" aria-hidden="true">
                ✓
              </div>
              <h2 className="success-title">השובר נוצר בהצלחה!</h2>
              <p className="success-desc">
                אישור התשלום התקבל. קוד השובר מוצג כאן:
              </p>
              <VoucherTicket voucher={completedVoucher} />
              <VoucherSummary
                items={[
                  { label: "טלפון", value: completedVoucher.phone, dir: "ltr" },
                  { label: "אימייל", value: completedVoucher.email, dir: "ltr" },
                  {
                    label: "סכום ששולם",
                    value: formatCurrency(completedVoucher.amount),
                  },
                ]}
              />
              <button
                type="button"
                className="reset-btn"
                onClick={() => navigate("/", { replace: true })}
              >
                רכישת שובר נוסף
              </button>
            </div>
          ) : (
            <>
              <VoucherSummary
                items={[
                  { label: "שם מלא", value: purchase.name },
                  { label: "טלפון", value: purchase.phone, dir: "ltr" },
                  { label: "אימייל", value: purchase.email, dir: "ltr" },
                  {
                    label: "לתשלום",
                    value: formatCurrency(purchase.amount),
                    className: "payment-total",
                  },
                ]}
              />

              {paypalClientId ? (
                <PayPalScriptProvider
                  options={{
                    clientId: paypalClientId,
                    currency: "ILS",
                    intent: "capture",
                    locale: "he_IL",
                  }}
                >
                  <div className="paypal-container">
                    <PayPalButtons
                      style={{ layout: "vertical", label: "pay" }}
                      forceReRender={[purchase.amount]}
                      onClick={() => {
                        clearPaymentStageTimeout();
                        setPaymentError(null);
                        setPaymentStage("starting");
                      }}
                      createOrder={async () => {
                        try {
                          if (!checkout.orderId || !checkout.verificationToken) {
                            throw new Error("Missing prepared order");
                          }
                          setPaymentError(null);
                          orderVerificationTokenRef.current =
                            checkout.verificationToken;
                          paymentStageTimeoutRef.current = window.setTimeout(
                            () => {
                              paymentStageTimeoutRef.current = null;
                              setPaymentStage((current) =>
                                current === "starting" ? null : current,
                              );
                            },
                            1500,
                          );
                          return checkout.orderId;
                        } catch {
                          console.error("Order creation request failed.");
                          clearPaymentStageTimeout();
                          setPaymentStage(null);
                          setPaymentError(PAYMENT_ERROR_MESSAGE);
                          throw new Error(PAYMENT_ERROR_MESSAGE);
                        }
                      }}
                      onApprove={async (data) => {
                        clearPaymentStageTimeout();
                        setPaymentStage("confirming");
                        if (!data.orderID) {
                          setPaymentStage(null);
                          setPaymentError(PAYMENT_ERROR_MESSAGE);
                          return;
                        }

                        try {
                          const verificationToken =
                            orderVerificationTokenRef.current;
                          if (!verificationToken) {
                            throw new Error("Missing order verification token");
                          }
                          const response = await fetch(
                            `/api/paypal/orders/${encodeURIComponent(data.orderID)}/capture`,
                            {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                verificationToken,
                                purchase: {
                                  name: purchase.name,
                                  phone: purchase.phone,
                                  email: purchase.email,
                                },
                              }),
                            },
                          );
                          if (!response.ok) throw new Error("Capture failed");

                          const result: unknown = await response.json();
                          if (
                            !isRecord(result) ||
                            result.status !== "COMPLETED" ||
                            result.currency !== "ILS" ||
                            typeof result.amount !== "number" ||
                            Math.round(result.amount * 100) !==
                              Math.round(purchase.amount * 100) ||
                            !isRecord(result.voucher)
                          ) {
                            throw new Error("Invalid capture response");
                          }

                          const voucher = result.voucher;
                          if (
                            typeof voucher.voucherCode !== "string" ||
                            typeof voucher.name !== "string" ||
                            typeof voucher.phone !== "string" ||
                            typeof voucher.email !== "string" ||
                            typeof voucher.amount !== "number" ||
                            typeof voucher.date !== "string" ||
                            Math.round(voucher.amount * 100) !==
                              Math.round(purchase.amount * 100)
                          ) {
                            throw new Error("Invalid voucher response");
                          }

                          setPaymentError(null);
                          setPaymentStage(null);
                          setCompletedVoucher({
                            voucherCode: voucher.voucherCode,
                            name: voucher.name,
                            phone: voucher.phone,
                            email: voucher.email,
                            amount: voucher.amount,
                            date: voucher.date,
                          });
                        } catch {
                          console.error("Payment confirmation request failed.");
                          setPaymentStage(null);
                          setPaymentError(PAYMENT_ERROR_MESSAGE);
                        }
                      }}
                      onCancel={() => {
                        clearPaymentStageTimeout();
                        setPaymentStage(null);
                        setPaymentError("התשלום בוטל. ניתן לנסות שוב.");
                      }}
                      onError={() => {
                        console.error("Payment checkout failed.");
                        clearPaymentStageTimeout();
                        setPaymentStage(null);
                        setPaymentError(PAYMENT_ERROR_MESSAGE);
                      }}
                    />
                  </div>
                </PayPalScriptProvider>
              ) : paypalConfigLoading ? (
                <PaymentStatus message="מכינים את אפשרות התשלום..." />
              ) : !paymentError ? (
                <div className="payment-error" role="alert">
                  {PAYMENT_ERROR_MESSAGE}
                </div>
              ) : null}

              {paymentStage && (
                <PaymentStatus
                  message={
                    paymentStage === "starting"
                      ? "פותחים את אפשרות התשלום..."
                      : "התשלום אושר. מאמתים את התשלום ומכינים את השובר..."
                  }
                />
              )}

              {paymentError && (
                <div className="payment-error" role="alert">
                  {paymentError}
                </div>
              )}

              <button
                type="button"
                className="back-button"
                onClick={() => navigate("/")}
              >
                חזרה לפרטי השובר
              </button>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
