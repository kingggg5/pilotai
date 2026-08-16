import { resolve } from "node:path";

import { AutomationService } from "../apps/api/src/automation.js";
import { TicketClassifier } from "../apps/api/src/classifier.js";
import { jsonLines, option, output, root } from "./io.js";

type Expected = { order_id: string | null; refund_id: string | null; language: "th" | "en"; missing_fields: string[] };
type Case = { id: string; input: { message: string; locale: "auto" | "th" | "en" }; expected: Expected };

const rows = await jsonLines<Case>(option("--dataset", resolve(root, "evals/golden/automation_entities.v1.jsonl"))!);
const classifier = new TicketClassifier();
const automation = new AutomationService();
const cases = rows.map((row) => {
	const entities = automation.extract({ ...row.input, metadata: {} }, classifier.predict(row.input.message));
	const actual: Expected = { order_id: entities.order_id, refund_id: entities.refund_id, language: entities.language, missing_fields: entities.missing_fields };
	return { id: row.id, passed: JSON.stringify(actual) === JSON.stringify(row.expected), expected: row.expected, actual };
});
const accuracy = cases.filter((row) => row.passed).length / cases.length;
const report = { case_count: cases.length, metrics: { entity_exact_match: accuracy }, passed: accuracy === 1, cases };
await output(report, option("--report"));
if (!report.passed) process.exitCode = 1;
