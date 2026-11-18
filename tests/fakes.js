// In-memory stand-ins for the PayPal and Meta (WhatsApp) HTTP APIs, installed
// as the global fetch. Tests control the behaviour through the returned state.

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function createFakeApis() {
  const state = {
    paypal: {
      orders: new Map(),
      nextId: 1,
      webhookSignatureValid: true,
    },
    whatsapp: {
      sentMessages: [],
      uploads: 0,
    },
    reset() {
      this.paypal.orders.clear();
      this.paypal.webhookSignatureValid = true;
      this.whatsapp.sentMessages = [];
      this.whatsapp.uploads = 0;
    },
    /** Simulates the buyer approving the order in the PayPal popup. */
    approve(orderId, { capturedValue, captureStatus = "COMPLETED" } = {}) {
      const order = this.paypal.orders.get(orderId);
      order.status = "APPROVED";
      order.capturedValue = capturedValue ?? order.value;
      order.captureStatus = captureStatus;
    },
  };

  function serializeOrder(order) {
    return {
      id: order.id,
      intent: "CAPTURE",
      status: order.status,
      purchase_units: [
        {
          amount: { currency_code: "ILS", value: order.value },
          ...(order.status === "COMPLETED" && {
            payments: {
              captures: [
                {
                  status: order.captureStatus,
                  amount: { currency_code: "ILS", value: order.capturedValue },
                },
              ],
            },
          }),
        },
      ],
    };
  }

  async function fetch(input, init = {}) {
    const url = new URL(typeof input === "string" ? input : input.url);
    const method = init.method ?? "GET";
    const { pathname } = url;

    if (url.hostname === "api-m.sandbox.paypal.com") {
      if (pathname === "/v1/oauth2/token") {
        return json({ access_token: "fake-paypal-token" });
      }
      if (pathname === "/v1/notifications/verify-webhook-signature") {
        return json({
          verification_status: state.paypal.webhookSignatureValid
            ? "SUCCESS"
            : "FAILURE",
        });
      }
      if (pathname === "/v2/checkout/orders" && method === "POST") {
        const body = JSON.parse(init.body);
        const id = `FAKEORDER${state.paypal.nextId++}`;
        state.paypal.orders.set(id, {
          id,
          status: "CREATED",
          value: body.purchase_units[0].amount.value,
        });
        return json({ id, status: "CREATED" }, 201);
      }
      const match = pathname.match(/^\/v2\/checkout\/orders\/([^/]+)(\/capture)?$/);
      if (match) {
        const order = state.paypal.orders.get(decodeURIComponent(match[1]));
        if (!order) return json({ name: "RESOURCE_NOT_FOUND" }, 404);
        if (match[2]) {
          // Idempotent like PayPal with a PayPal-Request-Id header.
          if (order.status === "APPROVED") order.status = "COMPLETED";
          else if (order.status !== "COMPLETED") {
            return json({ name: "UNPROCESSABLE_ENTITY" }, 422);
          }
        }
        return json(serializeOrder(order));
      }
    }

    if (url.hostname === "graph.facebook.com") {
      if (pathname.endsWith("/media")) {
        state.whatsapp.uploads += 1;
        return json({ id: `media-${state.whatsapp.uploads}` });
      }
      if (pathname.endsWith("/messages")) {
        const body = JSON.parse(init.body);
        state.whatsapp.sentMessages.push(body);
        return json({
          messages: [{ id: `wamid.${state.whatsapp.sentMessages.length}` }],
        });
      }
    }

    throw new Error(`Unexpected fetch in test: ${method} ${url}`);
  }

  return { state, fetch };
}
