import assert from "node:assert/strict";
import test from "node:test";

import { loadSettings } from "../src/config.js";
import { buildContainer } from "../src/container.js";
import { buildServer } from "../src/server.js";

async function fixture(context: test.TestContext) {
  const container = await buildContainer(loadSettings({ APP_ENV: "test", AI_MODE: "local", AUTH_MODE: "local", PERSISTENCE_MODE: "memory", RATE_LIMIT_ENABLED: "false" }));
  await container.products.upsert({ id: "iphone-17-pro-max-256gb-deep-blue", name: "iPhone 17 Pro Max", variant: "256GB · Deep Blue", unit_price: 48_900, currency: "THB", image_url: "/products/iphone-17-pro-max-deep-blue-full.webp", source_url: "https://www.apple.com/th-en/shop/buy-iphone/iphone-17-pro/6.9-inch-display-256gb-deep-blue", active: true }, "*");
  const app = await buildServer(container);
  context.after(async () => { await app.close(); await container.close(); });
  return app;
}

test("health, OpenAPI and current principal are available", async (context) => {
  const app = await fixture(context);
  assert.equal((await app.inject({ method: "GET", url: "/health/live" })).statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: "/openapi.json" })).statusCode, 200);
  const me = await app.inject({ method: "GET", url: "/api/v1/me", headers: { "x-tenant-id": "tenant-a" } });
  assert.equal(me.json().tenant_id, "tenant-a");
  const catalog = await app.inject({ method: "GET", url: "/api/v1/products" });
  assert.equal(catalog.statusCode, 200);
  assert.equal(catalog.json().items[0].unit_price, 48_900);
});

test("ticket intake is idempotent and queue joins workflow runs", async (context) => {
  const app = await fixture(context);
  const body = { message: "Where is order ORD-1001?", order_id: "ORD-1001", customer: "Nora", locale: "en", channel: "web", idempotency_key: "ticket-key-001" };
  const first = await app.inject({ method: "POST", url: "/api/v1/tickets", payload: body });
  const retry = await app.inject({ method: "POST", url: "/api/v1/tickets", payload: body });
  assert.equal(first.statusCode, 201);
  assert.equal(first.json().ticket.id, retry.json().ticket.id);
  const queue = await app.inject({ method: "GET", url: "/api/v1/ticket-queue" });
  assert.equal(queue.json().total, 1);
  assert.ok(queue.json().items[0].run);
});

test("invalid payloads fail with structured 422", async (context) => {
  const app = await fixture(context);
  const result = await app.inject({ method: "POST", url: "/api/v1/tickets", payload: { message: "x" } });
  assert.equal(result.statusCode, 422);
  assert.equal(result.json().code, "VALIDATION_ERROR");
});

test("ticket mutations create tenant-scoped audit events with request correlation", async (context) => {
  const app = await fixture(context);
  const created = await app.inject({
    method: "POST", url: "/api/v1/tickets",
    headers: { "x-tenant-id": "tenant-a", "x-request-id": "request-audit-001" },
    payload: { message: "Please check order ORD-1001", customer: "Private customer", locale: "en", channel: "web", idempotency_key: "audit-ticket-001" },
  });
  assert.equal(created.statusCode, 201);

  const audit = await app.inject({ method: "GET", url: "/api/v1/audit-events?limit=10", headers: { "x-tenant-id": "tenant-a" } });
  assert.equal(audit.statusCode, 200);
  assert.equal(audit.json().items[0].action, "ticket.created");
  assert.equal(audit.json().items[0].request_id, "request-audit-001");
  assert.equal(JSON.stringify(audit.json()).includes("Private customer"), false);

  const otherTenant = await app.inject({ method: "GET", url: "/api/v1/audit-events", headers: { "x-tenant-id": "tenant-b" } });
  assert.equal(otherTenant.json().items.length, 0);
});

test("queue supports structured filters and ticket assignment updates are audited", async (context) => {
  const app = await fixture(context);
  const created = await app.inject({ method: "POST", url: "/api/v1/tickets", headers: { "x-tenant-id": "tenant-a" }, payload: { message: "Refund order ORD-2002", subject: "Duplicate charge", customer: "Ari", customer_id: "ari@example.com", order_id: "ORD-2002", locale: "en", channel: "email", idempotency_key: "queue-filter-001" } });
  const ticket = created.json().ticket;
  const filtered = await app.inject({ method: "GET", url: "/api/v1/ticket-queue?number=ORD-2002&channel=email&priority=high&sort=priority", headers: { "x-tenant-id": "tenant-a" } });
  assert.equal(filtered.statusCode, 200);
  assert.equal(filtered.json().items[0].ticket.id, ticket.id);
  const updated = await app.inject({ method: "PATCH", url: `/api/v1/tickets/${ticket.id}`, headers: { "x-tenant-id": "tenant-a" }, payload: { status: "investigating", assigned_team: "Billing & Refunds" } });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().assigned_team, "Billing & Refunds");
  const audit = await app.inject({ method: "GET", url: "/api/v1/audit-events?action=ticket.updated", headers: { "x-tenant-id": "tenant-a" } });
  assert.equal(audit.json().items[0].resource_id, ticket.id);
});

test("customer accounts isolate tickets and protect unlinked order tracking", async (context) => {
  const app = await fixture(context);
  const registered = await app.inject({ method: "POST", url: "/api/v1/customer/register", headers: { "x-tenant-id": "tenant-a" }, payload: { name: "Nora", email: "nora@example.com", phone: "+66812345678", password: "a-secure-password" } });
  assert.equal(registered.statusCode, 201);
  const customer = registered.json();
  const login = await app.inject({ method: "POST", url: "/api/v1/customer/login", headers: { "x-tenant-id": "tenant-a" }, payload: { email: "nora@example.com", password: "a-secure-password" } });
  assert.equal(login.statusCode, 200);
  const actor = { "x-tenant-id": "tenant-a", "x-actor-id": customer.id };
  const ticket = await app.inject({ method: "POST", url: "/api/v1/tickets", headers: actor, payload: { message: "Where is order ORD-1001?", customer: "Nora", customer_id: "spoofed", order_id: "ORD-1001", locale: "en", channel: "web", idempotency_key: "customer-ticket-001" } });
  assert.equal(ticket.statusCode, 201);
  assert.equal(ticket.json().ticket.customer_id, customer.id);
  const forbidden = await app.inject({ method: "GET", url: "/api/v1/customer/orders/ORD-1002", headers: actor });
  assert.equal(forbidden.statusCode, 403);
});

test("purchase request prices on the server, creates an order, and joins the AI queue", async (context) => {
  const app = await fixture(context);
  const registered = await app.inject({ method: "POST", url: "/api/v1/customer/register", headers: { "x-tenant-id": "tenant-orders" }, payload: { name: "Buyer", email: "buyer@example.com", phone: "+66812345679", password: "a-secure-password" } });
  const customer = registered.json();
  const actor = { "x-tenant-id": "tenant-orders", "x-actor-id": customer.id };
  const response = await app.inject({ method: "POST", url: "/api/v1/customer/orders", headers: actor, payload: { locale: "en", items: [{ product_id: "iphone-17-pro-max-256gb-deep-blue", quantity: 2 }], idempotency_key: "purchase-key-001" } });
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().order.subtotal, 97_800);
  assert.equal(response.json().order.status, "pending_review");
  assert.equal(response.json().ticket.amount, "THB 97,800");
  assert.equal(response.json().run.classification.category, "purchase");
  const retry = await app.inject({ method: "POST", url: "/api/v1/customer/orders", headers: actor, payload: { locale: "en", items: [{ product_id: "iphone-17-pro-max-256gb-deep-blue", quantity: 20 }], idempotency_key: "purchase-key-001" } });
  assert.equal(retry.statusCode, 201);
  assert.equal(retry.json().replay, true);
  const order = await app.inject({ method: "GET", url: `/api/v1/customer/orders/${response.json().order.id}`, headers: actor });
  assert.equal(order.json().status, "pending_review");
});
