import "server-only";

import { readFileSync } from "node:fs";

export function serverSecret(name: string) {
	const direct = process.env[name];
	if (direct) return direct;
	const file = process.env[`${name}_FILE`];
	return file ? readFileSync(file, "utf8").trim() : undefined;
}
