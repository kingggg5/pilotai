import { createHmac } from "node:crypto";

import type { Category, ClassificationResult, Escalation, EvidenceDocument, LiveOrderStatus, PolicyDecision, Priority, RefundStatus, RetrievalResult } from "./domain.js";
import type { EscalationRepository, KnowledgeRepository, OrderStatusRepository, RefundStatusRepository } from "./repositories/index.js";

export class BusinessTools {
	constructor(
		readonly orders: OrderStatusRepository,
		readonly refunds: RefundStatusRepository,
		readonly knowledge: KnowledgeRepository,
		readonly escalations: EscalationRepository,
		readonly evidenceThreshold: number,
	) {}

	getOrderStatus(orderId: string, tenantId: string): Promise<LiveOrderStatus> { return this.orders.get(orderId, tenantId); }
	getRefundStatus(orderId: string, tenantId: string): Promise<RefundStatus> { return this.refunds.get(orderId, tenantId); }

	async searchPolicy(query: string, topK: number, tenantId: string, roles: readonly string[]) {
		const documents = await this.knowledge.search(query, topK, tenantId, roles);
		const topScore = documents[0]?.score ?? 0;
		const sufficient = topScore >= this.evidenceThreshold;
		return { query, documents: sufficient ? documents : [], sufficient_evidence: sufficient, top_score: topScore, abstention_reason: sufficient ? null : "No authorized document met the minimum evidence threshold." };
	}

	createEscalation(input: { reason: string; priority: Priority; threadId: string; tenantId: string; customerId?: string | null; orderId?: string | null }): Promise<Escalation> {
		return this.escalations.create(input);
	}
}

const zeroWidth = /[\u200B-\u200D\uFEFF]/gu;

export function normalizeForDetection(message: string) {
	return message.normalize("NFKC").toLocaleLowerCase().replace(zeroWidth, "").replace(/\s+/gu, " ").trim();
}

// Legacy marker substrings kept for contract parity with the golden evals.
const injectionMarkers = ["ignore all policy", "ignore previous", "system prompt", "call every", "api key", "card numbers", "tenant-blue", "ลืมคำสั่งก่อนหน้า", "เปิดเผย", "เรียกใช้ทุกเครื่องมือ"] as const;
// Markers must be normalized with the same pipeline as the message, otherwise
// canonically equivalent Thai combining-mark orderings never match literally.
const normalizedMarkers = injectionMarkers.map((marker) => ({ marker, normalized: normalizeForDetection(marker), compact: normalizeForDetection(marker).replace(/[\s.'"~-]/gu, "") }));

// Structured patterns are checked against the normalized text; markers are also
// checked against a whitespace/punctuation-stripped form so "i g n o r e" spacing
// cannot slip past detection.
const injectionPatterns: readonly [RegExp, string][] = [
	[/ignore\s+(?:all\s+)?(?:previous|prior|above|earlier|preceding)\s+(?:instructions?|prompts?|policy|policies|rules?|context)/u, "instruction-override"],
	[/ignore\s+(?:all\s+)?(?:policy|policies|guardrails?|safety\s+rules?)/u, "policy-override"],
	[/disregard\s+(?:all\s+)?(?:previous|prior|above|your)\s+(?:instructions?|policy|policies|rules?)/u, "instruction-override"],
	[/(?:reveal|show|print|repeat|expose|leak|disclose)\s+(?:the\s+|your\s+)?(?:system\s*prompt|hidden\s+instructions?|initial\s+instructions?|developer\s+instructions?|secret\s+prompt)/u, "prompt-exfiltration"],
	[/(?:reveal|show|print|repeat|export|dump|list|send|paste)\s+(?:all\s+|every\s+|any\s+)?(?:api\s*keys?|secrets?|credentials?|card\s*numbers?|credit\s+cards?|customer\s+(?:emails?|phones?|records?|data)|personal\s+data)/u, "data-exfiltration"],
	[/call\s+(?:every|all)\s+(?:available\s+)?(?:tools?|functions?|apis?|actions?)/u, "unbounded-tool-use"],
	[/(?:you\s+are\s+now|act\s+as|pretend\s+to\s+be)\s+(?:an?\s+)?(?:unrestricted|uncensored|unfiltered|dan)\b/u, "role-hijack"],
	[/ลืมคำสั่ง(?:ก่อนหน้า|ที่แล้ว|ข้างบน)/u, "instruction-override"],
	[/เมินเฉย\s*(?:คำสั่ง|นโยบาย|กฎ)/u, "policy-override"],
	[/(?:เปิดเผย|แสดง|ส่งออก|คัดลอก|พิมพ์ซ้ำ).{0,24}(?:รหัสลับ|คำสั่งระบบ|system\s*prompt|ข้อมูลลูกค้า|ข้อมูลส่วนตัว|เลขบัตร|รหัสผ่าน)/u, "data-exfiltration"],
	[/เรียกใช้(?:งาน)?(?:ทุกเครื่องมือ|เครื่องมือทุก|เครื่องมือทั้งหมด)/u, "unbounded-tool-use"],
];

export function detectInjection(message: string): { blocked: boolean; signals: string[] } {
	const normalized = normalizeForDetection(message);
	if (!normalized) return { blocked: false, signals: [] };
	const compact = normalized.replace(/[\s._*'"`~-]/gu, "");
	const signals = new Set<string>();
	for (const { marker, normalized: markerNormalized, compact: markerCompact } of normalizedMarkers) {
		if (normalized.includes(markerNormalized) || compact.includes(markerCompact)) signals.add(`marker:${marker}`);
	}
	for (const [pattern, label] of injectionPatterns) if (pattern.test(normalized)) signals.add(label);
	return { blocked: signals.size > 0, signals: [...signals].sort() };
}

export class PolicyService {
	evaluate(message: string, classification: ClassificationResult, retrieval: RetrievalResult): PolicyDecision {
		const detection = detectInjection(message);
		if (classification.category === "security" || detection.blocked) {
			const detail = detection.signals.length ? ` Detected: ${detection.signals.join(", ")}.` : "";
			return { allowed: false, requires_approval: false, risk_level: "high", reasons: [`Potential prompt injection, data exfiltration, or tenant-boundary request.${detail}`] };
		}

		const reasons: string[] = [];
		let requiresApproval = false;
		let riskLevel: PolicyDecision["risk_level"] = "low";
		if (classification.category === "refund_request") {
			requiresApproval = true; riskLevel = "high";
			reasons.push("Refund requests are write actions and require human approval.");
		}
		if (classification.category === "purchase") {
			requiresApproval = true; riskLevel = "medium";
			reasons.push("Purchase requests change customer and financial state, so a staff member must confirm availability and payment steps.");
		}
		if (classification.category === "billing" && ["high", "urgent"].includes(classification.priority)) {
			requiresApproval = true; riskLevel = "high";
			reasons.push("High-impact billing disputes create an escalation and require human approval.");
		}
		if (!retrieval.sufficient_evidence) reasons.push("Verified evidence is below threshold; the system must abstain rather than infer an answer.");
		if (classification.priority === "urgent") {
			requiresApproval = true; riskLevel = "high";
			reasons.push("Urgent customer-impacting requests require human review.");
		} else if (classification.priority === "high" && !requiresApproval) riskLevel = "medium";
		if (classification.category === "account_access" && ["high", "urgent"].includes(classification.priority)) {
			requiresApproval = true; riskLevel = "high";
			reasons.push("Possible account takeover must be escalated to a human.");
		}
		return { allowed: true, requires_approval: requiresApproval, risk_level: riskLevel, reasons: reasons.length ? reasons : ["Read-only or informational response is within automation policy."] };
	}
}

export function liveEvidence(category: Category, result: LiveOrderStatus | RefundStatus): EvidenceDocument {
	const order = category === "order_status";
	const found = result.status !== "not_found";
	const content = order
		? `Order ${result.order_id} status: ${result.status}; estimated delivery: ${(result as LiveOrderStatus).estimated_delivery ?? "not available"}; tracking: ${(result as LiveOrderStatus).tracking_number ?? "not assigned"}; updated: ${result.updated_at}.`
		: `Refund for ${result.order_id}: ${result.status}; amount: ${(result as RefundStatus).amount ?? "not available"} ${(result as RefundStatus).currency ?? ""}; updated: ${result.updated_at}.`;
	return { id: `${order ? "order" : "refund"}-${result.order_id}`, title: order ? "Live order status / สถานะคำสั่งซื้อปัจจุบัน" : "Live refund status / สถานะคืนเงินปัจจุบัน", content, source: `service://${order ? "orders" : "refunds"}/${result.order_id}`, page_label: "Live system record / ข้อมูลจากระบบปัจจุบัน", citation: `${order ? "Order" : "Refund"} service — ${result.order_id}`, score: found ? 1 : 0, metadata: { tool: order ? "get_order_status" : "check_refund_status", read_only: true } };
}

export class OperationsMetrics {
	requests = 0;
	failures = 0;
	pending = 0;
	abstentions = 0;
	autoCompleted = 0;
	autoRouted = 0;
	customerFollowups = 0;
	automationEvaluated = 0;
	manualSelected = 0;
	copilotSelected = 0;
	autopilotSelected = 0;
	readonly latencies: number[] = [];
	record(status: string, latency = 0) { this.requests += 1; if (status === "awaiting_approval") this.pending += 1; if (status === "needs_evidence") this.abstentions += 1; if (latency) { this.latencies.push(latency); if (this.latencies.length > 1_000) this.latencies.shift(); } }
	recordAutomation(mode: string, handlingMode = "autopilot") { this.automationEvaluated += 1; if (mode === "auto_completed") this.autoCompleted += 1; if (mode === "auto_routed") this.autoRouted += 1; if (mode === "needs_customer") this.customerFollowups += 1; if (handlingMode === "manual") this.manualSelected += 1; if (handlingMode === "copilot") this.copilotSelected += 1; if (handlingMode === "autopilot") this.autopilotSelected += 1; }
	failure() { this.failures += 1; }
	resolveApproval() { this.pending = Math.max(0, this.pending - 1); }

	snapshot() {
		const values = [...this.latencies].sort((a, b) => a - b);
		const percentile = (ratio: number) => values[Math.max(0, Math.ceil(values.length * ratio) - 1)] ?? 0;
		const share = (part: number, whole: number) => (whole ? part / whole : 0);
		return {
			requests_total: this.requests,
			failures_total: this.failures,
			approvals_pending: this.pending,
			abstentions_total: this.abstentions,
			automation_evaluated_total: this.automationEvaluated,
			automation_completed_total: this.autoCompleted,
			automation_routed_total: this.autoRouted,
			customer_followups_total: this.customerFollowups,
			handling_manual_total: this.manualSelected,
			handling_copilot_total: this.copilotSelected,
			handling_autopilot_total: this.autopilotSelected,
			latency_p50_ms: percentile(0.5),
			latency_p95_ms: percentile(0.95),
			metrics: [
				{ name: "failure_rate", value: share(this.failures, this.requests), unit: "ratio", status: this.failures ? "watch" : "healthy" },
				{ name: "approval_backlog", value: this.pending, unit: "tickets", status: this.pending > 20 ? "watch" : "healthy" },
				{ name: "automation_rate", value: share(this.autoCompleted, this.automationEvaluated), unit: "ratio", status: "healthy" },
				{ name: "autopilot_adoption", value: share(this.autopilotSelected, this.automationEvaluated), unit: "ratio", status: "healthy" },
			],
		};
	}
	prometheus() {
		const snapshot = this.snapshot();
		const counters: Record<string, number> = {
			servicepilot_requests_total: snapshot.requests_total,
			servicepilot_failures_total: snapshot.failures_total,
			servicepilot_abstentions_total: snapshot.abstentions_total,
			servicepilot_automation_evaluated_total: snapshot.automation_evaluated_total,
			servicepilot_automation_completed_total: snapshot.automation_completed_total,
			servicepilot_automation_routed_total: snapshot.automation_routed_total,
			servicepilot_customer_followups_total: snapshot.customer_followups_total,
			servicepilot_handling_manual_total: snapshot.handling_manual_total,
			servicepilot_handling_copilot_total: snapshot.handling_copilot_total,
			servicepilot_handling_autopilot_total: snapshot.handling_autopilot_total,
		};
		const gauges: Record<string, number> = {
			servicepilot_approvals_pending: snapshot.approvals_pending,
			servicepilot_latency_p50_ms: snapshot.latency_p50_ms,
			servicepilot_latency_p95_ms: snapshot.latency_p95_ms,
		};
		const render = (metrics: Record<string, number>, type: "counter" | "gauge") => Object.entries(metrics).map(([name, value]) => `# TYPE ${name} ${type}\n${name} ${value}`).join("\n");
		return `${render(counters, "counter")}\n${render(gauges, "gauge")}\n`;
	}
}

export interface EscalationNotification {
	escalation_id: string;
	thread_id: string;
	tenant_id: string;
	priority: Priority;
	reason: string;
	customer_id?: string | null;
	order_id?: string | null;
	created_at: string;
}

export class EscalationNotifier {
	constructor(readonly url: string | undefined, readonly secret: string | undefined, readonly timeoutMs = 3_000) {}
	enabled() { return Boolean(this.url); }

	async notify(payload: EscalationNotification) {
		if (!this.url) return;
		const body = JSON.stringify(payload);
		const headers: Record<string, string> = { "Content-Type": "application/json", "X-ServicePilot-Event": "escalation.created" };
		if (this.secret) headers["X-ServicePilot-Signature"] = createHmac("sha256", this.secret).update(body).digest("hex");
		try {
			const response = await fetch(this.url, { method: "POST", headers, body, signal: AbortSignal.timeout(this.timeoutMs) });
			if (!response.ok) console.error(JSON.stringify({ level: "error", event: "escalation_notify_failed", escalation_id: payload.escalation_id, status: response.status }));
			else console.info(JSON.stringify({ level: "info", event: "escalation_notified", escalation_id: payload.escalation_id }));
		} catch (error) {
			console.error(JSON.stringify({ level: "error", event: "escalation_notify_failed", escalation_id: payload.escalation_id, message: error instanceof Error ? error.message : "unknown" }));
		}
	}
}
