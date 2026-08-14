import assert from "node:assert/strict";
import test from "node:test";

import { AuditService, sanitizeAuditMetadata } from "../src/audit.js";
import type { Principal } from "../src/domain.js";
import { MemoryAuditRepository } from "../src/repositories/index.js";

const principal = (tenant_id: string): Principal => ({ subject: "agent-1", tenant_id, roles: ["audit:read"], auth_mode: "local" });

test("audit metadata removes customer content and credentials", () => {
  const result = sanitizeAuditMetadata({ status: "open", message: "private", nested: { accessToken: "secret", count: 2 } });
  assert.deepEqual(result, { status: "open", message: "[redacted]", nested: { accessToken: "[redacted]", count: 2 } });
});

test("audit repository isolates tenants and paginates with an opaque cursor", async () => {
  const repository = new MemoryAuditRepository();
  const audit = new AuditService(repository);
  for (let index = 0; index < 3; index += 1) {
    await audit.record({ principal: principal("tenant-a"), action: "ticket.created", resourceType: "ticket", resourceId: `ticket-${index}` });
  }
  await audit.record({ principal: principal("tenant-b"), action: "ticket.created", resourceType: "ticket", resourceId: "hidden" });

  const first = await repository.list("tenant-a", { limit: 2, action: "", outcome: "", resource_id: "" });
  assert.equal(first.items.length, 2);
  assert.ok(first.next_cursor);
  const second = await repository.list("tenant-a", { limit: 2, action: "", outcome: "", resource_id: "", cursor: first.next_cursor! });
  assert.equal(second.items.length, 1);
  assert.equal([...first.items, ...second.items].some((event) => event.resource_id === "hidden"), false);
});

test("audit resource filter uses a case-insensitive prefix", async () => {
  const repository = new MemoryAuditRepository();
  const audit = new AuditService(repository);
  await audit.record({ principal: principal("tenant-a"), action: "ticket.created", resourceType: "ticket", resourceId: "TKT-100" });
  await audit.record({ principal: principal("tenant-a"), action: "ticket.created", resourceType: "ticket", resourceId: "ORD-TKT-100" });

  const result = await repository.list("tenant-a", { limit: 25, action: "", outcome: "", resource_id: "tkt-" });
  assert.deepEqual(result.items.map((event) => event.resource_id), ["TKT-100"]);
});
