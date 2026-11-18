import { createVoucherPdf } from "./voucherPdf.js";

// WhatsApp Cloud API (Meta). The voucher PDF is uploaded as private media and
// sent inside a pre-approved message template, so no public PDF URL is needed.
const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
const templateName = process.env.WHATSAPP_TEMPLATE_NAME?.trim();
const templateLanguage = process.env.WHATSAPP_TEMPLATE_LANGUAGE?.trim() || "he";
const defaultCountryCode =
  process.env.WHATSAPP_DEFAULT_COUNTRY_CODE?.trim() || "972";
const apiVersion = process.env.WHATSAPP_API_VERSION?.trim() || "v23.0";
const REQUEST_TIMEOUT_MS = 10000;
// A send stuck in "sending" this long (e.g. the function was killed) may be
// claimed again.
const STALE_SENDING_MS = 2 * 60 * 1000;

export const whatsappConfigured = Boolean(
  accessToken &&
  phoneNumberId &&
  /^\d+$/.test(phoneNumberId) &&
  templateName &&
  /^v\d+\.\d+$/.test(apiVersion),
);

class WhatsAppError extends Error {
  constructor(status, code) {
    super("WhatsApp request failed");
    this.status = status;
    this.code = code;
  }

  // Network errors, timeouts, rate limits and Meta outages are worth retrying;
  // other 4xx errors (bad number, template mismatch, bad token) are not.
  get transient() {
    return !this.status || this.status === 429 || this.status >= 500;
  }
}

/** Converts a user-entered phone number to WhatsApp's digits-only E.164 form. */
export function toWhatsAppNumber(phone) {
  const trimmed = String(phone ?? "").trim();
  let digits = trimmed.replace(/\D/g, "");
  if (!trimmed.startsWith("+")) {
    if (digits.startsWith("00")) digits = digits.slice(2);
    else if (digits.startsWith("0")) {
      digits = defaultCountryCode + digits.slice(1);
    }
  }
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

async function graphRequest(pathname, init) {
  let response;
  try {
    response = await fetch(
      `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/${pathname}`,
      {
        ...init,
        headers: { Authorization: `Bearer ${accessToken}`, ...init.headers },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
  } catch {
    throw new WhatsAppError(0);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    throw new WhatsAppError(response.status, data?.error?.code);
  }
  return data;
}

async function uploadPdf(pdfBytes, filename) {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", "application/pdf");
  form.append(
    "file",
    new Blob([pdfBytes], { type: "application/pdf" }),
    filename,
  );
  const data = await graphRequest("media", { method: "POST", body: form });
  if (typeof data.id !== "string") throw new WhatsAppError(502);
  return data.id;
}

async function sendTemplate(to, mediaId, filename, voucher) {
  // Template text parameters may not contain newlines or long runs of spaces.
  const text = (value) => ({
    type: "text",
    text: String(value).replace(/\s+/g, " ").trim(),
  });
  const data = await graphRequest("messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: templateLanguage },
        components: [
          {
            type: "header",
            parameters: [
              { type: "document", document: { id: mediaId, filename } },
            ],
          },
          {
            type: "body",
            parameters: [text(voucher.name), text(voucher.voucherCode)],
          },
        ],
      },
    }),
  });
  const messageId = data.messages?.[0]?.id;
  if (typeof messageId !== "string") throw new WhatsAppError(502);
  return messageId;
}

/**
 * Sends the voucher PDF to the buyer's WhatsApp. Safe to call repeatedly and
 * concurrently: an atomic claim on the voucher document ensures one sender at
 * a time, and a voucher already sent (or permanently failed) is skipped
 * unless `force` is set (manual resend from the admin page).
 *
 * Never throws. Returns the resulting status:
 *   "sent" | "failed" (permanent) | "retry" (transient) | "skipped"
 */
export async function sendVoucherWhatsApp(
  collection,
  voucherCode,
  { force = false } = {},
) {
  if (!whatsappConfigured) return "skipped";

  const now = new Date();
  const claimable = force
    ? { "whatsapp.status": { $ne: "sending" } }
    : { "whatsapp.status": { $nin: ["sending", "sent", "failed"] } };

  let voucher;
  try {
    voucher = await collection.findOneAndUpdate(
      {
        voucherCode,
        status: "paid",
        $or: [
          claimable,
          {
            "whatsapp.status": "sending",
            "whatsapp.updatedAt": {
              $lt: new Date(now.getTime() - STALE_SENDING_MS),
            },
          },
        ],
      },
      {
        $set: { "whatsapp.status": "sending", "whatsapp.updatedAt": now },
        $inc: { "whatsapp.attempts": 1 },
      },
      { returnDocument: "after" },
    );
  } catch (error) {
    console.error("WhatsApp send claim failed.", error?.name ?? "Error");
    return "retry";
  }
  if (!voucher) return "skipped";

  const finish = async (status, fields = {}) => {
    await collection
      .updateOne(
        { voucherCode },
        {
          $set: {
            "whatsapp.status": status,
            "whatsapp.updatedAt": new Date(),
            ...fields,
          },
        },
      )
      .catch((error) =>
        console.error("WhatsApp status update failed.", error?.name ?? "Error"),
      );
    return status;
  };

  const to = toWhatsAppNumber(voucher.phone);
  if (!to) {
    console.error("WhatsApp send skipped: invalid phone.", voucherCode);
    return finish("failed", { "whatsapp.error": "invalid_phone" });
  }

  try {
    const filename = `voucher-${voucher.voucherCode}.pdf`;
    const pdf = await createVoucherPdf(voucher);
    const mediaId = await uploadPdf(pdf, filename);
    const messageId = await sendTemplate(to, mediaId, filename, voucher);
    return finish("sent", {
      "whatsapp.messageId": messageId,
      "whatsapp.sentAt": new Date(),
      "whatsapp.error": null,
    });
  } catch (error) {
    const isApiError = error instanceof WhatsAppError;
    const errorTag = isApiError
      ? `${error.status || "network"}:${error.code ?? ""}`
      : (error?.name ?? "Error");
    // Only codes are logged; never the phone number or access token.
    console.error("WhatsApp voucher send failed.", voucherCode, errorTag);
    return finish(isApiError && !error.transient ? "failed" : "retry", {
      "whatsapp.error": errorTag,
    });
  }
}
