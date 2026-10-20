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

const app = express();
const port = Number(process.env.PORT) || 3001;
const paypalEnvironment = process.env.PAYPAL_ENV || "sandbox";
const paypalClientId = process.env.PAYPAL_CLIENT_ID?.trim();
const paypalClientSecret = process.env.PAYPAL_CLIENT_SECRET?.trim();
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
const mongoDnsServers = process.env.MONGODB_DNS_SERVERS?.split(",")
  .map((server) => server.trim())
  .filter(Boolean);
if (mongoDnsServers?.length) dns.setServers(mongoDnsServers);
const mongoDatabaseName = getMongoDatabaseName(mongoUri);
if (
  mongoCollectionName.length > 120 ||
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
const dirname = path.dirname(fileURLToPath(import.meta.url));
const distDirectory = path.resolve(dirname, "..", "dist");
const mongoClient = mongoUri ? new MongoClient(mongoUri) : null;
let vouchersCollection;
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

app.disable("x-powered-by");
app.use(express.json({ limit: "10kb" }));
app.use(
  "/api/paypal",
  rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
);
app.use(
  "/api/admin/login",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
);
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

function serializeVoucher(voucher) {
  return {
    voucherCode: voucher.voucherCode,
    name: voucher.name,
    phone: voucher.phone,
    email: voucher.email,
    amount: voucher.amount,
    date: new Date(voucher.createdAt).toISOString(),
  };
}

async function saveVoucher({ orderId, purchase, amountCents }) {
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

app.get("/api/paypal/config", (_request, response) => {
  if (!paypalConfigured) return sendPaymentUnavailable(response);
  return response.json({ clientId: paypalClientId });
});

app.post("/api/paypal/orders", async (request, response) => {
  const amountCents = getAmountCents(request.body?.amount);
  const purchase = normalizePurchase(request.body?.purchase);
  if (amountCents === null || !purchase) {
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
      console.error("PayPal order creation returned an unexpected response.");
      return sendPaymentUnavailable(response);
    }

    return response.status(201).json({
      id: order.id,
      verificationToken: createOrderVerificationToken(
        order.id,
        amountCents,
        hashPurchase(purchase),
      ),
    });
  } catch (error) {
    console.error(
      "PayPal order creation failed.",
      error instanceof PaymentProviderError ? error.status : "network error",
    );
    return sendPaymentUnavailable(response);
  }
});

app.post("/api/paypal/orders/:orderId/capture", async (request, response) => {
  if (!paypalConfigured) return sendPaymentUnavailable(response);

  const { orderId } = request.params;
  if (!/^[A-Za-z0-9-]{1,128}$/.test(orderId)) {
    return response.status(400).json({ error: "לא ניתן לעבד את התשלום." });
  }

  const claims = verifyOrderToken(orderId, request.body?.verificationToken);
  const purchase = normalizePurchase(request.body?.purchase);
  if (!claims || !purchase || hashPurchase(purchase) !== claims.purchaseHash) {
    return sendPaymentUnavailable(response);
  }

  try {
    const orderPath = `/v2/checkout/orders/${encodeURIComponent(orderId)}`;
    const approvedOrder = await paypalRequest(orderPath);
    if (
      approvedOrder.id !== orderId ||
      approvedOrder.intent !== "CAPTURE" ||
      !Array.isArray(approvedOrder.purchase_units) ||
      approvedOrder.purchase_units.length !== 1
    ) {
      console.error("PayPal order verification failed.");
      return sendPaymentUnavailable(response);
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
      return sendPaymentUnavailable(response);
    }

    const capture = getVerifiedCapture(captureOrder, claims.amountCents);
    if (!capture) {
      console.error("PayPal capture did not match the verified order.");
      return sendPaymentUnavailable(response);
    }

    const voucher = await saveVoucher({
      orderId,
      purchase,
      amountCents: claims.amountCents,
    });
    return response.json({ ...capture, voucher });
  } catch (error) {
    console.error(
      "PayPal capture or voucher persistence failed.",
      error instanceof PaymentProviderError ? error.status : "network error",
    );
    return sendPaymentUnavailable(response);
  }
});

app.post("/api/admin/login", (request, response) => {
  if (
    adminPassword.length < 16 ||
    !mongoClient ||
    !adminSessionSecretConfigured
  ) {
    return response.status(503).json({ error: "שירות הניהול אינו זמין." });
  }
  const password = request.body?.password;
  if (typeof password !== "string" || password.length > 1024) {
    return response.status(400).json({ error: "פרטי ההתחברות אינם תקינים." });
  }

  const expected = createHash("sha256").update(adminPassword).digest();
  const received = createHash("sha256").update(password).digest();
  if (!timingSafeEqual(expected, received)) {
    return response.status(401).json({ error: "הסיסמה שגויה." });
  }

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

app.post("/api/admin/logout", (_request, response) => {
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

app.get("/api/admin/vouchers", requireAdmin, async (request, response) => {
  const search =
    typeof request.query.q === "string" ? request.query.q.trim() : "";
  if (search.length > 100) {
    return response.status(400).json({ error: "החיפוש ארוך מדי." });
  }

  const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    const vouchers = await vouchersCollection
      .find(
        search
          ? {
              $or: [
                { name: { $regex: safeSearch, $options: "i" } },
                { phone: { $regex: safeSearch, $options: "i" } },
                { email: { $regex: safeSearch, $options: "i" } },
                { voucherCode: { $regex: safeSearch, $options: "i" } },
              ],
            }
          : {},
        {
          projection: {
            _id: 0,
            voucherCode: 1,
            name: 1,
            phone: 1,
            email: 1,
            amount: 1,
            currency: 1,
            status: 1,
            createdAt: 1,
            redeemedAt: 1,
          },
        },
      )
      .sort({ createdAt: -1 })
      .toArray();

    const nonExpiredVouchers = vouchers.filter((voucher) => {
      const createdAt = new Date(voucher.createdAt);
      const expirationDate = new Date(createdAt);
      expirationDate.setFullYear(expirationDate.getFullYear() + 1);
      return new Date() < expirationDate;
    });

    return response.json({ vouchers: nonExpiredVouchers });
  } catch (error) {
    console.error("Admin voucher search failed.", error?.name ?? "Error");
    return response.status(500).json({ error: "החיפוש נכשל. נסו שוב." });
  }
});

app.patch(
  "/api/admin/vouchers/:voucherCode/redeem",
  requireAdmin,
  async (request, response) => {
    const { voucherCode } = request.params;
    if (
      !/^GRZ-(?:[A-HJ-NP-Z2-9]{6}|[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4})$/.test(
        voucherCode,
      )
    ) {
      return response.status(400).json({ error: "קוד השובר אינו תקין." });
    }

    try {
      const redeemedAt = new Date();
      const update = await vouchersCollection.updateOne(
        { voucherCode, status: "paid" },
        { $set: { status: "redeemed", redeemedAt } },
      );
      if (update.modifiedCount !== 1) {
        const existing = await vouchersCollection.findOne(
          { voucherCode },
          { projection: { status: 1 } },
        );
        if (!existing)
          return response.status(404).json({ error: "השובר לא נמצא." });
        return response.status(409).json({ error: "השובר כבר מומש." });
      }

      const voucher = await vouchersCollection.findOne(
        { voucherCode },
        {
          projection: {
            _id: 0,
            voucherCode: 1,
            name: 1,
            phone: 1,
            email: 1,
            amount: 1,
            currency: 1,
            status: 1,
            createdAt: 1,
            redeemedAt: 1,
          },
        },
      );
      return response.json({ voucher });
    } catch (error) {
      console.error("Admin voucher redemption failed.", error?.name ?? "Error");
      return response
        .status(500)
        .json({ error: "לא ניתן לממש את השובר כרגע." });
    }
  },
);

app.post("/api/admin/login", async (request, response) => {
  if (adminPassword.length < 16 || !adminSessionSecretConfigured) {
    return response.status(503).json({ error: "שירות הניהול אינו זמין." });
  }

  const submittedPassword = request.body?.password;
  if (
    typeof submittedPassword !== "string" ||
    submittedPassword.length > 1024
  ) {
    return response.status(400).json({ error: "פרטי ההתחברות אינם תקינים." });
  }

  const expectedPasswordHash = createHash("sha256")
    .update(adminPassword)
    .digest();
  const submittedPasswordHash = createHash("sha256")
    .update(submittedPassword)
    .digest();
  if (!timingSafeEqual(expectedPasswordHash, submittedPasswordHash)) {
    return response.status(401).json({ error: "הסיסמה שגויה." });
  }

  const cookieParts = [
    `gratzia_admin=${encodeURIComponent(createAdminSessionToken())}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/api/admin",
    `Max-Age=${ADMIN_SESSION_TTL_MS / 1000}`,
  ];
  if (adminCookieSecure) cookieParts.push("Secure");
  response.setHeader("Set-Cookie", cookieParts.join("; "));
  return response.json({ authenticated: true });
});

app.post("/api/admin/logout", (_request, response) => {
  response.setHeader(
    "Set-Cookie",
    "gratzia_admin=; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=0" +
      (adminCookieSecure ? "; Secure" : ""),
  );
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

app.get("/api/admin/vouchers", requireAdmin, async (request, response) => {
  const search =
    typeof request.query.q === "string" ? request.query.q.trim() : "";
  if (search.length > 100) {
    return response.status(400).json({ error: "החיפוש ארוך מדי." });
  }

  const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    const vouchers = await vouchersCollection
      .find(
        search
          ? {
              $or: [
                { name: { $regex: safeSearch, $options: "i" } },
                { phone: { $regex: safeSearch, $options: "i" } },
                { email: { $regex: safeSearch, $options: "i" } },
              ],
            }
          : {},
        {
          projection: {
            _id: 0,
            voucherCode: 1,
            name: 1,
            phone: 1,
            email: 1,
            amount: 1,
            currency: 1,
            status: 1,
            createdAt: 1,
            redeemedAt: 1,
          },
        },
      )
      .sort({ createdAt: -1 })
      .toArray();
    return response.json({ vouchers });
  } catch (error) {
    console.error("Admin voucher search failed.", error?.name ?? "Error");
    return response.status(500).json({ error: "החיפוש נכשל. נסו שוב." });
  }
});

app.patch(
  "/api/admin/vouchers/:voucherCode/redeem",
  requireAdmin,
  async (request, response) => {
    const { voucherCode } = request.params;
    if (
      !/^GRZ-(?:[A-HJ-NP-Z2-9]{6}|[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4})$/.test(
        voucherCode,
      )
    ) {
      return response.status(400).json({ error: "קוד השובר אינו תקין." });
    }

    try {
      const redeemedAt = new Date();
      const result = await vouchersCollection.updateOne(
        { voucherCode, status: "paid" },
        { $set: { status: "redeemed", redeemedAt } },
      );
      if (result.modifiedCount !== 1) {
        const existing = await vouchersCollection.findOne(
          { voucherCode },
          { projection: { status: 1 } },
        );
        if (!existing) {
          return response.status(404).json({ error: "השובר לא נמצא." });
        }
        return response.status(409).json({ error: "השובר כבר מומש." });
      }

      const voucher = await vouchersCollection.findOne(
        { voucherCode },
        {
          projection: {
            _id: 0,
            voucherCode: 1,
            name: 1,
            phone: 1,
            email: 1,
            amount: 1,
            currency: 1,
            status: 1,
            createdAt: 1,
            redeemedAt: 1,
          },
        },
      );
      return response.json({ voucher });
    } catch (error) {
      console.error("Admin voucher redemption failed.", error?.name ?? "Error");
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

app.use((error, _request, response, _next) => {
  if (error instanceof SyntaxError && "body" in error) {
    return response.status(400).json({ error: "Invalid request" });
  }
  console.error("Unhandled server error.");
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
      const collection = mongoClient
        .db(mongoDatabaseName)
        .collection(mongoCollectionName);
      await collection.createIndex(
        { paypalOrderId: 1 },
        { unique: true, name: "unique_paypal_order" },
      );
      await collection.createIndex(
        { voucherCode: 1 },
        { unique: true, name: "unique_voucher_code" },
      );
      return collection;
    })();
  }

  try {
    vouchersCollection = await mongoInitialization;
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
