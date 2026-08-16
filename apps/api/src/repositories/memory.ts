import { randomUUID } from "node:crypto";

import type { Embedder } from "../ai.js";
import type { AssistResponse, AuditEvent, AuditPage, AuditQuery, CatalogProduct, CustomerRecord, Escalation, EvidenceDocument, KnowledgeDocumentUpsert, LiveOrderStatus, OrderRecord, Priority, RefundStatus, TicketListFilters, TicketSummary } from "../domain.js";
import { auditEventPrecedesCursor, decodeAuditCursor, encodeAuditCursor } from "./audit-pagination.js";
import type { AuditRepository, CustomerRepository, EscalationRepository, KnowledgeRepository, OrderRepository, OrderStatusRepository, ProductRepository, RefundStatusRepository, RunRepository, TicketRepository } from "./contracts.js";

function tokens(text: string) {
	const words = text.normalize("NFKC").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
	const thai = [...text.matchAll(/[\u0E00-\u0E7F]{2,}/gu)].flatMap(([chunk]) => [...chunk].slice(0, -1).map((char, index) => char + [...chunk][index + 1]));
	return new Set([...words, ...thai]);
}

function cosine(left: readonly number[], right: readonly number[]) {
	const dot = left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
	return dot / ((Math.hypot(...left) || 1) * (Math.hypot(...right) || 1));
}

const tenantKey = (tenantId: string, id: string) => `${tenantId}:${id}`;

export class MemoryKnowledgeRepository implements KnowledgeRepository {
	readonly backend = "memory";
	readonly #documents: Array<KnowledgeDocumentUpsert & { tenant_id: string }> = [];
	constructor(readonly embedder: Embedder) {}

	async search(query: string, topK: number, tenantId: string, _roles: readonly string[] = []): Promise<EvidenceDocument[]> {
		const documents = this.#documents.filter((document) => !("tenant_id" in document) || document.tenant_id === tenantId);
		const [queryVector, ...vectors] = await this.embedder.embed([query, ...documents.map((document) => `${document.title} ${document.content}`)]);
		const queryTokens = tokens(query);
		return documents.map((document, index) => {
			const documentTokens = tokens(`${document.title} ${document.content}`);
			const lexical = [...queryTokens].filter((token) => documentTokens.has(token)).length / Math.max(1, queryTokens.size);
			const semantic = Math.max(0, cosine(queryVector!, vectors[index]!));
			const pageLabel = document.page_label ?? "Document";
			return {
				id: document.id, title: document.title, content: document.content, source: document.source,
				page_number: document.page_number, page_label: pageLabel, citation: `${document.title} — ${pageLabel}`,
				score: Number(Math.min(1, lexical * 0.7 + semantic * 0.3).toFixed(6)), metadata: document.metadata,
			};
		}).sort((left, right) => right.score - left.score || left.id.localeCompare(right.id)).slice(0, topK);
	}

	async upsert(document: KnowledgeDocumentUpsert, tenantId: string) {
		const index = this.#documents.findIndex((item) => item.id === document.id && "tenant_id" in item && item.tenant_id === tenantId);
		const stored = { ...document, tenant_id: tenantId };
		if (index >= 0) this.#documents[index] = stored;
		else this.#documents.push(stored);
	}
}

export class MemoryProductRepository implements ProductRepository {
	readonly #products = new Map<string, CatalogProduct>();
	async list(tenantId: string) {
		const selected = new Map<string, CatalogProduct>();
		for (const [key, product] of this.#products.entries()) if (product.active && key.startsWith("*:")) selected.set(product.id, product);
		for (const [key, product] of this.#products.entries()) if (product.active && key.startsWith(`${tenantId}:`)) selected.set(product.id, product);
		return [...selected.values()].map((product) => structuredClone(product));
	}
	async upsert(product: CatalogProduct, tenantId: string) { this.#products.set(tenantKey(tenantId, product.id), structuredClone(product)); }
	async priceLines(input: readonly { product_id: string; quantity: number }[], tenantId: string) {
		const products = new Map((await this.list(tenantId)).map((product) => [product.id, product]));
		return input.map(({ product_id, quantity }) => {
			const product = products.get(product_id);
			if (!product) throw Object.assign(new Error(`Unknown product: ${product_id}`), { statusCode: 400, code: "UNKNOWN_PRODUCT" });
			return { product_id, quantity, name: product.name, variant: product.variant, unit_price: product.unit_price, currency: product.currency };
		});
	}
}

export class MemoryRunRepository implements RunRepository {
	readonly backend = "memory";
	readonly #runs = new Map<string, AssistResponse>();
	async save(run: AssistResponse, tenantId: string) { this.#runs.set(tenantKey(tenantId, run.thread_id), structuredClone(run)); }
	async get(id: string, tenantId: string) { const run = this.#runs.get(tenantKey(tenantId, id)); return run ? structuredClone(run) : undefined; }
	async getMany(ids: readonly string[], tenantId: string) {
		const entries: (readonly [string, AssistResponse])[] = [];
		for (const id of ids) {
			const item = await this.get(id, tenantId);
			if (item) entries.push([id, item] as const);
		}
		return new Map(entries);
	}
	async health() { return true; }
}

export class MemoryTicketRepository implements TicketRepository {
	readonly #tickets = new Map<string, TicketSummary>();
	readonly #idempotency = new Map<string, string>();
	async save(ticket: TicketSummary, tenantId: string, idempotencyKey?: string | null) {
		this.#tickets.set(tenantKey(tenantId, ticket.id), structuredClone(ticket));
		if (idempotencyKey) this.#idempotency.set(tenantKey(tenantId, idempotencyKey), ticket.id);
	}
	async get(id: string, tenantId: string) { const ticket = this.#tickets.get(tenantKey(tenantId, id)); return ticket ? structuredClone(ticket) : undefined; }
	async getByRun(runId: string, tenantId: string) {
		const ticket = [...this.#tickets.entries()].find(([key, item]) => key.startsWith(`${tenantId}:`) && item.run_id === runId)?.[1];
		return ticket ? structuredClone(ticket) : undefined;
	}
	async getByIdempotency(key: string, tenantId: string) { const id = this.#idempotency.get(tenantKey(tenantId, key)); return id ? this.get(id, tenantId) : undefined; }
	async listPage(tenantId: string, limit: number, offset: number, filters: TicketListFilters = {}) {
		const term = filters.query?.toLocaleLowerCase() ?? "";
		const number = filters.number?.toLocaleLowerCase() ?? "";
		const priorityRank: Record<Priority, number> = { urgent: 4, high: 3, normal: 2, low: 1 };
		const items = [...this.#tickets.entries()]
			.filter(([key]) => key.startsWith(`${tenantId}:`))
			.map(([, ticket]) => structuredClone(ticket))
			.filter((ticket) => `${ticket.id} ${ticket.reference} ${ticket.subject} ${ticket.customer} ${ticket.customer_id ?? ""} ${ticket.customer_email ?? ""} ${ticket.customer_phone ?? ""} ${ticket.order_id ?? ""} ${ticket.summary}`.toLocaleLowerCase().includes(term))
			.filter((ticket) => !number || `${ticket.id} ${ticket.reference} ${ticket.order_id ?? ""}`.toLocaleLowerCase().includes(number))
			.filter((ticket) => !filters.priority || ticket.priority === filters.priority)
			.filter((ticket) => !filters.status || ticket.status === filters.status)
			.filter((ticket) => !filters.channel || ticket.channel === filters.channel)
			.filter((ticket) => !filters.handlingMode || ticket.handling_mode === filters.handlingMode)
			.filter((ticket) => !filters.createdFrom || ticket.created_at.slice(0, 10) >= filters.createdFrom)
			.filter((ticket) => !filters.createdTo || ticket.created_at.slice(0, 10) <= filters.createdTo)
			.filter((ticket) => !filters.customerId || ticket.customer_id === filters.customerId)
			.sort((left, right) => filters.sort === "oldest"
				? left.created_at.localeCompare(right.created_at)
				: filters.sort === "priority"
					? priorityRank[right.priority] - priorityRank[left.priority] || right.created_at.localeCompare(left.created_at)
					: right.created_at.localeCompare(left.created_at));
		return { items: items.slice(offset, offset + limit), total: items.length };
	}
}

export class MemoryCustomerRepository implements CustomerRepository {
	readonly #customers = new Map<string, CustomerRecord>();
	async create(customer: CustomerRecord) {
		if (await this.getByEmail(customer.email, customer.tenant_id)) throw Object.assign(new Error("Email is already registered"), { statusCode: 409 });
		this.#customers.set(tenantKey(customer.tenant_id, customer.id), structuredClone(customer));
	}
	async get(id: string, tenantId: string) { const value = this.#customers.get(tenantKey(tenantId, id)); return value ? structuredClone(value) : undefined; }
	async getByEmail(email: string, tenantId: string) { return [...this.#customers.values()].find((item) => item.tenant_id === tenantId && item.email === email.toLowerCase()); }
	async update(customer: CustomerRecord) { this.#customers.set(tenantKey(customer.tenant_id, customer.id), structuredClone(customer)); }
}

export class MemoryOrderRepository implements OrderRepository {
	readonly #orders = new Map<string, OrderRecord>();
	readonly #idempotency = new Map<string, string>();
	async save(order: OrderRecord, tenantId: string, idempotencyKey?: string | null) {
		this.#orders.set(tenantKey(tenantId, order.id), structuredClone(order));
		if (idempotencyKey) this.#idempotency.set(tenantKey(tenantId, idempotencyKey), order.id);
	}
	async get(id: string, tenantId: string) { const order = this.#orders.get(tenantKey(tenantId, id)); return order ? structuredClone(order) : undefined; }
	async getByIdempotency(key: string, tenantId: string) { const id = this.#idempotency.get(tenantKey(tenantId, key)); return id ? this.get(id, tenantId) : undefined; }
	async listForCustomer(customerId: string, tenantId: string) {
		return [...this.#orders.entries()].filter(([key, order]) => key.startsWith(`${tenantId}:`) && order.customer_id === customerId).map(([, order]) => structuredClone(order)).sort((a, b) => b.created_at.localeCompare(a.created_at));
	}
}

export class MemoryOrderStatusRepository implements OrderStatusRepository {
	constructor(readonly orders: MemoryOrderRepository) {}
	async get(orderId: string, tenantId: string): Promise<LiveOrderStatus> {
		const order = await this.orders.get(orderId, tenantId);
		return order ? { order_id: order.id, status: order.status, tracking_number: order.tracking_number ?? null, estimated_delivery: order.estimated_delivery ?? null, updated_at: order.updated_at } : { order_id: orderId, status: "not_found", updated_at: new Date().toISOString() };
	}
}

export class MemoryRefundStatusRepository implements RefundStatusRepository {
	readonly #refunds = new Map<string, RefundStatus>();
	async get(orderId: string, tenantId: string) { return this.#refunds.get(tenantKey(tenantId, orderId)) ?? { order_id: orderId, status: "not_found", updated_at: new Date().toISOString() }; }
	async save(value: RefundStatus, tenantId: string) { this.#refunds.set(tenantKey(tenantId, value.order_id), structuredClone(value)); }
}

export class MemoryEscalationRepository implements EscalationRepository {
	readonly #byThread = new Map<string, Escalation>();
	async create(input: { priority: Priority; threadId: string; tenantId: string }) {
		const key = tenantKey(input.tenantId, input.threadId);
		const existing = this.#byThread.get(key);
		if (existing) return existing;
		const result = { escalation_id: `ESC-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`, status: "open", priority: input.priority, created_at: new Date().toISOString() };
		this.#byThread.set(key, result);
		return result;
	}
}

export class MemoryAuditRepository implements AuditRepository {
	readonly #events: AuditEvent[] = [];
	async append(event: AuditEvent) { this.#events.push(structuredClone(event)); }
	async list(tenantId: string, query: AuditQuery): Promise<AuditPage> {
		const cursor = decodeAuditCursor(query.cursor);
		const resourcePrefix = query.resource_id.toLocaleLowerCase();
		const filtered = this.#events
			.filter((event) => event.tenant_id === tenantId)
			.filter((event) => !query.action || event.action === query.action)
			.filter((event) => !query.outcome || event.outcome === query.outcome)
			.filter((event) => !resourcePrefix || event.resource_id?.toLocaleLowerCase().startsWith(resourcePrefix))
			.filter((event) => auditEventPrecedesCursor(event, cursor))
			.sort((left, right) => right.occurred_at.localeCompare(left.occurred_at) || right.id.localeCompare(left.id));
		const items = filtered.slice(0, query.limit).map((event) => structuredClone(event));
		return { items, next_cursor: filtered.length > query.limit ? encodeAuditCursor(items.at(-1)!) : null };
	}
}
