import { NextResponse } from "next/server";
import { createPurchase } from "@/lib/api";
import { getCustomerSession } from "@/lib/customer-auth";

export async function POST(request: Request) {
	try {
		const session = await getCustomerSession();
		if (!session) return NextResponse.json({ ok: false, message: "Sign in required" }, { status: 401 });

		const body = await request.json().catch(() => ({})) as { items?: Array<{ productId: string; quantity: number }>; locale?: string };
		const items = (body.items ?? []).filter(
			(item): item is { productId: string; quantity: number } =>
				Boolean(item?.productId && Number.isInteger(item?.quantity) && item.quantity >= 1 && item.quantity <= 20)
		);

		if (!items.length) return NextResponse.json({ ok: false, message: "Invalid or empty cart" }, { status: 400 });

		const purchase = await createPurchase({ items, locale: body.locale === "en" ? "en" : "th" });
		return NextResponse.json({ ok: true, purchase }, { status: 201 });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Purchase request failed";
		return NextResponse.json({ ok: false, message }, { status: 502 });
	}
}
