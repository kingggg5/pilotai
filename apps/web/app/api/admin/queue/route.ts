import { NextResponse } from "next/server";

import { hasAdminSession } from "@/lib/admin-auth";
import { getConsoleData } from "@/lib/api";
import { parseQueueFilters } from "@/lib/queue-filters";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
	if (!await hasAdminSession()) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

	try {
		const url = new URL(request.url);
		const params = Object.fromEntries(url.searchParams.entries());
		const offset = Math.max(0, Number.parseInt(params.offset || "0", 10) || 0);
		const limit = Math.min(50, Math.max(1, Number.parseInt(params.limit || "50", 10) || 50));
		return NextResponse.json(await getConsoleData(offset, limit, parseQueueFilters(params)));
	} catch {
		return NextResponse.json({ ok: false, message: "Queue refresh failed" }, { status: 502 });
	}
}
