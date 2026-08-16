import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { buildGoldenWorkflow } from "../apps/api/src/golden-fixture.js";
import type { AssistResponse } from "../apps/api/src/domain.js";
import { jsonLines, option, output, root } from "./io.js";

type Expected = { category: string; priority: string; route: string; requires_human_approval: boolean; allowed_tools: string[] };
type Case = { id: string; tags: string[]; input: { message: string; locale: string; tenant_id: string }; expected: Expected };
type Spec = { contract_fields: string[]; allowed_values: Record<string, string[]>; critical_tags: string[]; no_tool_tags: string[]; thresholds: Record<string, number> };
const spec = JSON.parse(await readFile(option("--spec", resolve(root, "evals/spec.json"))!, "utf8")) as Spec;
const cases = await jsonLines<Case>(option("--dataset", resolve(root, "evals/golden/servicepilot_tickets.v1.jsonl"))!);

function validate() {
	const ids = new Set<string>();
	for (const row of cases) {
		if (!row.id || ids.has(row.id)) throw new Error(`Invalid or duplicate case id: ${row.id}`);
		ids.add(row.id);
		if (!row.input.message || !spec.allowed_values.locale?.includes(row.input.locale)) throw new Error(`Invalid input: ${row.id}`);
		if (Object.keys(row.expected).sort().join() !== [...spec.contract_fields].sort().join()) throw new Error(`Invalid expected contract: ${row.id}`);
		if (spec.no_tool_tags.some((tag) => row.tags.includes(tag)) && row.expected.allowed_tools.length) throw new Error(`Unsafe tools in hostile case: ${row.id}`);
	}
}

validate();
if (process.argv.includes("--validate-only")) await output({ valid: true, case_count: cases.length });
else {
	// Golden cases run through the real workflow graph over a deterministic
	// fixture world (local model, memory repositories) — no policy re-implementation.
	const tenant = cases[0]?.input.tenant_id ?? "tenant-golden";
	const corpus = await jsonLines<{ id: string; source: string; title: string; content: string; page_number?: number; page_label?: string; locale: "th" | "en" | "multi" }>(resolve(root, "evals/golden/rag_documents.v1.jsonl"));
	const workflow = await buildGoldenWorkflow({
		tenantId: tenant,
		orders: [{ id: "SO-1042", status: "shipped" }, { id: "SO-8821", status: "shipped" }, { id: "SO-7011", status: "confirmed" }, { id: "SO-9120", status: "confirmed" }],
		refunds: ["RF-3308", "RF-4410"],
		documents: corpus.map((document) => ({ id: document.id, source: document.source, title: document.title, content: document.content, page_number: document.page_number ?? null, page_label: document.page_label ?? null, locale: document.locale })),
	});

	// Cases run sequentially through the real graph to keep the report deterministic.
	const runs: AssistResponse[] = [];
	for (const row of cases) runs.push(await workflow.start({ message: row.input.message, locale: row.input.locale as "en" | "th", metadata: { tenant_id: row.input.tenant_id } }, row.input.tenant_id));

	const routeOf = (run: AssistResponse) => {
		if (run.status === "refused") return "refuse";
		if (run.automation.mode === "needs_customer") return "clarify";
		if (run.automation.mode === "needs_approval" || run.policy.requires_approval) return "human";
		if (run.automation.mode === "auto_completed") return "automated";
		if (run.automation.mode === "auto_routed") return run.classification.category === "general" ? "clarify" : "human";
		return "human";
	};
	const toolsOf = (run: AssistResponse) => {
		if (run.status === "refused") return [];
		if (run.policy.requires_approval) return ["create_escalation"];
		const tool = run.retrieval.documents[0]?.metadata?.tool;
		if (typeof tool === "string") return [tool];
		if (run.classification.category === "policy") return ["search_policy"];
		return [];
	};
	const results = runs.map((run) => ({ category: run.classification.category, priority: run.classification.priority, route: routeOf(run), requires_human_approval: run.policy.requires_approval, allowed_tools: toolsOf(run) }));

	const metrics: Record<string, number> = {};
	const mapping = { category: "category_accuracy", priority: "priority_accuracy", route: "route_accuracy", requires_human_approval: "approval_accuracy", allowed_tools: "tool_policy_accuracy" } as const;
	const failures: Array<{ id: string; field: string }> = [];
	for (const [field, metric] of Object.entries(mapping)) {
		const correct = cases.filter((row, index) => JSON.stringify(row.expected[field as keyof Expected]) === JSON.stringify(results[index]![field as keyof Expected])).length;
		metrics[metric] = correct / cases.length;
		cases.forEach((row, index) => { if (JSON.stringify(row.expected[field as keyof Expected]) !== JSON.stringify(results[index]![field as keyof Expected])) failures.push({ id: row.id, field }); });
	}
	const critical = cases.filter((row) => row.tags.some((tag) => spec.critical_tags.includes(tag)));
	metrics.critical_case_pass_rate = critical.filter((row) => !failures.some((failure) => failure.id === row.id)).length / critical.length;
	const failed_thresholds = Object.fromEntries(Object.entries(spec.thresholds).filter(([name, minimum]) => name in metrics && metrics[name]! < minimum).map(([name, minimum]) => [name, { actual: metrics[name], minimum }]));
	const report = { schema_version: 2, runner: "real-workflow", persistence: "memory", case_count: cases.length, critical_case_count: critical.length, metrics, passed: !Object.keys(failed_thresholds).length, failed_thresholds, failures };
	await output(report, option("--report"));
	if (!report.passed) process.exitCode = 1;
}
