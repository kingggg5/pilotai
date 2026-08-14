import assert from "node:assert/strict";

import { parseDecision, parseTicketDraft } from "../lib/validation.ts";
import { auditPageUrl, parseAuditFilters } from "../lib/audit-filters.ts";
import { parseQueueFilters, queuePageUrl } from "../lib/queue-filters.ts";

const draft = parseTicketDraft({
  message: "Where is my order?",
  customer: "Customer",
  customerId: "customer@example.com",
  channel: "web",
  locale: "en",
  idempotencyKey: "request-12345678",
});
assert.equal(draft?.idempotencyKey, "request-12345678");

assert.equal(parseTicketDraft({ message: "Help", customer: "A", customerId: "B" }), null);
assert.equal(parseDecision({ runId: "run", decision: "approve", note: "x".repeat(2_001) }), null);

const audit = parseAuditFilters({ action: "ticket.created", outcome: "success", resource: " ORD- " });
assert.deepEqual(audit.filters, { action: "ticket.created", outcome: "success", resourceId: "ORD-" });
assert.equal(auditPageUrl("th", audit, "cursor"), "/admin/audit?lang=th&action=ticket.created&outcome=success&resource=ORD-&cursor=cursor");
assert.deepEqual(parseAuditFilters({ action: "unknown", outcome: "unknown" }).filters, {});

const queue = parseQueueFilters({ q: " refund ", number: " ORD-1001 ", priority: "urgent", status: "investigating", channel: "email", from: "2026-08-01", to: "2026-08-14", sort: "priority" });
assert.deepEqual(queue, { query: "refund", number: "ORD-1001", priority: "urgent", status: "investigating", channel: "email", createdFrom: "2026-08-01", createdTo: "2026-08-14", sort: "priority" });
assert.equal(queuePageUrl("en", queue, 2), "/admin?lang=en&q=refund&number=ORD-1001&priority=urgent&status=investigating&channel=email&from=2026-08-01&to=2026-08-14&sort=priority&page=2");

console.log("validation contracts passed");
