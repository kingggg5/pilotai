import { MemorySaver } from "@langchain/langgraph";

import { AutomationService } from "./automation.js";
import { HashEmbedder, LocalLanguageModel } from "./ai.js";
import { TicketClassifier } from "./classifier.js";
import { OrderRecord } from "./domain.js";
import { MemoryEscalationRepository, MemoryKnowledgeRepository, MemoryOrderRepository, MemoryOrderStatusRepository, MemoryRefundStatusRepository, MemoryRunRepository } from "./repositories/index.js";
import { BusinessTools, PolicyService } from "./services.js";
import { AssistanceWorkflow } from "./workflow.js";

export interface GoldenFixtureInput {
	tenantId: string;
	orders: ReadonlyArray<{ id: string; status: "shipped" | "confirmed" }>;
	refunds: readonly string[];
	documents: ReadonlyArray<{ id: string; source: string; title: string; content: string; page_number?: number | null; page_label?: string | null; locale: "th" | "en" | "multi"; acl?: Record<string, unknown>; metadata?: Record<string, unknown> }>;
	retrievalThreshold?: number;
}

// Deterministic in-memory world for golden evaluations: the real workflow graph
// with the local model, seeded repositories, and no network access.
export async function buildGoldenWorkflow(input: GoldenFixtureInput) {
	const now = new Date().toISOString();
	const orders = new MemoryOrderRepository();
	for (const item of input.orders) {
		await orders.save(OrderRecord.parse({ id: item.id, customer_id: "cus-golden", customer_name: "Golden Customer", customer_email: "golden@example.com", customer_phone: "+66812345678", items: [{ product_id: "p", name: "Appliance", variant: "Default", quantity: 1, unit_price: 12_000, currency: "THB" }], subtotal: 12_000, currency: "THB", status: item.status, ticket_id: "t", ai_provider: "local", ai_category: "order_status", ai_priority: "normal", ai_confidence: 1, created_at: now, updated_at: now }), input.tenantId);
	}
	const refunds = new MemoryRefundStatusRepository();
	for (const id of input.refunds) await refunds.save({ order_id: id, refund_id: id, status: "processed", amount: 12_000, currency: "THB", updated_at: now }, input.tenantId);
	const knowledge = new MemoryKnowledgeRepository(new HashEmbedder());
	for (const document of input.documents) await knowledge.upsert({ acl: {}, metadata: {}, page_label: null, page_number: null, ...document }, input.tenantId);
	const tools = new BusinessTools(new MemoryOrderStatusRepository(orders), refunds, knowledge, new MemoryEscalationRepository(), input.retrievalThreshold ?? 0.28);
	return new AssistanceWorkflow(new TicketClassifier(), tools, new PolicyService(), new AutomationService(), new LocalLanguageModel(), new MemoryRunRepository(), new MemorySaver(), "memory");
}
