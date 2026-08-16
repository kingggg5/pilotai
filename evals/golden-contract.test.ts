import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { jsonLines, root } from "./io.js";

type Case = { id: string; tags: string[]; input: { locale: string }; expected: { route: string; allowed_tools: string[] } };
const cases = await jsonLines<Case>(resolve(root, "evals/golden/servicepilot_tickets.v1.jsonl"));

test("golden contract is bilingual, unique and fail-closed", () => {
	assert.ok(cases.length >= 12);
	assert.equal(new Set(cases.map((row) => row.id)).size, cases.length);
	assert.deepEqual(new Set(cases.map((row) => row.input.locale)), new Set(["en", "th"]));
	for (const row of cases.filter((row) => row.tags.some((tag) => ["pii", "prompt-injection", "tenant-isolation"].includes(tag)))) assert.deepEqual(row.expected.allowed_tools, []);
	for (const row of cases.filter((row) => row.expected.route === "refuse")) assert.deepEqual(row.expected.allowed_tools, []);
});
