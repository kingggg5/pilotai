import type { FastifyInstance } from "fastify";
import { type ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { AuditActions } from "../audit.js";
import type { AppContainer } from "../container.js";
import { KnowledgeDocumentUpsert, TicketCreateRequest, TicketSummary, TicketUpdateRequest, type AssistResponse, type TicketListFilters, type TicketWorkItem } from "../domain.js";
import { requireRole } from "../security.js";
import { routeContext } from "./context.js";
import { QueueQuery, TicketParams } from "./schemas.js";

export function ticketStatus(run: AssistResponse) {
  if (["auto_completed", "human_completed", "human_rejected"].includes(run.automation.mode)) return "resolved";
  if (run.automation.mode === "manual_queue") return "new";
  if (run.automation.mode === "copilot_ready") return "draft_ready";
  return ({ awaiting_approval: "needs_approval", completed: "draft_ready", needs_evidence: "investigating", refused: "investigating" } as const)[run.status as "awaiting_approval"] ?? "investigating";
}

function generatedSubject(run: AssistResponse, reference: string | null, message: string) {
  const label = ({ order_status: "Order status", refund_status: "Refund status", refund_request: "Refund request", policy: "Policy question", account_access: "Account security", billing: "Billing issue", technical: "Technical issue", purchase: "Purchase request", security: "Blocked request", general: "Customer question" } as const)[run.classification.category];
  return reference ? `${label} · ${reference}` : message.slice(0, 120);
}

export function workItem(payload: z.infer<typeof TicketCreateRequest>, run: AssistResponse, reference?: string): TicketWorkItem {
  const now = new Date().toISOString();
  const linkedReference = payload.order_id ?? run.entities.order_id ?? run.entities.refund_id;
  const ticket = TicketSummary.parse({
    id: `tkt_${run.thread_id}`, reference: reference ?? `SP-${run.thread_id.slice(-6).toUpperCase()}`,
    subject: payload.subject ?? generatedSubject(run, linkedReference, payload.message), customer: payload.customer, customer_id: payload.customer_id,
    customer_email: payload.customer_id?.includes("@") ? payload.customer_id : null, customer_phone: null,
    channel: payload.channel, locale: payload.locale,
    handling_mode: run.automation.handling_mode,
    priority: run.classification.priority, status: ticketStatus(run), confidence: run.classification.confidence,
    wait_minutes: 0, summary: payload.message,
    requested_action: run.automation.mode === "manual_queue" ? "Human handling requested" : run.automation.mode === "copilot_ready" ? "Review AI-prepared response" : run.automation.mode === "auto_completed" ? "Completed automatically from verified evidence" : run.automation.next_question ?? (run.status === "awaiting_approval" ? "Review and approve proposed escalation" : "Review AI-prepared response"),
    order_id: linkedReference, assigned_team: run.automation.assigned_team, created_at: now, updated_at: now,
    tags: run.automation.tags, run_id: run.thread_id,
  });
  return { ticket, run };
}

export async function registerOperationsRoutes(app: FastifyInstance, container: AppContainer) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const { authenticate, principal } = routeContext(container);

  api.post("/api/v1/tools/get-order-status", { preHandler: authenticate, schema: { tags: ["tools"], body: z.object({ order_id: z.string().min(1).max(128), customer_id: z.string().max(128).nullable().optional() }), response: { 200: z.any() } } }, async (request) => {
    const actor = principal(request);
    const result = await container.tools.getOrderStatus(request.body.order_id, actor.tenant_id);
    await container.audit.fromRequest(request, actor, { action: AuditActions.orderRead, resourceType: "order", resourceId: request.body.order_id, metadata: { status: result.status } });
    return result;
  });
  api.post("/api/v1/tools/check-refund-status", { preHandler: authenticate, schema: { tags: ["tools"], body: z.object({ order_id: z.string().min(1).max(128) }), response: { 200: z.any() } } }, async (request) => {
    const actor = principal(request);
    const result = await container.tools.getRefundStatus(request.body.order_id, actor.tenant_id);
    await container.audit.fromRequest(request, actor, { action: AuditActions.refundRead, resourceType: "refund", resourceId: request.body.order_id, metadata: { status: result.status } });
    return result;
  });
  api.post("/api/v1/tools/search-policy", { preHandler: authenticate, schema: { tags: ["tools"], body: z.object({ query: z.string().min(2).max(2_000), top_k: z.number().int().min(1).max(10).default(3) }), response: { 200: z.any() } } }, async (request) => {
    const actor = principal(request);
    return container.tools.searchPolicy(request.body.query, request.body.top_k, actor.tenant_id, actor.roles);
  });
  api.post("/api/v1/knowledge/documents", { preHandler: authenticate, schema: { tags: ["knowledge"], body: KnowledgeDocumentUpsert, response: { 202: z.object({ id: z.string(), indexed: z.boolean(), embedding_model: z.string() }) } } }, async (request, reply) => {
    const actor = principal(request);
    requireRole(actor, ["agent", "supervisor"], "Agent role required");
    await container.knowledge.upsert(request.body, actor.tenant_id);
    await container.audit.fromRequest(request, actor, { action: AuditActions.knowledgeUpserted, resourceType: "knowledge_document", resourceId: request.body.id, metadata: { locale: request.body.locale, source: request.body.source } });
    return reply.code(202).send({ id: request.body.id, indexed: true, embedding_model: container.settings.EMBEDDING_MODEL });
  });

  api.post("/api/v1/tickets", { preHandler: authenticate, schema: { tags: ["operations"], body: TicketCreateRequest, response: { 201: z.any(), 401: z.any() } } }, async (request, reply) => {
    const actor = principal(request);
    requireRole(actor, ["ticket:create", "agent", "supervisor"], "Ticket create role required");
    const account = actor.roles.includes("customer") ? await container.customers.get(actor.subject, actor.tenant_id) : undefined;
    if (actor.roles.includes("customer") && !account) return reply.code(401).send({ detail: "Customer session is no longer valid", code: "UNAUTHORIZED" });
    const input = account ? { ...request.body, customer: account.name, customer_id: account.id } : request.body;
    if (request.body.idempotency_key) {
      const existing = await container.tickets.getByIdempotency(request.body.idempotency_key, actor.tenant_id);
      if (existing?.run_id) {
        const run = await container.runs.get(existing.run_id, actor.tenant_id);
        if (run) {
          await container.audit.fromRequest(request, actor, { action: AuditActions.ticketReplay, resourceType: "ticket", resourceId: existing.id });
          return reply.code(201).send({ ticket: existing, run });
        }
      }
    }
    const run = await container.workflow.start({ message: input.message, customer_id: input.customer_id, order_id: input.order_id, locale: input.locale, handling_mode: input.handling_mode, metadata: { tenant_id: actor.tenant_id, actor_id: actor.subject, roles: actor.roles, channel: input.channel } }, actor.tenant_id);
    container.metrics.record(run.status);
    container.metrics.recordAutomation(run.automation.mode, run.automation.handling_mode);
    const item = workItem(input, run);
    if (account) item.ticket = TicketSummary.parse({ ...item.ticket, customer_email: account.email, customer_phone: account.phone });
    await container.tickets.save(item.ticket, actor.tenant_id, request.body.idempotency_key);
    await container.audit.fromRequest(request, actor, { action: AuditActions.ticketCreated, resourceType: "ticket", resourceId: item.ticket.id, metadata: { channel: item.ticket.channel, priority: item.ticket.priority, status: item.ticket.status, category: run.classification.category, handling_mode: run.automation.handling_mode } });
    await container.audit.fromRequest(request, actor, { action: AuditActions.handlingModeSelected, resourceType: "workflow_run", resourceId: run.thread_id, metadata: { handling_mode: run.automation.handling_mode, ticket_id: item.ticket.id } });
    await container.audit.record({
      principal: { ...actor, subject: "servicepilot-automation" }, actorType: "system", action: AuditActions.automationCompleted,
      resourceType: "ticket", resourceId: item.ticket.id, requestId: request.id,
      metadata: { handling_mode: run.automation.handling_mode, mode: run.automation.mode, assigned_team: run.automation.assigned_team, action_types: run.automation.actions.map((action) => action.type), evidence_count: run.retrieval.documents.length },
    });
    return reply.code(201).send(item);
  });
  api.get("/api/v1/tickets", { preHandler: authenticate, schema: { tags: ["operations"], response: { 200: z.object({ items: z.array(TicketSummary) }) } } }, async (request) => {
    const actor = principal(request); requireRole(actor, ["agent", "supervisor"], "Agent role required");
    return { items: (await container.tickets.listPage(actor.tenant_id, 100, 0)).items };
  });
  api.get("/api/v1/ticket-queue", { preHandler: authenticate, schema: { tags: ["operations"], querystring: QueueQuery, response: { 200: z.any() } } }, async (request) => {
    const actor = principal(request); requireRole(actor, ["agent", "supervisor"], "Agent role required");
    const filters: TicketListFilters = { sort: request.query.sort };
    if (request.query.q) filters.query = request.query.q;
    if (request.query.number) filters.number = request.query.number;
    if (request.query.priority) filters.priority = request.query.priority;
    if (request.query.status) filters.status = request.query.status;
    if (request.query.channel) filters.channel = request.query.channel;
    if (request.query.handling_mode) filters.handlingMode = request.query.handling_mode;
    if (request.query.created_from) filters.createdFrom = request.query.created_from;
    if (request.query.created_to) filters.createdTo = request.query.created_to;
    const page = await container.tickets.listPage(actor.tenant_id, request.query.limit, request.query.offset, filters);
    const runs = await container.runs.getMany(page.items.flatMap((ticket) => ticket.run_id ? [ticket.run_id] : []), actor.tenant_id);
    return { items: page.items.map((ticket) => ({ ticket, run: ticket.run_id ? runs.get(ticket.run_id) ?? null : null })), total: page.total, offset: request.query.offset, limit: request.query.limit };
  });
  api.patch("/api/v1/tickets/:ticketId", { preHandler: authenticate, schema: { tags: ["operations"], params: TicketParams, body: TicketUpdateRequest, response: { 200: TicketSummary, 404: z.any() } } }, async (request, reply) => {
    const actor = principal(request); requireRole(actor, ["agent", "supervisor"], "Agent role required");
    const current = await container.tickets.get(request.params.ticketId, actor.tenant_id);
    if (!current) return reply.code(404).send({ detail: "Ticket not found", code: "NOT_FOUND" });
    const updated = TicketSummary.parse({ ...current, ...request.body, updated_at: new Date().toISOString() });
    await container.tickets.save(updated, actor.tenant_id);
    await container.audit.fromRequest(request, actor, {
      action: AuditActions.ticketUpdated, resourceType: "ticket", resourceId: updated.id,
      metadata: { from_status: current.status, to_status: updated.status, from_team: current.assigned_team, to_team: updated.assigned_team, from_priority: current.priority, to_priority: updated.priority },
    });
    return updated;
  });
  api.get("/api/v1/ops/dashboard", { preHandler: authenticate, schema: { tags: ["operations"], response: { 200: z.any() } } }, async (request) => {
    requireRole(principal(request), ["agent", "supervisor"], "Agent role required"); return container.metrics.snapshot();
  });
}
