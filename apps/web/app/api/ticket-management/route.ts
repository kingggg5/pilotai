import { NextResponse } from "next/server";

import { hasAdminSession } from "@/lib/admin-auth";
import { updateTicket } from "@/lib/api";
import type { Priority, TicketStatus } from "@/lib/types";

export async function PATCH(request: Request) {
  if (!await hasAdminSession()) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json() as { ticketId?: unknown; status?: unknown; priority?: unknown; assignedTeam?: unknown };
    const statuses: TicketStatus[] = ["new", "investigating", "needs_approval", "draft_ready", "resolved"];
    const priorities: Priority[] = ["low", "normal", "high", "urgent"];
    if (typeof body.ticketId !== "string" || !statuses.includes(body.status as TicketStatus) || !priorities.includes(body.priority as Priority) || typeof body.assignedTeam !== "string" || !body.assignedTeam.trim()) throw new Error("Invalid ticket update");
    return NextResponse.json({ ok: true, ticket: await updateTicket(body.ticketId, { status: body.status as TicketStatus, priority: body.priority as Priority, assignedTeam: body.assignedTeam.trim() }) });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "Ticket update failed" }, { status: 400 });
  }
}
