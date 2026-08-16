import { z } from "zod";

export const Category = z.enum(["account_access", "billing", "general", "order_status", "policy", "purchase", "refund_request", "refund_status", "security", "technical"]);
export const Priority = z.enum(["low", "normal", "high", "urgent"]);
export const TicketStatus = z.enum(["new", "investigating", "needs_approval", "draft_ready", "resolved"]);
export const WorkflowStatus = z.enum(["awaiting_approval", "completed", "needs_evidence", "refused"]);
export const RiskLevel = z.enum(["low", "medium", "high"]);
export const Locale = z.enum(["auto", "th", "en"]);
export const HandlingMode = z.enum(["manual", "copilot", "autopilot"]);
export type Category = z.infer<typeof Category>;
export type Priority = z.infer<typeof Priority>;
export type TicketStatus = z.infer<typeof TicketStatus>;
export type WorkflowStatus = z.infer<typeof WorkflowStatus>;
export type HandlingMode = z.infer<typeof HandlingMode>;

export const ProductLine = z.object({
	product_id: z.string().min(1).max(128),
	name: z.string().min(1).max(240),
	variant: z.string().min(1).max(120),
	quantity: z.number().int().min(1).max(20),
	unit_price: z.number().nonnegative(),
	currency: z.literal("THB").default("THB"),
});
export type ProductLine = z.infer<typeof ProductLine>;

export const CatalogProduct = z.object({
	id: z.string().min(1).max(128),
	name: z.string().min(1).max(240),
	variant: z.string().min(1).max(120),
	unit_price: z.number().nonnegative(),
	currency: z.literal("THB"),
	image_url: z.string().min(1).max(2_000),
	source_url: z.string().url().max(2_000).nullable(),
	active: z.boolean(),
});
export type CatalogProduct = z.infer<typeof CatalogProduct>;

export const OrderStatus = z.enum(["pending_review", "confirmed", "processing", "shipped", "cancelled", "paid"]);
export type OrderStatus = z.infer<typeof OrderStatus>;
export const OrderRecord = z.object({
	id: z.string().min(1).max(128), customer_id: z.string().min(1).max(128), customer_name: z.string().min(1).max(240),
	customer_email: z.string().email(), customer_phone: z.string().min(7).max(32), items: z.array(ProductLine).min(1).max(20),
	subtotal: z.number().nonnegative(), currency: z.literal("THB"), status: OrderStatus, ticket_id: z.string().min(1),
	ai_provider: z.string().min(1).max(80), ai_category: Category, ai_priority: Priority, ai_confidence: z.number().min(0).max(1),
	tracking_number: z.string().max(128).nullable().optional(), estimated_delivery: z.string().max(64).nullable().optional(),
	created_at: z.string().datetime(), updated_at: z.string().datetime(),
});
export type OrderRecord = z.infer<typeof OrderRecord>;
export const PurchaseRequest = z.object({
	items: z.array(z.object({ product_id: z.string().min(1).max(128), quantity: z.number().int().min(1).max(20) })).min(1).max(20),
	locale: Locale.default("auto"),
	idempotency_key: z.string().min(8).max(128).nullable().optional(),
});
export type PurchaseRequest = z.infer<typeof PurchaseRequest>;

export const ClassificationResult = z.object({
	category: Category,
	priority: Priority,
	confidence: z.number().min(0).max(1),
	probabilities: z.record(z.string(), z.number()),
	priority_probabilities: z.record(z.string(), z.number()),
	model_version: z.string(),
});
export type ClassificationResult = z.infer<typeof ClassificationResult>;

export const EvidenceDocument = z.object({
	id: z.string(), title: z.string(), content: z.string(), source: z.string(),
	page_number: z.number().int().positive().nullable().optional(),
	page_label: z.string().nullable().optional(), citation: z.string(),
	score: z.number().min(0).max(1), metadata: z.record(z.string(), z.unknown()).default({}),
});
export type EvidenceDocument = z.infer<typeof EvidenceDocument>;

export const RetrievalResult = z.object({
	query: z.string(), documents: z.array(EvidenceDocument), sufficient_evidence: z.boolean(),
	top_score: z.number().min(0).max(1), abstention_reason: z.string().nullable().optional(),
	retrieval_version: z.string().default("hybrid-rrf-v2"),
});
export type RetrievalResult = z.infer<typeof RetrievalResult>;

export const PolicyDecision = z.object({
	allowed: z.boolean(), requires_approval: z.boolean(), risk_level: RiskLevel, reasons: z.array(z.string()),
});
export type PolicyDecision = z.infer<typeof PolicyDecision>;

export const ExtractedEntities = z.object({
	order_id: z.string().max(128).nullable(),
	refund_id: z.string().max(128).nullable(),
	language: z.enum(["th", "en"]),
	requested_action: z.string().max(120),
	missing_fields: z.array(z.string().max(80)),
	confidence: z.number().min(0).max(1),
});
export type ExtractedEntities = z.infer<typeof ExtractedEntities>;

export const AutomationAction = z.object({
	type: z.enum(["extract_entities", "lookup_order", "lookup_refund", "search_policy", "route_ticket", "set_priority", "draft_response", "request_information", "create_escalation"]),
	status: z.enum(["completed", "pending", "needs_input", "blocked"]),
	risk: z.enum(["read", "low_write", "high_write"]),
	detail: z.string().max(500),
});
export type AutomationAction = z.infer<typeof AutomationAction>;

export const AutomationResult = z.object({
	handling_mode: HandlingMode,
	mode: z.enum(["manual_queue", "copilot_ready", "auto_completed", "auto_routed", "needs_customer", "needs_approval", "human_completed", "human_rejected", "refused"]),
	assigned_team: z.string().max(120),
	tags: z.array(z.string().max(80)),
	next_question: z.string().max(500).nullable(),
	actions: z.array(AutomationAction),
});
export type AutomationResult = z.infer<typeof AutomationResult>;

export const ApprovalPrompt = z.object({
	type: z.literal("human_approval").default("human_approval"), reasons: z.array(z.string()),
	risk_level: RiskLevel, draft: z.string(),
});
export const ApprovalRecord = z.object({
	decision: z.enum(["approve", "reject"]), feedback: z.string().max(2_000).nullable().optional(),
	reviewer: z.string().max(128).nullable().optional(),
});
export type ApprovalRecord = z.infer<typeof ApprovalRecord>;

export const AssistRequest = z.object({
	message: z.string().trim().min(3).max(8_000), customer_id: z.string().max(128).nullable().optional(),
	order_id: z.string().max(128).nullable().optional(), metadata: z.record(z.string(), z.unknown()).default({}),
	conversation_context: z.array(z.object({ role: z.enum(["customer", "assistant"]), content: z.string().trim().min(1).max(1_600) })).max(8).default([]),
	locale: Locale.default("auto"), handling_mode: HandlingMode.default("autopilot"),
});
export type AssistRequest = z.input<typeof AssistRequest>;
export const ApprovalResumeRequest = z.object({
	decision: z.enum(["approve", "reject"]), feedback: z.string().max(2_000).nullable().optional(),
	reviewer: z.string().max(128).nullable().optional(),
});
export const DecisionRequest = z.object({ decision: z.enum(["approve", "reject"]), note: z.string().max(2_000).nullable().optional() });

export const AssistResponse = z.object({
	thread_id: z.string(), status: WorkflowStatus, classification: ClassificationResult,
	retrieval: RetrievalResult, draft: z.string(), policy: PolicyDecision,
	entities: ExtractedEntities, automation: AutomationResult,
	approval: z.union([ApprovalPrompt, ApprovalRecord]).nullable().optional(), answer: z.string().nullable().optional(),
	escalation_id: z.string().nullable().optional(), trace_id: z.string().nullable().optional(), provider: z.string(),
});
export type AssistResponse = z.infer<typeof AssistResponse>;

export const TicketSummary = z.object({
	id: z.string(), reference: z.string(), subject: z.string(), customer: z.string(),
	customer_id: z.string().nullable().optional(), customer_email: z.string().nullable().optional(), customer_phone: z.string().nullable().optional(),
	channel: z.enum(["email", "chat", "web"]),
	locale: Locale, priority: Priority, status: TicketStatus,
	handling_mode: HandlingMode.default("autopilot"),
	confidence: z.number().min(0).max(1), wait_minutes: z.number().int().nonnegative(),
	summary: z.string(), requested_action: z.string(), order_id: z.string().nullable().optional(),
	amount: z.string().nullable().optional(), assigned_team: z.string().max(120),
	created_at: z.string().datetime(), updated_at: z.string().datetime(),
	tags: z.array(z.string()).default([]), run_id: z.string().nullable().optional(),
});
export type TicketSummary = z.infer<typeof TicketSummary>;
export const TicketCreateRequest = z.object({
	message: z.string().trim().min(3).max(8_000), subject: z.string().max(240).nullable().optional(),
	customer: z.string().trim().min(1).max(240).default("Customer"), customer_id: z.string().max(128).nullable().optional(),
	order_id: z.string().max(128).nullable().optional(), channel: z.enum(["email", "chat", "web"]).default("web"),
	conversation_context: z.array(z.object({ role: z.enum(["customer", "assistant"]), content: z.string().trim().min(1).max(1_600) })).max(8).default([]),
	locale: Locale.default("auto"), handling_mode: HandlingMode.default("autopilot"),
	idempotency_key: z.string().min(8).max(128).nullable().optional(),
});
export type TicketCreateRequest = z.input<typeof TicketCreateRequest>;
export const TicketUpdateRequest = z.object({
	status: TicketStatus.optional(), priority: Priority.optional(), assigned_team: z.string().trim().min(1).max(120).optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one field is required");
export type TicketUpdateRequest = z.infer<typeof TicketUpdateRequest>;
export const TicketWorkItem = z.object({ ticket: TicketSummary, run: AssistResponse });
export type TicketWorkItem = z.infer<typeof TicketWorkItem>;

export type TicketListFilters = {
	query?: string;
	number?: string;
	priority?: Priority;
	status?: TicketStatus;
	channel?: "email" | "chat" | "web";
	handlingMode?: HandlingMode;
	createdFrom?: string;
	createdTo?: string;
	sort?: "newest" | "oldest" | "priority";
	customerId?: string;
};

export const CustomerProfile = z.object({
	id: z.string(), name: z.string(), email: z.string().email(), phone: z.string(),
	created_at: z.string().datetime(), updated_at: z.string().datetime(),
});
export type CustomerProfile = z.infer<typeof CustomerProfile>;
export const CustomerRegisterRequest = z.object({
	name: z.string().trim().min(2).max(120), email: z.string().trim().toLowerCase().email().max(240),
	phone: z.string().trim().min(7).max(32), password: z.string().min(10).max(128),
});
export const CustomerLoginRequest = z.object({ email: z.string().trim().toLowerCase().email().max(240), password: z.string().min(1).max(128) });
export const CustomerUpdateRequest = z.object({
	name: z.string().trim().min(2).max(120).optional(), phone: z.string().trim().min(7).max(32).optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one field is required");
export type CustomerRecord = CustomerProfile & { tenant_id: string; password_hash: string };

export const AuditOutcome = z.enum(["success", "denied", "failure"]);
export const AuditActorType = z.enum(["user", "service", "system"]);
export const AuditEvent = z.object({
	id: z.string().uuid(),
	tenant_id: z.string().min(1),
	occurred_at: z.string().datetime(),
	actor_id: z.string().min(1),
	actor_type: AuditActorType,
	action: z.string().min(3).max(120),
	resource_type: z.string().min(1).max(80),
	resource_id: z.string().max(256).nullable(),
	outcome: AuditOutcome,
	request_id: z.string().max(256).nullable(),
	metadata: z.record(z.string(), z.unknown()),
});
export type AuditEvent = z.infer<typeof AuditEvent>;
export type AuditOutcome = z.infer<typeof AuditOutcome>;
export type AuditActorType = z.infer<typeof AuditActorType>;

export const AuditQuery = z.object({
	cursor: z.string().max(512).optional(),
	limit: z.coerce.number().int().min(1).max(100).default(25),
	action: z.string().trim().max(120).default(""),
	outcome: z.union([AuditOutcome, z.literal("")]).default(""),
	resource_id: z.string().trim().max(256).default(""),
});
export type AuditQuery = z.infer<typeof AuditQuery>;
export const AuditPage = z.object({ items: z.array(AuditEvent), next_cursor: z.string().nullable() });
export type AuditPage = z.infer<typeof AuditPage>;

export const KnowledgeDocumentUpsert = z.object({
	id: z.string().min(3).max(128), source: z.string().min(1).max(500), title: z.string().min(1).max(500),
	content: z.string().min(3).max(100_000), page_number: z.number().int().positive().nullable().optional(),
	page_label: z.string().max(128).nullable().optional(), locale: z.enum(["th", "en", "multi"]).default("en"),
	acl: z.record(z.string(), z.unknown()).default({}), metadata: z.record(z.string(), z.unknown()).default({}),
});
export type KnowledgeDocumentUpsert = z.infer<typeof KnowledgeDocumentUpsert>;

export interface Principal {
	subject: string;
	tenant_id: string;
	roles: string[];
	auth_mode: "local" | "jwt" | "oidc";
	email?: string;
	name?: string;
	phone?: string;
}
export interface LiveOrderStatus { order_id: string; status: string; estimated_delivery?: string | null; tracking_number?: string | null; updated_at: string }
export interface RefundStatus { order_id: string; refund_id?: string | null; status: string; amount?: number | null; currency?: string | null; updated_at: string }
export interface Escalation { escalation_id: string; status: string; priority: Priority; created_at: string }

export const TicketFeedbackRequest = z.object({
	feedback_type: z.enum(["thumbs_up", "thumbs_down", "edited_reply", "escalated"]),
	rating: z.number().int().min(1).max(5).optional(),
	original_draft: z.string().max(10_000).optional(),
	edited_reply: z.string().max(10_000).optional(),
	notes: z.string().max(2000).optional(),
});
export type TicketFeedbackRequest = z.infer<typeof TicketFeedbackRequest>;

export const ModelRoutingInfo = z.object({
	model: z.string(),
	provider: z.string(),
	reason: z.string(),
	estimated_input_tokens: z.number().int().nonnegative(),
	estimated_output_tokens: z.number().int().nonnegative(),
	estimated_cost_usd: z.number().nonnegative(),
	estimated_cost_thb: z.number().nonnegative(),
});
export type ModelRoutingInfo = z.infer<typeof ModelRoutingInfo>;

export const AnalyticsKPI = z.object({
	total_tickets: z.number().int().nonnegative(),
	resolved_tickets: z.number().int().nonnegative(),
	zero_touch_rate: z.number().min(0).max(100),
	human_assisted_rate: z.number().min(0).max(100),
	avg_confidence: z.number().min(0).max(1),
	estimated_hours_saved: z.number().nonnegative(),
	estimated_cost_saved_thb: z.number().nonnegative(),
	csat_score: z.number().min(0).max(5),
	sentiment_distribution: z.object({
		positive: z.number().nonnegative(),
		neutral: z.number().nonnegative(),
		urgent_dispute: z.number().nonnegative(),
	}),
});
export type AnalyticsKPI = z.infer<typeof AnalyticsKPI>;
