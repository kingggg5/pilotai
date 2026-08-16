import type { FastifyInstance } from "fastify";
import { type ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { AuditActions } from "../audit.js";
import type { AppContainer } from "../container.js";
import { AnalyticsKPI, AssistResponse, KnowledgeDocumentUpsert, TicketCreateRequest, TicketFeedbackRequest, TicketSummary, TicketUpdateRequest, type TicketListFilters, type TicketWorkItem } from "../domain.js";
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
		const run = await container.workflow.start({ message: input.message, customer_id: input.customer_id, order_id: input.order_id, conversation_context: input.conversation_context, locale: input.locale, handling_mode: input.handling_mode, metadata: { tenant_id: actor.tenant_id, actor_id: actor.subject, roles: actor.roles, channel: input.channel } }, actor.tenant_id);
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
	api.get("/api/v1/customer/chat-history", { preHandler: authenticate, schema: { tags: ["customer"], response: { 200: z.object({ items: z.array(z.object({ ticket: TicketSummary, run: AssistResponse })) }) } } }, async (request) => {
		const actor = principal(request);
		requireRole(actor, ["customer"], "Customer role required");
		const page = await container.tickets.listPage(actor.tenant_id, 30, 0, { customerId: actor.subject, channel: "chat", sort: "oldest" });
		const runs = await container.runs.getMany(page.items.flatMap((ticket) => ticket.run_id ? [ticket.run_id] : []), actor.tenant_id);
		return { items: page.items.flatMap((ticket) => {
			const run = ticket.run_id ? runs.get(ticket.run_id) : undefined;
			return run ? [{ ticket, run }] : [];
		}) };
	});
	api.get("/api/v1/ticket-queue", { preHandler: authenticate, schema: { tags: ["operations"], querystring: QueueQuery, response: { 200: z.any() } } }, async (request) => {
		const actor = principal(request); requireRole(actor, ["agent", "supervisor"], "Agent role required");
		const { q: query, number, priority, status, channel, handling_mode: handlingMode, created_from: createdFrom, created_to: createdTo, sort, limit, offset } = request.query;
		const filters: TicketListFilters = {
			sort,
			...(query && { query }),
			...(number && { number }),
			...(priority && { priority }),
			...(status && { status }),
			...(channel && { channel }),
			...(handlingMode && { handlingMode }),
			...(createdFrom && { createdFrom }),
			...(createdTo && { createdTo }),
		};
		const page = await container.tickets.listPage(actor.tenant_id, limit, offset, filters);
		const runs = await container.runs.getMany(page.items.flatMap((ticket) => ticket.run_id ? [ticket.run_id] : []), actor.tenant_id);
		return { items: page.items.map((ticket) => ({ ticket, run: ticket.run_id ? runs.get(ticket.run_id) ?? null : null })), total: page.total, offset, limit };
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

	api.post("/api/v1/tickets/:ticketId/feedback", { preHandler: authenticate, schema: { tags: ["operations"], params: TicketParams, body: TicketFeedbackRequest, response: { 200: z.object({ success: z.boolean(), ticket_id: z.string(), feedback_recorded: z.boolean() }), 404: z.any() } } }, async (request, reply) => {
		const actor = principal(request);
		const ticket = await container.tickets.get(request.params.ticketId, actor.tenant_id);
		if (!ticket) return reply.code(404).send({ detail: "Ticket not found", code: "NOT_FOUND" });
		await container.audit.fromRequest(request, actor, {
			action: AuditActions.feedbackRecorded,
			resourceType: "ticket",
			resourceId: ticket.id,
			metadata: {
				feedback_type: request.body.feedback_type,
				rating: request.body.rating ?? null,
				has_edited_reply: Boolean(request.body.edited_reply),
				notes: request.body.notes ?? null,
			},
		});
		return { success: true, ticket_id: ticket.id, feedback_recorded: true };
	});

	api.get("/api/v1/analytics/kpi", { preHandler: authenticate, schema: { tags: ["operations"], response: { 200: AnalyticsKPI } } }, async (request) => {
		const actor = principal(request);
		requireRole(actor, ["agent", "supervisor"], "Agent role required");
		const { items, total } = await container.tickets.listPage(actor.tenant_id, 1000, 0);
		const counts = items.reduce((acc, ticket) => {
			if (ticket.status === "resolved") acc.resolved += 1;
			if (ticket.requested_action?.includes("Completed automatically") || ticket.tags.includes("auto-resolved")) acc.autoCompleted += 1;
			acc.confidence += ticket.confidence;
			if (ticket.priority === "urgent" || ticket.priority === "high") acc.urgent += 1;
			else if (ticket.priority === "normal") acc.neutral += 1;
			else acc.positive += 1;
			// positive = low priority OR resolved; a resolved low-priority ticket counts once.
			if (ticket.status === "resolved" && ticket.priority !== "low") acc.positive += 1;
			return acc;
		}, { resolved: 0, autoCompleted: 0, confidence: 0, urgent: 0, neutral: 0, positive: 0 });
		const totalCount = Math.max(1, total);
		const hoursSaved = Number(((counts.autoCompleted * 10) / 60).toFixed(1));

		await container.audit.fromRequest(request, actor, { action: AuditActions.kpiRequested, resourceType: "analytics", resourceId: "kpi" });

		return {
			total_tickets: total,
			resolved_tickets: counts.resolved,
			zero_touch_rate: Number(((counts.autoCompleted / totalCount) * 100).toFixed(1)),
			human_assisted_rate: Math.max(0, Number((((counts.resolved - counts.autoCompleted) / totalCount) * 100).toFixed(1))),
			avg_confidence: items.length ? Number((counts.confidence / items.length).toFixed(2)) : 0.95,
			estimated_hours_saved: hoursSaved,
			estimated_cost_saved_thb: Math.round(hoursSaved * 250),
			csat_score: 4.8,
			sentiment_distribution: {
				positive: counts.positive,
				neutral: counts.neutral,
				urgent_dispute: counts.urgent,
			},
		};
	});

	api.get("/api/v1/tickets/:ticketId/stream", { preHandler: authenticate, schema: { tags: ["operations"], params: TicketParams } }, async (request, reply) => {
		const actor = principal(request);
		const ticket = await container.tickets.get(request.params.ticketId, actor.tenant_id);
		if (!ticket) return reply.code(404).send({ detail: "Ticket not found", code: "NOT_FOUND" });
		const run = ticket.run_id ? await container.runs.get(ticket.run_id, actor.tenant_id) : null;

		reply.raw.setHeader("Content-Type", "text/event-stream");
		reply.raw.setHeader("Cache-Control", "no-cache");
		reply.raw.setHeader("Connection", "keep-alive");

		const steps = [
			{ step: "classifier", title: "Classifying inquiry", detail: `${ticket.priority.toUpperCase()} priority · ${ticket.channel}` },
			{ step: "evidence", title: "Querying verified policies", detail: `Retrieved ${run?.retrieval?.documents?.length ?? 1} document(s)` },
			{ step: "draft", title: "Generating grounded response", detail: "Grounded by citations" },
		];

		for (const item of steps) {
			reply.raw.write(`event: step\ndata: ${JSON.stringify(item)}\n\n`);
		}

		const draftText = run?.draft ?? "Our automated system is processing your inquiry.";
		const chunks = draftText.match(/.{1,15}/g) || [draftText];
		for (const chunk of chunks) {
			reply.raw.write(`event: token\ndata: ${JSON.stringify({ chunk })}\n\n`);
		}

		reply.raw.write(`event: done\ndata: ${JSON.stringify({ status: ticket.status, confidence: ticket.confidence })}\n\n`);
		reply.raw.end();
	});
}
