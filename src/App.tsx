import { useEffect, useRef, useState, type FormEvent } from "react";
import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import "./App.css";

interface FormData {
  name: string;
  phone: string;
  email: string;
  amount: string;
}

interface FormErrors {
  name?: string;
  phone?: string;
  email?: string;
  amount?: string;
}

interface PurchaseDetails {
  name: string;
  phone: string;
  email: string;
  amount: number;
}

interface CompletedVoucher extends PurchaseDetails {
  voucherCode: string;
  date: string;
}

interface AdminVoucher {
  voucherCode: string;
  name: string;
  phone: string;
  email: string;
  amount: number;
  currency: string;
  status: "paid" | "redeemed";
  createdAt: string;
  redeemedAt?: string;
}

const PRESET_AMOUNTS = [50, 100, 150, 200];
const PAYMENT_ERROR_MESSAGE =
  "לא ניתן להשלים את התשלום כרגע. נסו שוב מאוחר יותר או פנו לשירות הלקוחות.";
const currencyFormatter = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 2,
});

function formatCurrency(amount: number): string {
  return currencyFormatter.format(amount);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<PurchaseForm />} />
        <Route path="/payment" element={<PaymentPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

function PurchaseForm() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState<FormData>({
    name: "",
    phone: "",
    email: "",
    amount: "100",
  });
  const [errors, setErrors] = useState<FormErrors>({});

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
    } else if (amount < 10) {
      newErrors.amount = "הסכום המינימלי לשובר הוא 10 ₪";
    } else if (amount > 10000) {
      newErrors.amount = "הסכום המרבי לשובר הוא 10,000 ₪";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validate()) return;

    const purchase: PurchaseDetails = {
      name: formData.name.trim(),
      phone: formData.phone.trim(),
      email: formData.email.trim(),
      amount: Number(formData.amount),
    };
    navigate("/payment", { state: { purchase } });
  };

  const handlePresetClick = (amount: number) => {
    setFormData((previous) => ({ ...previous, amount: amount.toString() }));
    if (errors.amount) {
      setErrors((previous) => ({ ...previous, amount: undefined }));
    }
  };

  return (
    <main className="voucher-app" dir="rtl">
      <div className="voucher-container">
        <header className="voucher-header">
          <img
            className="brand-logo"
            src="/logo.jpg"
            alt="גרציא מתנות ואירועים"
          />
          <h1>שוברי מתנה גרציא</h1>
          <p>רכישת שובר מתנה דיגיטלי בכמה צעדים פשוטים</p>
        </header>

        <section className="voucher-card">
          <form onSubmit={handleSubmit} noValidate>
            <div className="form-group">
              <label htmlFor="name">שם מלא</label>
              <input
                id="name"
                type="text"
                autoComplete="name"
                placeholder="לדוגמה: ישראל ישראלי"
                className={`form-control ${errors.name ? "is-invalid" : ""}`}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? "name-error" : undefined}
                value={formData.name}
                onChange={(event) => {
                  setFormData({ ...formData, name: event.target.value });
                  if (errors.name) setErrors({ ...errors, name: undefined });
                }}
              />
              {errors.name && (
                <div id="name-error" className="error-message">
                  {errors.name}
                </div>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="phone">מספר טלפון</label>
              <input
                id="phone"
                type="tel"
                dir="ltr"
                autoComplete="tel"
                placeholder="לדוגמה: 050-123-4567"
                className={`form-control ${errors.phone ? "is-invalid" : ""}`}
                aria-invalid={Boolean(errors.phone)}
                aria-describedby={errors.phone ? "phone-error" : undefined}
                value={formData.phone}
                onChange={(event) => {
                  setFormData({ ...formData, phone: event.target.value });
                  if (errors.phone) setErrors({ ...errors, phone: undefined });
                }}
              />
              {errors.phone && (
                <div id="phone-error" className="error-message">
                  {errors.phone}
                </div>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="email">כתובת אימייל</label>
              <input
                id="email"
                type="email"
                dir="ltr"
                autoComplete="email"
                placeholder="name@example.com"
                className={`form-control ${errors.email ? "is-invalid" : ""}`}
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? "email-error" : undefined}
                value={formData.email}
                onChange={(event) => {
                  setFormData({ ...formData, email: event.target.value });
                  if (errors.email) setErrors({ ...errors, email: undefined });
                }}
              />
              {errors.email && (
                <div id="email-error" className="error-message">
                  {errors.email}
                </div>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="amount">סכום השובר (₪)</label>
              <div className="preset-amounts">
                {PRESET_AMOUNTS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={`preset-btn ${formData.amount === preset.toString() ? "active" : ""}`}
                    onClick={() => handlePresetClick(preset)}
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
                  className={`form-control ${errors.amount ? "is-invalid" : ""}`}
                  aria-invalid={Boolean(errors.amount)}
                  aria-describedby={errors.amount ? "amount-error" : undefined}
                  value={formData.amount}
                  onChange={(event) => {
                    setFormData({ ...formData, amount: event.target.value });
                    if (errors.amount)
                      setErrors({ ...errors, amount: undefined });
                  }}
                />
              </div>
              {errors.amount && (
                <div id="amount-error" className="error-message">
                  {errors.amount}
                </div>
              )}
            </div>

            <button type="submit" className="submit-btn">
              מעבר לתשלום
              {formData.amount &&
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

function AdminPage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [password, setPassword] = useState("");
  const [search, setSearch] = useState("");
  const [vouchers, setVouchers] = useState<AdminVoucher[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [voucherToRedeem, setVoucherToRedeem] = useState<AdminVoucher | null>(
    null,
  );
  const redeemDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/session")
      .then(async (response) => {
        if (!response.ok) throw new Error("Session check failed");
        return (await response.json()) as { authenticated: boolean };
      })
      .then((result) => {
        if (!cancelled) setAuthenticated(result.authenticated);
      })
      .catch(() => {
        if (!cancelled) setMessage("לא ניתן להתחבר לשירות הניהול כרגע.");
      })
      .finally(() => {
        if (!cancelled) setCheckingSession(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!authenticated) return;

    const query = search.trim();

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setMessage("");
      try {
        const response = await fetch(
          `/api/admin/vouchers?q=${encodeURIComponent(query)}`,
          { signal: controller.signal },
        );
        if (response.status === 401) {
          setAuthenticated(false);
          setMessage("פג תוקף ההתחברות. יש להתחבר מחדש.");
          return;
        }
        if (!response.ok) throw new Error("Search failed");
        const result = (await response.json()) as {
          vouchers: AdminVoucher[];
        };
        if (controller.signal.aborted) return;
        setVouchers(result.vouchers);
        if (result.vouchers.length === 0) {
          setMessage("לא נמצאו שוברים מתאימים.");
        }
      } catch {
        if (!controller.signal.aborted) {
          setMessage("החיפוש נכשל. נסו שוב.");
        }
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [authenticated, search]);

  useEffect(() => {
    const dialog = redeemDialogRef.current;
    if (!dialog) return;

    if (voucherToRedeem && !dialog.open) {
      dialog.showModal();
    } else if (!voucherToRedeem && dialog.open) {
      dialog.close();
    }
  }, [voucherToRedeem]);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        setMessage(
          response.status === 401
            ? "הסיסמה שגויה."
            : "לא ניתן להתחבר לשירות הניהול כרגע.",
        );
        return;
      }
      setPassword("");
      setAuthenticated(true);
      setMessage("התחילו להקליד לחיפוש שוברים.");
    } catch {
      setMessage("לא ניתן להתחבר לשירות הניהול כרגע.");
    } finally {
      setBusy(false);
    }
  };

  const handleRedeem = async (voucherCode: string) => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/admin/vouchers/${encodeURIComponent(voucherCode)}/redeem`,
        { method: "PATCH" },
      );
      if (response.status === 401) {
        setAuthenticated(false);
        setMessage("פג תוקף ההתחברות. יש להתחבר מחדש.");
        return;
      }
      if (response.status === 409) {
        setMessage("השובר כבר מומש.");
        setVouchers((current) =>
          current.map((voucher) =>
            voucher.voucherCode === voucherCode
              ? { ...voucher, status: "redeemed" }
              : voucher,
          ),
        );
        return;
      }
      if (!response.ok) throw new Error("Redemption failed");

      const result = (await response.json()) as { voucher: AdminVoucher };
      setVouchers((current) =>
        current.map((voucher) =>
          voucher.voucherCode === voucherCode ? result.voucher : voucher,
        ),
      );
      setMessage("השובר מומש בהצלחה.");
    } catch {
      setMessage("לא ניתן לממש את השובר כרגע.");
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/logout", { method: "POST" });
      if (!response.ok) throw new Error("Logout failed");
      setAuthenticated(false);
      setVouchers([]);
      setSearch("");
      setMessage("");
    } catch {
      setMessage("לא ניתן להתנתק כרגע. נסו שוב.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="voucher-app admin-page" dir="rtl">
      <div className="voucher-container admin-container">
        <header className="voucher-header">
          <img
            className="brand-logo"
            src="/logo.jpg"
            alt="גרציה מתנות ואירועים"
          />
          <h1>ניהול שוברים</h1>
          <p>
            {authenticated
              ? "חיפוש ומימוש שוברים"
              : "כניסה לממשק ניהול השוברים"}
          </p>
        </header>

        <section className="voucher-card">
          {checkingSession ? (
            <p className="admin-message" role="status">
              בודקים התחברות...
            </p>
          ) : !authenticated ? (
            <form onSubmit={handleLogin}>
              <div className="form-group">
                <label htmlFor="admin-password">סיסמת מנהל</label>
                <input
                  id="admin-password"
                  type="password"
                  autoComplete="current-password"
                  className="form-control"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </div>
              {message && (
                <p className="admin-message admin-message-error" role="alert">
                  {message}
                </p>
              )}
              <button type="submit" className="submit-btn" disabled={busy}>
                {busy ? "מתחברים..." : "כניסה"}
              </button>
            </form>
          ) : (
            <>
              <div className="admin-toolbar">
                <span>מחוברים לממשק הניהול</span>
                <button
                  type="button"
                  className="admin-logout"
                  onClick={() => void handleLogout()}
                  disabled={busy}
                >
                  יציאה
                </button>
              </div>
              <div className="admin-search-form">
                <div className="form-group">
                  <label htmlFor="voucher-search">
                    חיפוש לפי שם, טלפון או אימייל
                  </label>
                  <input
                    id="voucher-search"
                    type="search"
                    className="form-control"
                    placeholder="חיפוש..."
                    value={search}
                    onChange={(event) => {
                      const value = event.target.value;
                      setSearch(value);
                      setVouchers([]);
                      setSearching(true);
                      setMessage("");
                    }}
                    maxLength={100}
                  />
                </div>
              </div>

              {message && (
                <p className="admin-message" role="status">
                  {message}
                </p>
              )}
              {searching && (
                <p className="admin-message" role="status">
                  מחפשים שוברים...
                </p>
              )}

              {vouchers.length > 0 && (
                <div className="admin-voucher-list" aria-live="polite">
                  {vouchers.map((voucher) => (
                    <article
                      className="admin-voucher"
                      key={voucher.voucherCode}
                    >
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
                          {new Date(voucher.createdAt).toLocaleDateString(
                            "he-IL",
                          )}
                        </span>
                        {voucher.redeemedAt && (
                          <span>
                            מומש:{" "}
                            {new Date(voucher.redeemedAt).toLocaleDateString(
                              "he-IL",
                            )}
                          </span>
                        )}
                      </div>
                      {voucher.status === "paid" && (
                        <button
                          type="button"
                          className="redeem-btn"
                          onClick={() => setVoucherToRedeem(voucher)}
                          disabled={busy}
                        >
                          מימוש שובר
                        </button>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </div>
      <dialog
        ref={redeemDialogRef}
        className="redeem-dialog"
        aria-labelledby="redeem-dialog-title"
        aria-describedby="redeem-dialog-description"
        onClose={() => setVoucherToRedeem(null)}
      >
        {voucherToRedeem && (
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
              <strong dir="ltr">{voucherToRedeem.voucherCode}</strong>
              <span>{voucherToRedeem.name}</span>
              <strong>{formatCurrency(voucherToRedeem.amount)}</strong>
            </div>
            <div className="redeem-dialog-actions">
              <button
                type="button"
                className="redeem-dialog-cancel"
                onClick={() => setVoucherToRedeem(null)}
                autoFocus
              >
                ביטול
              </button>
              <button
                type="button"
                className="redeem-dialog-confirm"
                onClick={() => {
                  const voucherCode = voucherToRedeem.voucherCode;
                  setVoucherToRedeem(null);
                  void handleRedeem(voucherCode);
                }}
              >
                כן, לממש את השובר
              </button>
            </div>
          </div>
        )}
      </dialog>
    </main>
  );
}

function PaymentPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const purchase = (location.state as { purchase?: PurchaseDetails } | null)
    ?.purchase;
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const orderVerificationTokenRef = useRef<string | null>(null);
  const [paypalClientId, setPaypalClientId] = useState<string | null>(null);
  const [paypalConfigLoading, setPaypalConfigLoading] = useState(true);
  const [completedVoucher, setCompletedVoucher] =
    useState<CompletedVoucher | null>(null);

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

  if (
    !purchase ||
    !Number.isFinite(purchase.amount) ||
    purchase.amount < 10 ||
    purchase.amount > 10000
  ) {
    return <Navigate to="/" replace />;
  }

  return (
    <main className="voucher-app" dir="rtl">
      <div className="voucher-container">
        <header className="voucher-header">
          <img
            className="brand-logo"
            src="/logo.jpg"
            alt="גרציה מתנות ואירועים"
          />
          <h1>{completedVoucher ? "התשלום הושלם" : "תשלום מאובטח"}</h1>
          <p>
            {completedVoucher
              ? "תודה על הרכישה, השובר שלך מוכן"
              : "בדקו את פרטי השובר והשלימו את התשלום"}
          </p>
        </header>

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
              <div className="voucher-ticket">
                <div className="voucher-ticket-brand">
                  <span>שובר מתנה גרציה</span>
                  <span className="voucher-ticket-code" dir="ltr">
                    {completedVoucher.voucherCode}
                  </span>
                </div>
                <div className="voucher-ticket-amount">
                  {formatCurrency(completedVoucher.amount)}
                </div>
                <div className="voucher-ticket-recipient">
                  <span>הונפק עבור: {completedVoucher.name}</span>
                  <span>{completedVoucher.date}</span>
                </div>
              </div>
              <div className="summary-details">
                <div className="summary-row">
                  <span className="summary-label">טלפון</span>
                  <span className="summary-value" dir="ltr">
                    {completedVoucher.phone}
                  </span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">אימייל</span>
                  <span className="summary-value" dir="ltr">
                    {completedVoucher.email}
                  </span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">סכום ששולם</span>
                  <span className="summary-value">
                    {formatCurrency(completedVoucher.amount)}
                  </span>
                </div>
              </div>
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
              <div className="summary-details">
                <div className="summary-row">
                  <span className="summary-label">שם מלא</span>
                  <span className="summary-value">{purchase.name}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">טלפון</span>
                  <span className="summary-value" dir="ltr">
                    {purchase.phone}
                  </span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">אימייל</span>
                  <span className="summary-value" dir="ltr">
                    {purchase.email}
                  </span>
                </div>
                <div className="summary-row payment-total">
                  <span className="summary-label">לתשלום</span>
                  <span className="summary-value">
                    {formatCurrency(purchase.amount)}
                  </span>
                </div>
              </div>

              {paypalClientId ? (
                <PayPalScriptProvider
                  options={{
                    clientId: paypalClientId,
                    currency: "ILS",
                    intent: "capture",
                  }}
                >
                  <div className="paypal-container">
                    <PayPalButtons
                      style={{ layout: "vertical", label: "pay" }}
                      forceReRender={[purchase.amount]}
                      createOrder={async () => {
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
                          if (!response.ok)
                            throw new Error("Order creation failed");

                          const order: unknown = await response.json();
                          if (
                            !order ||
                            typeof order !== "object" ||
                            !("id" in order) ||
                            typeof order.id !== "string" ||
                            !("verificationToken" in order) ||
                            typeof order.verificationToken !== "string"
                          ) {
                            throw new Error("Invalid order response");
                          }
                          setPaymentError(null);
                          orderVerificationTokenRef.current =
                            order.verificationToken;
                          return order.id;
                        } catch {
                          console.error("Order creation request failed.");
                          setPaymentError(PAYMENT_ERROR_MESSAGE);
                          throw new Error(PAYMENT_ERROR_MESSAGE);
                        }
                      }}
                      onApprove={async (data) => {
                        if (!data.orderID) {
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
                          setPaymentError(PAYMENT_ERROR_MESSAGE);
                        }
                      }}
                      onCancel={() => {
                        setPaymentError("התשלום בוטל. ניתן לנסות שוב.");
                      }}
                      onError={() => {
                        console.error("Payment checkout failed.");
                        setPaymentError(PAYMENT_ERROR_MESSAGE);
                      }}
                    />
                  </div>
                </PayPalScriptProvider>
              ) : paypalConfigLoading ? (
                <div className="payment-error" role="status">
                  מכינים את אפשרות התשלום...
                </div>
              ) : !paymentError ? (
                <div className="payment-error" role="alert">
                  {PAYMENT_ERROR_MESSAGE}
                </div>
              ) : null}

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

export default App;
