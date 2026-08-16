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

const injectionMarkers = ["ignore all policy", "ignore previous", "system prompt", "call every", "api key", "card numbers", "tenant-blue", "ลืมคำสั่งก่อนหน้า", "เปิดเผย", "เรียกใช้ทุกเครื่องมือ"] as const;

export class PolicyService {
  evaluate(message: string, classification: ClassificationResult, retrieval: RetrievalResult): PolicyDecision {
    const normalized = message.normalize("NFKC").toLocaleLowerCase().replace(/\s+/gu, " ");
    if (classification.category === "security" || injectionMarkers.some((marker) => normalized.includes(marker))) {
      return { allowed: false, requires_approval: false, risk_level: "high", reasons: ["Potential prompt injection, data exfiltration, or tenant-boundary request."] };
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
  snapshot() { const values = [...this.latencies].sort((a, b) => a - b); const percentile = (value: number) => values[Math.max(0, Math.ceil(values.length * value) - 1)] ?? 0; return { requests_total: this.requests, failures_total: this.failures, approvals_pending: this.pending, abstentions_total: this.abstentions, automation_evaluated_total: this.automationEvaluated, automation_completed_total: this.autoCompleted, automation_routed_total: this.autoRouted, customer_followups_total: this.customerFollowups, handling_manual_total: this.manualSelected, handling_copilot_total: this.copilotSelected, handling_autopilot_total: this.autopilotSelected, latency_p50_ms: percentile(0.5), latency_p95_ms: percentile(0.95), metrics: [{ name: "failure_rate", value: this.requests ? this.failures / this.requests : 0, unit: "ratio", status: this.failures ? "watch" : "healthy" }, { name: "approval_backlog", value: this.pending, unit: "tickets", status: this.pending > 20 ? "watch" : "healthy" }, { name: "automation_rate", value: this.automationEvaluated ? this.autoCompleted / this.automationEvaluated : 0, unit: "ratio", status: "healthy" }, { name: "autopilot_adoption", value: this.automationEvaluated ? this.autopilotSelected / this.automationEvaluated : 0, unit: "ratio", status: "healthy" }] }; }
}

export class ModelRoutingService {
  route(category: Category, priority: Priority, messageLength: number) {
    const inputTokens = Math.max(20, Math.ceil(messageLength / 3));
    const isUrgent = priority === "urgent" || category === "security" || category === "billing";
    const isComplex = priority === "high" || category === "refund_request";

    let model = "gpt-4o-mini";
    let provider = "openai";
    let reason = "Standard ticket category: routed to fast, cost-efficient small model";
    let outputTokens = 120;
    let costPer1MInput = 0.15;
    let costPer1MOutput = 0.60;

    if (isUrgent) {
      model = "gpt-4o";
      reason = "Urgent/Security ticket: routed to high-reasoning flagship model";
      outputTokens = 250;
      costPer1MInput = 2.50;
      costPer1MOutput = 10.00;
    } else if (isComplex) {
      model = "claude-3-5-haiku";
      provider = "anthropic";
      reason = "Complex request: routed to balanced latency-cost model";
      outputTokens = 180;
      costPer1MInput = 0.80;
      costPer1MOutput = 4.00;
    }

    const costUsd = Number(((inputTokens * costPer1MInput + outputTokens * costPer1MOutput) / 1_000_000).toFixed(6));
    const costThb = Number((costUsd * 36.0).toFixed(4));

    return {
      model,
      provider,
      reason,
      estimated_input_tokens: inputTokens,
      estimated_output_tokens: outputTokens,
      estimated_cost_usd: costUsd,
      estimated_cost_thb: costThb,
    };
  }
}

