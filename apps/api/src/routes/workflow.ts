import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { type ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { AuditActions } from "../audit.js";
import type { AppContainer } from "../container.js";
import { ApprovalResumeRequest, AssistRequest, DecisionRequest } from "../domain.js";
import { requireRole } from "../security.js";
import { ticketStatus } from "./operations.js";
import { routeContext } from "./context.js";
import { ErrorResponse, ThreadParams } from "./schemas.js";

export async function registerWorkflowRoutes(app: FastifyInstance, container: AppContainer) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const { authenticate, principal } = routeContext(container);

  api.post("/api/v1/assist", { preHandler: authenticate, schema: { tags: ["workflow"], body: AssistRequest, response: { 200: z.any(), 422: ErrorResponse } } }, async (request) => {
    const actor = principal(request);
    const run = await container.workflow.start({ ...request.body, metadata: { ...request.body.metadata, tenant_id: actor.tenant_id, actor_id: actor.subject, roles: actor.roles } }, actor.tenant_id);
    container.metrics.record(run.status);
    await container.audit.fromRequest(request, actor, { action: AuditActions.workflowStarted, resourceType: "workflow_run", resourceId: run.thread_id, metadata: { status: run.status, category: run.classification.category } });
    return run;
  });

  const getRun = async (request: FastifyRequest, reply: FastifyReply) => {
    const { threadId } = request.params as z.infer<typeof ThreadParams>;
    const run = await container.workflow.status(threadId, principal(request).tenant_id);
    return run ?? reply.code(404).send({ detail: "Workflow run not found", code: "NOT_FOUND" });
  };
  api.get("/api/v1/runs/:threadId", { preHandler: authenticate, schema: { tags: ["workflow"], params: ThreadParams, response: { 200: z.any(), 404: ErrorResponse } } }, getRun);
  api.get("/api/v1/assist/:threadId", { preHandler: authenticate, schema: { tags: ["workflow"], params: ThreadParams, response: { 200: z.any(), 404: ErrorResponse } } }, getRun);

  const resume = async (request: FastifyRequest, reply: FastifyReply, supplied?: z.infer<typeof ApprovalResumeRequest>) => {
    const actor = principal(request);
    const { threadId } = request.params as z.infer<typeof ThreadParams>;
    const decision = supplied ?? request.body as z.infer<typeof ApprovalResumeRequest>;
    requireRole(actor, ["approver", "supervisor"], "Approver role required");
    try {
      const run = await container.workflow.resume(threadId, { ...decision, reviewer: actor.subject }, actor.tenant_id);
      const ticket = await container.tickets.getByRun(threadId, actor.tenant_id);
      if (ticket) await container.tickets.save({ ...ticket, status: ticketStatus(run.status) }, actor.tenant_id);
      container.metrics.resolveApproval();
      await container.audit.fromRequest(request, actor, {
        action: decision.decision === "approve" ? AuditActions.approvalApproved : AuditActions.approvalRejected,
        resourceType: "workflow_run", resourceId: threadId,
        metadata: { ticket_id: ticket?.id, status: run.status, note_present: Boolean(decision.feedback) },
      });
      return run;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Workflow failed";
      return reply.code(message.includes("not found") ? 404 : 409).send({ detail: message, code: message.includes("not found") ? "NOT_FOUND" : "CONFLICT" });
    }
  };
  api.post("/api/v1/assist/:threadId/resume", { preHandler: authenticate, schema: { tags: ["workflow"], params: ThreadParams, body: ApprovalResumeRequest, response: { 200: z.any(), 404: ErrorResponse, 409: ErrorResponse } } }, resume);
  api.post("/api/v1/runs/:threadId/decision", { preHandler: authenticate, schema: { tags: ["workflow"], params: ThreadParams, body: DecisionRequest, response: { 200: z.any(), 404: ErrorResponse, 409: ErrorResponse } } },
    async (request, reply) => resume(request, reply, { decision: request.body.decision, feedback: request.body.note }));
}
