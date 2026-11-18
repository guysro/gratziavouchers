// Structured audit log for payments, vouchers, WhatsApp and admin actions.
// Each event is printed to the console (visible in Vercel's runtime logs) and
// stored in MongoDB, where a TTL index removes it after the retention period.
//
// Never pass customer personal data (name, phone, email) or secrets here; use
// identifiers such as the voucher code or PayPal order ID instead.

let logsCollection;

export function setEventLogCollection(collection) {
  logsCollection = collection;
}

/**
 * @param {string} event   e.g. "paypal.capture", "admin.redeem"
 * @param {"success" | "failure"} outcome
 * @param {Record<string, unknown>} [details]
 */
export async function logEvent(event, outcome, details = {}) {
  const entry = { at: new Date(), event, outcome, ...details };
  const line = JSON.stringify(entry);
  if (outcome === "failure") console.error(line);
  else console.log(line);

  if (!logsCollection) return;
  try {
    await logsCollection.insertOne(entry);
  } catch (error) {
    // Logging must never break the request it describes.
    console.error("Event log write failed.", error?.name ?? "Error");
  }
}
