import type { FastifyInstance } from "fastify";
import { type ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { AppContainer } from "../container.js";
import { routeContext } from "./context.js";

export async function registerSystemRoutes(app: FastifyInstance, container: AppContainer) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const { authenticate, principal } = routeContext(container);

  api.get("/health/live", { schema: { tags: ["health"], response: { 200: z.object({ status: z.string(), service: z.string(), version: z.string() }) } } },
    async () => ({ status: "ok", service: "servicepilot-api", version: container.settings.APP_VERSION }));

  api.get("/health/ready", { schema: { tags: ["health"], response: { 200: z.object({ ready: z.boolean(), checks: z.record(z.string(), z.string()) }), 503: z.object({ ready: z.boolean(), checks: z.record(z.string(), z.string()) }) } } }, async (_, reply) => {
    const database = await container.runs.health();
    const ready = database && (container.settings.PERSISTENCE_MODE !== "postgres" || container.workflow.checkpointerBackend === "postgres");
    return reply.code(ready ? 200 : 503).send({ ready, checks: { database: database ? "ok" : "unavailable", persistence: container.runs.backend, checkpointer: container.workflow.checkpointerBackend } });
  });

  api.get("/openapi.json", { schema: { hide: true } }, async () => app.swagger());
  api.get("/api/v1/me", { preHandler: authenticate, schema: { tags: ["security"], security: [{ bearerAuth: [] }], response: { 200: z.object({ subject: z.string(), tenant_id: z.string(), roles: z.array(z.string()), auth_mode: z.string() }) } } },
    async (request) => principal(request));
}
