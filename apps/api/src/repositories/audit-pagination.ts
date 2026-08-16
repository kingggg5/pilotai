import type { AuditEvent } from "../domain.js";

type AuditCursor = { occurred_at: string; id: string };

export function encodeAuditCursor(event: AuditEvent) {
	const cursor = { occurred_at: event.occurred_at, id: event.id } satisfies AuditCursor;
	return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeAuditCursor(value?: string): AuditCursor | undefined {
	if (!value) return undefined;
	try {
		const cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as AuditCursor;
		if (!cursor.id || Number.isNaN(Date.parse(cursor.occurred_at))) throw new Error();
		return cursor;
	} catch {
		throw Object.assign(new Error("Invalid audit cursor"), { statusCode: 400 });
	}
}

export function auditEventPrecedesCursor(event: AuditEvent, cursor?: AuditCursor) {
	return !cursor || event.occurred_at < cursor.occurred_at || (event.occurred_at === cursor.occurred_at && event.id < cursor.id);
}

export function escapeLikePrefix(value: string) {
	return `${value.toLocaleLowerCase().replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}
