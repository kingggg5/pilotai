import { randomUUID } from "node:crypto";

import type { FastifyRequest } from "fastify";

import type { AuditActorType, AuditEvent, AuditOutcome, Principal } from "./domain.js";
import type { AuditRepository } from "./repositories/index.js";

const sensitiveKey = /authorization|cookie|password|secret|token|api[_-]?key|message|content|email|phone|customer/i;
const MAX_DEPTH = 4;
const MAX_ITEMS = 30;
const MAX_TEXT = 500;

export const AuditActions = {
	workflowStarted: "workflow.started",
	approvalApproved: "approval.approved",
	approvalRejected: "approval.rejected",
	approvalReauthorized: "approval.reauthorized",
	ticketCreated: "ticket.created",
	ticketUpdated: "ticket.updated",
	handlingModeSelected: "workflow.handling_mode_selected",
	automationCompleted: "automation.completed",
	customerRegistered: "customer.registered",
	customerLogin: "customer.login",
	customerProfileUpdated: "customer.profile_updated",
	ticketReplay: "ticket.idempotent_replay",
	knowledgeUpserted: "knowledge.upserted",
	orderRead: "order.status_read",
	orderCreated: "order.created",
	orderPaid: "order.paid",
	refundRead: "refund.status_read",
	catalogUpdated: "catalog.product_updated",
	feedbackRecorded: "ticket.feedback_recorded",
	kpiRequested: "analytics.kpi_read",
	webhookAccepted: "webhook.accepted",
	webhookReplay: "webhook.idempotent_replay",
	requestDenied: "request.denied",
	requestFailed: "request.failed",
} as const;

function safeValue(value: unknown, depth = 0): unknown {
	if (depth >= MAX_DEPTH) return "[truncated]";
	if (typeof value === "string") return value.slice(0, MAX_TEXT);
	if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
	if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((item) => safeValue(item, depth + 1));
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value as Record<string, unknown>)
			.slice(0, MAX_ITEMS)
			.map(([key, item]) => [key, sensitiveKey.test(key) ? "[redacted]" : safeValue(item, depth + 1)]));
	}
	return String(value).slice(0, MAX_TEXT);
}

export function sanitizeAuditMetadata(metadata: Record<string, unknown> = {}) {
	return safeValue(metadata) as Record<string, unknown>;
}

export type AuditWrite = {
	principal: Principal;
	action: string;
	resourceType: string;
	resourceId?: string | null;
	outcome?: AuditOutcome;
	actorType?: AuditActorType;
	requestId?: string | null;
	metadata?: Record<string, unknown>;
};

export class AuditService {
	constructor(readonly repository: AuditRepository) {}

	async record(input: AuditWrite): Promise<AuditEvent> {
		const event: AuditEvent = {
			id: randomUUID(),
			tenant_id: input.principal.tenant_id,
			occurred_at: new Date().toISOString(),
			actor_id: input.principal.subject,
			actor_type: input.actorType ?? "user",
			action: input.action,
			resource_type: input.resourceType,
			resource_id: input.resourceId ?? null,
			outcome: input.outcome ?? "success",
			request_id: input.requestId ?? null,
			metadata: sanitizeAuditMetadata(input.metadata),
		};
		await this.repository.append(event);
		return event;
	}

	fromRequest(request: FastifyRequest, principal: Principal, input: Omit<AuditWrite, "principal" | "requestId">) {
		return this.record({ ...input, principal, requestId: request.id });
	}
}
