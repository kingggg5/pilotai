import { NextResponse } from "next/server";

import { hasAdminSession } from "@/lib/admin-auth";
import { submitTicketFeedback } from "@/lib/api";
import { parseTicketFeedback } from "@/lib/validation";

export async function POST(request: Request) {
	if (!await hasAdminSession()) return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
	try {
		const input = parseTicketFeedback(await request.json());
		if (!input) return NextResponse.json({ success: false, message: "Invalid feedback request" }, { status: 400 });
		const result = await submitTicketFeedback(input.ticketId, { feedbackType: input.feedbackType, rating: input.rating, notes: input.notes });
		return NextResponse.json({ success: result.success }, { status: result.success ? 200 : 502 });
	} catch {
		return NextResponse.json({ success: false, message: "Invalid feedback request" }, { status: 400 });
	}
}
