import { NextResponse } from "next/server";

import { createSsoAuthorizationUrl } from "@/lib/sso-auth";

export async function GET(request: Request) {
	try {
		const url = new URL(request.url);
		const nextPath = url.searchParams.get("next") || "/account";
		if (!nextPath.startsWith("/") || nextPath.startsWith("//")) return NextResponse.json({ ok: false, message: "Invalid redirect" }, { status: 400 });
		return await createSsoAuthorizationUrl(nextPath);
	} catch (error) {
		return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "SSO is unavailable" }, { status: 503 });
	}
}
