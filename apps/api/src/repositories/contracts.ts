import type {
	AssistResponse,
	AuditEvent,
	AuditPage,
	AuditQuery,
	Escalation,
	EvidenceDocument,
	KnowledgeDocumentUpsert,
	CustomerRecord,
	CatalogProduct,
	Priority,
	OrderRecord,
	TicketListFilters,
	TicketSummary,
} from "../domain.js";

export interface RunRepository {
	readonly backend: string;
	save(run: AssistResponse, tenantId: string): Promise<void>;
	get(id: string, tenantId: string): Promise<AssistResponse | undefined>;
	getMany(ids: readonly string[], tenantId: string): Promise<Map<string, AssistResponse>>;
	health(): Promise<boolean>;
}

export interface TicketRepository {
	save(ticket: TicketSummary, tenantId: string, idempotencyKey?: string | null): Promise<void>;
	get(id: string, tenantId: string): Promise<TicketSummary | undefined>;
	getByRun(runId: string, tenantId: string): Promise<TicketSummary | undefined>;
	getByIdempotency(key: string, tenantId: string): Promise<TicketSummary | undefined>;
	listPage(tenantId: string, limit: number, offset: number, filters?: TicketListFilters): Promise<{ items: TicketSummary[]; total: number }>;
}

export interface CustomerRepository {
	create(customer: CustomerRecord): Promise<void>;
	get(id: string, tenantId: string): Promise<CustomerRecord | undefined>;
	getByEmail(email: string, tenantId: string): Promise<CustomerRecord | undefined>;
	update(customer: CustomerRecord): Promise<void>;
}

export interface OrderRepository {
	save(order: OrderRecord, tenantId: string, idempotencyKey?: string | null): Promise<void>;
	get(id: string, tenantId: string): Promise<OrderRecord | undefined>;
	getByIdempotency(key: string, tenantId: string): Promise<OrderRecord | undefined>;
	listForCustomer(customerId: string, tenantId: string): Promise<OrderRecord[]>;
}

export interface ProductRepository {
	list(tenantId: string): Promise<CatalogProduct[]>;
	upsert(product: CatalogProduct, tenantId: string): Promise<void>;
	priceLines(input: readonly { product_id: string; quantity: number }[], tenantId: string): Promise<import("../domain.js").ProductLine[]>;
}

export interface OrderStatusRepository {
	get(orderId: string, tenantId: string): Promise<import("../domain.js").LiveOrderStatus>;
}

export interface RefundStatusRepository {
	get(orderId: string, tenantId: string): Promise<import("../domain.js").RefundStatus>;
}

export interface KnowledgeRepository {
	readonly backend: string;
	search(query: string, topK: number, tenantId: string, roles: readonly string[]): Promise<EvidenceDocument[]>;
	upsert(document: KnowledgeDocumentUpsert, tenantId: string): Promise<void>;
}

export interface EscalationRepository {
	create(input: {
		reason: string;
		priority: Priority;
		threadId: string;
		tenantId: string;
		customerId?: string | null;
		orderId?: string | null;
	}): Promise<Escalation>;
}

export interface AuditRepository {
	append(event: AuditEvent): Promise<void>;
	list(tenantId: string, query: AuditQuery): Promise<AuditPage>;
}
