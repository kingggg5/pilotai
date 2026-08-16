import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";

import { serverSecret } from "@/lib/secrets";

export const SSO_COOKIE = "sp_sso";
export const SSO_STATE_COOKIE = "sp_oidc_state";
const SESSION_SECONDS = 8 * 60 * 60;
const STATE_SECONDS = 10 * 60;

export type SsoSession = {
	sub: string;
	tenantId: string;
	name: string;
	email: string;
	phone: string;
	roles: string[];
	accessToken: string;
	expiresAt: number;
};

type OidcDiscovery = {
	authorization_endpoint: string;
	token_endpoint: string;
	issuer: string;
	jwks_uri: string;
};

type OidcClaims = Record<string, unknown> & { sub?: string; name?: string; email?: string; phone_number?: string; tenant_id?: string; roles?: unknown; amr?: unknown };

function secretCandidates() {
	return [serverSecret("SERVICEPILOT_SESSION_SECRET"), serverSecret("SERVICEPILOT_SESSION_SECRET_PREVIOUS")].filter((value): value is string => Boolean(value));
}

function keyFor(secret: string) { return createHash("sha256").update(secret).digest(); }
function encode(value: Uint8Array) { return Buffer.from(value).toString("base64url"); }
function decode(value: string) { return Buffer.from(value, "base64url"); }

function seal(value: unknown) {
	const secret = secretCandidates()[0];
	if (!secret) throw new Error("SSO session secret is not configured");
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", keyFor(secret), iv);
	const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
	return `${encode(iv)}.${encode(cipher.getAuthTag())}.${encode(ciphertext)}`;
}

function open<T>(value: string | undefined): T | null {
	if (!value) return null;
	for (const secret of secretCandidates()) {
		try {
			const [encodedIv, encodedTag, encodedCiphertext, extra] = value.split(".");
			if (!encodedIv || !encodedTag || !encodedCiphertext || extra) continue;
			const decipher = createDecipheriv("aes-256-gcm", keyFor(secret), decode(encodedIv));
			decipher.setAuthTag(decode(encodedTag));
			return JSON.parse(Buffer.concat([decipher.update(decode(encodedCiphertext)), decipher.final()]).toString("utf8")) as T;
		} catch { /* try the previous rotation key */ }
	}
	return null;
}

function config() {
	if (process.env.SERVICEPILOT_AUTH_MODE !== "oidc") return null;
	const issuer = process.env.SERVICEPILOT_OIDC_ISSUER_URL?.trim();
	const clientId = process.env.SERVICEPILOT_OIDC_CLIENT_ID?.trim();
	const clientSecret = serverSecret("SERVICEPILOT_OIDC_CLIENT_SECRET");
	const redirectUri = process.env.SERVICEPILOT_OIDC_REDIRECT_URI?.trim();
	if (!issuer || !clientId || !clientSecret || !redirectUri) return null;
	return {
		issuer: issuer.replace(/\/$/u, ""), clientId, clientSecret, redirectUri,
		scope: process.env.SERVICEPILOT_OIDC_SCOPE || "openid profile email",
		roleClaim: process.env.SERVICEPILOT_OIDC_ROLE_CLAIM || "roles",
		customerRole: process.env.SERVICEPILOT_OIDC_CUSTOMER_ROLE || "customer",
		adminRoles: (process.env.SERVICEPILOT_OIDC_ADMIN_ROLES || "agent,approver,supervisor,audit:read,admin").split(",").map((item) => item.trim()).filter(Boolean),
		tenantClaim: process.env.SERVICEPILOT_OIDC_TENANT_CLAIM || "tenant_id",
		mfaClaim: process.env.SERVICEPILOT_OIDC_MFA_CLAIM || "amr",
		mfaValues: (process.env.SERVICEPILOT_OIDC_MFA_VALUES || "mfa,otp,webauthn").split(",").map((item) => item.trim()).filter(Boolean),
		mfaRequired: process.env.SERVICEPILOT_OIDC_MFA_REQUIRED !== "false",
	};
}

let discoveryCache: { expiresAt: number; value: OidcDiscovery } | null = null;
async function discovery(settings: NonNullable<ReturnType<typeof config>>) {
	if (discoveryCache && discoveryCache.expiresAt > Date.now()) return discoveryCache.value;
	const response = await fetch(`${settings.issuer}/.well-known/openid-configuration`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
	if (!response.ok) throw new Error("OIDC discovery failed");
	const value = await response.json() as OidcDiscovery;
	if (!value.authorization_endpoint || !value.token_endpoint || !value.jwks_uri) throw new Error("OIDC discovery is incomplete");
	discoveryCache = { expiresAt: Date.now() + 5 * 60_000, value };
	return value;
}

export function ssoConfigured() { return Boolean(config() && secretCandidates()[0]); }

export async function createSsoAuthorizationUrl(nextPath: string) {
	const settings = config();
	if (!settings) throw new Error("SSO is not configured");
	const metadata = await discovery(settings);
	const state = encode(randomBytes(32));
	const verifier = encode(randomBytes(32));
	const challenge = encode(createHash("sha256").update(verifier).digest());
	const query = new URLSearchParams({ client_id: settings.clientId, response_type: "code", scope: settings.scope, redirect_uri: settings.redirectUri, state, code_challenge: challenge, code_challenge_method: "S256" });
	const target = `${metadata.authorization_endpoint}?${query}`;
	const stateResponse = NextResponse.redirect(target);
	stateResponse.cookies.set(SSO_STATE_COOKIE, seal({ state, verifier, nextPath, exp: Math.floor(Date.now() / 1_000) + STATE_SECONDS }), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: STATE_SECONDS });
	return stateResponse;
}

export async function completeSso(code: string, state: string) {
	const settings = config();
	if (!settings) throw new Error("SSO is not configured");
	const cookieStore = await cookies();
	const pending = open<{ state: string; verifier: string; nextPath: string; exp: number }>(cookieStore.get(SSO_STATE_COOKIE)?.value);
	if (!pending || pending.exp <= Date.now() / 1_000 || pending.state.length !== state.length || !timingSafeEqual(Buffer.from(pending.state), Buffer.from(state))) throw new Error("Invalid SSO state");
	const metadata = await discovery(settings);
	const response = await fetch(metadata.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: settings.clientId, client_secret: settings.clientSecret, redirect_uri: settings.redirectUri, code, code_verifier: pending.verifier }), signal: AbortSignal.timeout(15_000) });
	if (!response.ok) throw new Error("SSO token exchange failed");
	const token = await response.json() as { access_token?: string; id_token?: string; expires_in?: number };
	if (!token.access_token || !token.id_token) throw new Error("SSO response did not include required tokens");
	const verified = await jwtVerify<OidcClaims>(token.id_token, createRemoteJWKSet(new URL(metadata.jwks_uri)), { issuer: metadata.issuer || settings.issuer, audience: settings.clientId, algorithms: ["RS256", "ES256"], requiredClaims: ["sub"] });
	const claims = verified.payload;
	const mfaClaim = claims[settings.mfaClaim] as unknown;
	const mfaValues: string[] = Array.isArray(mfaClaim) ? mfaClaim.map((value: unknown) => String(value)) : typeof mfaClaim === "string" ? [mfaClaim] : [];
	if (settings.mfaRequired && !mfaValues.some((value) => settings.mfaValues.includes(value))) throw new Error("MFA is required by this application");
	const roleClaim = claims[settings.roleClaim] as unknown;
	const roles: string[] = Array.isArray(roleClaim) ? roleClaim.map((value: unknown) => String(value)) : typeof roleClaim === "string" ? roleClaim.split(/[ ,]+/u).filter(Boolean) : [];
	const tenantClaim = claims[settings.tenantClaim] as unknown;
	const tenantId = typeof tenantClaim === "string" ? tenantClaim : process.env.SERVICEPILOT_TENANT_ID;
	if (roles.includes(settings.customerRole)) roles.push("customer", "ticket:create");
	if (settings.adminRoles.some((role) => roles.includes(role))) roles.push("agent", "approver", "audit:read");
	const email = typeof claims.email === "string" ? claims.email : "";
	const name = typeof claims.name === "string" ? claims.name : email.split("@")[0] || "Customer";
	if (!tenantId || !claims.sub || !email) throw new Error("SSO token is missing tenant or email claims");
	const session: SsoSession = { sub: claims.sub, tenantId, name, email, phone: typeof claims.phone_number === "string" ? claims.phone_number : "", roles, accessToken: token.access_token, expiresAt: Math.floor(Date.now() / 1_000) + Math.min(token.expires_in || SESSION_SECONDS, SESSION_SECONDS) };
	return { session, nextPath: pending.nextPath };
}

export function setSsoCookie(response: NextResponse, session: SsoSession) {
	response.cookies.set(SSO_COOKIE, seal(session), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_SECONDS, priority: "high" });
	response.cookies.set(SSO_STATE_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
}

export async function getSsoSession() {
	const session = open<SsoSession>((await cookies()).get(SSO_COOKIE)?.value);
	return session && session.sub && session.email && session.expiresAt > Date.now() / 1_000 ? session : null;
}

export function clearSsoCookie(response: NextResponse) {
	response.cookies.set(SSO_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
}
