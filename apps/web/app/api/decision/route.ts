import { NextResponse } from "next/server";

import { hasAdminSession } from "@/lib/admin-auth";
import { submitDecision } from "@/lib/api";
import { parseDecision } from "@/lib/validation";

export async function POST(request: Request) {
  if (!await hasAdminSession()) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  try {
    const input = parseDecision(await request.json());
    if (!input) return NextResponse.json({ ok: false, message: "Invalid decision request" }, { status: 400 });
    const result = await submitDecision(input.runId, input.decision, input.note);
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid decision request" }, { status: 400 });
  }
}
