import type { AssistRequest, AutomationResult, Category, ClassificationResult, ExtractedEntities, HandlingMode, PolicyDecision, RetrievalResult } from "./domain.js";

const categoryTeams: Record<Category, string> = {
	account_access: "Trust & Safety",
	billing: "Billing & Refunds",
	general: "Customer Support",
	order_status: "Sales & Orders",
	policy: "Customer Support",
	purchase: "Sales & Orders",
	refund_request: "Billing & Refunds",
	refund_status: "Billing & Refunds",
	security: "Trust & Safety",
	technical: "Technical Support",
};

const requestedActions: Record<Category, string> = {
	account_access: "secure_account",
	billing: "review_billing",
	general: "answer_question",
	order_status: "check_order_status",
	policy: "answer_policy",
	purchase: "confirm_purchase",
	refund_request: "request_refund",
	refund_status: "check_refund_status",
	security: "block_unsafe_request",
	technical: "diagnose_technical_issue",
};

const reference = (message: string, prefix: string) => message.match(new RegExp(`\\b${prefix}[-_]?[A-Z0-9]{4,}\\b`, "iu"))?.[0]?.toUpperCase().replace("_", "-") ?? null;

export class AutomationService {
	extract(request: AssistRequest, classification: ClassificationResult): ExtractedEntities {
		const language = request.locale === "th" || (request.locale === "auto" && /[\u0E00-\u0E7F]/u.test(request.message)) ? "th" : "en";
		const orderId = request.order_id ?? reference(request.message, "(?:ORD|SO)");
		const refundId = reference(request.message, "(?:REF|RF)");
		const needsOrder = ["order_status", "refund_status", "refund_request"].includes(classification.category);
		return {
			order_id: orderId,
			refund_id: refundId,
			language,
			requested_action: requestedActions[classification.category],
			missing_fields: needsOrder && !orderId && !refundId ? ["order_id"] : [],
			confidence: classification.confidence,
		};
	}

	plan(classification: ClassificationResult, retrieval: RetrievalResult, policy: PolicyDecision, entities: ExtractedEntities, handlingMode: HandlingMode = "autopilot"): AutomationResult {
		const assignedTeam = categoryTeams[classification.category];
		const actions: AutomationResult["actions"] = [
			{ type: "extract_entities", status: "completed", risk: "read", detail: entities.order_id || entities.refund_id ? "Reference extracted from the customer request." : "Request analyzed; no reference was found." },
			{ type: "route_ticket", status: "completed", risk: "low_write", detail: `Ticket routed to ${assignedTeam}.` },
			{ type: "set_priority", status: "completed", risk: "low_write", detail: `Priority set to ${classification.priority}.` },
		];

		const tool = classification.category === "order_status" ? "lookup_order" : classification.category === "refund_status" ? "lookup_refund" : "search_policy";
		if (["order_status", "refund_status", "policy"].includes(classification.category)) {
			actions.push({ type: tool, status: retrieval.sufficient_evidence ? "completed" : entities.missing_fields.length ? "needs_input" : "blocked", risk: "read", detail: retrieval.sufficient_evidence ? "Authorized evidence was retrieved automatically." : retrieval.abstention_reason ?? "No verified evidence was found." });
		}

		const baseTags = [classification.category, classification.priority, entities.language, handlingMode];
		if (!policy.allowed) return { handling_mode: handlingMode, mode: "refused", assigned_team: assignedTeam, tags: [...baseTags, "blocked"], next_question: null, actions: [...actions, { type: "draft_response", status: "blocked", risk: "read", detail: "Unsafe request was blocked by deterministic policy." }] };

		if (handlingMode === "manual") {
			return {
				handling_mode: handlingMode,
				mode: "manual_queue",
				assigned_team: assignedTeam,
				tags: [...baseTags, "human-handling"],
				next_question: null,
				actions: actions.map((action) => action.type === "extract_entities" ? action : { ...action, detail: `${action.detail} Applied by deterministic intake rules; no AI business tool was called.` }),
			};
		}

		if (policy.requires_approval) return { handling_mode: handlingMode, mode: "needs_approval", assigned_team: assignedTeam, tags: [...baseTags, "approval-required"], next_question: null, actions: [...actions, { type: "create_escalation", status: "pending", risk: "high_write", detail: "Escalation will be created only after a human approves it." }] };

		if (entities.missing_fields.length) {
			const nextQuestion = entities.language === "th" ? "กรุณาระบุเลขคำสั่งซื้อ เพื่อให้ระบบตรวจสอบข้อมูลล่าสุดให้อัตโนมัติ" : "Please provide the order number so I can check the latest verified status automatically.";
			return { handling_mode: handlingMode, mode: "needs_customer", assigned_team: assignedTeam, tags: [...baseTags, "needs-information"], next_question: nextQuestion, actions: [...actions, { type: "request_information", status: "completed", risk: "read", detail: "Asked the customer for the missing order reference." }] };
		}

		const generalAnswer = retrieval.retrieval_version === "general-conversation-v1";
		const autoCompleted = generalAnswer || (retrieval.sufficient_evidence && ["order_status", "refund_status", "policy"].includes(classification.category));
		actions.push({ type: "draft_response", status: retrieval.sufficient_evidence ? "completed" : "blocked", risk: "read", detail: generalAnswer ? "A general-knowledge response was prepared without using customer or company records." : retrieval.sufficient_evidence ? "A grounded response was prepared automatically." : "The system abstained because evidence was insufficient." });
		return {
			handling_mode: handlingMode,
			mode: handlingMode === "copilot" && (retrieval.sufficient_evidence || generalAnswer) ? "copilot_ready" : autoCompleted ? "auto_completed" : "auto_routed",
			assigned_team: assignedTeam,
			tags: [...baseTags, ...(generalAnswer ? ["general-answer"] : []), handlingMode === "copilot" ? "staff-review" : autoCompleted ? "auto-resolved" : "staff-review"],
			next_question: null,
			actions,
		};
	}
}
