import { randomUUID } from "node:crypto";
import { Command, END, interrupt, MemorySaver, START, StateGraph, StateSchema } from "@langchain/langgraph";
import { z } from "zod";

import type { LanguageModel } from "./ai.js";
import { AutomationResult, ExtractedEntities, HandlingMode, ApprovalRecord, AssistResponse, ClassificationResult, PolicyDecision, RetrievalResult, TraceStep, RunUsage, type AssistRequest } from "./domain.js";
import type { TicketClassifier } from "./classifier.js";
import type { RunRepository } from "./repositories/index.js";
import { BusinessTools, EscalationNotifier, liveEvidence, normalizeForDetection, PolicyService } from "./services.js";
import { AutomationService } from "./automation.js";

const State = new StateSchema({
	thread_id: z.string(), message: z.string(), customer_id: z.string().nullable().optional(),
	order_id: z.string().nullable().optional(), metadata: z.record(z.string(), z.unknown()).default({}),
	conversation_context: z.array(z.object({ role: z.enum(["customer", "assistant"]), content: z.string() })).default([]),
	locale: z.string().default("auto"), handling_mode: HandlingMode.default("autopilot"), classification: ClassificationResult.optional(),
	retrieval: RetrievalResult.optional(), draft: z.string().optional(), policy: PolicyDecision.optional(),
	entities: ExtractedEntities.optional(), automation: AutomationResult.optional(),
	approval: ApprovalRecord.optional(), answer: z.string().optional(), escalation_id: z.string().optional(),
});
type TicketState = typeof State.State;

const businessContextMarkers = [
	"servicepilot", "order", "refund", "purchase", "payment", "billing", "account", "customer", "ticket", "support", "delivery", "tracking", "policy", "company", "founder", "private", "personal",
	"คำสั่งซื้อ", "คืนเงิน", "ซื้อสินค้า", "ชำระเงิน", "เรียกเก็บ", "บัญชี", "ลูกค้า", "ทิกเก็ต", "เจ้าหน้าที่", "พัสดุ", "ติดตาม", "นโยบาย", "บริษัท", "ผู้ก่อตั้ง", "ส่วนตัว", "ข้อมูลส่วนตัว", "ปัญหา", "ผิดพลาด", "ใช้งานไม่ได้", "ไม่ทำงาน", "ตรวจสอบ",
] as const;

// Free-form general knowledge is only allowed for question-shaped requests that
// the classifier also scored as "general"; vague follow-ups such as "it still
// does not work" must fall through to grounded retrieval instead.
function isGeneralKnowledgeRequest(message: string, classification: ClassificationResult) {
	if (classification.category !== "general" || (classification.probabilities.general ?? 0) < 0.2) return false;
	const normalized = normalizeForDetection(message);
	if (!normalized || businessContextMarkers.some((marker) => normalized.includes(marker))) return false;
	const questionShaped = normalized.endsWith("?")
		|| /^(what|who|when|where|why|how|which|can|could|would|do|does|did|is|are|tell|explain|define|สวัสดี|หวัดดี|ดีครับ|ดีค่ะ|ขอบคุณ|ขอบใจ|อะไร|ทำไม|ยังไง|อย่างไร|เมื่อไหร่|เมื่อไร|ที่ไหน|ใคร|ช่วยอะไร|ทำอะไรได้)/iu.test(normalized)
		|| /(ช่วยอะไรได้บ้าง|ทำอะไรได้บ้าง|มีอะไรบ้าง|what can you help|what do you do|how can you help|thank you|thanks)/iu.test(normalized);
	return questionShaped;
}

export class AssistanceWorkflow {
	readonly graph;
	readonly checkpointerBackend: string;

	constructor(
		readonly classifier: TicketClassifier,
		readonly tools: BusinessTools,
		readonly policy: PolicyService,
		readonly automation: AutomationService,
		readonly languageModel: LanguageModel,
		readonly runs: RunRepository,
		checkpointer: ConstructorParameters<typeof StateGraph>[1] extends never ? never : unknown = new MemorySaver(),
		checkpointerBackend = "memory",
		readonly approvalTtlMinutes = 30,
		readonly escalationNotifier?: EscalationNotifier,
	) {
		this.checkpointerBackend = checkpointerBackend;
		const builder = new StateGraph(State)
			.addNode("classify_request", (state) => this.classify(state))
			.addNode("extract_entities", (state) => this.extract(state))
			.addNode("retrieve_evidence", (state) => this.retrieve(state))
			.addNode("draft_response", (state) => this.draft(state))
			.addNode("check_policy", (state) => this.checkPolicy(state))
			.addNode("plan_automation", (state) => this.planAutomation(state))
			.addNode("request_approval", (state) => this.approve(state))
			.addNode("complete_workflow", (state) => this.complete(state))
			.addEdge(START, "classify_request")
			.addEdge("classify_request", "extract_entities")
			.addEdge("extract_entities", "retrieve_evidence")
			.addEdge("retrieve_evidence", "draft_response")
			.addEdge("draft_response", "check_policy")
			.addEdge("check_policy", "plan_automation")
			.addConditionalEdges("plan_automation", (state) => state.automation!.mode === "needs_approval" ? "request_approval" : "complete_workflow", { request_approval: "request_approval", complete_workflow: "complete_workflow" })
			.addEdge("request_approval", "complete_workflow")
			.addEdge("complete_workflow", END);
		this.graph = builder.compile({ checkpointer: checkpointer as never });
	}

	private async classify(state: TicketState) { return { classification: this.classifier.predict(state.message) }; }

	private async extract(state: TicketState) {
		const entities = this.automation.extract({ message: state.message, customer_id: state.customer_id, order_id: state.order_id, metadata: state.metadata, locale: state.locale as AssistRequest["locale"], handling_mode: state.handling_mode }, state.classification!);
		return { entities, order_id: state.order_id ?? entities.order_id ?? entities.refund_id };
	}

	private async retrieve(state: TicketState) {
		const classification = state.classification!;
		const query = `${classification.category}: ${state.message}`;
		if (state.handling_mode === "manual") return { retrieval: { query, documents: [], sufficient_evidence: false, top_score: 0, abstention_reason: "Human handling was selected; no AI business tool was called.", retrieval_version: "manual-intake-v1" } };
		if (isGeneralKnowledgeRequest(state.message, classification)) return { retrieval: { query, documents: [], sufficient_evidence: true, top_score: 0, abstention_reason: null, retrieval_version: "general-conversation-v1" } };
		if (["order_status", "refund_status"].includes(classification.category)) {
			if (!state.order_id) return { retrieval: { query, documents: [], sufficient_evidence: false, top_score: 0, abstention_reason: "An order number is required for a verified live lookup.", retrieval_version: "live-tool-v2" } };
			const tenantId = String(state.metadata.tenant_id ?? "tenant-local");
			const result = classification.category === "order_status" ? await this.tools.getOrderStatus(state.order_id, tenantId) : await this.tools.getRefundStatus(state.order_id, tenantId);
			const document = liveEvidence(classification.category, result);
			return { retrieval: { query, documents: document.score ? [document] : [], sufficient_evidence: Boolean(document.score), top_score: document.score, abstention_reason: document.score ? null : "The live record was not found.", retrieval_version: "live-tool-v2" } };
		}
		const tenantId = String(state.metadata.tenant_id ?? "tenant-local");
		const roles = Array.isArray(state.metadata.roles) ? state.metadata.roles.map(String) : [];
		return { retrieval: { ...await this.tools.searchPolicy(query, 5, tenantId, roles), retrieval_version: "hybrid-rrf-v2" } };
	}

	private async draft(state: TicketState) {
		if (state.handling_mode === "manual") return { draft: state.entities!.language === "th" ? "รับเรื่องแล้ว เจ้าหน้าที่จะตรวจสอบและติดต่อกลับ โดยระบบไม่ได้เรียกใช้เครื่องมือ AI เพื่อดำเนินการแทน" : "Your request is in the human queue. No AI business tool was used to act on it." };
		if (!state.retrieval!.sufficient_evidence) {
			if (state.entities!.missing_fields.length) return { draft: state.entities!.language === "th" ? "กรุณาระบุเลขคำสั่งซื้อ เพื่อให้ระบบตรวจสอบข้อมูลล่าสุดให้อัตโนมัติ" : "Please provide the order number so I can check the latest verified status automatically." };
			const thai = state.entities!.language === "th";
			return { draft: thai ? "ยังไม่พบหลักฐานที่ตรวจสอบได้เพียงพอ จึงขอไม่คาดเดาคำตอบ กรุณาระบุเลขคำสั่งซื้อหรือส่งเรื่องให้เจ้าหน้าที่ตรวจสอบ" : "I do not have enough verified evidence to answer safely. Please provide the order reference or route this ticket to a specialist." };
		}
		return { draft: await this.languageModel.draft({ message: state.message, customerId: state.customer_id ?? null, orderId: state.order_id ?? null, conversation: state.conversation_context, allowGeneralKnowledge: state.retrieval!.retrieval_version === "general-conversation-v1", classification: state.classification!, evidence: state.retrieval!.documents }) };
	}

	private async checkPolicy(state: TicketState) { return { policy: this.policy.evaluate(state.message, state.classification!, state.retrieval!) }; }

	private async planAutomation(state: TicketState) { return { automation: this.automation.plan(state.classification!, state.retrieval!, state.policy!, state.entities!, state.handling_mode) }; }

	private async approve(state: TicketState) {
		const expiresAt = new Date(Date.now() + this.approvalTtlMinutes * 60_000).toISOString();
		const response = ApprovalRecord.parse(interrupt({ type: "human_approval", reasons: state.policy!.reasons, risk_level: state.policy!.risk_level, draft: state.draft!, expires_at: expiresAt }));
		const updateAction = (status: "completed" | "blocked", detail: string) => ({ ...state.automation!, actions: state.automation!.actions.map((action) => action.type === "create_escalation" ? { ...action, status, detail } : action) });
		if (response.decision === "reject") return { approval: response, automation: { ...updateAction("blocked", "A human rejected the escalation; no write was performed."), mode: "human_rejected", tags: [...state.automation!.tags, "human-rejected"] } };
		const tenantId = String(state.metadata.tenant_id ?? "tenant-local");
		const escalation = await this.tools.createEscalation({ reason: response.feedback ?? state.message, priority: state.classification!.priority, threadId: state.thread_id, tenantId, customerId: state.customer_id ?? null, orderId: state.order_id ?? null });
		if (this.escalationNotifier?.enabled()) void this.escalationNotifier.notify({ escalation_id: escalation.escalation_id, thread_id: state.thread_id, tenant_id: tenantId, priority: escalation.priority, reason: response.feedback ?? state.message, customer_id: state.customer_id ?? null, order_id: state.order_id ?? null, created_at: escalation.created_at });
		return { approval: response, escalation_id: escalation.escalation_id, automation: { ...updateAction("completed", `Escalation ${escalation.escalation_id} was created after human approval.`), mode: "human_completed", tags: [...state.automation!.tags, "human-approved"] } };
	}

	private async complete(state: TicketState) {
		if (!state.policy!.allowed) return { answer: "I can't help reveal protected instructions, credentials, personal data, or information belonging to another tenant." };
		if (state.approval?.decision === "reject") return { answer: "The proposed write action was rejected. No external action was performed." };
		if (state.escalation_id) return { answer: `Approved and routed to the responsible team as ${state.escalation_id}.` };
		return { answer: state.draft! };
	}

	private config(threadId: string, tenantId: string) { return { configurable: { thread_id: `${tenantId}:${threadId}` } }; }

	private buildTrace(result: TicketState & Record<string, unknown>, prompt: unknown, provider: string): TraceStep[] {
		const classification = result.classification!;
		const retrieval = result.retrieval!;
		const entities = result.entities!;
		const policy = result.policy!;
		const automation = result.automation!;
		const manual = retrieval.retrieval_version === "manual-intake-v1";
		const trace: TraceStep[] = [
			{ id: "classify", title: "Classified request", detail: `${classification.category} • ${classification.priority} • confidence ${Math.round(classification.confidence * 100)}%`, status: "complete" },
			{ id: "extract", title: "Extracted request data", detail: entities.order_id || entities.refund_id || "No reference found", status: "complete" },
			{ id: "retrieve", title: manual ? "Human handling selected" : "Checked authorized sources", detail: `${retrieval.documents.length} source(s) • ${retrieval.retrieval_version}`, status: manual ? "skipped" : "complete" },
			{ id: "draft", title: "Prepared response", detail: `Provider: ${provider}`, status: "complete" },
			{ id: "policy", title: "Applied policy", detail: `${policy.risk_level} risk • ${policy.reasons[0] ?? "Policy checked"}`, status: "complete" },
			{ id: "automation", title: "Planned automation", detail: `${automation.mode} • ${automation.assigned_team}`, status: "complete" },
		];
		const pendingPrompt = prompt as { expires_at?: string | null } | null | undefined;
		const decision = result.approval;
		if (pendingPrompt) trace.push({ id: "approval", title: "Waiting for human decision", detail: pendingPrompt.expires_at ? `Risk ${policy.risk_level} • expires ${pendingPrompt.expires_at}` : `Risk ${policy.risk_level}`, status: "active" });
		else if (decision) trace.push({ id: "approval", title: decision.decision === "approve" ? "Approved by human" : "Rejected by human", detail: decision.reviewer ? `Reviewer: ${decision.reviewer}` : "Reviewer recorded in audit trail", status: "complete" });
		else trace.push({ id: "approval", title: "Approval not required", detail: "Policy allowed automated handling", status: "skipped" });
		return trace;
	}

	private usage(result: TicketState & Record<string, unknown>, startedAt: number): RunUsage {
		const conversationChars = (result.conversation_context ?? []).reduce((sum, turn) => sum + turn.content.length, 0);
		const evidenceChars = (result.retrieval?.documents ?? []).reduce((sum, doc) => sum + doc.content.length, 0);
		const outputChars = (result.draft ?? "").length + (result.answer ?? "").length;
		return {
			latency_ms: Math.max(0, Date.now() - startedAt),
			input_tokens_estimate: Math.max(1, Math.ceil(((result.message ?? "").length + conversationChars + evidenceChars) / 3)),
			output_tokens_estimate: Math.max(0, Math.ceil(outputChars / 3)),
		};
	}

	private static statusOf(result: TicketState & Record<string, unknown>, paused: boolean): AssistResponse["status"] {
		if (paused) return "awaiting_approval";
		if (!result.policy!.allowed) return "refused";
		if (result.automation!.mode === "manual_queue" || result.escalation_id || result.approval) return "completed";
		return result.retrieval!.sufficient_evidence ? "completed" : "needs_evidence";
	}

	private async response(result: TicketState & Record<string, unknown>, tenantId: string, startedAt: number): Promise<AssistResponse> {
		const interruptions = result.__interrupt__ as Array<{ value?: unknown }> | undefined;
		const prompt = interruptions?.[0]?.value;
		const response = AssistResponse.parse({
			status: AssistanceWorkflow.statusOf(result, Boolean(prompt)),
			thread_id: result.thread_id, classification: result.classification, retrieval: result.retrieval, draft: result.draft,
			policy: result.policy, entities: result.entities, automation: result.automation, approval: prompt ?? result.approval ?? null,
			answer: result.answer ?? null, escalation_id: result.escalation_id ?? null, provider: this.languageModel.name,
			trace: this.buildTrace(result, prompt, this.languageModel.name), usage: this.usage(result, startedAt),
		});
		await this.runs.save(response, tenantId);
		return response;
	}

	async start(request: AssistRequest, tenantId = "tenant-local", threadId: string = randomUUID()) {
		const startedAt = Date.now();
		const result = await this.graph.invoke({ thread_id: threadId, message: request.message, customer_id: request.customer_id, order_id: request.order_id, metadata: request.metadata ?? {}, conversation_context: request.conversation_context ?? [], locale: request.locale ?? "auto", handling_mode: request.handling_mode ?? "autopilot" }, this.config(threadId, tenantId));
		return this.response(result as TicketState & Record<string, unknown>, tenantId, startedAt);
	}

	async resume(threadId: string, decision: z.infer<typeof ApprovalRecord>, tenantId = "tenant-local") {
		const existing = await this.runs.get(threadId, tenantId);
		if (!existing) throw new Error("Workflow run not found");
		if (existing.status !== "awaiting_approval") throw new Error("Workflow is not awaiting approval");
		const prompt = existing.approval;
		if (prompt && "type" in prompt && prompt.type === "human_approval" && prompt.expires_at && Date.now() > Date.parse(prompt.expires_at)) throw new Error("Approval window expired; re-authorize the run before deciding");
		const startedAt = Date.now();
		const result = await this.graph.invoke(new Command({ resume: decision }), this.config(threadId, tenantId));
		return this.response(result as TicketState & Record<string, unknown>, tenantId, startedAt);
	}

	async reauthorize(threadId: string, tenantId = "tenant-local"): Promise<AssistResponse> {
		const existing = await this.runs.get(threadId, tenantId);
		if (!existing) throw new Error("Workflow run not found");
		if (existing.status !== "awaiting_approval" || !existing.approval || !("type" in existing.approval) || existing.approval.type !== "human_approval") throw new Error("Workflow is not awaiting approval");
		const expiresAt = new Date(Date.now() + this.approvalTtlMinutes * 60_000).toISOString();
		const updated = AssistResponse.parse({ ...existing, approval: { ...existing.approval, expires_at: expiresAt } });
		await this.runs.save(updated, tenantId);
		return updated;
	}

	status(threadId: string, tenantId = "tenant-local") { return this.runs.get(threadId, tenantId); }
}
