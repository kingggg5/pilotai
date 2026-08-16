import { NextResponse } from "next/server";
import { payCustomerOrder } from "@/lib/api";
import { getCustomerSession } from "@/lib/customer-auth";

export async function POST(
	_request: Request,
	{ params }: { params: Promise<{ orderId: string }> }
) {
	try {
		const session = await getCustomerSession();
		if (!session) {
			return NextResponse.json({ ok: false, message: "Sign in required" }, { status: 401 });
		}

		const { orderId } = await params;
		if (!orderId) {
			return NextResponse.json({ ok: false, message: "Order ID required" }, { status: 400 });
		}

		const result = await payCustomerOrder(orderId);
		return NextResponse.json(result, { status: 200 });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Payment confirmation failed";
		return NextResponse.json({ ok: false, message }, { status: 502 });
	}
}
