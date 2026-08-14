import { NextResponse } from "next/server";

import { loginCustomer, registerCustomer } from "@/lib/api";
import { CUSTOMER_COOKIE, CUSTOMER_SESSION_SECONDS, createCustomerToken } from "@/lib/customer-auth";

function sessionResponse(profile: { id: string; name: string; email: string; phone: string }, status = 200) {
  const response = NextResponse.json({ ok: true, profile }, { status });
  response.cookies.set(CUSTOMER_COOKIE, createCustomerToken({ sub: profile.id, name: profile.name, email: profile.email, phone: profile.phone }), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: CUSTOMER_SESSION_SECONDS, priority: "high",
  });
  return response;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    if (body.mode === "register") {
      if (typeof body.name !== "string" || typeof body.email !== "string" || typeof body.phone !== "string" || typeof body.password !== "string") throw new Error("Invalid registration");
      return sessionResponse(await registerCustomer({ name: body.name, email: body.email, phone: body.phone, password: body.password }), 201);
    }
    if (typeof body.email !== "string" || typeof body.password !== "string") throw new Error("Invalid login");
    return sessionResponse(await loginCustomer({ email: body.email, password: body.password }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Authentication failed";
    return NextResponse.json({ ok: false, message }, { status: message.includes("already registered") ? 409 : 401 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(CUSTOMER_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
