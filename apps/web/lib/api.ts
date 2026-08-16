import "server-only";

import { randomUUID } from "node:crypto";
import { apiHeaders } from "@/lib/api-auth";
import type {
	AuditData,
	AuditEvent,
	AuditFilters,
	ConsoleData,
	CustomerProfile,
	Decision,
	DecisionResponse,
	Evidence,
	KpiAnalytics,
	OrderTracking,
	PurchaseResult,
	QueueFilters,
	Run,
	Ticket,
	TicketDraft,
	TicketFeedbackInput,
	TicketWorkItem,
} from "@/lib/types";
import type { Product } from "@/lib/catalog";

const API_URL = (process.env.SERVICEPILOT_API_URL || process.env.NEXT_PUBLIC_API_URL)?.replace(/\/$/, "");
const REQUEST_TIMEOUT_MS = Number(process.env.SERVICEPILOT_UPSTREAM_TIMEOUT_MS || 25_000);
type ApiActor = "admin" | "customer";

type ApiProduct = { id: string; name: string; variant: string; unit_price: number; currency: "THB"; image_url: string; source_url: string | null; active: boolean };
type ApiEvidence = { id: string; title: string; content: string; source: string; citation: string; page_label?: string; score: number };
type ApiCustomer = { id: string; name: string; email: string; phone: string; created_at: string; updated_at: string };

type ApiTicket = {
	id: string;
	reference: string;
	subject: string;
	customer: string;
	customer_id?: string;
	customer_email?: string;
	customer_phone?: string;
	channel: Ticket["channel"];
	handling_mode?: Ticket["handlingMode"];
	priority: Ticket["priority"];
	status: Ticket["status"];
	confidence: number;
	wait_minutes: number;
	summary: string;
	requested_action: string;
	order_id?: string;
	amount?: string;
	tags: string[];
	run_id?: string;
	locale: Ticket["locale"];
	assigned_team: string;
	created_at: string;
	updated_at: string;
};

type ApiRun = {
	thread_id: string;
	status: Run["state"];
	classification: { category: string; priority: string; confidence: number; model_version: string };
	retrieval: { documents: ApiEvidence[]; sufficient_evidence: boolean; top_score: number; retrieval_version?: string };
	draft: string;
	answer?: string;
	policy: { reasons: string[]; risk_level: string };
	entities?: { order_id?: string | null; refund_id?: string | null; language: "th" | "en"; requested_action: string; missing_fields: string[] };
	automation?: { handling_mode?: Run["automation"]["handlingMode"]; mode: Run["automation"]["mode"]; assigned_team: string; next_question?: string | null; actions: Run["automation"]["actions"] };
	approval?: { decision?: Decision; reviewer?: string };
	escalation_id?: string;
	trace?: { id: string; title: string; detail: string; status: "complete" | "active" | "skipped" }[];
	provider: string;
};

type ApiAuditEvent = {
	id: string;
	occurred_at: string;
	actor_id: string;
	actor_type: AuditEvent["actorType"];
	action: string;
	resource_type: string;
	resource_id?: string;
	outcome: AuditEvent["outcome"];
	request_id?: string;
	metadata: Record<string, unknown>;
};

// Unified Type-Safe Upstream Request Helper
async function request<T>(path: string, actor: ApiActor, init?: RequestInit): Promise<T> {
	if (!API_URL) throw new Error("Operations API is not configured");

	const response = await fetch(`${API_URL}${path}`, {
		...init,
		cache: "no-store",
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		headers: {
			...(init?.body ? { "Content-Type": "application/json" } : {}),
			...await apiHeaders(actor),
			...init?.headers,
		},
	});

	if (!response.ok) {
		const error = await response.json().catch(() => ({})) as { detail?: string };
		throw new Error(error.detail || `Operations API returned ${response.status}`);
	}
	return response.json() as Promise<T>;
}

// Model Mappers
const toEvidence = (item: ApiEvidence): Evidence => ({
	id: item.id,
	title: item.title,
	source: item.source,
	excerpt: item.content,
	score: item.score,
	section: item.page_label || item.citation,
});

const toCustomer = (value: ApiCustomer): CustomerProfile => ({
	id: value.id,
	name: value.name,
	email: value.email,
	phone: value.phone,
	createdAt: value.created_at,
	updatedAt: value.updated_at,
});

const toAuditEvent = (event: ApiAuditEvent): AuditEvent => ({
	id: event.id,
	occurredAt: event.occurred_at,
	actorId: event.actor_id,
	actorType: event.actor_type,
	action: event.action,
	resourceType: event.resource_type,
	resourceId: event.resource_id,
	outcome: event.outcome,
	requestId: event.request_id,
	metadata: event.metadata,
});

function toTicket(ticket: ApiTicket): Ticket {
	const { customer_id, customer_email, customer_phone, wait_minutes, requested_action, order_id, run_id, assigned_team, handling_mode, created_at, updated_at, ...rest } = ticket;
	return {
		...rest,
		waitMinutes: wait_minutes,
		requestedAction: requested_action,
		orderId: order_id,
		runId: run_id,
		customerId: customer_id,
		customerEmail: customer_email,
		customerPhone: customer_phone,
		assignedTeam: assigned_team,
		handlingMode: handling_mode ?? "autopilot",
		createdAt: created_at,
		updatedAt: updated_at,
	};
}

function toRun(run: ApiRun, ticketId: string): Run {
	const evidence = run.retrieval.documents.map(toEvidence);
	const waiting = run.status === "awaiting_approval";
	const automation = run.automation ?? { handling_mode: "autopilot", mode: waiting ? "needs_approval" : "auto_routed", assigned_team: "Customer Support", next_question: null, actions: [] };

	return {
		id: run.thread_id,
		ticketId,
		state: run.status,
		recommendation: run.answer || run.draft,
		confidence: run.classification.confidence,
		draft: run.draft,
		decision: run.approval?.decision,
		reviewer: run.approval?.reviewer,
		escalationId: run.escalation_id,
		evidence,
		entities: {
			orderId: run.entities?.order_id ?? undefined,
			refundId: run.entities?.refund_id ?? undefined,
			language: run.entities?.language ?? "en",
			requestedAction: run.entities?.requested_action ?? run.classification.category,
			missingFields: run.entities?.missing_fields ?? [],
		},
		automation: {
			handlingMode: automation.handling_mode ?? "autopilot",
			mode: automation.mode,
			assignedTeam: automation.assigned_team,
			nextQuestion: automation.next_question ?? undefined,
			actions: automation.actions,
		},
		ai: {
			category: run.classification.category,
			priority: run.classification.priority,
			modelVersion: run.classification.model_version,
			provider: run.provider,
			retrievalVersion: run.retrieval.retrieval_version,
			riskLevel: run.policy.risk_level,
			reasons: run.policy.reasons,
			sufficientEvidence: run.retrieval.sufficient_evidence,
			topScore: run.retrieval.top_score,
		},
		trace: run.trace?.length ? run.trace : [
			{ id: "classify", title: "Classified request", detail: `${run.classification.category} • ${run.classification.priority}`, status: "complete" },
			{ id: "extract", title: "Extracted request data", detail: run.entities?.order_id || run.entities?.refund_id || "No reference found", status: "complete" },
			{ id: "retrieve", title: "Checked authorized sources", detail: `${evidence.length} sources`, status: "complete" },
			{ id: "policy", title: "Applied policy", detail: run.policy.reasons.join(" ") || "Policy checked", status: "complete" },
			{ id: "decision", title: waiting ? "Waiting for human decision" : "Workflow completed", detail: run.status.replaceAll("_", " "), status: waiting ? "active" : "complete" },
		],
	};
}

function pendingRun(ticket: Ticket): Run {
	return {
		id: ticket.runId || ticket.id,
		ticketId: ticket.id,
		state: "running",
		recommendation: "",
		confidence: ticket.confidence,
		draft: "",
		evidence: [],
		entities: { language: ticket.locale === "th" ? "th" : "en", requestedAction: "pending", missingFields: [] },
		automation: { handlingMode: ticket.handlingMode, mode: ticket.handlingMode === "manual" ? "manual_queue" : ticket.handlingMode === "copilot" ? "copilot_ready" : "auto_routed", assignedTeam: ticket.assignedTeam, actions: [] },
		ai: { category: ticket.tags[0] || "general", priority: ticket.priority, modelVersion: "pending", provider: "pending", riskLevel: "pending", reasons: [], sufficientEvidence: false, topScore: 0 },
		trace: [{ id: "pending", title: "Workflow queued", detail: "Waiting for processing", status: "active" }],
	};
}

function queueParams(offset: number, limit: number, filters: QueueFilters) {
	const query = new URLSearchParams({ offset: String(offset), limit: String(limit), sort: filters.sort });
	if (filters.query) query.set("q", filters.query);
	if (filters.number) query.set("number", filters.number);
	if (filters.priority) query.set("priority", filters.priority);
	if (filters.status) query.set("status", filters.status);
	if (filters.channel) query.set("channel", filters.channel);
	if (filters.handlingMode) query.set("handling_mode", filters.handlingMode);
	if (filters.createdFrom) query.set("created_from", filters.createdFrom);
	if (filters.createdTo) query.set("created_to", filters.createdTo);
	return query;
}

// Public API Functions
export async function getProducts(): Promise<Product[]> {
	const payload = await request<{ items: ApiProduct[] }>("/api/v1/products", "customer");
	return payload.items.map((item) => ({ id: item.id, name: item.name, variant: item.variant, priceThb: item.unit_price, sourceUrl: item.source_url ?? "", imageUrl: item.image_url }));
}

export async function getConsoleData(offset = 0, limit = 50, filters: QueueFilters = { sort: "newest" }): Promise<ConsoleData> {
	const checkedAt = new Date().toISOString();
	try {
		const payload = await request<{ items: { ticket: ApiTicket; run?: ApiRun }[]; total: number; offset: number; limit: number }>(`/api/v1/ticket-queue?${queueParams(offset, limit, filters)}`, "admin");
		const tickets = payload.items.map((item) => toTicket(item.ticket));
		const runs = Object.fromEntries(payload.items.map((item, index) => {
			const ticket = tickets[index];
			return [ticket.id, item.run ? toRun(item.run, ticket.id) : pendingRun(ticket)];
		}));
		return { tickets, runs, source: "live", checkedAt, total: payload.total, offset: payload.offset, limit: payload.limit };
	} catch (error) {
		return { tickets: [], runs: {}, source: "unavailable", checkedAt, loadError: error instanceof Error ? error.message : "Operations API is unavailable", total: 0, offset, limit };
	}
}

export async function updateTicket(ticketId: string, input: { status: Ticket["status"]; priority: Ticket["priority"]; assignedTeam: string }) {
	const payload = await request<ApiTicket>(`/api/v1/tickets/${encodeURIComponent(ticketId)}`, "admin", {
		method: "PATCH",
		body: JSON.stringify({ status: input.status, priority: input.priority, assigned_team: input.assignedTeam }),
	});
	return toTicket(payload);
}

export const registerCustomer = (input: { name: string; email: string; phone: string; password: string }) =>
	request<ApiCustomer>("/api/v1/customer/register", "customer", { method: "POST", body: JSON.stringify(input) }).then(toCustomer);

export const loginCustomer = (input: { email: string; password: string }) =>
	request<ApiCustomer>("/api/v1/customer/login", "customer", { method: "POST", body: JSON.stringify(input) }).then(toCustomer);

export const updateCustomer = (input: { name: string; phone: string }) =>
	request<ApiCustomer>("/api/v1/customer/me", "customer", { method: "PATCH", body: JSON.stringify(input) }).then(toCustomer);

export async function getCustomerTickets() {
	const payload = await request<{ items: ApiTicket[] }>("/api/v1/customer/tickets", "customer");
	return payload.items.map(toTicket);
}

export async function trackCustomerOrder(orderId: string): Promise<OrderTracking> {
	const value = await request<{ order_id: string; status: string; subtotal?: number; currency?: "THB"; tracking_number?: string; estimated_delivery?: string; updated_at: string }>(`/api/v1/customer/orders/${encodeURIComponent(orderId)}`, "customer");
	return { orderId: value.order_id, status: value.status, subtotal: value.subtotal, currency: value.currency, trackingNumber: value.tracking_number, estimatedDelivery: value.estimated_delivery, updatedAt: value.updated_at };
}

export async function payCustomerOrder(orderId: string): Promise<{ ok: boolean; message: string; order: { id: string; status: string; subtotal: number } }> {
	return request<{ ok: boolean; message: string; order: { id: string; status: string; subtotal: number } }>(`/api/v1/customer/orders/${encodeURIComponent(orderId)}/pay`, "customer", {
		method: "POST",
	});
}

export async function createPurchase(input: { items: { productId: string; quantity: number }[]; locale: "th" | "en" }): Promise<PurchaseResult> {
	const payload = await request<{ order: { id: string; status: string; subtotal: number; currency: "THB"; ai_provider: string }; ticket: { id: string } }>("/api/v1/customer/orders", "customer", {
		method: "POST",
		body: JSON.stringify({ items: input.items.map((item) => ({ product_id: item.productId, quantity: item.quantity })), locale: input.locale, idempotency_key: `web-${randomUUID()}` }),
	});
	return { orderId: payload.order.id, ticketId: payload.ticket.id, status: payload.order.status, subtotal: payload.order.subtotal, currency: payload.order.currency, aiProvider: payload.order.ai_provider };
}

export async function createTicket(draft: TicketDraft): Promise<TicketWorkItem> {
	const payload = await request<{ ticket: ApiTicket; run: ApiRun }>("/api/v1/tickets", "customer", {
		method: "POST",
		body: JSON.stringify({
			message: draft.message,
			customer: draft.customer,
			customer_id: draft.customerId,
			channel: draft.channel,
			locale: draft.locale,
			handling_mode: draft.handlingMode,
			conversation_context: draft.conversationContext,
			idempotency_key: draft.idempotencyKey,
			...(draft.subject ? { subject: draft.subject } : {}),
			...(draft.orderId ? { order_id: draft.orderId } : {}),
		}),
	});
	const ticket = toTicket(payload.ticket);
	return { ticket, run: toRun(payload.run, ticket.id) };
}

export async function getCustomerChatHistory(): Promise<TicketWorkItem[]> {
	const payload = await request<{ items: Array<{ ticket: ApiTicket; run: ApiRun }> }>("/api/v1/customer/chat-history", "customer");
	return payload.items.map((item) => {
		const ticket = toTicket(item.ticket);
		return { ticket, run: toRun(item.run, ticket.id) };
	});
}

export async function submitDecision(runId: string, decision: Decision, note?: string): Promise<DecisionResponse> {
	try {
		const payload = await request<ApiRun>(`/api/v1/runs/${encodeURIComponent(runId)}/decision`, "admin", {
			method: "POST",
			body: JSON.stringify({ decision, ...(note ? { note } : {}) }),
		});
		return { ok: true, message: "Decision confirmed", run: toRun(payload, runId) };
	} catch (error) {
		return { ok: false, message: error instanceof Error ? error.message : "Decision was not confirmed" };
	}
}

export async function getAuditEvents(filters: AuditFilters): Promise<AuditData> {
	const query = new URLSearchParams({ limit: "25" });
	if (filters.cursor) query.set("cursor", filters.cursor);
	if (filters.action) query.set("action", filters.action);
	if (filters.outcome) query.set("outcome", filters.outcome);
	if (filters.resourceId) query.set("resource_id", filters.resourceId);
	try {
		const payload = await request<{ items: ApiAuditEvent[]; next_cursor?: string }>(`/api/v1/audit-events?${query}`, "admin");
		return { items: payload.items.map(toAuditEvent), nextCursor: payload.next_cursor };
	} catch (error) {
		return { items: [], loadError: error instanceof Error ? error.message : "Audit service is unavailable" };
	}
}

export async function getKpiAnalytics(): Promise<KpiAnalytics | null> {
	try {
		const payload = await request<{
			total_tickets: number;
			resolved_tickets: number;
			zero_touch_rate: number;
			human_assisted_rate: number;
			avg_confidence: number;
			estimated_hours_saved: number;
			estimated_cost_saved_thb: number;
			csat_score: number;
			sentiment_distribution: { positive: number; neutral: number; urgent_dispute: number };
		}>("/api/v1/analytics/kpi", "admin");
		return {
			totalTickets: payload.total_tickets,
			resolvedTickets: payload.resolved_tickets,
			zeroTouchRate: payload.zero_touch_rate,
			humanAssistedRate: payload.human_assisted_rate,
			avgConfidence: payload.avg_confidence,
			estimatedHoursSaved: payload.estimated_hours_saved,
			estimatedCostSavedThb: payload.estimated_cost_saved_thb,
			csatScore: payload.csat_score,
			sentimentDistribution: {
				positive: payload.sentiment_distribution.positive,
				neutral: payload.sentiment_distribution.neutral,
				urgentDispute: payload.sentiment_distribution.urgent_dispute,
			},
		};
	} catch {
		return null;
	}
}

export async function submitTicketFeedback(ticketId: string, feedback: TicketFeedbackInput): Promise<{ success: boolean }> {
	try {
		const payload = await request<{ success: boolean }>(`/api/v1/tickets/${encodeURIComponent(ticketId)}/feedback`, "admin", {
			method: "POST",
			body: JSON.stringify({
				feedback_type: feedback.feedbackType,
				rating: feedback.rating,
				original_draft: feedback.originalDraft,
				edited_reply: feedback.editedReply,
				notes: feedback.notes,
			}),
		});
		return { success: payload.success };
	} catch {
		return { success: false };
	}
}
