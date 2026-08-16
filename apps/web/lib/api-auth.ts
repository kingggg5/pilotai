import "server-only";

import { createHmac } from "node:crypto";

import { getAdminSession } from "@/lib/admin-auth";
import { getCustomerSession } from "@/lib/customer-auth";
import { serverSecret } from "@/lib/secrets";
import { getSsoSession } from "@/lib/sso-auth";

export type ApiActor = "admin" | "customer";
type Claims = { sub: string; tenant_id: string; roles: string[] };

const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

function jwt(claims: Claims) {
	const secret = serverSecret("SERVICEPILOT_JWT_SECRET");
	if (!secret) return undefined;
	const now = Math.floor(Date.now() / 1000);
	const header = base64url({ alg: "HS256", typ: "JWT" });
	const jwtIssuer = process.env.SERVICEPILOT_JWT_ISSUER ?? "servicepilot";
	const jwtAudience = process.env.SERVICEPILOT_JWT_AUDIENCE ?? "servicepilot-api";
	const payload = base64url({
		...claims,
		iss: jwtIssuer,
		aud: jwtAudience,
		iat: now,
		exp: now + 5 * 60,
	});
	const unsigned = `${header}.${payload}`;
	const signature = createHmac("sha256", secret).update(unsigned).digest("base64url");
	return `${unsigned}.${signature}`;
}

export async function apiHeaders(actor: ApiActor) {
	if (process.env.SERVICEPILOT_AUTH_MODE === "oidc") {
		const session = await getSsoSession();
		if (!session?.accessToken) throw new Error("SSO session expired");
		return { "X-Tenant-ID": session.tenantId, "X-Actor-ID": session.sub, Authorization: `Bearer ${session.accessToken}` };
	}
	const tenantId = process.env.SERVICEPILOT_TENANT_ID ?? "tenant-local";
	let claims: Claims;
	if (actor === "admin") {
		const session = await getAdminSession();
		if (!session) throw new Error("Admin session expired");
		claims = { sub: session.sub, tenant_id: session.tenantId, roles: session.roles };
	} else {
		const session = await getCustomerSession();
		claims = session
			? { sub: session.sub, tenant_id: session.tenantId, roles: ["customer", "ticket:create"] }
			: { sub: "customer-web", tenant_id: tenantId, roles: ["ticket:create"] };
	}
	const token = jwt(claims);
	return {
		"X-Tenant-ID": claims.tenant_id,
		"X-Actor-ID": claims.sub,
		...(token ? { Authorization: `Bearer ${token}` } : {}),
	};
}
