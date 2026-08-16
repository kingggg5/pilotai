import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { TicketClassifier } from "../apps/api/src/classifier.js";
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
	const classifier = new TicketClassifier();
	const predictions = cases.map((row) => {
		const result = classifier.predict(row.input.message);
		const refuse = result.category === "security";
		const approval = result.category === "refund_request" || result.priority === "urgent" || (result.category === "billing" && result.priority === "high") || (result.category === "account_access" && ["high", "urgent"].includes(result.priority));
		const allowed_tools = refuse ? [] : result.category === "order_status" ? ["get_order_status"] : result.category === "refund_status" ? ["check_refund_status"] : result.category === "policy" ? ["search_policy"] : approval ? ["create_escalation"] : [];
		const route = refuse ? "refuse" : approval ? "human" : result.category === "general" && /still does not work|ยัง.*ไม่ได้/iu.test(row.input.message) ? "clarify" : result.category === "technical" ? "human" : "automated";
		return { category: result.category, priority: result.priority, route, requires_human_approval: approval, allowed_tools };
	});
	const metrics: Record<string, number> = {};
	const mapping = { category: "category_accuracy", priority: "priority_accuracy", route: "route_accuracy", requires_human_approval: "approval_accuracy", allowed_tools: "tool_policy_accuracy" } as const;
	const failures: Array<{ id: string; field: string }> = [];
	for (const [field, metric] of Object.entries(mapping)) {
		const correct = cases.filter((row, index) => JSON.stringify(row.expected[field as keyof Expected]) === JSON.stringify(predictions[index]![field as keyof Expected])).length;
		metrics[metric] = correct / cases.length;
		cases.forEach((row, index) => { if (JSON.stringify(row.expected[field as keyof Expected]) !== JSON.stringify(predictions[index]![field as keyof Expected])) failures.push({ id: row.id, field }); });
	}
	const critical = cases.filter((row) => row.tags.some((tag) => spec.critical_tags.includes(tag)));
	metrics.critical_case_pass_rate = critical.filter((row) => !failures.some((failure) => failure.id === row.id)).length / critical.length;
	const failed_thresholds = Object.fromEntries(Object.entries(spec.thresholds).filter(([name, minimum]) => name in metrics && metrics[name]! < minimum).map(([name, minimum]) => [name, { actual: metrics[name], minimum }]));
	const report = { schema_version: 1, case_count: cases.length, critical_case_count: critical.length, metrics, passed: !Object.keys(failed_thresholds).length, failed_thresholds, failures };
	await output(report, option("--report"));
	if (!report.passed) process.exitCode = 1;
}
