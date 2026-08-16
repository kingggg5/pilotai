import { NextResponse } from "next/server";

import { apiHeaders } from "@/lib/api-auth";
import { getCustomerSession } from "@/lib/customer-auth";

const API_URL = (process.env.SERVICEPILOT_API_URL || process.env.NEXT_PUBLIC_API_URL)?.replace(/\/$/, "");

export const dynamic = "force-dynamic";

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ ticketId: string }> }
) {
	try {
		const session = await getCustomerSession();
		if (!session) {
			return NextResponse.json({ ok: false, message: "Sign in required" }, { status: 401 });
		}

		const { ticketId } = await params;
		if (!ticketId || !API_URL) {
			return NextResponse.json({ ok: false, message: "Ticket stream unavailable" }, { status: 502 });
		}

		const upstream = await fetch(`${API_URL}/api/v1/tickets/${encodeURIComponent(ticketId)}/stream`, {
			cache: "no-store",
			headers: await apiHeaders("customer"),
		});
		if (!upstream.ok || !upstream.body) {
			return NextResponse.json({ ok: false, message: "Ticket stream unavailable" }, { status: 502 });
		}

		return new Response(upstream.body, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
	} catch {
		return NextResponse.json({ ok: false, message: "Ticket stream unavailable" }, { status: 502 });
	}
}
