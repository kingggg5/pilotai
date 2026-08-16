import type { Language, QueueFilters } from "@/lib/types";

type RawQueueParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
const clean = (value: string | string[] | undefined, max: number) => first(value)?.trim().slice(0, max) || undefined;

export function parseQueueFilters(params: RawQueueParams): QueueFilters {
	const priority = first(params.priority);
	const status = first(params.status);
	const channel = first(params.channel);
	const handlingMode = first(params.handling);
	const sort = first(params.sort);
	return {
		...(clean(params.q, 200) ? { query: clean(params.q, 200) } : {}),
		...(clean(params.number, 128) ? { number: clean(params.number, 128) } : {}),
		...(["low", "normal", "high", "urgent"].includes(priority || "") ? { priority: priority as QueueFilters["priority"] } : {}),
		...(["new", "investigating", "needs_approval", "draft_ready", "resolved"].includes(status || "") ? { status: status as QueueFilters["status"] } : {}),
		...(["email", "chat", "web"].includes(channel || "") ? { channel: channel as QueueFilters["channel"] } : {}),
		...(["manual", "copilot", "autopilot"].includes(handlingMode || "") ? { handlingMode: handlingMode as QueueFilters["handlingMode"] } : {}),
		...(clean(params.from, 10)?.match(/^\d{4}-\d{2}-\d{2}$/u) ? { createdFrom: clean(params.from, 10) } : {}),
		...(clean(params.to, 10)?.match(/^\d{4}-\d{2}-\d{2}$/u) ? { createdTo: clean(params.to, 10) } : {}),
		sort: sort === "oldest" || sort === "priority" ? sort : "newest",
	};
}

export function queuePageUrl(language: Language, filters: QueueFilters, page = 1) {
	const query = new URLSearchParams({ lang: language });
	if (filters.query) query.set("q", filters.query);
	if (filters.number) query.set("number", filters.number);
	if (filters.priority) query.set("priority", filters.priority);
	if (filters.status) query.set("status", filters.status);
	if (filters.channel) query.set("channel", filters.channel);
	if (filters.handlingMode) query.set("handling", filters.handlingMode);
	if (filters.createdFrom) query.set("from", filters.createdFrom);
	if (filters.createdTo) query.set("to", filters.createdTo);
	if (filters.sort !== "newest") query.set("sort", filters.sort);
	if (page > 1) query.set("page", String(page));
	return `/admin?${query}`;
}

export function queueDataUrl(filters: QueueFilters, offset = 0, limit = 50) {
	const query = new URLSearchParams({ offset: String(offset), limit: String(limit), sort: filters.sort });
	if (filters.query) query.set("q", filters.query);
	if (filters.number) query.set("number", filters.number);
	if (filters.priority) query.set("priority", filters.priority);
	if (filters.status) query.set("status", filters.status);
	if (filters.channel) query.set("channel", filters.channel);
	if (filters.handlingMode) query.set("handling", filters.handlingMode);
	if (filters.createdFrom) query.set("from", filters.createdFrom);
	if (filters.createdTo) query.set("to", filters.createdTo);
	return `/api/admin/queue?${query}`;
}
