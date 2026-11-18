import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  call,
  downloadTokenFor,
  insertVoucher,
  randomIp,
  signAdminCookie,
  startTestApp,
  TEST_SECRETS,
} from "./setup.js";

let app;
let fakes;
let collections;
let stop;
let adminCookie;

const TWO_YEARS_AGO = () => new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000);

beforeAll(async () => {
  ({ app, fakes, collections, stop } = await startTestApp());
  const login = await call(app, "post", "/api/admin/login")
    .send({ password: TEST_SECRETS.adminPassword })
    .expect(200);
  adminCookie = login.headers["set-cookie"][0].split(";")[0];
});

afterAll(async () => {
  await stop?.();
});

beforeEach(async () => {
  fakes.reset();
  await collections.vouchers.deleteMany({});
});

function downloadPdf(voucherCode, token) {
  const request = call(app, "get", `/api/vouchers/${voucherCode}/pdf`);
  return token ? request.set("Authorization", `Bearer ${token}`) : request;
}

describe("customer voucher PDF download", () => {
  it("returns the PDF with the voucher's download token", async () => {
    const voucher = await insertVoucher(collections);

    const response = await downloadPdf(
      voucher.voucherCode,
      downloadTokenFor(voucher),
    ).expect(200);

    expect(response.headers["content-type"]).toBe("application/pdf");
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.body.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("returns 404 without a token or with a wrong token", async () => {
    const voucher = await insertVoucher(collections);

    await downloadPdf(voucher.voucherCode).expect(404);
    await downloadPdf(voucher.voucherCode, "A".repeat(43)).expect(404);
  });

  it("returns 404 when using another voucher's token", async () => {
    const mine = await insertVoucher(collections);
    const other = await insertVoucher(collections);

    await downloadPdf(other.voucherCode, downloadTokenFor(mine)).expect(404);
  });

  it("returns 404 for redeemed and expired vouchers, even with a valid token", async () => {
    const redeemed = await insertVoucher(collections, { status: "redeemed" });
    const expired = await insertVoucher(collections, {
      createdAt: TWO_YEARS_AGO(),
    });

    await downloadPdf(redeemed.voucherCode, downloadTokenFor(redeemed)).expect(404);
    await downloadPdf(expired.voucherCode, downloadTokenFor(expired)).expect(404);
  });

  it("returns 400 for a malformed voucher code", async () => {
    await downloadPdf("not-a-code", "A".repeat(43)).expect(400);
  });
});

describe("admin authentication", () => {
  const adminEndpoints = [
    ["get", "/api/admin/vouchers?q="],
    ["post", "/api/admin/vouchers"],
    ["patch", "/api/admin/vouchers/GRZ-ABCDEF/redeem"],
    ["get", "/api/admin/vouchers/GRZ-ABCDEF/pdf"],
    ["post", "/api/admin/vouchers/GRZ-ABCDEF/whatsapp"],
  ];

  it.each(adminEndpoints)("%s %s requires a session", async (method, path) => {
    await call(app, method, path).expect(401);
  });

  it.each(adminEndpoints)(
    "%s %s rejects forged and expired session cookies",
    async (method, path) => {
      const forged = `gratzia_admin=${encodeURIComponent(
        `${Buffer.from(JSON.stringify({ expiresAt: Date.now() + 3600000 })).toString("base64url")}.forged-signature`,
      )}`;
      const expired = signAdminCookie(Date.now() - 1000);

      await call(app, method, path).set("Cookie", forged).expect(401);
      await call(app, method, path).set("Cookie", expired).expect(401);
    },
  );

  it("accepts a valid session", async () => {
    await call(app, "get", "/api/admin/vouchers?q=")
      .set("Cookie", adminCookie)
      .expect(200);
  });

  it("rejects a wrong password and sets an HttpOnly cookie on success", async () => {
    await call(app, "post", "/api/admin/login")
      .send({ password: "wrong-password-0000000" })
      .expect(401);

    const response = await call(app, "post", "/api/admin/login")
      .send({ password: TEST_SECRETS.adminPassword })
      .expect(200);
    const cookie = response.headers["set-cookie"][0];
    expect(cookie).toMatch(/^gratzia_admin=/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
  });

  it("rate-limits repeated login attempts from the same IP", async () => {
    const ip = randomIp();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await call(app, "post", "/api/admin/login", ip)
        .send({ password: "wrong-password-0000000" })
        .expect(401);
    }

    // Even the correct password is refused once the limit is reached.
    await call(app, "post", "/api/admin/login", ip)
      .send({ password: TEST_SECRETS.adminPassword })
      .expect(429);
  });
});

describe("voucher redemption", () => {
  function redeem(voucherCode) {
    return call(app, "patch", `/api/admin/vouchers/${voucherCode}/redeem`).set(
      "Cookie",
      adminCookie,
    );
  }

  it("redeems a valid voucher once", async () => {
    const voucher = await insertVoucher(collections);

    const response = await redeem(voucher.voucherCode).expect(200);
    expect(response.body.voucher.status).toBe("redeemed");
    expect(response.body.voucher.redeemedAt).toEqual(expect.any(String));

    await redeem(voucher.voucherCode).expect(409);
  });

  it("lets only one of many simultaneous redemptions succeed", async () => {
    const voucher = await insertVoucher(collections);

    // Enough parallel requests that their database calls interleave.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => redeem(voucher.voucherCode)),
    );

    const statuses = results.map((result) => result.status);
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(9);
    const stored = await collections.vouchers.findOne({
      voucherCode: voucher.voucherCode,
    });
    expect(stored.status).toBe("redeemed");
  });

  it("refuses expired vouchers with 410 and unknown codes with 404", async () => {
    const expired = await insertVoucher(collections, {
      createdAt: TWO_YEARS_AGO(),
    });

    await redeem(expired.voucherCode).expect(410);
    await redeem("GRZ-ZZZZZZ").expect(404);

    const stored = await collections.vouchers.findOne({
      voucherCode: expired.voucherCode,
    });
    expect(stored.status).toBe("paid");
  });
});
