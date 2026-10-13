# Gratzia Vouchers

A Hebrew, right-to-left React voucher app with an Express API for PayPal checkout.

## Local development

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and enter your PayPal credentials, MongoDB connection URI, and a unique admin password of at least 16 characters. Keep PayPal in `sandbox` while testing. The app uses the database name in the URI path, or `gratzia_vouchers` if no database name is specified.
3. Run `npm run dev`. This starts the Express API and Vite client; Vite forwards `/api` requests to Express.

The PayPal secret is read only by the Express server. The public client ID is returned to the browser by `/api/paypal/config` for loading the PayPal button SDK. Do not prefix PayPal credentials with `VITE_`.

If Node.js reports `querySrv ECONNREFUSED` for the MongoDB Atlas hostname while other tools can resolve it, uncomment `MONGODB_DNS_SERVERS=1.1.1.1,8.8.8.8` in `.env`. This optional setting changes DNS servers for the Node.js process only.

## Admin voucher management

Open `/admin` to sign in with `ADMIN_PASSWORD`. Search by customer name, phone, or email. Search results are limited to 50 vouchers. Paid vouchers can be redeemed once; redemption atomically changes their status to `redeemed` and records the time in MongoDB. The admin session uses an HttpOnly, SameSite cookie and expires after eight hours.

## Production

Set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENV=live`, `MONGODB_URI`, `ADMIN_PASSWORD`, and `PORT` in the server environment. Run `npm run build`, then `npm start`; Express serves the built app and handles the API on the same origin. The admin session cookie is Secure by default and is sent only over HTTPS. For local HTTP development only, set `NODE_ENV=development`. Serve production over HTTPS.

The API creates PayPal checkout orders in ILS without saving purchase records before payment. It returns a short-lived server-signed token binding the expected amount and recipient details to the PayPal order. After PayPal confirms the captured amount and currency, the server generates a voucher code and saves the paid voucher in the `vouchers` MongoDB collection. A unique index on the PayPal order ID prevents duplicate vouchers if capture is retried.
