import assert from "node:assert/strict";
import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { exportJWK, SignJWT } from "jose";

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

test("JWT rotation accepts the previous key only when MFA is present", async (context) => {
	const settings = loadSettings({ APP_ENV: "test", AI_MODE: "local", AUTH_MODE: "jwt", JWT_SECRET: "current-secret", JWT_SECRET_PREVIOUS: "previous-secret", AUTH_REQUIRE_MFA: "true", PERSISTENCE_MODE: "memory", RATE_LIMIT_ENABLED: "false" });
	const container = await buildContainer(settings);
	const app = await buildServer(container);
	context.after(async () => { await app.close(); await container.close(); });
	const token = await new SignJWT({ tenant_id: "tenant-blue", roles: ["agent"], amr: ["mfa"] }).setProtectedHeader({ alg: "HS256" }).setSubject("agent-rotation").setIssuer("servicepilot").setAudience("servicepilot-api").setExpirationTime("5m").sign(new TextEncoder().encode("previous-secret"));
	const accepted = await app.inject({ method: "GET", url: "/api/v1/me", headers: { authorization: `Bearer ${token}` } });
	assert.equal(accepted.statusCode, 200);
	const noMfa = await new SignJWT({ tenant_id: "tenant-blue", roles: ["agent"] }).setProtectedHeader({ alg: "HS256" }).setSubject("agent-no-mfa").setIssuer("servicepilot").setAudience("servicepilot-api").setExpirationTime("5m").sign(new TextEncoder().encode("current-secret"));
	const rejected = await app.inject({ method: "GET", url: "/api/v1/me", headers: { authorization: `Bearer ${noMfa}` } });
	assert.equal(rejected.statusCode, 401);
});

test("OIDC JWKS authentication validates issuer, tenant, role, and MFA claims", async (context) => {
	const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
	const jwk = await exportJWK(publicKey);
	jwk.kid = "servicepilot-test";
	const jwks = createServer((_, response) => { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ keys: [jwk] })); });
	await new Promise<void>((resolve) => jwks.listen(0, "127.0.0.1", () => resolve()));
	const address = jwks.address();
	if (!address || typeof address === "string") throw new Error("JWKS test server did not bind");
	const issuer = `http://127.0.0.1:${address.port}`;
	const settings = loadSettings({ APP_ENV: "test", AI_MODE: "local", AUTH_MODE: "oidc", OIDC_ISSUER_URL: issuer, OIDC_AUDIENCE: "servicepilot-api", OIDC_JWKS_URL: `${issuer}/jwks`, AUTH_REQUIRE_MFA: "true", PERSISTENCE_MODE: "memory", RATE_LIMIT_ENABLED: "false" });
	const container = await buildContainer(settings);
	const app = await buildServer(container);
	context.after(async () => { await app.close(); await container.close(); await new Promise<void>((resolve) => jwks.close(() => resolve())); });
	const token = await new SignJWT({ tenant_id: "tenant-oidc", roles: ["agent"], amr: ["mfa"] }).setProtectedHeader({ alg: "RS256", kid: "servicepilot-test" }).setSubject("oidc-agent").setIssuer(issuer).setAudience("servicepilot-api").setExpirationTime("5m").sign(privateKey);
	const result = await app.inject({ method: "GET", url: "/api/v1/me", headers: { authorization: `Bearer ${token}` } });
	assert.equal(result.statusCode, 200);
	assert.equal(result.json().auth_mode, "oidc");
	assert.equal(result.json().tenant_id, "tenant-oidc");
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
