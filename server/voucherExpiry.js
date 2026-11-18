// Single source of truth for voucher validity. All expiry math is done in UTC.

const DAY_MS = 24 * 60 * 60 * 1000;

export function getVoucherExpiry(createdAt) {
  const expiry = new Date(createdAt);
  if (Number.isNaN(expiry.getTime())) {
    throw new Error("Invalid voucher creation date.");
  }
  expiry.setUTCFullYear(expiry.getUTCFullYear() + 1);
  return expiry;
}

export function isVoucherExpired(createdAt, now = Date.now()) {
  return now >= getVoucherExpiry(createdAt).getTime();
}

// Lower bound on `createdAt` for vouchers that may still be valid, for use in
// database queries. It is one day looser than the exact rule (to absorb
// leap-day edge cases), so results must still be checked with
// isVoucherExpired.
export function getPossiblyValidCreatedAfter(now = Date.now()) {
  const cutoff = new Date(now - DAY_MS);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  return cutoff;
}
