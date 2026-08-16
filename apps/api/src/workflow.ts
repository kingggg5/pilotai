import { randomUUID } from "node:crypto";
import { Command, END, interrupt, MemorySaver, START, StateGraph, StateSchema } from "@langchain/langgraph";
import { z } from "zod";

import type { LanguageModel } from "./ai.js";
import { AutomationResult, ExtractedEntities, HandlingMode, ApprovalRecord, AssistResponse, ClassificationResult, PolicyDecision, RetrievalResult, type AssistRequest } from "./domain.js";
import type { TicketClassifier } from "./classifier.js";
import type { RunRepository } from "./repositories/index.js";
import { BusinessTools, liveEvidence, PolicyService } from "./services.js";
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
		return { draft: await this.languageModel.draft({ message: state.message, customerId: state.customer_id ?? null, orderId: state.order_id ?? null, conversation: state.conversation_context, classification: state.classification!, evidence: state.retrieval!.documents }) };
	}

	private async checkPolicy(state: TicketState) { return { policy: this.policy.evaluate(state.message, state.classification!, state.retrieval!) }; }

	private async planAutomation(state: TicketState) { return { automation: this.automation.plan(state.classification!, state.retrieval!, state.policy!, state.entities!, state.handling_mode) }; }

	private async approve(state: TicketState) {
		const response = ApprovalRecord.parse(interrupt({ type: "human_approval", reasons: state.policy!.reasons, risk_level: state.policy!.risk_level, draft: state.draft! }));
		const updateAction = (status: "completed" | "blocked", detail: string) => ({ ...state.automation!, actions: state.automation!.actions.map((action) => action.type === "create_escalation" ? { ...action, status, detail } : action) });
		if (response.decision === "reject") return { approval: response, automation: { ...updateAction("blocked", "A human rejected the escalation; no write was performed."), mode: "human_rejected", tags: [...state.automation!.tags, "human-rejected"] } };
		const escalation = await this.tools.createEscalation({ reason: response.feedback ?? state.message, priority: state.classification!.priority, threadId: state.thread_id, tenantId: String(state.metadata.tenant_id ?? "tenant-local"), customerId: state.customer_id ?? null, orderId: state.order_id ?? null });
		return { approval: response, escalation_id: escalation.escalation_id, automation: { ...updateAction("completed", `Escalation ${escalation.escalation_id} was created after human approval.`), mode: "human_completed", tags: [...state.automation!.tags, "human-approved"] } };
	}

	private async complete(state: TicketState) {
		if (!state.policy!.allowed) return { answer: "I can't help reveal protected instructions, credentials, personal data, or information belonging to another tenant." };
		if (state.approval?.decision === "reject") return { answer: "The proposed write action was rejected. No external action was performed." };
		if (state.escalation_id) return { answer: `Approved and routed to the responsible team as ${state.escalation_id}.` };
		return { answer: state.draft! };
	}

	private config(threadId: string, tenantId: string) { return { configurable: { thread_id: `${tenantId}:${threadId}` } }; }

	private async response(result: TicketState & Record<string, unknown>, tenantId: string): Promise<AssistResponse> {
		const interruptions = result.__interrupt__ as Array<{ value?: unknown }> | undefined;
		const prompt = interruptions?.[0]?.value;
		const status = prompt ? "awaiting_approval" : !result.policy!.allowed ? "refused" : result.automation!.mode === "manual_queue" ? "completed" : result.escalation_id || result.approval ? "completed" : !result.retrieval!.sufficient_evidence ? "needs_evidence" : "completed";
		const response = AssistResponse.parse({ thread_id: result.thread_id, status, classification: result.classification, retrieval: result.retrieval, draft: result.draft, policy: result.policy, entities: result.entities, automation: result.automation, approval: prompt ?? result.approval ?? null, answer: result.answer ?? null, escalation_id: result.escalation_id ?? null, provider: this.languageModel.name });
		await this.runs.save(response, tenantId);
		return response;
	}

	async start(request: AssistRequest, tenantId = "tenant-local", threadId: string = randomUUID()) {
		const result = await this.graph.invoke({ thread_id: threadId, message: request.message, customer_id: request.customer_id, order_id: request.order_id, metadata: request.metadata ?? {}, conversation_context: request.conversation_context ?? [], locale: request.locale ?? "auto", handling_mode: request.handling_mode ?? "autopilot" }, this.config(threadId, tenantId));
		return this.response(result as TicketState & Record<string, unknown>, tenantId);
	}

	async resume(threadId: string, decision: z.infer<typeof ApprovalRecord>, tenantId = "tenant-local") {
		const existing = await this.runs.get(threadId, tenantId);
		if (!existing) throw new Error("Workflow run not found");
		if (existing.status !== "awaiting_approval") throw new Error("Workflow is not awaiting approval");
		const result = await this.graph.invoke(new Command({ resume: decision }), this.config(threadId, tenantId));
		return this.response(result as TicketState & Record<string, unknown>, tenantId);
	}

	status(threadId: string, tenantId = "tenant-local") { return this.runs.get(threadId, tenantId); }
}
