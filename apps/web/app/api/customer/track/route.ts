import { NextResponse } from "next/server";

import { trackCustomerOrder } from "@/lib/api";
import { getCustomerSession } from "@/lib/customer-auth";

export async function POST(request: Request) {
	if (!await getCustomerSession()) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
	try {
		const body = await request.json() as { orderId?: unknown };
		if (typeof body.orderId !== "string" || !body.orderId.trim()) throw new Error("Enter an order number");
		return NextResponse.json({ ok: true, tracking: await trackCustomerOrder(body.orderId.trim()) });
	} catch (error) {
		return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Tracking failed" }, { status: 400 });
	}
}
