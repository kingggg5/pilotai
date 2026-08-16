import { NextResponse } from "next/server";

import {
	ADMIN_COOKIE,
	ADMIN_SESSION_SECONDS,
	adminAuthConfigured,
	createAdminToken,
	verifyAdminPassword,
} from "@/lib/admin-auth";
import { clearSsoCookie } from "@/lib/sso-auth";

export async function POST(request: Request) {
	if (process.env.SERVICEPILOT_AUTH_MODE === "oidc") return NextResponse.json({ ok: false, message: "Use SSO sign-in" }, { status: 400 });
	if (!adminAuthConfigured()) return NextResponse.json({ ok: false }, { status: 503 });
	try {
		const body = await request.json() as { password?: unknown };
		if (typeof body.password !== "string" || !verifyAdminPassword(body.password)) {
			return NextResponse.json({ ok: false }, { status: 401 });
		}
		const response = NextResponse.json({ ok: true });
		response.cookies.set(ADMIN_COOKIE, createAdminToken(), {
			httpOnly: true,
			secure: process.env.NODE_ENV === "production",
			sameSite: "strict",
			path: "/",
			maxAge: ADMIN_SESSION_SECONDS,
			priority: "high",
		});
		return response;
	} catch {
		return NextResponse.json({ ok: false }, { status: 400 });
	}
}

export async function DELETE() {
	const response = NextResponse.json({ ok: true });
	if (process.env.SERVICEPILOT_AUTH_MODE === "oidc") { clearSsoCookie(response); return response; }
	response.cookies.set(ADMIN_COOKIE, "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
	return response;
}
