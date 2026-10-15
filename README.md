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

Open `/admin` to sign in with `ADMIN_PASSWORD`. Search by customer name, phone, or email. Search results are limited to 50 vouchers. Paid vouchers can be redeemed once; redemption atomically changes their status to `redeemed` and records the time in MongoDB. The admin session uses an HttpOnly, SameSite cookie and expires after eight hours.

## Production

## Deploying to Vercel

The Express API is in `api/` and is exposed through a catch-all Vercel Function. Vercel builds the Vite frontend as static assets; Express handles `/api/*` requests. Add `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENV=live`, `MONGODB_URI`, `ADMIN_PASSWORD`, and `ADMIN_SESSION_SECRET` to the Vercel project environment variables. Generate a unique `ADMIN_SESSION_SECRET` with at least 32 random bytes and keep the same value across deployments/environments so admin sessions remain verifiable across function instances. Optionally set `MONGODB_COLLECTION_PRODUCTION` and `MONGODB_COLLECTION_DEVELOPMENT` on Vercel to override the default collection names. Do not set `PORT`; Vercel manages function ports.

The admin session cookie is Secure by default and is sent only over HTTPS. For local HTTP development only, set `NODE_ENV=development`. Vercel provides HTTPS automatically.

## Standalone production

Set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENV=live`, `MONGODB_URI`, `ADMIN_PASSWORD`, `PORT`, and `NODE_ENV=production` in the server environment. Run `npm run build`, then `npm start`; Express serves the built app and handles the API on the same origin. The admin session cookie is Secure by default. Serve production over HTTPS.

The API creates PayPal checkout orders in ILS without saving purchase records before payment. It returns a short-lived server-signed token binding the expected amount and recipient details to the PayPal order. After PayPal confirms the captured amount and currency, the server generates a voucher code and saves the paid voucher in the environment-specific MongoDB collection. A unique index on the PayPal order ID prevents duplicate vouchers if capture is retried.
