export type Language = "th" | "en";
export type Priority = "urgent" | "high" | "normal" | "low";
export type TicketStatus = "needs_approval" | "investigating" | "draft_ready" | "new" | "resolved";
export type Decision = "approve" | "reject";
export type WorkflowState = "awaiting_approval" | "running" | "completed" | "rejected" | "needs_evidence" | "refused";
export type HandlingMode = "manual" | "copilot" | "autopilot";

export interface Ticket {
	id: string;
	reference: string;
	subject: string;
	customer: string;
	customerId?: string;
	customerEmail?: string;
	customerPhone?: string;
	channel: "email" | "chat" | "web";
	handlingMode: HandlingMode;
	priority: Priority;
	status: TicketStatus;
	confidence: number;
	waitMinutes: number;
	summary: string;
	requestedAction: string;
	orderId?: string;
	amount?: string;
	tags: string[];
	runId?: string;
	locale: "auto" | "th" | "en";
	assignedTeam: string;
	createdAt: string;
	updatedAt: string;
}

export interface TraceStep {
	id: string;
	title: string;
	detail: string;
	status: "complete" | "active" | "pending" | "skipped";
}

export interface Evidence {
	id: string;
	title: string;
	source: string;
	excerpt: string;
	score: number;
	section: string;
}

export interface Run {
	id: string;
	ticketId: string;
	state: WorkflowState;
	recommendation: string;
	confidence: number;
	draft: string;
	decision?: Decision;
	escalationId?: string;
	reviewer?: string;
	trace: TraceStep[];
	evidence: Evidence[];
	entities: {
		orderId?: string;
		refundId?: string;
		language: Language;
		requestedAction: string;
		missingFields: string[];
	};
	automation: {
		handlingMode: HandlingMode;
		mode: "manual_queue" | "copilot_ready" | "auto_completed" | "auto_routed" | "needs_customer" | "needs_approval" | "human_completed" | "human_rejected" | "refused";
		assignedTeam: string;
		nextQuestion?: string;
		actions: Array<{ type: string; status: "completed" | "pending" | "needs_input" | "blocked"; risk: "read" | "low_write" | "high_write"; detail: string }>;
	};
	ai: {
		category: string;
		priority: string;
		modelVersion: string;
		provider: string;
		retrievalVersion?: string;
		riskLevel: string;
		reasons: string[];
		sufficientEvidence: boolean;
		topScore: number;
	};
}

export type QueueSort = "newest" | "oldest" | "priority";
export interface QueueFilters {
	query?: string;
	number?: string;
	priority?: Priority;
	status?: TicketStatus;
	channel?: Ticket["channel"];
	handlingMode?: HandlingMode;
	createdFrom?: string;
	createdTo?: string;
	sort: QueueSort;
}

export interface CustomerProfile {
	id: string;
	name: string;
	email: string;
	phone: string;
	createdAt: string;
	updatedAt: string;
}

export interface OrderTracking {
	orderId: string;
	status: string;
	subtotal?: number;
	currency?: "THB";
	trackingNumber?: string;
	estimatedDelivery?: string;
	updatedAt: string;
}

export interface PurchaseResult {
	orderId: string;
	ticketId: string;
	status: string;
	subtotal: number;
	currency: "THB";
	aiProvider: string;
}

export interface ConsoleData {
	tickets: Ticket[];
	runs: Record<string, Run>;
	source: "live" | "unavailable";
	checkedAt: string;
	loadError?: string;
	total: number;
	offset: number;
	limit: number;
}

export interface DecisionResponse {
	ok: boolean;
	message: string;
	run?: Run;
}

export interface TicketDraft {
	message: string;
	subject?: string;
	customer: string;
	customerId: string;
	orderId?: string;
	channel: "email" | "chat" | "web";
	locale: "auto" | "th" | "en";
	handlingMode: HandlingMode;
	conversationContext?: Array<{ role: "customer" | "assistant"; content: string }>;
	idempotencyKey: string;
}

export interface TicketWorkItem {
	ticket: Ticket;
	run: Run;
}

export type AuditOutcome = "success" | "denied" | "failure";

export interface AuditEvent {
	id: string;
	occurredAt: string;
	actorId: string;
	actorType: "user" | "service" | "system";
	action: string;
	resourceType: string;
	resourceId?: string;
	outcome: AuditOutcome;
	requestId?: string;
	metadata: Record<string, unknown>;
}

export interface AuditData {
	items: AuditEvent[];
	nextCursor?: string;
	loadError?: string;
}

export interface AuditFilters {
	cursor?: string;
	action?: string;
	outcome?: AuditOutcome;
	resourceId?: string;
}

export interface KpiAnalytics {
	totalTickets: number;
	resolvedTickets: number;
	zeroTouchRate: number;
	humanAssistedRate: number;
	avgConfidence: number;
	estimatedHoursSaved: number;
	estimatedCostSavedThb: number;
	csatScore: number;
	sentimentDistribution: {
		positive: number;
		neutral: number;
		urgentDispute: number;
	};
}

export interface TicketFeedbackInput {
	feedbackType: "thumbs_up" | "thumbs_down" | "edited_reply" | "escalated";
	rating?: number;
	originalDraft?: string;
	editedReply?: string;
	notes?: string;
}
