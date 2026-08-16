import { MemorySaver } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

import { buildEmbedder, buildLanguageModel } from "./ai.js";
import { AuditService } from "./audit.js";
import { AutomationService } from "./automation.js";
import { TicketClassifier } from "./classifier.js";
import type { Settings } from "./config.js";
import { AssistanceWorkflow } from "./workflow.js";
import { BusinessTools, ModelRoutingService, OperationsMetrics, PolicyService } from "./services.js";
import { MemoryAuditRepository, MemoryCustomerRepository, MemoryEscalationRepository, MemoryKnowledgeRepository, MemoryOrderRepository, MemoryOrderStatusRepository, MemoryProductRepository, MemoryRefundStatusRepository, MemoryRunRepository, MemoryTicketRepository, PostgresAuditRepository, PostgresCustomerRepository, PostgresEscalationRepository, PostgresKnowledgeRepository, PostgresOrderRepository, PostgresOrderStatusRepository, PostgresProductRepository, PostgresRefundStatusRepository, PostgresResources, PostgresRunRepository, PostgresTicketRepository, type AuditRepository, type CustomerRepository, type KnowledgeRepository, type OrderRepository, type ProductRepository, type RunRepository, type TicketRepository } from "./repositories/index.js";
import { buildRateLimiter, type RateLimiter } from "./security.js";

export interface AppContainer {
  settings: Settings;
  workflow: AssistanceWorkflow;
  runs: RunRepository;
  tickets: TicketRepository;
  customers: CustomerRepository;
  orders: OrderRepository;
  products: ProductRepository;
  knowledge: KnowledgeRepository;
  tools: BusinessTools;
  classifier: TicketClassifier;
  modelRouter: ModelRoutingService;
  metrics: OperationsMetrics;
  rateLimiter: RateLimiter;
  audit: AuditService;
  close(): Promise<void>;
}

export async function buildContainer(settings: Settings): Promise<AppContainer> {
  const embedder = buildEmbedder(settings);
  const resources: Array<{ close(): Promise<void> }> = [];
  let runs: RunRepository;
  let tickets: TicketRepository;
  let knowledge: KnowledgeRepository;
  let auditRepository: AuditRepository;
  let customers: CustomerRepository;
  let orders: OrderRepository;
  let products: ProductRepository;
  let orderStatuses: import("./repositories/contracts.js").OrderStatusRepository;
  let refundStatuses: import("./repositories/contracts.js").RefundStatusRepository;
  let escalations;
  let checkpointer: MemorySaver | PostgresSaver = new MemorySaver();
  let checkpointerBackend = "memory";

  if (settings.PERSISTENCE_MODE === "postgres") {
    const postgres = new PostgresResources(settings.DATABASE_URL!);
    resources.push(postgres);
    runs = new PostgresRunRepository(postgres);
    tickets = new PostgresTicketRepository(postgres);
    customers = new PostgresCustomerRepository(postgres);
    orders = new PostgresOrderRepository(postgres);
    products = new PostgresProductRepository(postgres);
    orderStatuses = new PostgresOrderStatusRepository(postgres);
    refundStatuses = new PostgresRefundStatusRepository(postgres);
    knowledge = new PostgresKnowledgeRepository(postgres, embedder);
    escalations = new PostgresEscalationRepository(postgres);
    auditRepository = new PostgresAuditRepository(postgres);
    checkpointer = new PostgresSaver(postgres.pool);
    await checkpointer.setup();
    checkpointerBackend = "postgres";
  } else {
    runs = new MemoryRunRepository();
    tickets = new MemoryTicketRepository();
    customers = new MemoryCustomerRepository();
    orders = new MemoryOrderRepository();
    products = new MemoryProductRepository();
    orderStatuses = new MemoryOrderStatusRepository(orders as MemoryOrderRepository);
    refundStatuses = new MemoryRefundStatusRepository();
    knowledge = new MemoryKnowledgeRepository(embedder);
    escalations = new MemoryEscalationRepository();
    auditRepository = new MemoryAuditRepository();

    await products.upsert({
      id: "iphone-17-pro-max-256gb-deep-blue",
      name: "iPhone 17 Pro Max",
      variant: "256GB · Deep Blue",
      unit_price: 48_900,
      currency: "THB",
      image_url: "/products/iphone-17-pro-max-deep-blue-full.webp",
      source_url: "https://www.apple.com/th-en/shop/buy-iphone/iphone-17-pro/6.9-inch-display-256gb-deep-blue",
      active: true,
    }, "*");

    await knowledge.upsert({
      id: "return-policy",
      title: "Return and Refund Policy / นโยบายการคืนสินค้าและคืนเงิน",
      content: "Customers can request a refund within 14 days of delivery for unopened products. Refunds are processed within 3-5 business days.",
      source: "policy://return-refund",
      page_label: "Section 2.1 (Refund Terms)",
      locale: "multi",
      acl: {},
      metadata: { category: "policy" },
    }, "*");
  }

  const tools = new BusinessTools(orderStatuses, refundStatuses, knowledge, escalations, settings.RETRIEVAL_MIN_SCORE);
  const classifier = new TicketClassifier();
  const modelRouter = new ModelRoutingService();
  const workflow = new AssistanceWorkflow(classifier, tools, new PolicyService(), new AutomationService(), buildLanguageModel(settings), runs, checkpointer, checkpointerBackend);
  const rateLimiter = await buildRateLimiter(settings);
  resources.push(rateLimiter);
  return { settings, workflow, runs, tickets, customers, orders, products, knowledge, tools, classifier, modelRouter, metrics: new OperationsMetrics(), rateLimiter, audit: new AuditService(auditRepository), async close() { for (const resource of resources.reverse()) await resource.close(); } };
}
