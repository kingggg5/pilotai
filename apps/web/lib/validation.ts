import type { Decision, TicketDraft } from "@/lib/types";

export const limits = { message: 8_000, subject: 240, identity: 128, note: 2_000 } as const;

export function parseTicketDraft(value: unknown): TicketDraft | null {
	if (!value || typeof value !== "object") return null;
	const body = value as Record<string, unknown>;
	const message = typeof body.message === "string" ? body.message.trim() : "";
	const customer = typeof body.customer === "string" ? body.customer.trim() : "";
	const customerId = typeof body.customerId === "string" ? body.customerId.trim() : "";
	const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
	const subject = typeof body.subject === "string" ? body.subject.trim() : "";
	const channel = body.channel === "email" || body.channel === "chat" || body.channel === "web" ? body.channel : "web";
	const locale = body.locale === "th" || body.locale === "en" ? body.locale : "auto";
	const handlingMode = body.handlingMode === "manual" || body.handlingMode === "copilot" || body.handlingMode === "autopilot" ? body.handlingMode : null;
	const conversationContext = Array.isArray(body.conversationContext)
		? body.conversationContext.flatMap((turn) => {
			if (!turn || typeof turn !== "object") return [];
			const value = turn as Record<string, unknown>;
			const role: "customer" | "assistant" | null = value.role === "customer" || value.role === "assistant" ? value.role : null;
			const content = typeof value.content === "string" ? value.content.trim() : "";
			return role && content && content.length <= 1_600 ? [{ role, content }] : [];
		}).slice(-8)
		: [];
	const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : "";
	if (message.length < 3 || message.length > limits.message || !customer || !customerId || !handlingMode) return null;
	if (idempotencyKey.length < 8 || idempotencyKey.length > 128) return null;
	if (customer.length > limits.identity || customerId.length > limits.identity || orderId.length > limits.identity || subject.length > limits.subject) return null;
	return { message, customer, customerId, orderId: orderId || undefined, subject: subject || undefined, channel, locale, handlingMode, conversationContext, idempotencyKey };
}

export function parseDecision(value: unknown): { runId: string; decision: Decision; note?: string } | null {
	if (!value || typeof value !== "object") return null;
	const body = value as Record<string, unknown>;
	const runId = typeof body.runId === "string" ? body.runId : "";
	const decision = body.decision === "approve" || body.decision === "reject" ? body.decision : null;
	const note = typeof body.note === "string" ? body.note.trim() : "";
	if (!runId || !decision || note.length > limits.note) return null;
	return { runId, decision, ...(note ? { note } : {}) };
}

export function parseTicketFeedback(value: unknown): { ticketId: string; feedbackType: "thumbs_up" | "thumbs_down" | "edited_reply"; rating?: number; notes?: string } | null {
	if (!value || typeof value !== "object") return null;
	const body = value as Record<string, unknown>;
	const ticketId = typeof body.ticketId === "string" ? body.ticketId.trim() : "";
	const feedbackType = body.feedbackType === "thumbs_up" || body.feedbackType === "thumbs_down" || body.feedbackType === "edited_reply" ? body.feedbackType : null;
	const rating = typeof body.rating === "number" && Number.isInteger(body.rating) && body.rating >= 1 && body.rating <= 5 ? body.rating : undefined;
	const notes = typeof body.notes === "string" ? body.notes.trim() : "";
	if (!ticketId || !feedbackType || notes.length > limits.note) return null;
	if (body.rating !== undefined && rating === undefined) return null;
	return { ticketId, feedbackType, ...(rating ? { rating } : {}), ...(notes ? { notes } : {}) };
}
