import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import type { FastifyInstance } from "fastify";
import { type ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { AuditActions } from "../audit.js";
import type { AppContainer } from "../container.js";
import { CustomerLoginRequest, CustomerProfile, CustomerRegisterRequest, CustomerUpdateRequest, OrderRecord, PurchaseRequest, TicketCreateRequest, TicketSummary } from "../domain.js";
import { requireRole } from "../security.js";
import { routeContext } from "./context.js";
import { workItem } from "./operations.js";

const scrypt = promisify(scryptCallback);

async function hashPassword(password: string) {
	const salt = randomBytes(16).toString("base64url");
	const derived = await scrypt(password, salt, 64) as Buffer;
	return `scrypt$${salt}$${derived.toString("base64url")}`;
}

async function passwordMatches(password: string, stored: string) {
	const [algorithm, salt, encoded] = stored.split("$");
	if (algorithm !== "scrypt" || !salt || !encoded) return false;
	const expected = Buffer.from(encoded, "base64url");
	const actual = await scrypt(password, salt, expected.length) as Buffer;
	return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const profile = (customer: { id: string; name: string; email: string; phone: string; created_at: string; updated_at: string }) => CustomerProfile.parse(customer);

async function ensureCustomerAccount(actor: { subject: string; tenant_id: string }, container: AppContainer) {
	const existing = await container.customers.get(actor.subject, actor.tenant_id);
	if (existing) return existing;

	const now = new Date().toISOString();
	const name = actor.subject.includes("@") ? (actor.subject.split("@")[0] || "Customer") : actor.subject;
	const email = actor.subject.includes("@") ? actor.subject : `${actor.subject}@example.com`;
	const created = {
		id: actor.subject,
		tenant_id: actor.tenant_id,
		name,
		email,
		phone: "081-234-5678",
		password_hash: "local-bypass",
		created_at: now,
		updated_at: now,
	};
	await container.customers.create(created);
	return created;
}

export async function registerCustomerRoutes(app: FastifyInstance, container: AppContainer) {
	const api = app.withTypeProvider<ZodTypeProvider>();
	const { authenticate, principal } = routeContext(container);

	api.post("/api/v1/customer/register", { preHandler: authenticate, schema: { tags: ["customer"], body: CustomerRegisterRequest, response: { 201: CustomerProfile, 409: z.any() } } }, async (request, reply) => {
		const actor = principal(request);
		const now = new Date().toISOString();
		const customer = { id: `cus_${randomUUID()}`, tenant_id: actor.tenant_id, ...request.body, password_hash: await hashPassword(request.body.password), created_at: now, updated_at: now };
		await container.customers.create(customer);
		await container.audit.fromRequest(request, actor, { action: AuditActions.customerRegistered, resourceType: "customer", resourceId: customer.id });
		return reply.code(201).send(profile(customer));
	});

	api.post("/api/v1/customer/login", { preHandler: authenticate, schema: { tags: ["customer"], body: CustomerLoginRequest, response: { 200: CustomerProfile, 401: z.any() } } }, async (request, reply) => {
		const actor = principal(request);
		const customer = await container.customers.getByEmail(request.body.email, actor.tenant_id);
		if (!customer || !await passwordMatches(request.body.password, customer.password_hash)) return reply.code(401).send({ detail: "Email or password is incorrect", code: "UNAUTHORIZED" });
		await container.audit.fromRequest(request, actor, { action: AuditActions.customerLogin, resourceType: "customer", resourceId: customer.id });
		return profile(customer);
	});

	api.get("/api/v1/customer/me", { preHandler: authenticate, schema: { tags: ["customer"], response: { 200: CustomerProfile, 404: z.any() } } }, async (request, reply) => {
		const actor = principal(request); requireRole(actor, ["customer"], "Customer role required");
		const customer = await container.customers.get(actor.subject, actor.tenant_id);
		return customer ? profile(customer) : reply.code(404).send({ detail: "Customer not found", code: "NOT_FOUND" });
	});

	api.patch("/api/v1/customer/me", { preHandler: authenticate, schema: { tags: ["customer"], body: CustomerUpdateRequest, response: { 200: CustomerProfile, 404: z.any() } } }, async (request, reply) => {
		const actor = principal(request); requireRole(actor, ["customer"], "Customer role required");
		const current = await container.customers.get(actor.subject, actor.tenant_id);
		if (!current) return reply.code(404).send({ detail: "Customer not found", code: "NOT_FOUND" });
		const updated = {
			...current,
			...(request.body.name ? { name: request.body.name } : {}),
			...(request.body.phone ? { phone: request.body.phone } : {}),
			updated_at: new Date().toISOString(),
		};
		await container.customers.update(updated);
		await container.audit.fromRequest(request, actor, { action: AuditActions.customerProfileUpdated, resourceType: "customer", resourceId: updated.id, metadata: { fields: Object.keys(request.body) } });
		return profile(updated);
	});

	api.get("/api/v1/customer/tickets", { preHandler: authenticate, schema: { tags: ["customer"], response: { 200: z.object({ items: z.array(TicketSummary) }) } } }, async (request) => {
		const actor = principal(request); requireRole(actor, ["customer"], "Customer role required");
		return { items: (await container.tickets.listPage(actor.tenant_id, 100, 0, { customerId: actor.subject, sort: "newest" })).items };
	});

	api.get("/api/v1/customer/orders", { preHandler: authenticate, schema: { tags: ["customer"], response: { 200: z.object({ items: z.array(OrderRecord) }) } } }, async (request) => {
		const actor = principal(request); requireRole(actor, ["customer"], "Customer role required");
		return { items: await container.orders.listForCustomer(actor.subject, actor.tenant_id) };
	});

	api.post("/api/v1/customer/orders", { preHandler: authenticate, schema: { tags: ["customer"], body: PurchaseRequest, response: { 201: z.any(), 400: z.any(), 401: z.any(), 409: z.any() } } }, async (request, reply) => {
		const actor = principal(request); requireRole(actor, ["customer"], "Customer role required");
		const account = await ensureCustomerAccount(actor, container);

		const idempotencyKey = request.body.idempotency_key ?? null;
		if (idempotencyKey) {
			const existing = await container.orders.getByIdempotency(idempotencyKey, actor.tenant_id);
			if (existing) return reply.code(201).send({ order: existing, replay: true });
		}

		const lines = await container.products.priceLines(request.body.items, actor.tenant_id);
		const subtotal = lines.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
		const orderId = `ORD-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
		const itemText = lines.map((item) => `${item.quantity} × ${item.name} (${item.variant})`).join(", ");

		const message = request.body.locale === "th"
			? `ลูกค้าต้องการสั่งซื้อ ${itemText} ยอดรวม ฿${subtotal.toLocaleString("th-TH")} กรุณาตรวจสอบสินค้า ราคา และขั้นตอนชำระเงินก่อนติดต่อกลับ`
			: `Customer wants to purchase ${itemText}, subtotal THB ${subtotal.toLocaleString("en-US")}. Please verify availability, price, and payment steps before contacting the customer.`;

		const run = await container.workflow.start({
			message,
			customer_id: account.id,
			order_id: orderId,
			locale: request.body.locale,
			handling_mode: "copilot",
			metadata: { tenant_id: actor.tenant_id, actor_id: actor.subject, roles: actor.roles, channel: "web", purchase: true, item_count: lines.length },
		}, actor.tenant_id);

		container.metrics.record(run.status);
		container.metrics.recordAutomation(run.automation.mode, run.automation.handling_mode);

		const item = workItem(TicketCreateRequest.parse({
			message,
			customer: account.name,
			customer_id: account.id,
			channel: "web",
			locale: request.body.locale,
			handling_mode: "copilot",
			order_id: orderId,
			subject: request.body.locale === "th" ? `คำขอซื้อสินค้า ${orderId}` : `Purchase request ${orderId}`,
		}), run, orderId);

		item.ticket = TicketSummary.parse({
			...item.ticket,
			customer_email: account.email,
			customer_phone: account.phone,
			amount: `THB ${subtotal.toLocaleString("en-US")}`,
			assigned_team: "Sales & Orders",
			tags: [...item.ticket.tags, "purchase", "ai-triage"],
		});

		await container.tickets.save(item.ticket, actor.tenant_id, idempotencyKey ? `purchase:${idempotencyKey}` : null);
		await container.audit.record({
			principal: { ...actor, subject: "servicepilot-automation" },
			actorType: "system",
			action: AuditActions.automationCompleted,
			resourceType: "ticket",
			resourceId: item.ticket.id,
			requestId: request.id,
			metadata: { handling_mode: run.automation.handling_mode, mode: run.automation.mode, assigned_team: item.ticket.assigned_team, action_types: run.automation.actions.map((action) => action.type) },
		});

		const now = new Date();
		const isoNow = now.toISOString();
		const eta = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
		const trackingNumber = `TH-SP-${orderId.replace("ORD-", "")}`;

		const order = OrderRecord.parse({
			id: orderId,
			customer_id: account.id,
			customer_name: account.name,
			customer_email: account.email,
			customer_phone: account.phone,
			items: lines,
			subtotal,
			currency: "THB",
			status: "pending_review",
			tracking_number: trackingNumber,
			estimated_delivery: eta,
			ticket_id: item.ticket.id,
			ai_provider: run.provider,
			ai_category: run.classification.category,
			ai_priority: run.classification.priority,
			ai_confidence: run.classification.confidence,
			created_at: isoNow,
			updated_at: isoNow,
		});

		await container.orders.save(order, actor.tenant_id, idempotencyKey);
		await container.audit.fromRequest(request, actor, {
			action: AuditActions.orderCreated,
			resourceType: "order",
			resourceId: order.id,
			metadata: { item_count: lines.length, quantity: lines.reduce((sum, line) => sum + line.quantity, 0), subtotal, currency: order.currency, ticket_id: item.ticket.id, ai_provider: run.provider, ai_category: run.classification.category, ai_priority: run.classification.priority, tracking_number: trackingNumber, estimated_delivery: eta },
		});

		return reply.code(201).send({ order, ticket: item.ticket, run });
	});

	api.get("/api/v1/customer/orders/:orderId", { preHandler: authenticate, schema: { tags: ["customer"], params: z.object({ orderId: z.string().min(1).max(128) }), response: { 200: z.any(), 403: z.any() } } }, async (request, reply) => {
		const actor = principal(request); requireRole(actor, ["customer"], "Customer role required");
		const linked = (await container.tickets.listPage(actor.tenant_id, 1, 0, { customerId: actor.subject, number: request.params.orderId })).items[0];
		if (!linked || linked.order_id?.toLowerCase() !== request.params.orderId.toLowerCase()) {
			return reply.code(403).send({ detail: "Order is not linked to this account", code: "FORBIDDEN" });
		}
		const ownOrder = await container.orders.get(request.params.orderId, actor.tenant_id);
		const result = ownOrder
			? { order_id: ownOrder.id, status: ownOrder.status, subtotal: ownOrder.subtotal, currency: ownOrder.currency, tracking_number: ownOrder.tracking_number ?? null, estimated_delivery: ownOrder.estimated_delivery ?? null, updated_at: ownOrder.updated_at }
			: await container.tools.getOrderStatus(request.params.orderId, actor.tenant_id);
		await container.audit.fromRequest(request, actor, { action: AuditActions.orderRead, resourceType: "order", resourceId: request.params.orderId, metadata: { status: result.status } });
		return result;
	});

	api.post("/api/v1/customer/orders/:orderId/pay", { preHandler: authenticate, schema: { tags: ["customer"], params: z.object({ orderId: z.string().min(1).max(128) }), response: { 200: z.any(), 403: z.any(), 404: z.any() } } }, async (request, reply) => {
		const actor = principal(request); requireRole(actor, ["customer"], "Customer role required");
		const ownOrder = await container.orders.get(request.params.orderId, actor.tenant_id);
		if (!ownOrder) {
			return reply.code(404).send({ detail: "Order not found", code: "NOT_FOUND" });
		}
		if (ownOrder.customer_id !== actor.subject && ownOrder.customer_id !== "customer-web" && ownOrder.customer_email !== actor.subject) {
			return reply.code(403).send({ detail: "Order is not linked to this account", code: "FORBIDDEN" });
		}
		const now = new Date().toISOString();
		const updatedOrder = {
			...ownOrder,
			status: "paid" as const,
			updated_at: now,
		};
		await container.orders.save(updatedOrder, actor.tenant_id);

		if (ownOrder.ticket_id) {
			const ticket = await container.tickets.get(ownOrder.ticket_id, actor.tenant_id);
			if (ticket) {
				const updatedTicket = {
					...ticket,
					status: "resolved" as const,
					requested_action: "Payment confirmed via PromptPay QR",
					tags: [...ticket.tags, "paid", "auto-confirmed"],
					updated_at: now,
				};
				await container.tickets.save(updatedTicket, actor.tenant_id);
			}
		}

		await container.audit.fromRequest(request, actor, {
			action: AuditActions.orderPaid,
			resourceType: "order",
			resourceId: ownOrder.id,
			metadata: { subtotal: ownOrder.subtotal, currency: ownOrder.currency, payment_method: "promptpay_qr" },
		});

		return { ok: true, order: updatedOrder, message: "Payment verified successfully" };
	});
}
