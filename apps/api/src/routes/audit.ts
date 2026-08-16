import type { FastifyInstance } from "fastify";
import { type ZodTypeProvider } from "fastify-type-provider-zod";

import type { AppContainer } from "../container.js";
import { AuditPage, AuditQuery } from "../domain.js";
import { requireRole } from "../security.js";
import { routeContext } from "./context.js";
import { ErrorResponse } from "./schemas.js";

export async function registerAuditRoutes(app: FastifyInstance, container: AppContainer) {
	const api = app.withTypeProvider<ZodTypeProvider>();
	const { authenticate, principal } = routeContext(container);
	api.get("/api/v1/audit-events", {
		preHandler: authenticate,
		schema: {
			tags: ["audit"], security: [{ bearerAuth: [] }], querystring: AuditQuery,
			response: { 200: AuditPage, 403: ErrorResponse },
		},
	}, async (request) => {
		const actor = principal(request);
		requireRole(actor, ["audit:read", "supervisor", "approver"], "Audit read role required");
		return container.audit.repository.list(actor.tenant_id, request.query);
	});
}
