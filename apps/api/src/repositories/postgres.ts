import { createHash, randomUUID } from "node:crypto";
import pg from "pg";

import type { Embedder } from "../ai.js";
import type { AssistResponse, AuditEvent, AuditPage, AuditQuery, CatalogProduct, CustomerRecord, Escalation, EvidenceDocument, KnowledgeDocumentUpsert, LiveOrderStatus, OrderRecord, Priority, RefundStatus, TicketListFilters, TicketSummary } from "../domain.js";
import { decodeAuditCursor, encodeAuditCursor, escapeLikePrefix } from "./audit-pagination.js";
import type { AuditRepository, CustomerRepository, EscalationRepository, KnowledgeRepository, OrderRepository, OrderStatusRepository, ProductRepository, RefundStatusRepository, RunRepository, TicketRepository } from "./contracts.js";

export class PostgresResources {
  readonly pool: pg.Pool;
  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url, max: 10, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 30_000 });
    this.pool.on("error", (error) => console.error(JSON.stringify({ level: "error", event: "postgres_idle_client_error", message: error.message })));
  }
  async close() { await this.pool.end(); }
}

export class PostgresRunRepository implements RunRepository {
  readonly backend = "postgres";
  constructor(readonly db: PostgresResources) {}
  async save(run: AssistResponse, tenantId: string) {
    const id = createHash("sha256").update(`${tenantId}:${run.thread_id}`).digest("hex");
    const uuid = `${id.slice(0, 8)}-${id.slice(8, 12)}-4${id.slice(13, 16)}-8${id.slice(17, 20)}-${id.slice(20, 32)}`;
    await this.db.pool.query(
      `INSERT INTO workflow_runs (id,tenant_id,ticket_id,status,graph_thread_id,input,output)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (tenant_id,graph_thread_id) DO UPDATE SET status=EXCLUDED.status,output=EXCLUDED.output,updated_at=now()`,
      [uuid, tenantId, run.thread_id, run.status, run.thread_id, {}, run],
    );
  }
  async get(id: string, tenantId: string) {
    const result = await this.db.pool.query<{ output: AssistResponse }>("SELECT output FROM workflow_runs WHERE graph_thread_id=$1 AND tenant_id=$2", [id, tenantId]);
    return result.rows[0]?.output;
  }
  async getMany(ids: readonly string[], tenantId: string) {
    if (!ids.length) return new Map();
    const result = await this.db.pool.query<{ graph_thread_id: string; output: AssistResponse }>("SELECT graph_thread_id,output FROM workflow_runs WHERE tenant_id=$1 AND graph_thread_id=ANY($2::text[])", [tenantId, ids]);
    return new Map(result.rows.map((row) => [row.graph_thread_id, row.output]));
  }
  async health() { try { await this.db.pool.query("SELECT 1"); return true; } catch { return false; } }
}

export class PostgresTicketRepository implements TicketRepository {
  constructor(readonly db: PostgresResources) {}
  private hydrate(row: { payload: TicketSummary; created_at: Date; updated_at: Date }): TicketSummary {
    return {
      ...row.payload,
      customer_id: row.payload.customer_id ?? null,
      locale: row.payload.locale ?? "auto",
      assigned_team: row.payload.assigned_team ?? "Customer Support",
      created_at: row.payload.created_at ?? row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }
  async save(ticket: TicketSummary, tenantId: string, idempotencyKey?: string | null) {
    await this.db.pool.query(
      `INSERT INTO support_tickets (tenant_id,ticket_id,run_id,status,idempotency_key,payload)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (tenant_id,ticket_id) DO UPDATE SET run_id=EXCLUDED.run_id,status=EXCLUDED.status,payload=EXCLUDED.payload,updated_at=now()`,
      [tenantId, ticket.id, ticket.run_id, ticket.status, idempotencyKey, ticket],
    );
  }
  async get(id: string, tenantId: string) {
    const row = (await this.db.pool.query<{ payload: TicketSummary; created_at: Date; updated_at: Date }>("SELECT payload,created_at,updated_at FROM support_tickets WHERE ticket_id=$1 AND tenant_id=$2", [id, tenantId])).rows[0];
    return row ? this.hydrate(row) : undefined;
  }
  async getByRun(runId: string, tenantId: string) {
    const row = (await this.db.pool.query<{ payload: TicketSummary; created_at: Date; updated_at: Date }>("SELECT payload,created_at,updated_at FROM support_tickets WHERE run_id=$1 AND tenant_id=$2 LIMIT 1", [runId, tenantId])).rows[0];
    return row ? this.hydrate(row) : undefined;
  }
  async getByIdempotency(key: string, tenantId: string) {
    const row = (await this.db.pool.query<{ payload: TicketSummary; created_at: Date; updated_at: Date }>("SELECT payload,created_at,updated_at FROM support_tickets WHERE idempotency_key=$1 AND tenant_id=$2", [key, tenantId])).rows[0];
    return row ? this.hydrate(row) : undefined;
  }
  async listPage(tenantId: string, limit: number, offset: number, filters: TicketListFilters = {}) {
    const values: unknown[] = [tenantId];
    const add = (value: unknown) => { values.push(value); return `$${values.length}`; };
    const conditions = ["tenant_id=$1"];
    if (filters.query) {
      const value = add(`%${filters.query}%`);
      conditions.push(`concat_ws(' ',ticket_id,payload->>'reference',payload->>'subject',payload->>'customer',payload->>'customer_id',payload->>'customer_email',payload->>'customer_phone',payload->>'order_id',payload->>'summary') ILIKE ${value}`);
    }
    if (filters.number) {
      const value = add(`%${filters.number}%`);
      conditions.push(`concat_ws(' ',ticket_id,payload->>'reference',payload->>'order_id') ILIKE ${value}`);
    }
    if (filters.priority) conditions.push(`payload->>'priority'=${add(filters.priority)}`);
    if (filters.status) conditions.push(`status=${add(filters.status)}`);
    if (filters.channel) conditions.push(`payload->>'channel'=${add(filters.channel)}`);
    if (filters.createdFrom) conditions.push(`created_at>=${add(filters.createdFrom)}::date`);
    if (filters.createdTo) conditions.push(`created_at<${add(filters.createdTo)}::date + interval '1 day'`);
    if (filters.customerId) conditions.push(`payload->>'customer_id'=${add(filters.customerId)}`);
    const order = filters.sort === "oldest" ? "created_at ASC" : filters.sort === "priority"
      ? "CASE payload->>'priority' WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END DESC,created_at DESC"
      : "created_at DESC";
    const limitParam = add(limit);
    const offsetParam = add(offset);
    const result = await this.db.pool.query<{ payload: TicketSummary; total: number; created_at: Date; updated_at: Date }>(
      `SELECT payload,created_at,updated_at,count(*) OVER()::int AS total FROM support_tickets WHERE ${conditions.join(" AND ")} ORDER BY ${order} LIMIT ${limitParam} OFFSET ${offsetParam}`,
      values,
    );
    return { items: result.rows.map((row) => this.hydrate(row)), total: result.rows[0]?.total ?? 0 };
  }
}

export class PostgresCustomerRepository implements CustomerRepository {
  constructor(readonly db: PostgresResources) {}
  async create(customer: CustomerRecord) {
    try {
      await this.db.pool.query(
        "INSERT INTO customer_accounts (id,tenant_id,name,email,phone,password_hash,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [customer.id, customer.tenant_id, customer.name, customer.email, customer.phone, customer.password_hash, customer.created_at, customer.updated_at],
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw Object.assign(new Error("Email is already registered"), { statusCode: 409 });
      throw error;
    }
  }
  async get(id: string, tenantId: string) {
    const result = await this.db.pool.query<CustomerRecord>("SELECT id,tenant_id,name,email,phone,password_hash,created_at,updated_at FROM customer_accounts WHERE id=$1 AND tenant_id=$2", [id, tenantId]);
    const row = result.rows[0];
    return row ? { ...row, created_at: new Date(row.created_at).toISOString(), updated_at: new Date(row.updated_at).toISOString() } : undefined;
  }
  async getByEmail(email: string, tenantId: string) {
    const result = await this.db.pool.query<CustomerRecord>("SELECT id,tenant_id,name,email,phone,password_hash,created_at,updated_at FROM customer_accounts WHERE lower(email)=lower($1) AND tenant_id=$2", [email, tenantId]);
    const row = result.rows[0];
    return row ? { ...row, created_at: new Date(row.created_at).toISOString(), updated_at: new Date(row.updated_at).toISOString() } : undefined;
  }
  async update(customer: CustomerRecord) {
    await this.db.pool.query("UPDATE customer_accounts SET name=$1,phone=$2,updated_at=$3 WHERE id=$4 AND tenant_id=$5", [customer.name, customer.phone, customer.updated_at, customer.id, customer.tenant_id]);
  }
}

export class PostgresKnowledgeRepository implements KnowledgeRepository {
  readonly backend = "postgres";
  constructor(readonly db: PostgresResources, readonly embedder: Embedder) {}
  async search(query: string, topK: number, tenantId: string, _roles: readonly string[] = []): Promise<EvidenceDocument[]> {
    const [vector] = await this.embedder.embed([query]);
    const result = await this.db.pool.query<{ id: string; title: string; content: string; source: string; page_number: number | null; page_label: string | null; metadata: Record<string, unknown>; score: number }>(
      `WITH ranked AS (
         SELECT id,title,content,source,page_number,page_label,metadata,
           row_number() OVER(ORDER BY ts_rank_cd(content_tsv,plainto_tsquery('simple',$1)) DESC) lexical_rank,
           row_number() OVER(ORDER BY COALESCE(embedding <=> $2::vector,2)) vector_rank,
           ts_rank_cd(content_tsv,plainto_tsquery('simple',$1)) lexical_score,
           COALESCE(1-(embedding <=> $2::vector),0) vector_score
         FROM knowledge_documents WHERE tenant_id IN ('*',$3)
       ) SELECT *,LEAST(1,GREATEST(0,lexical_score*.55+vector_score*.30+(1.0/(60+lexical_rank)+1.0/(60+vector_rank))/(2.0/61)*.15))::float AS score
       FROM ranked ORDER BY score DESC LIMIT $4`,
      [query, `[${vector!.join(",")}]`, tenantId, topK],
    );
    return result.rows.map((row) => ({ ...row, citation: `${row.title} — ${row.page_label ?? "Document"}` }));
  }
  async upsert(document: KnowledgeDocumentUpsert, tenantId: string) {
    const [vector] = await this.embedder.embed([document.content]);
    await this.db.pool.query(
      `INSERT INTO knowledge_documents (id,tenant_id,source,title,content,page_number,page_label,locale,acl,metadata,embedding_model,embedding)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::vector)
       ON CONFLICT (tenant_id,id) DO UPDATE SET source=EXCLUDED.source,title=EXCLUDED.title,content=EXCLUDED.content,page_number=EXCLUDED.page_number,page_label=EXCLUDED.page_label,locale=EXCLUDED.locale,acl=EXCLUDED.acl,metadata=EXCLUDED.metadata,embedding_model=EXCLUDED.embedding_model,embedding=EXCLUDED.embedding`,
      [document.id, tenantId, document.source, document.title, document.content, document.page_number, document.page_label, document.locale, document.acl, document.metadata, this.embedder.model, `[${vector!.join(",")}]`],
    );
  }
}

export class PostgresOrderRepository implements OrderRepository {
  constructor(readonly db: PostgresResources) {}
  private hydrate(row: { payload: OrderRecord; updated_at: Date }): OrderRecord {
    return { ...row.payload, updated_at: row.updated_at.toISOString() };
  }
  async save(order: OrderRecord, tenantId: string, idempotencyKey?: string | null) {
    await this.db.pool.query(
      `INSERT INTO commerce_orders (tenant_id,order_id,idempotency_key,status,customer_id,payload)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (tenant_id,order_id) DO UPDATE SET status=EXCLUDED.status,payload=EXCLUDED.payload,updated_at=now()`,
      [tenantId, order.id, idempotencyKey, order.status, order.customer_id, order],
    );
  }
  async get(id: string, tenantId: string) {
    const row = (await this.db.pool.query<{ payload: OrderRecord; updated_at: Date }>("SELECT payload,updated_at FROM commerce_orders WHERE order_id=$1 AND tenant_id=$2", [id, tenantId])).rows[0];
    return row ? this.hydrate(row) : undefined;
  }
  async getByIdempotency(key: string, tenantId: string) {
    const row = (await this.db.pool.query<{ payload: OrderRecord; updated_at: Date }>("SELECT payload,updated_at FROM commerce_orders WHERE idempotency_key=$1 AND tenant_id=$2", [key, tenantId])).rows[0];
    return row ? this.hydrate(row) : undefined;
  }
  async listForCustomer(customerId: string, tenantId: string) {
    const rows = (await this.db.pool.query<{ payload: OrderRecord; updated_at: Date }>("SELECT payload,updated_at FROM commerce_orders WHERE customer_id=$1 AND tenant_id=$2 ORDER BY created_at DESC LIMIT 100", [customerId, tenantId])).rows;
    return rows.map((row) => this.hydrate(row));
  }
}

export class PostgresOrderStatusRepository implements OrderStatusRepository {
  constructor(readonly db: PostgresResources) {}
  async get(orderId: string, tenantId: string): Promise<LiveOrderStatus> {
    const row = (await this.db.pool.query<{ status: string; payload: OrderRecord; updated_at: Date }>("SELECT status,payload,updated_at FROM commerce_orders WHERE order_id=$1 AND tenant_id=$2", [orderId, tenantId])).rows[0];
    if (!row) return { order_id: orderId, status: "not_found", updated_at: new Date().toISOString() };
    return { order_id: orderId, status: row.status, tracking_number: row.payload.tracking_number ?? null, estimated_delivery: row.payload.estimated_delivery ?? null, updated_at: row.updated_at.toISOString() };
  }
}

export class PostgresRefundStatusRepository implements RefundStatusRepository {
  constructor(readonly db: PostgresResources) {}
  async get(orderId: string, tenantId: string): Promise<RefundStatus> {
    const row = (await this.db.pool.query<{ refund_id: string; status: string; amount: number | null; currency: string | null; updated_at: Date }>("SELECT refund_id,status,amount,currency,updated_at FROM refund_statuses WHERE order_id=$1 AND tenant_id=$2 ORDER BY updated_at DESC LIMIT 1", [orderId, tenantId])).rows[0];
    return row ? { order_id: orderId, refund_id: row.refund_id, status: row.status, amount: row.amount, currency: row.currency, updated_at: row.updated_at.toISOString() } : { order_id: orderId, status: "not_found", updated_at: new Date().toISOString() };
  }
}

export class PostgresProductRepository implements ProductRepository {
  constructor(readonly db: PostgresResources) {}
  async list(tenantId: string) {
    const result = await this.db.pool.query<CatalogProduct>("SELECT product_id AS id,name,variant,unit_price::float,currency,image_url,source_url,active FROM catalog_products WHERE active=true AND tenant_id IN ('*',$1) ORDER BY sort_order,name", [tenantId]);
    const selected = new Map<string, CatalogProduct>();
    for (const product of result.rows) selected.set(product.id, product);
    return [...selected.values()];
  }
  async upsert(product: CatalogProduct, tenantId: string) {
    await this.db.pool.query("INSERT INTO catalog_products (tenant_id,product_id,name,variant,unit_price,currency,image_url,source_url,active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (tenant_id,product_id) DO UPDATE SET name=EXCLUDED.name,variant=EXCLUDED.variant,unit_price=EXCLUDED.unit_price,currency=EXCLUDED.currency,image_url=EXCLUDED.image_url,source_url=EXCLUDED.source_url,active=EXCLUDED.active,updated_at=now()", [tenantId, product.id, product.name, product.variant, product.unit_price, product.currency, product.image_url, product.source_url, product.active]);
  }
  async priceLines(input: readonly { product_id: string; quantity: number }[], tenantId: string) {
    const products = new Map((await this.list(tenantId)).map((product) => [product.id, product]));
    return input.map(({ product_id, quantity }) => {
      const product = products.get(product_id);
      if (!product) throw Object.assign(new Error(`Unknown product: ${product_id}`), { statusCode: 400, code: "UNKNOWN_PRODUCT" });
      return { product_id, quantity, name: product.name, variant: product.variant, unit_price: product.unit_price, currency: product.currency };
    });
  }
}

export class PostgresEscalationRepository implements EscalationRepository {
  constructor(readonly db: PostgresResources) {}
  async create(input: { reason: string; priority: Priority; threadId: string; tenantId: string; customerId?: string | null; orderId?: string | null }) {
    const result: Escalation = { escalation_id: `ESC-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`, status: "open", priority: input.priority, created_at: new Date().toISOString() };
    const response = await this.db.pool.query<{ escalation_id: string; status: string; priority: Priority; created_at: Date }>(
      `INSERT INTO escalations (escalation_id,tenant_id,graph_thread_id,status,priority,payload,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(tenant_id,graph_thread_id) DO UPDATE SET graph_thread_id=EXCLUDED.graph_thread_id
       RETURNING escalation_id,status,priority,created_at`,
      [result.escalation_id, input.tenantId, input.threadId, result.status, result.priority, input, result.created_at],
    );
    const row = response.rows[0]!;
    return { ...row, created_at: row.created_at.toISOString() };
  }
}

export class PostgresAuditRepository implements AuditRepository {
  constructor(readonly db: PostgresResources) {}
  async append(event: AuditEvent) {
    await this.db.pool.query(
      `INSERT INTO audit_events (id,tenant_id,occurred_at,actor_id,actor_type,action,resource_type,resource_id,outcome,request_id,metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [event.id, event.tenant_id, event.occurred_at, event.actor_id, event.actor_type, event.action, event.resource_type, event.resource_id, event.outcome, event.request_id, event.metadata],
    );
  }
  async list(tenantId: string, query: AuditQuery): Promise<AuditPage> {
    const cursor = decodeAuditCursor(query.cursor);
    const resourcePrefix = query.resource_id ? escapeLikePrefix(query.resource_id) : "";
    const result = await this.db.pool.query<AuditEvent & { occurred_at: Date }>(
      `SELECT id,tenant_id,occurred_at,actor_id,actor_type,action,resource_type,resource_id,outcome,request_id,metadata
       FROM audit_events
       WHERE tenant_id=$1 AND ($2='' OR action=$2) AND ($3='' OR outcome=$3)
         AND ($4='' OR lower(resource_id) LIKE $4 ESCAPE '\\')
         AND ($5::timestamptz IS NULL OR (occurred_at,id)<($5::timestamptz,$6::uuid))
       ORDER BY occurred_at DESC,id DESC LIMIT $7`,
      [tenantId, query.action, query.outcome, resourcePrefix, cursor?.occurred_at ?? null, cursor?.id ?? null, query.limit + 1],
    );
    const events = result.rows.map((row) => ({ ...row, occurred_at: row.occurred_at.toISOString() }));
    const items = events.slice(0, query.limit);
    return { items, next_cursor: events.length > query.limit ? encodeAuditCursor(items.at(-1)!) : null };
  }
}
