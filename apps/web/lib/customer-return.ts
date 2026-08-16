import type { Language } from "@/lib/types";

const allowedPaths = new Set(["/support", "/cart"]);

export function customerReturnPath(value?: string) {
	if (!value) return "/account";

	try {
		const target = new URL(value, "http://servicepilot.local");
		if (target.origin !== "http://servicepilot.local" || !allowedPaths.has(target.pathname)) return "/account";

		const query = new URLSearchParams();
		if (target.pathname === "/support" && target.searchParams.get("topic") === "purchase") {
			const quantity = Number.parseInt(target.searchParams.get("quantity") || "1", 10) || 1;
			query.set("topic", "purchase");
			query.set("quantity", String(Math.min(10, Math.max(1, quantity))));
		}
		return `${target.pathname}${query.size ? `?${query}` : ""}`;
	} catch {
		return "/account";
	}
}

export function localizedPath(path: string, language: Language) {
	return `${path}${path.includes("?") ? "&" : "?"}lang=${language}`;
}
