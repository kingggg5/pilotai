import assert from "node:assert/strict";
import test from "node:test";
import { SignJWT } from "jose";

import { loadSettings } from "../src/config.js";
import { buildContainer } from "../src/container.js";
import { buildServer } from "../src/server.js";
import { MemoryRateLimiter } from "../src/security.js";

test("JWT authentication preserves required tenant claim", async (context) => {
	const secret = "correct-horse-battery-staple";
	const settings = loadSettings({ APP_ENV: "test", AI_MODE: "local", AUTH_MODE: "jwt", JWT_SECRET: secret, JWT_ISSUER: "servicepilot", JWT_AUDIENCE: "servicepilot-api", PERSISTENCE_MODE: "memory", RATE_LIMIT_ENABLED: "false" });
	const container = await buildContainer(settings);
	const app = await buildServer(container);
	context.after(async () => { await app.close(); await container.close(); });
	const token = await new SignJWT({ tenant_id: "tenant-blue", roles: ["agent"] }).setProtectedHeader({ alg: "HS256" }).setSubject("agent-1").setIssuer("servicepilot").setAudience("servicepilot-api").setExpirationTime("5m").sign(new TextEncoder().encode(secret));
	const result = await app.inject({ method: "GET", url: "/api/v1/me", headers: { authorization: `Bearer ${token}` } });
	assert.equal(result.statusCode, 200);
	assert.equal(result.json().tenant_id, "tenant-blue");
});

test("production configuration fails closed", () => {
	assert.throws(() => loadSettings({ APP_ENV: "production", AI_MODE: "local", AUTH_MODE: "local", PERSISTENCE_MODE: "memory" }));
});

test("memory rate limiter rejects after limit", async () => {
	const limiter = new MemoryRateLimiter(2, 60);
	assert.equal((await limiter.consume("ip")).allowed, true);
	assert.equal((await limiter.consume("ip")).allowed, true);
	assert.equal((await limiter.consume("ip")).allowed, false);
});
