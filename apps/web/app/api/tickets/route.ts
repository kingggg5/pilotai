import { NextResponse } from "next/server";

import { createTicket } from "@/lib/api";
import { getCustomerSession } from "@/lib/customer-auth";
import { parseTicketDraft } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const customer = await getCustomerSession();
    if (!customer) return NextResponse.json({ ok: false, message: "Sign in required" }, { status: 401 });
    const draft = parseTicketDraft(await request.json());
    if (!draft) return NextResponse.json({ ok: false, message: "Invalid ticket request" }, { status: 400 });
    return NextResponse.json({ ok: true, item: await createTicket({ ...draft, customer: customer.name, customerId: customer.email }) }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Ticket creation failed" },
      { status: 502 },
    );
  }
}
