import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { createClient, type RedisClientType } from "redis";

import type { Principal } from "./domain.js";
import type { Settings } from "./config.js";

function unauthorized(message = "Bearer token required") {
	return Object.assign(new Error(message), { statusCode: 401, headers: { "WWW-Authenticate": "Bearer" } });
}

const remoteKeys = new Map<string, JWTVerifyGetKey>();

function oidcKey(settings: Settings) {
	if (!settings.OIDC_JWKS_URL) throw unauthorized("OIDC JWKS is not configured");
	let key = remoteKeys.get(settings.OIDC_JWKS_URL);
	if (!key) {
		const url = new URL(settings.OIDC_JWKS_URL);
		if (url.protocol !== "https:" && settings.APP_ENV === "production") throw unauthorized("OIDC JWKS must use HTTPS");
		key = createRemoteJWKSet(url);
		remoteKeys.set(settings.OIDC_JWKS_URL, key);
	}
	return key;
}

function claimValues(value: unknown) {
	return Array.isArray(value) ? value.map(String) : typeof value === "string" ? value.split(/[ ,]+/u).filter(Boolean) : [];
}

function verifyMfa(payload: Record<string, unknown>, settings: Settings) {
	if (!settings.AUTH_REQUIRE_MFA) return;
	const values = claimValues(payload[settings.AUTH_MFA_CLAIM]);
	const accepted = settings.AUTH_MFA_VALUES.split(",").map((item) => item.trim()).filter(Boolean);
	if (!values.some((value) => accepted.includes(value))) throw unauthorized("Multi-factor authentication is required");
}

function rolesFromClaims(payload: Record<string, unknown>, settings: Settings) {
	const roles = claimValues(payload[settings.AUTH_ROLE_CLAIM] ?? payload.roles ?? payload.groups ?? payload.scope);
	if (roles.includes(settings.AUTH_CUSTOMER_ROLE)) roles.push("customer", "ticket:create");
	if (settings.AUTH_ADMIN_ROLES.split(",").map((item) => item.trim()).some((role) => roles.includes(role))) roles.push("agent", "approver", "audit:read");
	return [...new Set(roles)];
}

function tenantFromClaims(payload: Record<string, unknown>, settings: Settings) {
	const tenant = payload[settings.AUTH_TENANT_CLAIM] ?? payload.tenant_id ?? payload.org_id;
	if (typeof tenant !== "string" || !tenant) throw unauthorized("Tenant claim is required");
	return tenant;
}

async function verifyBearer(token: string, settings: Settings) {
	if (settings.AUTH_MODE === "oidc") return jwtVerify(token, oidcKey(settings), { algorithms: ["RS256", "ES256"], issuer: settings.OIDC_ISSUER_URL!, audience: settings.OIDC_AUDIENCE!, clockTolerance: settings.JWT_LEEWAY_SECONDS, requiredClaims: ["sub"] });
	return jwtVerify(token, new TextEncoder().encode(settings.JWT_SECRET!), { algorithms: ["HS256"], issuer: settings.JWT_ISSUER, audience: settings.JWT_AUDIENCE, clockTolerance: settings.JWT_LEEWAY_SECONDS, requiredClaims: ["sub", "tenant_id"] });
}

export async function principalFor(request: FastifyRequest, settings: Settings): Promise<Principal> {
	if (settings.AUTH_MODE === "local") {
		const actor = String(request.headers["x-actor-id"] ?? request.headers["x-servicepilot-subject"] ?? "local-agent");
		const tenant = String(request.headers["x-tenant-id"] ?? request.headers["x-servicepilot-tenant"] ?? "tenant-local");
		const headerRole = request.headers["x-servicepilot-role"] ?? request.headers["x-role"];
		const isCustomer = headerRole === "customer" || actor.startsWith("cus_") || actor.includes("@");
		const roles = headerRole
			? [String(headerRole), "ticket:create"]
			: (isCustomer
					? ["customer", "ticket:create"]
					: ["agent", "approver", "supervisor", "audit:read", "ticket:create"]);
		return { subject: actor, tenant_id: tenant, roles, auth_mode: "local" };
	}
	const authorization = request.headers.authorization;
	if (!authorization?.startsWith("Bearer ") || (settings.AUTH_MODE === "jwt" && !settings.JWT_SECRET)) throw unauthorized();
	try {
		let result;
		try {
			result = await verifyBearer(authorization.slice(7), settings);
		} catch (error) {
			if (settings.AUTH_MODE !== "jwt" || !settings.JWT_SECRET_PREVIOUS) throw error;
			result = await jwtVerify(authorization.slice(7), new TextEncoder().encode(settings.JWT_SECRET_PREVIOUS), {
			algorithms: ["HS256"], issuer: settings.JWT_ISSUER, audience: settings.JWT_AUDIENCE,
			clockTolerance: settings.JWT_LEEWAY_SECONDS, requiredClaims: ["sub", "tenant_id"],
			});
		}
		verifyMfa(result.payload as Record<string, unknown>, settings);
		const payload = result.payload as Record<string, unknown>;
		return {
			subject: result.payload.sub!, tenant_id: settings.AUTH_MODE === "oidc" ? tenantFromClaims(payload, settings) : String(result.payload.tenant_id),
			roles: rolesFromClaims(payload, settings), auth_mode: settings.AUTH_MODE === "oidc" ? "oidc" : "jwt",
			...(typeof payload.email === "string" ? { email: payload.email } : {}),
			...(typeof payload.name === "string" ? { name: payload.name } : {}),
			...(typeof payload.phone_number === "string" ? { phone: payload.phone_number } : {}),
		};
	} catch (error) {
		if (error instanceof Error && (error as { statusCode?: number }).statusCode === 401) throw error;
		throw unauthorized("Invalid or expired bearer token");
	}
}

export function requireRole(principal: Principal, allowed: readonly string[], message: string) {
	if (!allowed.some((role) => principal.roles.includes(role))) throw Object.assign(new Error(message), { statusCode: 403 });
}

export function verifyWebhook(body: string, signature: string | undefined, settings: Settings) {
	if (!settings.WEBHOOK_SECRET) {
		if (settings.APP_ENV === "production") throw Object.assign(new Error("Webhook secret is not configured"), { statusCode: 503 });
		return;
	}
	const supplied = (signature ?? "").replace(/^sha256=/u, "");
	const expected = createHmac("sha256", settings.WEBHOOK_SECRET).update(body).digest("hex");
	const safe = supplied.length === expected.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
	if (!safe) throw unauthorized("Invalid webhook signature");
}

export interface RateLimiter { consume(key: string): Promise<{ allowed: boolean; remaining: number }>; close(): Promise<void> }

export class MemoryRateLimiter implements RateLimiter {
	readonly #buckets = new Map<string, { count: number; expires: number }>();
	constructor(readonly limit: number, readonly windowSeconds: number) {}
	async consume(key: string) { const now = Date.now(); let bucket = this.#buckets.get(key); if (!bucket || bucket.expires <= now) { bucket = { count: 0, expires: now + this.windowSeconds * 1_000 }; this.#buckets.set(key, bucket); } bucket.count += 1; return { allowed: bucket.count <= this.limit, remaining: Math.max(0, this.limit - bucket.count) }; }
	async close() { this.#buckets.clear(); }
}

export class RedisRateLimiter implements RateLimiter {
	constructor(readonly client: RedisClientType, readonly limit: number, readonly windowSeconds: number) {}
	async consume(key: string) {
		const count = await this.client.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n", { keys: [`servicepilot:rate:${key}`], arguments: [String(this.windowSeconds)] });
		const value = Number(count);
		return { allowed: value <= this.limit, remaining: Math.max(0, this.limit - value) };
	}
	async close() { await this.client.quit(); }
}

export async function buildRateLimiter(settings: Settings): Promise<RateLimiter> {
	if (!settings.REDIS_URL) return new MemoryRateLimiter(settings.RATE_LIMIT_REQUESTS, settings.RATE_LIMIT_WINDOW_SECONDS);
	const client = createClient({ url: settings.REDIS_URL });
	client.on("error", (error) => console.error(JSON.stringify({ level: "error", event: "redis_error", message: error.message })));
	await client.connect();
	return new RedisRateLimiter(client as RedisClientType, settings.RATE_LIMIT_REQUESTS, settings.RATE_LIMIT_WINDOW_SECONDS);
}
