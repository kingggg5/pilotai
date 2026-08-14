import { NextResponse } from "next/server";

import { updateCustomer } from "@/lib/api";
import { CUSTOMER_COOKIE, CUSTOMER_SESSION_SECONDS, createCustomerToken, getCustomerSession } from "@/lib/customer-auth";

export async function PATCH(request: Request) {
  if (!await getCustomerSession()) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json() as Record<string, unknown>;
    if (typeof body.name !== "string" || typeof body.phone !== "string") throw new Error("Invalid profile");
    const profile = await updateCustomer({ name: body.name, phone: body.phone });
    const response = NextResponse.json({ ok: true, profile });
    response.cookies.set(CUSTOMER_COOKIE, createCustomerToken({ sub: profile.id, name: profile.name, email: profile.email, phone: profile.phone }), {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: CUSTOMER_SESSION_SECONDS, priority: "high",
    });
    return response;
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Profile update failed" }, { status: 400 });
  }
}
