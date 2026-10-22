import { useEffect, useRef, useState, type FormEvent } from "react";
import AdminVoucherCard from "../components/admin/AdminVoucherCard";
import RedeemConfirmationDialog from "../components/admin/RedeemConfirmationDialog";
import FormField from "../components/forms/FormField";
import VoucherAmountField from "../components/forms/VoucherAmountField";
import BrandHeader from "../components/layout/BrandHeader";
import VoucherSummary from "../components/payment/VoucherSummary";
import VoucherTicket from "../components/payment/VoucherTicket";
import type { AdminVoucher, FormData, FormErrors } from "../types/voucher";
import {
  formatCurrency,
  MAX_VOUCHER_AMOUNT,
  MIN_VOUCHER_AMOUNT,
  VOUCHER_AMOUNT_STEP,
} from "../utils/voucher";

function getManualVoucherErrors(data: FormData): FormErrors {
  const errors: FormErrors = {};
  const name = data.name.trim();
  const phone = data.phone.trim();
  const phoneDigits = phone.replace(/\D/g, "");
  const email = data.email.trim();
  const amount = Number(data.amount);

  if (!name) {
    errors.name = "יש להזין שם מלא";
  } else if (name.length < 2) {
    errors.name = "השם חייב להכיל לפחות שני תווים";
  } else if (name.length > 100) {
    errors.name = "השם ארוך מדי";
  }

  if (!phone) {
    errors.phone = "יש להזין מספר טלפון";
  } else if (phone.length > 30 || phoneDigits.length < 7 || phoneDigits.length > 15) {
    errors.phone = "יש להזין מספר טלפון תקין";
  }

  if (!email) {
    errors.email = "יש להזין כתובת אימייל";
  } else if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    errors.email = "יש להזין כתובת אימייל תקינה";
  }

  if (!data.amount || !Number.isFinite(amount)) {
    errors.amount = "יש להזין סכום לשובר";
  } else if (amount < MIN_VOUCHER_AMOUNT) {
    errors.amount = `הסכום המינימלי לשובר הוא ${MIN_VOUCHER_AMOUNT} ₪`;
  } else if (amount > MAX_VOUCHER_AMOUNT) {
    errors.amount = "הסכום המרבי לשובר הוא 10,000 ₪";
  } else if (amount % VOUCHER_AMOUNT_STEP !== 0) {
    errors.amount = `ניתן לבחור סכום בקפיצות של ${VOUCHER_AMOUNT_STEP} ₪`;
  }

  return errors;
}

export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [password, setPassword] = useState("");
  const [search, setSearch] = useState("");
  const [searchRefresh, setSearchRefresh] = useState(0);
  const [vouchers, setVouchers] = useState<AdminVoucher[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [createVoucherDialogOpen, setCreateVoucherDialogOpen] = useState(false);
  const [creatingVoucher, setCreatingVoucher] = useState(false);
  const [createVoucherMessage, setCreateVoucherMessage] = useState("");
  const [createdVoucher, setCreatedVoucher] = useState<AdminVoucher | null>(
    null,
  );
  const [newVoucher, setNewVoucher] = useState({
    name: "",
    phone: "",
    email: "",
    amount: "",
  });
  const [newVoucherErrors, setNewVoucherErrors] = useState<FormErrors>({});
  const [voucherToRedeem, setVoucherToRedeem] =
    useState<AdminVoucher | null>(null);
  const createVoucherDialogRef = useRef<HTMLDialogElement>(null);

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
  }, [authenticated, search, searchRefresh]);

  useEffect(() => {
    const dialog = createVoucherDialogRef.current;
    if (!dialog) return;

    if (createVoucherDialogOpen && !dialog.open) {
      dialog.showModal();
    } else if (!createVoucherDialogOpen && dialog.open) {
      dialog.close();
    }
  }, [createVoucherDialogOpen]);

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

  const handleCreateVoucher = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validationErrors = getManualVoucherErrors(newVoucher);
    setNewVoucherErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    setCreatingVoucher(true);
    setCreateVoucherMessage("");
    setCreatedVoucher(null);

    try {
      const response = await fetch("/api/admin/vouchers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newVoucher,
          amount: Number(newVoucher.amount),
        }),
      });
      if (response.status === 401) {
        setAuthenticated(false);
        setCreateVoucherDialogOpen(false);
        setMessage("פג תוקף ההתחברות. יש להתחבר מחדש.");
        return;
      }
      if (response.status === 400) {
        const result = (await response.json()) as { error: string };
        setCreateVoucherMessage(result.error);
        return;
      }
      if (!response.ok) throw new Error("Voucher creation failed");

      const result = (await response.json()) as { voucher: AdminVoucher };
      setCreatedVoucher(result.voucher);
      setNewVoucher({ name: "", phone: "", email: "", amount: "" });
      setNewVoucherErrors({});
      setSearching(true);
      setSearchRefresh((refresh) => refresh + 1);
      setMessage("");
      setCreateVoucherMessage(
        `השובר ${result.voucher.voucherCode} נוצר בהצלחה.`,
      );
    } catch {
      setCreateVoucherMessage("לא ניתן ליצור את השובר כרגע. נסו שוב.");
    } finally {
      setCreatingVoucher(false);
    }
  };

  const updateNewVoucherField = (field: keyof FormData, value: string) => {
    const nextVoucher = { ...newVoucher, [field]: value };
    setNewVoucher(nextVoucher);
    setNewVoucherErrors((current) => ({
      ...current,
      [field]: getManualVoucherErrors(nextVoucher)[field],
    }));
    setCreateVoucherMessage("");
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
      setCreateVoucherMessage("");
      setCreateVoucherDialogOpen(false);
    } catch {
      setMessage("לא ניתן להתנתק כרגע. נסו שוב.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="voucher-app admin-page" dir="rtl">
      <div className="voucher-container admin-container">
        <BrandHeader
          title="ניהול שוברים"
          description={
            authenticated
              ? "חיפוש ומימוש שוברים"
              : "כניסה לממשק ניהול השוברים"
          }
        />

        <section className="voucher-card">
          {checkingSession ? (
            <p className="admin-message" role="status">
              בודקים התחברות...
            </p>
          ) : !authenticated ? (
            <form onSubmit={handleLogin}>
              <FormField
                id="admin-password"
                label="סיסמת מנהל"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
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
                <div className="admin-toolbar-actions">
                  <button
                    type="button"
                    className="admin-create-trigger"
                    onClick={() => {
                      setCreateVoucherMessage("");
                      setCreatedVoucher(null);
                      setCreateVoucherDialogOpen(true);
                    }}
                  >
                    יצירת שובר ידנית
                  </button>
                  <button
                    type="button"
                    className="admin-logout"
                    onClick={() => void handleLogout()}
                    disabled={busy}
                  >
                    יציאה
                  </button>
                </div>
              </div>
              <dialog
                ref={createVoucherDialogRef}
                className="admin-create-dialog"
                aria-labelledby="admin-create-dialog-title"
                onClose={() => setCreateVoucherDialogOpen(false)}
                onClick={(event) => {
                  if (
                    event.target === event.currentTarget &&
                    !creatingVoucher
                  ) {
                    setCreateVoucherDialogOpen(false);
                  }
                }}
              >
                <form
                  className="admin-create-form"
                  onSubmit={(event) => void handleCreateVoucher(event)}
                  noValidate
                >
                  <button
                    type="button"
                    className="admin-create-close"
                    aria-label="סגירה"
                    onClick={() => setCreateVoucherDialogOpen(false)}
                    disabled={creatingVoucher}
                  >
                    ×
                  </button>
                  {createdVoucher ? (
                    <div className="admin-create-success success-card">
                      <h2
                        id="admin-create-dialog-title"
                        className="success-title"
                      >
                        השובר נוצר בהצלחה!
                      </h2>
                      <p className="success-desc">
                        השובר הידני מוכן:
                      </p>
                      <VoucherTicket
                        voucher={{
                          voucherCode: createdVoucher.voucherCode,
                          name: createdVoucher.name,
                          phone: createdVoucher.phone,
                          email: createdVoucher.email,
                          amount: createdVoucher.amount,
                          date: createdVoucher.createdAt,
                        }}
                      />
                      <VoucherSummary
                        items={[
                          {
                            label: "טלפון",
                            value: createdVoucher.phone,
                            dir: "ltr",
                          },
                          {
                            label: "אימייל",
                            value: createdVoucher.email,
                            dir: "ltr",
                          },
                          {
                            label: "סכום השובר",
                            value: formatCurrency(createdVoucher.amount),
                          },
                        ]}
                      />
                      <a
                        className="admin-created-voucher-download"
                        href={`/api/admin/vouchers/${encodeURIComponent(createdVoucher.voucherCode)}/pdf`}
                      >
                        <span aria-hidden="true">↓</span>
                        הורדת השובר כקובץ PDF
                      </a>
                      <div className="admin-create-actions">
                        <button
                          type="button"
                          className="submit-btn"
                          onClick={() => setCreateVoucherDialogOpen(false)}
                        >
                          סיום
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <h2 id="admin-create-dialog-title">
                        יצירת שובר ידנית
                      </h2>
                      <FormField
                        id="new-voucher-name"
                        label="שם מלא"
                        type="text"
                        autoComplete="name"
                        autoFocus
                        value={newVoucher.name}
                        onChange={(event) =>
                          updateNewVoucherField("name", event.target.value)
                        }
                        error={newVoucherErrors.name}
                        minLength={2}
                        maxLength={100}
                      />
                      <FormField
                        id="new-voucher-phone"
                        label="טלפון"
                        type="tel"
                        autoComplete="tel"
                        value={newVoucher.phone}
                        onChange={(event) =>
                          updateNewVoucherField("phone", event.target.value)
                        }
                        error={newVoucherErrors.phone}
                        maxLength={30}
                      />
                      <FormField
                        id="new-voucher-email"
                        label="אימייל"
                        type="email"
                        autoComplete="email"
                        value={newVoucher.email}
                        onChange={(event) =>
                          updateNewVoucherField("email", event.target.value)
                        }
                        error={newVoucherErrors.email}
                        maxLength={254}
                      />
                      <VoucherAmountField
                        value={newVoucher.amount}
                        onChange={(event) =>
                          updateNewVoucherField("amount", event.target.value)
                        }
                        onAmountChange={(amount) =>
                          updateNewVoucherField("amount", amount)
                        }
                        error={newVoucherErrors.amount}
                      />
                      {createVoucherMessage && (
                        <p className="admin-message" role="status">
                          {createVoucherMessage}
                        </p>
                      )}
                      <div className="admin-create-actions">
                        <button
                          type="submit"
                          className="submit-btn"
                          disabled={creatingVoucher || busy}
                        >
                          {creatingVoucher ? "יוצרים שובר..." : "יצירת שובר"}
                        </button>
                      </div>
                    </>
                  )}
                </form>
              </dialog>
              <div className="admin-search-form">
                <FormField
                  id="voucher-search"
                  label="חיפוש לפי שם, טלפון, אימייל או מזהה שובר"
                  type="search"
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
                <button
                  type="button"
                  className="submit-btn"
                  onClick={() => {
                    setSearching(true);
                    setMessage("");
                    setSearchRefresh((refresh) => refresh + 1);
                  }}
                  disabled={searching}
                >
                  {searching ? "מרעננים..." : "רענון שוברים"}
                </button>
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
                    <AdminVoucherCard
                      key={voucher.voucherCode}
                      voucher={voucher}
                      busy={busy}
                      onRedeem={setVoucherToRedeem}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </div>
      <RedeemConfirmationDialog
        voucher={voucherToRedeem}
        onCancel={() => setVoucherToRedeem(null)}
        onConfirm={(voucher) => {
          setVoucherToRedeem(null);
          void handleRedeem(voucher.voucherCode);
        }}
      />
    </main>
  );
}
