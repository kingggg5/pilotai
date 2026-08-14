export type Language = "th" | "en";
export type Priority = "urgent" | "high" | "normal" | "low";
export type TicketStatus = "needs_approval" | "investigating" | "draft_ready" | "new" | "resolved";
export type Decision = "approve" | "reject";
export type WorkflowState = "awaiting_approval" | "running" | "completed" | "rejected" | "needs_evidence" | "refused";

export interface Ticket {
  id: string;
  reference: string;
  subject: string;
  customer: string;
  customerId?: string;
  customerEmail?: string;
  customerPhone?: string;
  channel: "email" | "chat" | "web";
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
  status: "complete" | "active" | "pending";
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
  ai: {
    category: string;
    priority: string;
    modelVersion: string;
    provider: string;
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
