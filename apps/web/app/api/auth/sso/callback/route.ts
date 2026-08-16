import { NextResponse } from "next/server";

import { completeSso, setSsoCookie } from "@/lib/sso-auth";

export async function GET(request: Request) {
	const url = new URL(request.url);
	const error = url.searchParams.get("error");
	if (error) return NextResponse.json({ ok: false, message: "SSO sign-in was cancelled" }, { status: 401 });
	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");
	if (!code || !state) return NextResponse.json({ ok: false, message: "SSO callback is incomplete" }, { status: 400 });
	try {
		const result = await completeSso(code, state);
		const response = NextResponse.redirect(new URL(result.nextPath, url.origin));
		setSsoCookie(response, result.session);
		return response;
	} catch (reason) {
		return NextResponse.json({ ok: false, message: reason instanceof Error ? reason.message : "SSO sign-in failed" }, { status: 401 });
	}
}
