import { createHash, createHmac, randomInt } from "node:crypto";
import { MongoClient } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { vi } from "vitest";
import { createFakeApis } from "./fakes.js";

export const TEST_SECRETS = {
  paypalClientSecret: "test-paypal-client-secret",
  adminSessionSecret: "test-admin-session-secret-0123456789abcdefghij",
  adminPassword: "test-admin-password-1234567890",
};

export const PURCHASE = {
  name: "Test Buyer",
  phone: "050-1234567",
  email: "buyer@example.com",
};

const COLLECTION = "vouchers_test";
const DATABASE = "gratzia_test";

/**
 * Starts an in-memory MongoDB, fakes PayPal and Meta, and loads the Express
 * app with test settings. The real .env file is never read.
 */
export async function startTestApp() {
  const mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri(DATABASE);

  for (const key of Object.keys(process.env)) {
    if (/^(PAYPAL_|WHATSAPP_|MONGODB_|ADMIN_|LOG_)/.test(key)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, {
    DOTENV_CONFIG_PATH: "tests/.env.does-not-exist",
    VERCEL: "1",
    VERCEL_ENV: "preview",
    MONGODB_URI: uri,
    MONGODB_COLLECTION_DEVELOPMENT: COLLECTION,
    PAYPAL_ENV: "sandbox",
    PAYPAL_CLIENT_ID: "test-paypal-client-id",
    PAYPAL_CLIENT_SECRET: TEST_SECRETS.paypalClientSecret,
    PAYPAL_WEBHOOK_ID: "test-webhook-id",
    ADMIN_PASSWORD: TEST_SECRETS.adminPassword,
    ADMIN_SESSION_SECRET: TEST_SECRETS.adminSessionSecret,
    WHATSAPP_ACCESS_TOKEN: "test-whatsapp-token",
    WHATSAPP_PHONE_NUMBER_ID: "1234567890",
    WHATSAPP_TEMPLATE_NAME: "voucher_delivery",
  });

  const fakes = createFakeApis();
  vi.stubGlobal("fetch", fakes.fetch);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  const { default: app } = await import("../api/index.js");
  // The first request creates the app's collections and indexes.
  await request(app).get("/api/admin/session").expect(200);

  const client = await MongoClient.connect(uri);
  const db = client.db(DATABASE);
  const collections = {
    vouchers: db.collection(COLLECTION),
    pendingOrders: db.collection(`${COLLECTION}_pending_orders`),
    logs: db.collection(`${COLLECTION}_logs`),
  };

  async function stop() {
    await client.close();
    await mongo.stop();
  }

  return { app, fakes: fakes.state, collections, stop };
}

/** A random client IP, so rate limits never carry over between tests. */
export function randomIp() {
  return `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
}

/** supertest request from a fresh client IP (Vercel mode trusts one proxy). */
export function call(app, method, path, ip = randomIp()) {
  return request(app)[method](path).set("X-Forwarded-For", ip);
}

export function hashPurchase(purchase) {
  return createHash("sha256")
    .update(JSON.stringify([purchase.name, purchase.phone, purchase.email]))
    .digest("hex");
}

/** Signs an order token the same way the server does. */
export function signOrderToken(claims) {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", TEST_SECRETS.paypalClientSecret)
    .update(`voucher-order:${payload}`)
    .digest("base64url");
  return `${payload}.${signature}`;
}

/** Builds an admin session cookie the same way the server does. */
export function signAdminCookie(expiresAt) {
  const payload = Buffer.from(JSON.stringify({ expiresAt })).toString(
    "base64url",
  );
  const signature = createHmac("sha256", TEST_SECRETS.adminSessionSecret)
    .update(payload)
    .digest("base64url");
  return `gratzia_admin=${encodeURIComponent(`${payload}.${signature}`)}`;
}

export function downloadTokenFor(voucher) {
  return createHmac("sha256", TEST_SECRETS.adminSessionSecret)
    .update(`voucher-pdf:${voucher.paypalOrderId}:${voucher.voucherCode}`)
    .digest("base64url");
}

let voucherCounter = 0;

/** Inserts a voucher straight into the database. */
export async function insertVoucher(collections, overrides = {}) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  voucherCounter += 1;
  const code = Array.from(
    { length: 6 },
    (_, i) => chars[(voucherCounter * 7 + i * 13 + randomInt(32)) % 32],
  ).join("");
  const voucher = {
    paypalOrderId: `TEST-${voucherCounter}-${randomInt(1e9)}`,
    voucherCode: `GRZ-${code}`,
    ...PURCHASE,
    amount: 300,
    currency: "ILS",
    status: "paid",
    createdAt: new Date(),
    ...overrides,
  };
  await collections.vouchers.insertOne(voucher);
  return voucher;
}
