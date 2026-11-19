import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  call,
  hashPurchase,
  PURCHASE,
  signOrderToken,
  startTestApp,
} from "./setup.js";

let app;
let fakes;
let collections;
let stop;

beforeAll(async () => {
  ({ app, fakes, collections, stop } = await startTestApp());
});

afterAll(async () => {
  await stop?.();
});

beforeEach(async () => {
  fakes.reset();
  await collections.vouchers.deleteMany({});
  await collections.pendingOrders.deleteMany({});
  await collections.logs.deleteMany({});
});

async function createOrder(amount = 250, purchase = PURCHASE) {
  const response = await call(app, "post", "/api/paypal/orders")
    .send({ amount, purchase })
    .expect(201);
  return response.body;
}

function capture(orderId, verificationToken, purchase = PURCHASE) {
  return call(app, "post", `/api/paypal/orders/${orderId}/capture`).send({
    verificationToken,
    purchase,
  });
}

function sendWebhook(orderId, eventType = "CHECKOUT.ORDER.APPROVED") {
  const resource =
    eventType === "PAYMENT.CAPTURE.COMPLETED"
      ? { supplementary_data: { related_ids: { order_id: orderId } } }
      : { id: orderId };
  return call(app, "post", "/api/webhooks/paypal").send({
    event_type: eventType,
    resource,
  });
}

describe("checkout", () => {
  it("issues one voucher and sends it on WhatsApp after a completed payment", async () => {
    const order = await createOrder(250);
    fakes.approve(order.id);

    const response = await capture(order.id, order.verificationToken).expect(200);

    expect(response.body).toMatchObject({
      status: "COMPLETED",
      amount: 250,
      currency: "ILS",
      voucher: { amount: 250, email: PURCHASE.email },
    });
    expect(response.body.voucher.voucherCode).toMatch(/^GRZ-[A-HJ-NP-Z2-9]{6}$/);
    expect(response.body.voucher.downloadToken).toEqual(expect.any(String));

    const vouchers = await collections.vouchers.find().toArray();
    expect(vouchers).toHaveLength(1);
    expect(vouchers[0]).toMatchObject({
      paypalOrderId: order.id,
      amount: 250,
      status: "paid",
      whatsapp: { status: "sent" },
    });
    expect(await collections.pendingOrders.countDocuments()).toBe(0);

    expect(fakes.whatsapp.sentMessages).toHaveLength(1);
    expect(fakes.whatsapp.sentMessages[0].to).toBe("972501234567");
  });

  it("rejects invalid amounts when creating an order", async () => {
    for (const amount of [50, 125, 20000, "250", -100]) {
      await call(app, "post", "/api/paypal/orders")
        .send({ amount, purchase: PURCHASE })
        .expect(400);
    }
    expect(fakes.paypal.orders.size).toBe(0);
  });

  it("issues no voucher when PayPal captured a different amount than ordered", async () => {
    const order = await createOrder(500);
    fakes.approve(order.id, { capturedValue: "100.00" });

    await capture(order.id, order.verificationToken).expect(503);

    expect(await collections.vouchers.countDocuments()).toBe(0);
    expect(fakes.whatsapp.sentMessages).toHaveLength(0);
  });

  it("issues no voucher while PayPal holds the capture as PENDING, and logs why", async () => {
    const order = await createOrder(250);
    fakes.approve(order.id, { captureStatus: "PENDING" });

    await capture(order.id, order.verificationToken).expect(503);

    expect(await collections.vouchers.countDocuments()).toBe(0);
    // The pending order is kept so the webhook can still fulfil it later.
    expect(await collections.pendingOrders.countDocuments()).toBe(1);
    const log = await collections.logs.findOne({
      event: "paypal.capture",
      outcome: "failure",
    });
    expect(log).toMatchObject({
      orderId: order.id,
      reason: "capture_not_completed",
      captureStatus: "PENDING",
    });
  });

  it("issues no voucher for an order the buyer has not approved", async () => {
    const order = await createOrder(250);

    await capture(order.id, order.verificationToken).expect(503);

    expect(await collections.vouchers.countDocuments()).toBe(0);
  });
});

describe("order verification token", () => {
  it("rejects a capture whose buyer details differ from the signed order", async () => {
    const order = await createOrder(250);
    fakes.approve(order.id);

    await capture(order.id, order.verificationToken, {
      ...PURCHASE,
      email: "attacker@example.com",
    }).expect(503);

    expect(await collections.vouchers.countDocuments()).toBe(0);
  });

  it("rejects a token with a tampered amount", async () => {
    const order = await createOrder(250);
    fakes.approve(order.id);
    const [payload, signature] = order.verificationToken.split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    const tamperedPayload = Buffer.from(
      JSON.stringify({ ...claims, amountCents: 10000 }),
    ).toString("base64url");

    await capture(order.id, `${tamperedPayload}.${signature}`).expect(503);

    expect(await collections.vouchers.countDocuments()).toBe(0);
  });

  it("rejects a token issued for a different order", async () => {
    const first = await createOrder(250);
    const second = await createOrder(250);
    fakes.approve(second.id);

    await capture(second.id, first.verificationToken).expect(503);

    expect(await collections.vouchers.countDocuments()).toBe(0);
  });

  it("rejects an expired token", async () => {
    const order = await createOrder(250);
    fakes.approve(order.id);
    const expiredToken = signOrderToken({
      orderId: order.id,
      amountCents: 25000,
      purchaseHash: hashPurchase(PURCHASE),
      expiresAt: Date.now() - 1000,
    });

    await capture(order.id, expiredToken).expect(503);

    expect(await collections.vouchers.countDocuments()).toBe(0);
  });
});

describe("PayPal webhook", () => {
  it("issues the voucher when the buyer closed the page before capture", async () => {
    const order = await createOrder(300);
    fakes.approve(order.id);

    await sendWebhook(order.id).expect(200);

    const vouchers = await collections.vouchers.find().toArray();
    expect(vouchers).toHaveLength(1);
    expect(vouchers[0]).toMatchObject({ paypalOrderId: order.id, amount: 300 });
    expect(await collections.pendingOrders.countDocuments()).toBe(0);
    expect(fakes.whatsapp.sentMessages).toHaveLength(1);
  });

  it("handles PAYMENT.CAPTURE.COMPLETED events for the same order", async () => {
    const order = await createOrder(300);
    fakes.approve(order.id);

    await sendWebhook(order.id, "PAYMENT.CAPTURE.COMPLETED").expect(200);

    expect(await collections.vouchers.countDocuments()).toBe(1);
  });

  it("rejects a webhook whose signature PayPal does not verify", async () => {
    const order = await createOrder(300);
    fakes.approve(order.id);
    fakes.paypal.webhookSignatureValid = false;

    await sendWebhook(order.id).expect(400);

    expect(await collections.vouchers.countDocuments()).toBe(0);
    expect(fakes.paypal.orders.get(order.id).status).toBe("APPROVED");
  });

  it("issues exactly one voucher and one WhatsApp message when the browser and webhook race", async () => {
    const order = await createOrder(400);
    fakes.approve(order.id);

    const [browser, webhook] = await Promise.all([
      capture(order.id, order.verificationToken),
      sendWebhook(order.id),
    ]);

    expect(browser.status).toBe(200);
    expect(webhook.status).toBe(200);
    const vouchers = await collections.vouchers.find().toArray();
    expect(vouchers).toHaveLength(1);
    expect(browser.body.voucher.voucherCode).toBe(vouchers[0].voucherCode);
    expect(fakes.whatsapp.sentMessages).toHaveLength(1);
  });

  it("does not issue a second voucher when the webhook arrives after the browser capture", async () => {
    const order = await createOrder(400);
    fakes.approve(order.id);
    await capture(order.id, order.verificationToken).expect(200);

    await sendWebhook(order.id).expect(200);
    await sendWebhook(order.id, "PAYMENT.CAPTURE.COMPLETED").expect(200);

    expect(await collections.vouchers.countDocuments()).toBe(1);
    expect(fakes.whatsapp.sentMessages).toHaveLength(1);
  });
});
