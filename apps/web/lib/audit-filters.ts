import type { AuditFilters, AuditOutcome } from "@/lib/types";

export const auditActions = [
  "ticket.created", "ticket.updated", "ticket.idempotent_replay", "customer.registered", "customer.login", "customer.profile_updated", "workflow.started", "approval.approved", "approval.rejected",
  "order.status_read", "refund.status_read", "knowledge.upserted", "webhook.accepted", "webhook.idempotent_replay",
  "request.denied", "request.failed",
] as const;

export type AuditSearch = { lang?: string; cursor?: string; action?: string; outcome?: string; resource?: string };
export type ParsedAuditFilters = { filters: AuditFilters; action?: string; outcome?: AuditOutcome; resource?: string };

const outcomes = new Set<AuditOutcome>(["success", "denied", "failure"]);
const actions = new Set<string>(auditActions);

export function parseAuditFilters(search: AuditSearch): ParsedAuditFilters {
  const action = search.action && actions.has(search.action) ? search.action : undefined;
  const outcome = search.outcome && outcomes.has(search.outcome as AuditOutcome) ? search.outcome as AuditOutcome : undefined;
  const resource = search.resource?.trim().slice(0, 256) || undefined;
  return {
    filters: {
      ...(search.cursor ? { cursor: search.cursor } : {}),
      ...(action ? { action } : {}),
      ...(outcome ? { outcome } : {}),
      ...(resource ? { resourceId: resource } : {}),
    },
    ...(action ? { action } : {}),
    ...(outcome ? { outcome } : {}),
    ...(resource ? { resource } : {}),
  };
}

export function auditPageUrl(language: string, parsed: ParsedAuditFilters, cursor?: string) {
  const query = new URLSearchParams({ lang: language });
  if (parsed.action) query.set("action", parsed.action);
  if (parsed.outcome) query.set("outcome", parsed.outcome);
  if (parsed.resource) query.set("resource", parsed.resource);
  if (cursor) query.set("cursor", cursor);
  return `/admin/audit?${query}`;
}

export function humanizeAuditValue(value: string) {
  return value.replaceAll(".", " · ").replaceAll("_", " ");
}
