import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

import { serverSecret } from "@/lib/secrets";

export const CUSTOMER_COOKIE = "sp_customer";
export const CUSTOMER_SESSION_SECONDS = 7 * 24 * 60 * 60;

export type CustomerSession = {
	sub: string;
	tenantId: string;
	name: string;
	email: string;
	phone: string;
	exp: number;
};

const secret = () => serverSecret("SERVICEPILOT_CUSTOMER_SESSION_SECRET")
	|| serverSecret("SERVICEPILOT_SESSION_SECRET")
	|| (process.env.NODE_ENV === "production" ? undefined : "local-customer-session-secret-change-me");
const sign = (payload: string, key: string) => createHmac("sha256", key).update(payload).digest("base64url");
const equal = (left: string, right: string) => {
	const a = Buffer.from(left); const b = Buffer.from(right);
	return a.length === b.length && timingSafeEqual(a, b);
};

export function createCustomerToken(profile: Omit<CustomerSession, "tenantId" | "exp">) {
	const key = secret();
	if (!key) throw new Error("Customer authentication is not configured");
	const tenantId = process.env.SERVICEPILOT_TENANT_ID ?? "tenant-local";
	const session: CustomerSession = {
		...profile,
		tenantId: tenantId,
		exp: Math.floor(Date.now() / 1_000) + CUSTOMER_SESSION_SECONDS,
	};
	const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
	return `${payload}.${sign(payload, key)}`;
}

export async function getCustomerSession(): Promise<CustomerSession | null> {
	const key = secret();
	const token = (await cookies()).get(CUSTOMER_COOKIE)?.value;
	if (!key || !token) return null;
	const [payload, signature, extra] = token.split(".");
	if (!payload || !signature || extra || !equal(signature, sign(payload, key))) return null;
	try {
		const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as CustomerSession;
		return session.sub && session.email && session.exp > Date.now() / 1_000 ? session : null;
	} catch { return null; }
}
