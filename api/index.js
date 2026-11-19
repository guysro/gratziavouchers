import "dotenv/config";
import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import dns from "node:dns";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import rateLimit from "express-rate-limit";
import { MongoClient } from "mongodb";
import { logEvent, setEventLogCollection } from "../server/eventLog.js";
import { MongoRateLimitStore } from "../server/mongoRateLimitStore.js";
import {
  getPossiblyValidCreatedAfter,
  isVoucherExpired,
} from "../server/voucherExpiry.js";
import { createVoucherPdf } from "../server/voucherPdf.js";
import {
  sendVoucherWhatsApp,
  whatsappConfigured,
} from "../server/whatsapp.js";

const app = express();
const port = Number(process.env.PORT) || 3001;
const paypalEnvironment = process.env.PAYPAL_ENV || "sandbox";
const paypalClientId = process.env.PAYPAL_CLIENT_ID?.trim();
const paypalClientSecret = process.env.PAYPAL_CLIENT_SECRET?.trim();
const paypalWebhookId = process.env.PAYPAL_WEBHOOK_ID?.trim();
// Number of reverse-proxy hops in front of Express. Vercel's edge sets
// X-Forwarded-For itself, so exactly one hop is trusted there.
const trustProxyHops =
  process.env.VERCEL === "1"
    ? 1
    : /^\d+$/.test(process.env.TRUST_PROXY ?? "")
      ? Number(process.env.TRUST_PROXY)
      : 0;
const mongoUri = process.env.MONGODB_URI?.trim();
const adminPassword = process.env.ADMIN_PASSWORD ?? "";
const configuredAdminSessionSecret = process.env.ADMIN_SESSION_SECRET?.trim();
const adminSessionSecretConfigured =
  process.env.VERCEL !== "1" || Boolean(configuredAdminSessionSecret);
const adminCookieSecure = process.env.NODE_ENV !== "development";
const adminSessionSecret =
  configuredAdminSessionSecret ?? randomBytes(32).toString("base64url");
const isProductionEnvironment =
  process.env.VERCEL_ENV !== undefined
    ? process.env.VERCEL_ENV === "production"
    : process.env.NODE_ENV === "production";
const mongoCollectionName = isProductionEnvironment
  ? process.env.MONGODB_COLLECTION_PRODUCTION?.trim() || "vouchers"
  : process.env.MONGODB_COLLECTION_DEVELOPMENT?.trim() || "vouchers_dev";
const pendingOrdersCollectionName = `${mongoCollectionName}_pending_orders`;
const rateLimitsCollectionName = `${mongoCollectionName}_rate_limits`;
const logsCollectionName = `${mongoCollectionName}_logs`;
const LOG_RETENTION_DAYS = /^\d+$/.test(process.env.LOG_RETENTION_DAYS ?? "")
  ? Math.max(1, Number(process.env.LOG_RETENTION_DAYS))
  : 180;
const mongoDnsServers = process.env.MONGODB_DNS_SERVERS?.split(",")
  .map((server) => server.trim())
  .filter(Boolean);
if (mongoDnsServers?.length) dns.setServers(mongoDnsServers);
const mongoDatabaseName = getMongoDatabaseName(mongoUri);
if (
  rateLimitsCollectionName.length > 120 ||
  mongoCollectionName.includes("\0") ||
  mongoCollectionName.startsWith("system.")
) {
  throw new Error("Invalid MongoDB collection name.");
}
const paypalConfigured = Boolean(
  paypalClientId &&
  paypalClientSecret &&
  ["sandbox", "live"].includes(paypalEnvironment),
);
const paypalApiBase =
  paypalEnvironment === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
const MIN_AMOUNT_CENTS = 10000;
const AMOUNT_STEP_CENTS = 5000;
const MAX_AMOUNT_CENTS = 1000000;
const ORDER_TOKEN_TTL_MS = 30 * 60 * 1000;
const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
// How long order details are kept so a PayPal webhook can still issue the
// voucher if the buyer's browser never completed the capture.
const PENDING_ORDER_TTL_SECONDS = 7 * 24 * 60 * 60;
const ADMIN_SEARCH_LIMIT = 50;
const VOUCHER_CODE_PATTERN =
  /^GRZ-(?:[A-HJ-NP-Z2-9]{6}|[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4})$/;
const ADMIN_VOUCHER_PROJECTION = {
  _id: 0,
  voucherCode: 1,
  name: 1,
  phone: 1,
  email: 1,
  amount: 1,
  currency: 1,
  status: 1,
  source: 1,
  createdAt: 1,
  redeemedAt: 1,
  "whatsapp.status": 1,
};
const dirname = path.dirname(fileURLToPath(import.meta.url));
const distDirectory = path.resolve(dirname, "..", "dist");
const mongoClient = mongoUri ? new MongoClient(mongoUri) : null;
let vouchersCollection;
let pendingOrdersCollection;
let rateLimitsCollection;
let mongoInitialization;

function getMongoDatabaseName(uri) {
  if (!uri) return "gratzia_vouchers";
  try {
    const uriDatabaseName = decodeURIComponent(
      new URL(uri).pathname.replace(/^\/+|\/+$/g, ""),
    );
    return uriDatabaseName || "gratzia_vouchers";
  } catch {
    return "gratzia_vouchers";
  }
}

class PaymentProviderError extends Error {
  constructor(status) {
    super("Payment provider request failed");
    this.status = status;
  }
}

const PAYPAL_WEBHOOK_PATH = "/api/webhooks/paypal";

function createRateLimiter(name, windowMs, limit) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    store: new MongoRateLimitStore(name, async () => {
      await initializeMongo();
      return rateLimitsCollection;
    }),
  });
}

app.disable("x-powered-by");
app.set("trust proxy", trustProxyHops);
const parseSmallJson = express.json({ limit: "10kb" });
app.use((request, response, next) =>
  // PayPal webhook events can exceed 10kb; that route has its own parser.
  request.path === PAYPAL_WEBHOOK_PATH
    ? next()
    : parseSmallJson(request, response, next),
);
app.use("/api/paypal", createRateLimiter("paypal", 60 * 1000, 30));
app.use("/api/admin/login", createRateLimiter("admin-login", 15 * 60 * 1000, 10));
app.use("/api/vouchers", createRateLimiter("voucher-pdf", 15 * 60 * 1000, 20));
app.use(async (_request, _response, next) => {
  try {
    await initializeMongo();
    next();
  } catch (error) {
    next(error);
  }
});

function sendPaymentUnavailable(response) {
  return response.status(503).json({
    error:
      "לא ניתן להשלים את התשלום כרגע. נסו שוב מאוחר יותר או פנו לשירות הלקוחות.",
  });
}

function createAdminSessionToken() {
  const payload = Buffer.from(
    JSON.stringify({ expiresAt: Date.now() + ADMIN_SESSION_TTL_MS }),
  ).toString("base64url");
  const signature = createHmac("sha256", adminSessionSecret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function isValidAdminSession(token) {
  if (typeof token !== "string" || token.length > 512) return false;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return false;

  let suppliedSignature;
  try {
    suppliedSignature = Buffer.from(signature, "base64url");
  } catch {
    return false;
  }
  const expectedSignature = createHmac("sha256", adminSessionSecret)
    .update(payload)
    .digest();
  if (
    suppliedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    return false;
  }

  try {
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    return Number.isInteger(claims.expiresAt) && claims.expiresAt > Date.now();
  } catch {
    return false;
  }
}

function getCookie(request, name) {
  const cookieHeader = request.headers.cookie;
  if (typeof cookieHeader !== "string") return null;
  for (const cookie of cookieHeader.split(";")) {
    const separator = cookie.indexOf("=");
    if (separator < 0 || cookie.slice(0, separator).trim() !== name) continue;
    return decodeURIComponent(cookie.slice(separator + 1).trim());
  }
  return null;
}

function requireAdmin(request, response, next) {
  if (
    adminPassword.length < 16 ||
    !mongoClient ||
    !adminSessionSecretConfigured
  ) {
    return response.status(503).json({ error: "שירות הניהול אינו זמין." });
  }
  if (!isValidAdminSession(getCookie(request, "gratzia_admin"))) {
    // Usually just an expired session; repeated entries may mean probing.
    void logEvent("admin.unauthorized", "failure", {
      method: request.method,
      path: request.path.slice(0, 200),
      ip: request.ip,
    });
    return response.status(401).json({ error: "נדרשת התחברות." });
  }
  return next();
}

function getAmountCents(amount) {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
  const cents = Math.round(amount * 100);
  if (
    Math.abs(amount * 100 - cents) > 0.000001 ||
    cents < MIN_AMOUNT_CENTS ||
    cents % AMOUNT_STEP_CENTS !== 0 ||
    cents > MAX_AMOUNT_CENTS
  ) {
    return null;
  }
  return cents;
}

function normalizePurchase(purchase) {
  if (
    !purchase ||
    typeof purchase.name !== "string" ||
    typeof purchase.phone !== "string" ||
    typeof purchase.email !== "string"
  ) {
    return null;
  }

  const name = purchase.name.trim();
  const phone = purchase.phone.trim();
  const email = purchase.email.trim().toLowerCase();
  const phoneDigits = phone.replace(/\D/g, "");

  if (
    name.length < 2 ||
    name.length > 100 ||
    phone.length > 30 ||
    phoneDigits.length < 7 ||
    phoneDigits.length > 15 ||
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return null;
  }

  return { name, phone, email };
}

function hashPurchase(purchase) {
  return createHash("sha256")
    .update(JSON.stringify([purchase.name, purchase.phone, purchase.email]))
    .digest("hex");
}

function parseAmountCents(amount) {
  if (
    (typeof amount !== "string" && typeof amount !== "number") ||
    (typeof amount === "number" && !Number.isFinite(amount)) ||
    (typeof amount === "string" && !/^\d+(?:\.\d{1,2})?$/.test(amount))
  ) {
    return null;
  }
  return getAmountCents(Number(amount));
}

function getVerifiedCapture(order, expectedCents) {
  if (order?.status !== "COMPLETED") {
    return null;
  }
  if (
    !Array.isArray(order.purchase_units) ||
    order.purchase_units.length !== 1
  ) {
    return null;
  }
  const captures = order.purchase_units[0]?.payments?.captures;
  if (!Array.isArray(captures) || captures.length !== 1) return null;
  const [capture] = captures;
  if (
    capture?.status !== "COMPLETED" ||
    capture.amount?.currency_code !== "ILS" ||
    parseAmountCents(capture.amount.value) !== expectedCents
  ) {
    return null;
  }
  return {
    status: "COMPLETED",
    amount: expectedCents / 100,
    currency: "ILS",
  };
}

function createOrderVerificationToken(orderId, amountCents, purchaseHash) {
  const payload = Buffer.from(
    JSON.stringify({
      orderId,
      amountCents,
      purchaseHash,
      expiresAt: Date.now() + ORDER_TOKEN_TTL_MS,
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", paypalClientSecret)
    .update(`voucher-order:${payload}`)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function verifyOrderToken(orderId, token) {
  if (typeof token !== "string" || token.length > 1024) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;

  const expectedSignature = createHmac("sha256", paypalClientSecret)
    .update(`voucher-order:${payload}`)
    .digest();
  let suppliedSignature;
  try {
    suppliedSignature = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (
    suppliedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    return null;
  }

  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (
    claims?.orderId !== orderId ||
    !Number.isInteger(claims.amountCents) ||
    claims.amountCents < MIN_AMOUNT_CENTS ||
    claims.amountCents % AMOUNT_STEP_CENTS !== 0 ||
    claims.amountCents > MAX_AMOUNT_CENTS ||
    typeof claims.purchaseHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(claims.purchaseHash) ||
    !Number.isInteger(claims.expiresAt) ||
    claims.expiresAt <= Date.now()
  ) {
    return null;
  }
  return claims;
}

function generateVoucherCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const suffix = Array.from(
    { length: 6 },
    () => chars[randomInt(chars.length)],
  ).join("");
  return `GRZ-${suffix}`;
}

function createVoucherDownloadToken(voucher) {
  return createHmac("sha256", adminSessionSecret)
    .update(`voucher-pdf:${voucher.paypalOrderId}:${voucher.voucherCode}`)
    .digest("base64url");
}

function isValidVoucherDownloadToken(voucher, token) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return false;
  }
  const supplied = Buffer.from(token);
  const expected = Buffer.from(createVoucherDownloadToken(voucher));
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function serializeVoucher(voucher) {
  return {
    voucherCode: voucher.voucherCode,
    name: voucher.name,
    phone: voucher.phone,
    email: voucher.email,
    amount: voucher.amount,
    date: new Date(voucher.createdAt).toISOString(),
    downloadToken: createVoucherDownloadToken(voucher),
  };
}

async function saveVoucher({ orderId, purchase, amountCents, source }) {
  const existing = await vouchersCollection.findOne({ paypalOrderId: orderId });
  if (existing) return serializeVoucher(existing);

  let duplicateError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const voucher = {
      paypalOrderId: orderId,
      voucherCode: generateVoucherCode(),
      ...purchase,
      amount: amountCents / 100,
      currency: "ILS",
      status: "paid",
      createdAt: new Date(),
    };

    try {
      await vouchersCollection.insertOne(voucher);
      await logEvent("voucher.issue", "success", {
        source,
        orderId,
        voucherCode: voucher.voucherCode,
        amount: voucher.amount,
      });
      return serializeVoucher(voucher);
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const existingVoucher = await vouchersCollection.findOne({
        paypalOrderId: orderId,
      });
      if (existingVoucher) return serializeVoucher(existingVoucher);
      duplicateError = error;
    }
  }
  throw duplicateError;
}

async function paypalRequest(
  pathname,
  { method = "GET", body, requestId } = {},
) {
  if (!paypalConfigured) throw new PaymentProviderError(503);

  const tokenResponse = await fetch(`${paypalApiBase}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${paypalClientId}:${paypalClientSecret}`,
      ).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(15000),
  });
  const token = await tokenResponse.json().catch(() => null);
  if (
    !tokenResponse.ok ||
    typeof token?.access_token !== "string" ||
    !token.access_token
  ) {
    throw new PaymentProviderError(tokenResponse.status);
  }

  const headers = {
    Authorization: `Bearer ${token.access_token}`,
    "Content-Type": "application/json",
  };
  if (requestId) headers["PayPal-Request-Id"] = requestId;

  const response = await fetch(`${paypalApiBase}${pathname}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    throw new PaymentProviderError(response.status);
  }
  return data;
}

/**
 * Captures an approved PayPal order (or reads an already-completed one),
 * verifies the captured amount, and saves the voucher. Safe to call more than
 * once for the same order: the capture uses an idempotent PayPal-Request-Id
 * and the voucher insert is deduplicated by a unique index.
 *
 * Returns null when the order cannot become a valid voucher (retrying will not
 * help), and throws on transient provider or database failures.
 */
async function captureAndSaveVoucher(orderId, amountCents, purchase, source) {
  const fail = async (reason, details = {}) => {
    await logEvent("paypal.capture", "failure", {
      source,
      orderId,
      amount: amountCents / 100,
      reason,
      ...details,
    });
    return null;
  };

  const orderPath = `/v2/checkout/orders/${encodeURIComponent(orderId)}`;
  const approvedOrder = await paypalRequest(orderPath);
  if (
    approvedOrder.id !== orderId ||
    approvedOrder.intent !== "CAPTURE" ||
    !Array.isArray(approvedOrder.purchase_units) ||
    approvedOrder.purchase_units.length !== 1
  ) {
    return fail("order_verification_failed");
  }

  let captureOrder = approvedOrder;
  if (approvedOrder.status === "APPROVED") {
    const captureRequestId = createHash("sha256")
      .update(`capture:${orderId}`)
      .digest("hex")
      .slice(0, 32);
    captureOrder = await paypalRequest(`${orderPath}/capture`, {
      method: "POST",
      requestId: captureRequestId,
      body: {},
    });
  } else if (approvedOrder.status !== "COMPLETED") {
    return fail("order_not_approved", { orderStatus: approvedOrder.status });
  }

  const capture = getVerifiedCapture(captureOrder, amountCents);
  if (!capture) {
    // e.g. captureStatus "PENDING" when PayPal holds the payment for review
    // or for a currency the account does not accept automatically.
    return fail("capture_not_completed", {
      orderStatus: captureOrder?.status,
      captureStatus:
        captureOrder?.purchase_units?.[0]?.payments?.captures?.[0]?.status,
    });
  }

  const voucher = await saveVoucher({ orderId, purchase, amountCents, source });
  await pendingOrdersCollection.deleteOne({ _id: orderId }).catch(() => {});
  await logEvent("paypal.capture", "success", {
    source,
    orderId,
    voucherCode: voucher.voucherCode,
    amount: capture.amount,
  });
  const whatsapp = await sendVoucherWhatsApp(
    vouchersCollection,
    voucher.voucherCode,
    { trigger: source },
  );
  return { capture, voucher, whatsapp };
}

function getErrorTag(error) {
  if (error instanceof PaymentProviderError) return `paypal_${error.status}`;
  return error?.name ?? "Error";
}

async function verifyPaypalWebhook(request) {
  const header = (name) => request.get(name);
  const result = await paypalRequest(
    "/v1/notifications/verify-webhook-signature",
    {
      method: "POST",
      body: {
        auth_algo: header("paypal-auth-algo"),
        cert_url: header("paypal-cert-url"),
        transmission_id: header("paypal-transmission-id"),
        transmission_sig: header("paypal-transmission-sig"),
        transmission_time: header("paypal-transmission-time"),
        webhook_id: paypalWebhookId,
        webhook_event: request.body,
      },
    },
  );
  return result?.verification_status === "SUCCESS";
}

function getWebhookOrderId(event) {
  if (event?.event_type === "CHECKOUT.ORDER.APPROVED") {
    return event.resource?.id;
  }
  if (event?.event_type === "PAYMENT.CAPTURE.COMPLETED") {
    return event.resource?.supplementary_data?.related_ids?.order_id;
  }
  return undefined;
}

app.post(
  PAYPAL_WEBHOOK_PATH,
  express.json({ limit: "200kb" }),
  async (request, response) => {
    const eventType =
      typeof request.body?.event_type === "string"
        ? request.body.event_type.slice(0, 100)
        : undefined;
    if (!paypalConfigured || !paypalWebhookId) {
      await logEvent("paypal.webhook", "failure", {
        eventType,
        reason: "webhook_not_configured",
      });
      return response.sendStatus(503);
    }

    let orderId;
    try {
      if (!(await verifyPaypalWebhook(request))) {
        await logEvent("paypal.webhook", "failure", {
          eventType,
          reason: "invalid_signature",
          ip: request.ip,
        });
        return response.sendStatus(400);
      }

      orderId = getWebhookOrderId(request.body);
      if (typeof orderId !== "string" || !/^[A-Za-z0-9-]{1,128}$/.test(orderId)) {
        await logEvent("paypal.webhook", "success", {
          eventType,
          result: "ignored",
        });
        return response.sendStatus(200);
      }

      const pending = await pendingOrdersCollection.findOne({ _id: orderId });
      let whatsapp;
      if (pending) {
        const result = await captureAndSaveVoucher(
          orderId,
          pending.amountCents,
          pending.purchase,
          "webhook",
        );
        await logEvent("paypal.webhook", result ? "success" : "failure", {
          eventType,
          orderId,
          result: result ? "fulfilled" : "not_fulfillable",
        });
        whatsapp = result?.whatsapp;
      } else {
        // Already fulfilled by the browser flow (or not one of our orders).
        // Retry the WhatsApp delivery in case it did not go through there.
        const voucher = await vouchersCollection.findOne(
          { paypalOrderId: orderId },
          { projection: { voucherCode: 1 } },
        );
        if (voucher) {
          whatsapp = await sendVoucherWhatsApp(
            vouchersCollection,
            voucher.voucherCode,
            { trigger: "webhook" },
          );
        }
        await logEvent("paypal.webhook", "success", {
          eventType,
          orderId,
          result: voucher ? "already_fulfilled" : "unknown_order",
        });
      }
      // A transient WhatsApp failure makes PayPal redeliver the event later,
      // which retries the send.
      return response.sendStatus(whatsapp === "retry" ? 500 : 200);
    } catch (error) {
      await logEvent("paypal.webhook", "failure", {
        eventType,
        orderId,
        reason: "processing_error",
        error: getErrorTag(error),
      });
      // Non-2xx makes PayPal retry the delivery later.
      return response.sendStatus(500);
    }
  },
);

app.get("/api/paypal/config", (_request, response) => {
  if (!paypalConfigured) return sendPaymentUnavailable(response);
  return response.json({ clientId: paypalClientId });
});

app.post("/api/paypal/orders", async (request, response) => {
  const amountCents = getAmountCents(request.body?.amount);
  const purchase = normalizePurchase(request.body?.purchase);
  if (amountCents === null || !purchase) {
    await logEvent("paypal.order.create", "failure", {
      reason: "invalid_request",
      ip: request.ip,
    });
    return response.status(400).json({ error: "בקשת התשלום אינה תקינה." });
  }

  try {
    const order = await paypalRequest("/v2/checkout/orders", {
      method: "POST",
      requestId: randomUUID(),
      body: {
        intent: "CAPTURE",
        application_context: {
          shipping_preference: "NO_SHIPPING",
        },
        purchase_units: [
          {
            description: "שובר מתנה גרציא",
            amount: {
              currency_code: "ILS",
              value: (amountCents / 100).toFixed(2),
            },
          },
        ],
      },
    });

    if (typeof order.id !== "string" || order.status !== "CREATED") {
      await logEvent("paypal.order.create", "failure", {
        amount: amountCents / 100,
        reason: "unexpected_response",
        orderStatus: order.status,
      });
      return sendPaymentUnavailable(response);
    }

    // Recovery record: lets the PayPal webhook issue the voucher even if the
    // buyer closes the page before the browser-side capture finishes.
    await pendingOrdersCollection.insertOne({
      _id: order.id,
      amountCents,
      purchase,
      createdAt: new Date(),
    });
    await logEvent("paypal.order.create", "success", {
      orderId: order.id,
      amount: amountCents / 100,
    });

    return response.status(201).json({
      id: order.id,
      verificationToken: createOrderVerificationToken(
        order.id,
        amountCents,
        hashPurchase(purchase),
      ),
    });
  } catch (error) {
    await logEvent("paypal.order.create", "failure", {
      amount: amountCents / 100,
      reason: "provider_or_database_error",
      error: getErrorTag(error),
    });
    return sendPaymentUnavailable(response);
  }
});

app.post("/api/paypal/orders/:orderId/capture", async (request, response) => {
  if (!paypalConfigured) return sendPaymentUnavailable(response);

  const { orderId } = request.params;
  if (!/^[A-Za-z0-9-]{1,128}$/.test(orderId)) {
    await logEvent("paypal.capture", "failure", {
      source: "browser",
      reason: "invalid_order_id",
      ip: request.ip,
    });
    return response.status(400).json({ error: "לא ניתן לעבד את התשלום." });
  }

  const claims = verifyOrderToken(orderId, request.body?.verificationToken);
  const purchase = normalizePurchase(request.body?.purchase);
  if (!claims || !purchase || hashPurchase(purchase) !== claims.purchaseHash) {
    await logEvent("paypal.capture", "failure", {
      source: "browser",
      orderId,
      reason: claims ? "purchase_details_mismatch" : "invalid_or_expired_token",
      ip: request.ip,
    });
    return sendPaymentUnavailable(response);
  }

  try {
    const result = await captureAndSaveVoucher(
      orderId,
      claims.amountCents,
      purchase,
      "browser",
    );
    if (!result) return sendPaymentUnavailable(response);
    return response.json({ ...result.capture, voucher: result.voucher });
  } catch (error) {
    await logEvent("paypal.capture", "failure", {
      source: "browser",
      orderId,
      amount: claims.amountCents / 100,
      reason: "provider_or_database_error",
      error: getErrorTag(error),
    });
    return sendPaymentUnavailable(response);
  }
});

app.post("/api/admin/login", async (request, response) => {
  if (
    adminPassword.length < 16 ||
    !mongoClient ||
    !adminSessionSecretConfigured
  ) {
    await logEvent("admin.login", "failure", {
      reason: "admin_not_configured",
      ip: request.ip,
    });
    return response.status(503).json({ error: "שירות הניהול אינו זמין." });
  }
  const password = request.body?.password;
  if (typeof password !== "string" || password.length > 1024) {
    await logEvent("admin.login", "failure", {
      reason: "invalid_request",
      ip: request.ip,
    });
    return response.status(400).json({ error: "פרטי ההתחברות אינם תקינים." });
  }

  const expected = createHash("sha256").update(adminPassword).digest();
  const received = createHash("sha256").update(password).digest();
  if (!timingSafeEqual(expected, received)) {
    await logEvent("admin.login", "failure", {
      reason: "wrong_password",
      ip: request.ip,
    });
    return response.status(401).json({ error: "הסיסמה שגויה." });
  }
  await logEvent("admin.login", "success", { ip: request.ip });

  const cookie = [
    `gratzia_admin=${encodeURIComponent(createAdminSessionToken())}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/api/admin",
    `Max-Age=${ADMIN_SESSION_TTL_MS / 1000}`,
  ];
  if (adminCookieSecure) cookie.push("Secure");
  response.setHeader("Set-Cookie", cookie.join("; "));
  return response.json({ authenticated: true });
});

app.post("/api/admin/logout", async (request, response) => {
  await logEvent("admin.logout", "success", {
    ip: request.ip,
    hadSession: isValidAdminSession(getCookie(request, "gratzia_admin")),
  });
  const cookie =
    "gratzia_admin=; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=0" +
    (adminCookieSecure ? "; Secure" : "");
  response.setHeader("Set-Cookie", cookie);
  return response.json({ authenticated: false });
});

app.get("/api/admin/session", (request, response) => {
  if (
    adminPassword.length < 16 ||
    !mongoClient ||
    !adminSessionSecretConfigured
  ) {
    return response.status(503).json({ error: "שירות הניהול אינו זמין." });
  }
  return response.json({
    authenticated: isValidAdminSession(getCookie(request, "gratzia_admin")),
  });
});

app.post("/api/admin/vouchers", requireAdmin, async (request, response) => {
  const purchase = normalizePurchase(request.body);
  const amountCents = getAmountCents(request.body?.amount);
  if (!purchase || amountCents === null) {
    await logEvent("admin.voucher.create", "failure", {
      reason: "invalid_request",
      ip: request.ip,
    });
    return response.status(400).json({ error: "פרטי השובר אינם תקינים." });
  }

  try {
    let voucher;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      voucher = {
        paypalOrderId: `admin-${randomUUID()}`,
        voucherCode: generateVoucherCode(),
        ...purchase,
        amount: amountCents / 100,
        currency: "ILS",
        status: "paid",
        source: "admin",
        createdAt: new Date(),
      };

      try {
        await vouchersCollection.insertOne(voucher);
        break;
      } catch (error) {
        if (error?.code !== 11000) throw error;
        if (attempt === 4) throw error;
      }
    }

    await logEvent("admin.voucher.create", "success", {
      voucherCode: voucher.voucherCode,
      amount: voucher.amount,
      ip: request.ip,
    });
    const whatsapp = await sendVoucherWhatsApp(
      vouchersCollection,
      voucher.voucherCode,
      { trigger: "admin_create" },
    );

    return response.status(201).json({
      voucher: {
        voucherCode: voucher.voucherCode,
        name: voucher.name,
        phone: voucher.phone,
        email: voucher.email,
        amount: voucher.amount,
        currency: voucher.currency,
        status: voucher.status,
        source: voucher.source,
        createdAt: voucher.createdAt,
        ...(whatsapp !== "skipped" && { whatsapp: { status: whatsapp } }),
      },
    });
  } catch (error) {
    await logEvent("admin.voucher.create", "failure", {
      amount: amountCents / 100,
      reason: "database_error",
      error: getErrorTag(error),
      ip: request.ip,
    });
    return response.status(500).json({ error: "לא ניתן ליצור את השובר כרגע." });
  }
});

app.post(
  "/api/admin/vouchers/:voucherCode/whatsapp",
  requireAdmin,
  async (request, response) => {
    const { voucherCode } = request.params;
    if (!VOUCHER_CODE_PATTERN.test(voucherCode)) {
      return response.status(400).json({ error: "קוד השובר אינו תקין." });
    }
    if (!whatsappConfigured) {
      return response.status(503).json({ error: "שליחה בוואטסאפ אינה מוגדרת." });
    }

    // The send itself is logged as "whatsapp.send"; this records who asked.
    const status = await sendVoucherWhatsApp(vouchersCollection, voucherCode, {
      force: true,
      trigger: "admin_resend",
    });
    await logEvent(
      "admin.whatsapp.resend",
      status === "sent" ? "success" : "failure",
      { voucherCode, result: status, ip: request.ip },
    );
    if (status === "skipped") {
      return response
        .status(409)
        .json({ error: "השובר אינו בתוקף או שהשליחה כבר מתבצעת." });
    }
    return response.json({ status });
  },
);

async function sendVoucherPdf(request, response, requireDownloadToken) {
  const { voucherCode } = request.params;
  const event = requireDownloadToken
    ? "voucher.pdf.download"
    : "admin.voucher.pdf.download";
  const notFound = async (reason) => {
    await logEvent(event, "failure", { voucherCode, reason, ip: request.ip });
    return response.status(404).json({ error: "השובר לא נמצא או שפג תוקפו." });
  };

  if (!VOUCHER_CODE_PATTERN.test(voucherCode)) {
    await logEvent(event, "failure", {
      reason: "invalid_voucher_code",
      ip: request.ip,
    });
    return response.status(400).json({ error: "קוד השובר אינו תקין." });
  }

  try {
    const voucher = await vouchersCollection.findOne({
      voucherCode,
      status: "paid",
    });
    if (!voucher) return notFound("not_found_or_redeemed");
    if (
      requireDownloadToken &&
      !isValidVoucherDownloadToken(
        voucher,
        request.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]+)$/i)?.[1],
      )
    ) {
      return notFound("invalid_download_token");
    }

    if (isVoucherExpired(voucher.createdAt)) return notFound("expired");

    const pdf = await createVoucherPdf(voucher);
    await logEvent(event, "success", { voucherCode, ip: request.ip });
    response.set({
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="voucher-${voucherCode}.pdf"`,
      "Content-Type": "application/pdf",
    });
    return response.send(Buffer.from(pdf));
  } catch (error) {
    await logEvent(event, "failure", {
      voucherCode,
      reason: "pdf_generation_error",
      error: getErrorTag(error),
      ip: request.ip,
    });
    return response.status(500).json({ error: "לא ניתן להכין את השובר כרגע." });
  }
}

app.get("/api/vouchers/:voucherCode/pdf", (request, response) =>
  sendVoucherPdf(request, response, true),
);

app.get(
  "/api/admin/vouchers/:voucherCode/pdf",
  requireAdmin,
  (request, response) => sendVoucherPdf(request, response, false),
);

app.get("/api/admin/vouchers", requireAdmin, async (request, response) => {
  const search =
    typeof request.query.q === "string" ? request.query.q.trim() : "";
  if (search.length > 100) {
    return response.status(400).json({ error: "החיפוש ארוך מדי." });
  }

  const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const now = Date.now();
  const filter = { createdAt: { $gt: getPossiblyValidCreatedAfter(now) } };
  if (search) {
    filter.$or = [
      { name: { $regex: safeSearch, $options: "i" } },
      { phone: { $regex: safeSearch, $options: "i" } },
      { email: { $regex: safeSearch, $options: "i" } },
      { voucherCode: { $regex: safeSearch, $options: "i" } },
    ];
  }

  try {
    const vouchers = await vouchersCollection
      .find(filter, { projection: ADMIN_VOUCHER_PROJECTION })
      .sort({ createdAt: -1 })
      .limit(ADMIN_SEARCH_LIMIT)
      .toArray();

    return response.json({
      vouchers: vouchers.filter(
        (voucher) => !isVoucherExpired(voucher.createdAt, now),
      ),
    });
  } catch (error) {
    // Successful searches are not logged: they run on every keystroke and
    // the search text may contain customer details.
    await logEvent("admin.voucher.search", "failure", {
      reason: "database_error",
      error: getErrorTag(error),
      ip: request.ip,
    });
    return response.status(500).json({ error: "החיפוש נכשל. נסו שוב." });
  }
});

app.patch(
  "/api/admin/vouchers/:voucherCode/redeem",
  requireAdmin,
  async (request, response) => {
    const { voucherCode } = request.params;
    const fail = async (status, reason, error) => {
      await logEvent("admin.voucher.redeem", "failure", {
        voucherCode,
        reason,
        ip: request.ip,
      });
      return response.status(status).json({ error });
    };
    if (!VOUCHER_CODE_PATTERN.test(voucherCode)) {
      return fail(400, "invalid_voucher_code", "קוד השובר אינו תקין.");
    }

    try {
      const existing = await vouchersCollection.findOne(
        { voucherCode },
        { projection: { status: 1, createdAt: 1 } },
      );
      if (!existing) return fail(404, "not_found", "השובר לא נמצא.");
      if (existing.status !== "paid") {
        return fail(409, "already_redeemed", "השובר כבר מומש.");
      }
      if (isVoucherExpired(existing.createdAt)) {
        return fail(410, "expired", "תוקף השובר פג.");
      }

      // The status condition keeps redemption atomic: only one concurrent
      // request can move the voucher from "paid" to "redeemed".
      const voucher = await vouchersCollection.findOneAndUpdate(
        { voucherCode, status: "paid" },
        { $set: { status: "redeemed", redeemedAt: new Date() } },
        { projection: ADMIN_VOUCHER_PROJECTION, returnDocument: "after" },
      );
      if (!voucher) return fail(409, "already_redeemed", "השובר כבר מומש.");
      await logEvent("admin.voucher.redeem", "success", {
        voucherCode,
        amount: voucher.amount,
        ip: request.ip,
      });
      return response.json({ voucher });
    } catch (error) {
      await logEvent("admin.voucher.redeem", "failure", {
        voucherCode,
        reason: "database_error",
        error: getErrorTag(error),
        ip: request.ip,
      });
      return response
        .status(500)
        .json({ error: "לא ניתן לממש את השובר כרגע." });
    }
  },
);

app.use("/api", (_request, response) =>
  response.status(404).json({ error: "לא נמצא." }),
);

if (process.env.VERCEL !== "1") {
  app.use(express.static(distDirectory));
  app.use(async (request, response, next) => {
    if (request.method !== "GET") return next();
    try {
      const indexHtml = await readFile(path.join(distDirectory, "index.html"));
      return response.type("html").send(indexHtml);
    } catch {
      return next();
    }
  });
}

app.use(async (error, request, response, _next) => {
  if (error instanceof SyntaxError && "body" in error) {
    return response.status(400).json({ error: "Invalid request" });
  }
  await logEvent("server.error", "failure", {
    method: request.method,
    path: request.path.slice(0, 200),
    error: getErrorTag(error),
  });
  return sendPaymentUnavailable(response);
});

async function startServer() {
  if (!mongoClient) {
    throw new Error("MONGODB_URI is required.");
  }

  await initializeMongo();

  app.listen(port, () => {
    console.log(`Voucher server listening on port ${port}`);
  });
}

async function initializeMongo() {
  if (!mongoClient) {
    throw new Error("MONGODB_URI is required.");
  }

  if (!mongoInitialization) {
    mongoInitialization = (async () => {
      await mongoClient.connect();
      const database = mongoClient.db(mongoDatabaseName);
      const collection = database.collection(mongoCollectionName);
      await collection.createIndex(
        { paypalOrderId: 1 },
        { unique: true, name: "unique_paypal_order" },
      );
      await collection.createIndex(
        { voucherCode: 1 },
        { unique: true, name: "unique_voucher_code" },
      );
      await collection.createIndex({ createdAt: -1 }, { name: "created_at" });

      const pendingOrders = database.collection(pendingOrdersCollectionName);
      await pendingOrders.createIndex(
        { createdAt: 1 },
        { expireAfterSeconds: PENDING_ORDER_TTL_SECONDS, name: "expire_pending" },
      );

      const rateLimits = database.collection(rateLimitsCollectionName);
      await rateLimits.createIndex(
        { resetAt: 1 },
        { expireAfterSeconds: 0, name: "expire_window" },
      );

      const logs = database.collection(logsCollectionName);
      await logs
        .createIndex(
          { at: 1 },
          {
            expireAfterSeconds: LOG_RETENTION_DAYS * 24 * 60 * 60,
            name: "expire_logs",
          },
        )
        .catch(async (error) => {
          // IndexOptionsConflict: the retention period was changed.
          if (error?.code !== 85) throw error;
          await database.command({
            collMod: logsCollectionName,
            index: {
              name: "expire_logs",
              expireAfterSeconds: LOG_RETENTION_DAYS * 24 * 60 * 60,
            },
          });
        })
        .then(() => logs.createIndex({ event: 1, at: -1 }, { name: "event_at" }))
        // Logging is still useful without its indexes; never block startup.
        .catch((error) =>
          console.error("Log index setup failed.", error?.codeName ?? error?.name),
        );
      setEventLogCollection(logs);

      return { collection, pendingOrders, rateLimits };
    })();
  }

  try {
    ({
      collection: vouchersCollection,
      pendingOrders: pendingOrdersCollection,
      rateLimits: rateLimitsCollection,
    } = await mongoInitialization);
  } catch (error) {
    mongoInitialization = undefined;
    throw error;
  }
}

export default app;

if (process.env.VERCEL !== "1") {
  startServer().catch(async (error) => {
    const errorName =
      error && typeof error.name === "string" ? error.name : "Error";
    const errorMessage =
      error && typeof error.message === "string"
        ? error.message.replace(
            /mongodb(?:\+srv)?:\/\/[^\s"'`]+/gi,
            "[redacted URI]",
          )
        : "Unknown startup error";
    console.error(`Server startup failed (${errorName}): ${errorMessage}`);
    if (mongoClient) await mongoClient.close().catch(() => {});
    process.exitCode = 1;
  });
}
