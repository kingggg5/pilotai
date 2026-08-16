import type { FastifyInstance, FastifyRequest } from "fastify";
import { type ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { AuditActions } from "../audit.js";
import type { AppContainer } from "../container.js";
import { AssistRequest, TicketCreateRequest, type Principal } from "../domain.js";
import { verifyWebhook } from "../security.js";
import { workItem } from "./operations.js";

export async function registerWebhookRoutes(app: FastifyInstance, container: AppContainer, rawBodies: WeakMap<FastifyRequest, string>) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  api.post("/api/v1/webhooks/tickets", { schema: { tags: ["webhooks"], body: z.object({ event_id: z.string().min(3).max(128), event_type: z.enum(["ticket.created", "ticket.updated"]), tenant_id: z.string().default("tenant-webhook"), ticket: AssistRequest }), response: { 202: z.object({ accepted: z.boolean(), event_id: z.string(), thread_id: z.string() }) } } }, async (request, reply) => {
    verifyWebhook(rawBodies.get(request) ?? JSON.stringify(request.body), request.headers["x-servicepilot-signature"] as string | undefined, container.settings);
    const actor: Principal = { subject: "webhook", tenant_id: request.body.tenant_id, roles: ["ticket:create"], auth_mode: "local" };
    const existing = await container.tickets.getByIdempotency(request.body.event_id, request.body.tenant_id);
    if (existing?.run_id) {
      await container.audit.fromRequest(request, actor, { action: AuditActions.webhookReplay, resourceType: "webhook_event", resourceId: request.body.event_id, actorType: "service" });
      return reply.code(202).send({ accepted: true, event_id: request.body.event_id, thread_id: existing.run_id });
    }
    const run = await container.workflow.start({ ...request.body.ticket, metadata: { ...request.body.ticket.metadata, tenant_id: request.body.tenant_id, actor_id: "webhook", roles: ["ticket:create"] } }, request.body.tenant_id);
    const payload = TicketCreateRequest.parse({ message: request.body.ticket.message, subject: request.body.ticket.message.slice(0, 120), customer: request.body.ticket.customer_id ?? "Webhook customer", customer_id: request.body.ticket.customer_id, order_id: request.body.ticket.order_id, locale: request.body.ticket.locale, handling_mode: request.body.ticket.handling_mode, channel: "web" });
    const item = workItem(payload, run);
    await container.tickets.save(item.ticket, request.body.tenant_id, request.body.event_id);
    await container.audit.fromRequest(request, actor, { action: AuditActions.webhookAccepted, resourceType: "webhook_event", resourceId: request.body.event_id, actorType: "service", metadata: { event_type: request.body.event_type, ticket_id: item.ticket.id } });
    return reply.code(202).send({ accepted: true, event_id: request.body.event_id, thread_id: run.thread_id });
  });
}
