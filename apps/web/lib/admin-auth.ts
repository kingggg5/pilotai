import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { serverSecret } from "@/lib/secrets";

export const ADMIN_COOKIE = "sp_admin";
export const ADMIN_SESSION_SECONDS = 8 * 60 * 60;

export type AdminSession = {
  sub: string;
  tenantId: string;
  roles: string[];
  exp: number;
};

const encode = (value: string) => Buffer.from(value).toString("base64url");
const decode = (value: string) => Buffer.from(value, "base64url").toString("utf8");

function password() {
  return serverSecret("SERVICEPILOT_ADMIN_PASSWORD");
}

function sessionSecret() {
  return serverSecret("SERVICEPILOT_SESSION_SECRET") || password();
}

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function equal(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function adminAuthConfigured() {
  return Boolean(password() && sessionSecret());
}

export function verifyAdminPassword(candidate: string) {
  const expected = password();
  return Boolean(expected && equal(candidate, expected));
}

export function createAdminToken() {
  const secret = sessionSecret();
  if (!secret) throw new Error("Admin authentication is not configured");
  const adminSub = process.env.SERVICEPILOT_ADMIN_SUBJECT ?? "support-admin";
  const tenantId = process.env.SERVICEPILOT_TENANT_ID ?? "tenant-local";
  const session: AdminSession = {
    sub: adminSub,
    tenantId: tenantId,
    roles: ["agent", "approver", "audit:read"],
    exp: Math.floor(Date.now() / 1000) + ADMIN_SESSION_SECONDS,
  };
  const payload = encode(JSON.stringify(session));
  return `${payload}.${signature(payload, secret)}`;
}

export async function getAdminSession(): Promise<AdminSession | null> {
  const secret = sessionSecret();
  if (!secret) {
    return process.env.NODE_ENV === "production"
      ? null
      : { sub: "local-agent", tenantId: "tenant-local", roles: ["agent", "approver", "audit:read"], exp: Number.MAX_SAFE_INTEGER };
  }
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token) return null;
  const [payload, supplied, extra] = token.split(".");
  if (!payload || !supplied || extra || !equal(supplied, signature(payload, secret))) return null;
  try {
    const session = JSON.parse(decode(payload)) as AdminSession;
    if (!session.sub || !session.tenantId || session.exp <= Date.now() / 1000) return null;
    return session;
  } catch {
    return null;
  }
}

export async function hasAdminSession() {
  return Boolean(await getAdminSession());
}
