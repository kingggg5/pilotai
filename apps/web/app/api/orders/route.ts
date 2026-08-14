import { NextResponse } from "next/server";

import { createPurchase } from "@/lib/api";
import { getCustomerSession } from "@/lib/customer-auth";

export async function POST(request: Request) {
  try {
    if (!await getCustomerSession()) return NextResponse.json({ ok: false, message: "Sign in required" }, { status: 401 });
    const value = await request.json() as { items?: unknown; locale?: unknown };
    if (!Array.isArray(value.items) || !value.items.length) return NextResponse.json({ ok: false, message: "Cart is empty" }, { status: 400 });
    const items = value.items.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const candidate = item as { productId?: unknown; quantity?: unknown };
      return typeof candidate.productId === "string" && typeof candidate.quantity === "number" ? [{ productId: candidate.productId, quantity: candidate.quantity }] : [];
    });
    if (!items.length || items.some((item) => !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20)) return NextResponse.json({ ok: false, message: "Invalid cart items" }, { status: 400 });
    const locale = value.locale === "en" ? "en" : "th";
    return NextResponse.json({ ok: true, purchase: await createPurchase({ items, locale }) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Purchase request failed";
    return NextResponse.json({ ok: false, message }, { status: 502 });
  }
}
