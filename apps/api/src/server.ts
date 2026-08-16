import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { type FastifyError, type FastifyRequest } from "fastify";
import { jsonSchemaTransform, serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";

import { AuditActions } from "./audit.js";
import type { AppContainer } from "./container.js";
import { registerAuditRoutes } from "./routes/audit.js";
import { registerCustomerRoutes } from "./routes/customers.js";
import { registerOperationsRoutes } from "./routes/operations.js";
import { registerProductRoutes } from "./routes/products.js";
import { registerSystemRoutes } from "./routes/system.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";
import { registerWorkflowRoutes } from "./routes/workflow.js";

export async function buildServer(container: AppContainer) {
	const rawBodies = new WeakMap<FastifyRequest, string>();
	const starts = new WeakMap<FastifyRequest, number>();
	const app = Fastify({
		logger: {
			level: container.settings.LOG_LEVEL,
			redact: ["req.headers.authorization", "req.headers.cookie", "res.headers.set-cookie"],
		},
		bodyLimit: 1_048_576,
		trustProxy: true,
		requestIdHeader: "x-request-id",
	}).withTypeProvider<ZodTypeProvider>();

	app.decorateRequest("principal", null);
	app.removeContentTypeParser("application/json");
	app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
		const raw = String(body);
		if (!raw.trim()) {
			done(null, undefined);
			return;
		}
		rawBodies.set(request, raw);
		try { done(null, JSON.parse(raw)); } catch (error) { done(error as Error); }
	});
	app.setValidatorCompiler(validatorCompiler);
	app.setSerializerCompiler(serializerCompiler);
	await app.register(helmet, { contentSecurityPolicy: false });
	await app.register(cors, { origin: container.settings.WEB_ORIGIN, credentials: true });
	await app.register(swagger, {
		openapi: {
			info: { title: "ServicePilot AI API", version: container.settings.APP_VERSION, description: "Bilingual support workflow, grounded retrieval, approval-gated tools and tenant-scoped audit events." },
			components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } } },
		},
		transform: jsonSchemaTransform,
	});
	await app.register(swaggerUi, { routePrefix: "/docs" });

	app.addHook("onRequest", async (request, reply) => {
		starts.set(request, performance.now());
		if (!container.settings.RATE_LIMIT_ENABLED || request.url.startsWith("/health/")) return;
		const result = await container.rateLimiter.consume(request.ip);
		reply.header("X-RateLimit-Remaining", result.remaining);
		if (!result.allowed) return reply.code(429).send({ detail: "Rate limit exceeded", code: "RATE_LIMITED" });
	});
	app.addHook("onResponse", async (request, reply) => {
		container.metrics.record(reply.statusCode >= 500 ? "failure" : "request", performance.now() - (starts.get(request) ?? performance.now()));
	});
	app.setErrorHandler(async (error: FastifyError, request, reply) => {
		const status = error.validation ? 422 : typeof error.statusCode === "number" ? error.statusCode : 500;
		if (status >= 500) { container.metrics.failure(); request.log.error({ err: error }, "request_failed"); }
		if (request.principal && request.method !== "GET") {
			await container.audit.fromRequest(request, request.principal, {
				action: status >= 500 ? AuditActions.requestFailed : AuditActions.requestDenied,
				resourceType: "http_route",
				resourceId: request.routeOptions.url ?? request.url.split("?", 1)[0] ?? null,
				outcome: status >= 500 ? "failure" : "denied",
				metadata: { method: request.method, status_code: status, error_code: error.code },
			}).catch((auditError) => request.log.error({ err: auditError }, "audit_write_failed"));
		}
		reply.code(status).send({ detail: status >= 500 ? "Internal server error" : error.message, code: error.validation ? "VALIDATION_ERROR" : status === 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR" });
	});

	await registerSystemRoutes(app, container);
	await registerWorkflowRoutes(app, container);
	await registerOperationsRoutes(app, container);
	await registerProductRoutes(app, container);
	await registerCustomerRoutes(app, container);
	await registerAuditRoutes(app, container);
	await registerWebhookRoutes(app, container, rawBodies);
	return app;
}
