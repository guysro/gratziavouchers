# Gratzia Vouchers

A Hebrew, right-to-left React voucher app with an Express API for PayPal checkout.

## Local development

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and enter your PayPal credentials, MongoDB connection URI, and a unique admin password of at least 16 characters. Keep PayPal in `sandbox` while testing. The app uses the database name in the URI path, or `gratzia_vouchers` if no database name is specified.
3. Run `npm run dev`. This starts the Express API and Vite client; Vite forwards `/api` requests to Express.

The PayPal secret is read only by the Express server. The public client ID is returned to the browser by `/api/paypal/config` for loading the PayPal button SDK. Do not prefix PayPal credentials with `VITE_`.

If Node.js reports `querySrv ECONNREFUSED` for the MongoDB Atlas hostname while other tools can resolve it, uncomment `MONGODB_DNS_SERVERS=1.1.1.1,8.8.8.8` in `.env`. This optional setting changes DNS servers for the Node.js process only.

Local development uses the `vouchers_dev` collection by default. Production uses the existing `vouchers` collection, preserving current production data. Override the names independently with `MONGODB_COLLECTION_DEVELOPMENT` and `MONGODB_COLLECTION_PRODUCTION`. On Vercel, only the Production environment uses the production collection; Preview and Development use the development collection.

## Admin voucher management

Open `/admin` to sign in with `ADMIN_PASSWORD`. Search by customer name, phone, email, or voucher code. Search results are limited to the 50 newest non-expired vouchers. Vouchers expire one year after creation (computed in UTC by `server/voucherExpiry.js`); expired vouchers cannot be redeemed or downloaded. Paid vouchers can be redeemed once; redemption atomically changes their status to `redeemed` and records the time in MongoDB. The admin session uses an HttpOnly, SameSite cookie and expires after eight hours.

## PayPal webhook (paid-order recovery)

When an order is created, its amount and buyer details are stored in the `<collection>_pending_orders` collection (auto-deleted after 7 days). Normally the browser captures the payment and the voucher is issued immediately. If the buyer closes the page after approving, or voucher saving fails, PayPal's webhook lets the server capture the order and issue the voucher anyway; it then appears in the admin search.

To enable it, create a webhook in the PayPal developer dashboard (separately for sandbox and live) pointing to `https://<your-domain>/api/webhooks/paypal`, subscribed to `CHECKOUT.ORDER.APPROVED` and `PAYMENT.CAPTURE.COMPLETED`, and set its ID as `PAYPAL_WEBHOOK_ID`. Note that events sent from PayPal's webhook simulator cannot be signature-verified; test with a real sandbox purchase.

## WhatsApp delivery

After a voucher is issued (browser capture, PayPal webhook, or admin creation), the server sends the voucher PDF to the buyer's phone through the Meta WhatsApp Cloud API. The PDF is uploaded as private WhatsApp media; no public link is created. Sending is skipped entirely when the `WHATSAPP_*` variables are not set.

Setup in Meta Business Manager / the Meta developer app:

1. Create a **System User** with access to the WhatsApp Business Account, and generate a permanent token with `whatsapp_business_messaging` permission. Set it as `WHATSAPP_ACCESS_TOKEN`.
2. Copy the business number's **Phone number ID** (not the phone number itself) into `WHATSAPP_PHONE_NUMBER_ID`.
3. Create and get approval for a **message template** (category Utility) named as in `WHATSAPP_TEMPLATE_NAME`, in language `WHATSAPP_TEMPLATE_LANGUAGE`, with:
   - Header: **Document**
   - Body with exactly two variables: `{{1}}` = customer name, `{{2}}` = voucher code. For example: `שלום {{1}}, תודה על הרכישה! מצורף שובר המתנה שלך, קוד: {{2}}`

Phone numbers starting with `0` get `WHATSAPP_DEFAULT_COUNTRY_CODE` (default `972`); numbers starting with `+` or `00` are used as-is.

The send status is stored on the voucher (`whatsapp.status`: `sent`, `failed`, or `retry`) and shown on the admin page, where a voucher can be sent or resent manually. Sends are deduplicated, so a browser capture and a webhook running at the same time send only one message. If a send fails transiently (network, rate limit, Meta outage), the PayPal webhook responds with an error so PayPal redelivers the event later and the send is retried. Permanent failures (invalid number, template mismatch) are not retried automatically; use the admin page after fixing the cause. `sent` means Meta accepted the message, not that it was delivered.

## Event log

Payments, vouchers, WhatsApp sends and admin actions are logged as structured events, both successes and failures. Each event is printed as a JSON line to the console (Vercel → project → **Logs**) and stored in MongoDB in `<collection>_logs`, where it is deleted automatically after `LOG_RETENTION_DAYS` (default 180).

Each entry has `at`, `event`, `outcome` (`success` / `failure`) and, depending on the event, `orderId`, `voucherCode`, `amount`, `source`/`trigger`, `reason`, `error` and `ip` (the client IP, for security review). Customer names, phone numbers and emails are never logged.

| Event | Logged when |
|---|---|
| `paypal.order.create` | A checkout order is created or rejected |
| `paypal.capture` | A payment is captured (`source`: `browser` or `webhook`) or fails, e.g. `captureStatus: "PENDING"` |
| `paypal.webhook` | A PayPal webhook is received, fulfilled, ignored or rejected |
| `voucher.issue` | A paid voucher is created (once per order) |
| `voucher.pdf.download` | A customer downloads a voucher PDF |
| `whatsapp.send` | A WhatsApp send succeeds or fails (`trigger` shows what started it) |
| `admin.login` / `admin.logout` | Admin sign-in (including wrong passwords) and sign-out |
| `admin.unauthorized` | An admin endpoint is called without a valid session |
| `admin.voucher.create` / `admin.voucher.redeem` / `admin.voucher.pdf.download` / `admin.whatsapp.resend` | Admin actions on vouchers |
| `admin.voucher.search` | Failed searches only; successful searches run on every keystroke and are not logged |
| `server.error` | Any unhandled server error |

To find everything that happened to an order, filter the collection by `orderId` or `voucherCode`, e.g. in MongoDB Atlas → Browse Collections: `{ voucherCode: "GRZ-ABC123" }`.

## Rate limiting

Rate-limit counters are stored in MongoDB (`<collection>_rate_limits`, auto-expiring), so limits are shared across all Vercel function instances. On Vercel the client IP is taken from Vercel's `X-Forwarded-For`; in standalone mode behind a reverse proxy, set `TRUST_PROXY` to the number of proxy hops.

## Deploying to Vercel

The Express API is in `api/` and is exposed through a catch-all Vercel Function. Vercel builds the Vite frontend as static assets; Express handles `/api/*` requests. Add `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENV=live`, `PAYPAL_WEBHOOK_ID`, `MONGODB_URI`, `ADMIN_PASSWORD`, and `ADMIN_SESSION_SECRET` to the Vercel project environment variables. Generate a unique `ADMIN_SESSION_SECRET` with at least 32 random bytes and keep the same value across deployments/environments so admin sessions remain verifiable across function instances. Optionally set `MONGODB_COLLECTION_PRODUCTION` and `MONGODB_COLLECTION_DEVELOPMENT` on Vercel to override the default collection names. Do not set `PORT`; Vercel manages function ports.

The admin session cookie is Secure by default and is sent only over HTTPS. For local HTTP development only, set `NODE_ENV=development`. Vercel provides HTTPS automatically.

## Standalone production

Set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENV=live`, `MONGODB_URI`, `ADMIN_PASSWORD`, `PORT`, and `NODE_ENV=production` in the server environment. Run `npm run build`, then `npm start`; Express serves the built app and handles the API on the same origin. The admin session cookie is Secure by default. Serve production over HTTPS.

The API creates PayPal checkout orders in ILS without saving purchase records before payment. It returns a short-lived server-signed token binding the expected amount and recipient details to the PayPal order. After PayPal confirms the captured amount and currency, the server generates a voucher code and saves the paid voucher in the environment-specific MongoDB collection. A unique index on the PayPal order ID prevents duplicate vouchers if capture is retried.
