import { useEffect, useState, type FormEvent } from "react";
import AdminVoucherCard from "../components/admin/AdminVoucherCard";
import RedeemConfirmationDialog from "../components/admin/RedeemConfirmationDialog";
import FormField from "../components/forms/FormField";
import BrandHeader from "../components/layout/BrandHeader";
import type { AdminVoucher } from "../types/voucher";

export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [password, setPassword] = useState("");
  const [search, setSearch] = useState("");
  const [vouchers, setVouchers] = useState<AdminVoucher[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [voucherToRedeem, setVoucherToRedeem] =
    useState<AdminVoucher | null>(null);

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
                <FormField
                  id="voucher-search"
                  label="חיפוש לפי שם, טלפון או אימייל"
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
