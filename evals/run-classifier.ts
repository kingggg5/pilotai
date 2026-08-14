import { resolve } from "node:path";
import { TicketClassifier, classificationMetrics } from "../apps/api/src/classifier.js";
import type { ClassificationResult } from "../apps/api/src/domain.js";
import { jsonLines, option, output, root } from "./io.js";

type Row = { input: { message: string }; expected: { category: ClassificationResult["category"]; priority: ClassificationResult["priority"] } };
const path = option("--dataset", resolve(root, "evals/golden/servicepilot_tickets.v1.jsonl"))!;
const rows = await jsonLines<Row>(path);
const classifier = new TicketClassifier();
const predicted = rows.map((row) => classifier.predict(row.input.message));
const expected = rows.map((row) => ({ ...predicted[0]!, category: row.expected.category, priority: row.expected.priority }));
await output({ case_count: rows.length, model_version: classifier.modelVersion, metrics: classificationMetrics(expected, predicted) }, option("--report"));
