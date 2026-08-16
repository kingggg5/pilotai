import { resolve } from "node:path";
import { HashEmbedder } from "../apps/api/src/ai.js";
import { MemoryKnowledgeRepository } from "../apps/api/src/repositories/index.js";
import { jsonLines, option, output, root } from "./io.js";

type Row = { id: string; query: string; relevant_document_ids: string[]; relevant_pages: number[] };
type DocumentRow = { id: string; source: string; title: string; content: string; page_number: number; page_label: string; locale: "th" | "en" | "multi"; acl: Record<string, unknown>; metadata: Record<string, unknown> };
const rows = await jsonLines<Row>(option("--dataset", resolve(root, "evals/golden/rag_retrieval.v1.jsonl"))!);
const documents = await jsonLines<DocumentRow>(option("--documents", resolve(root, "evals/golden/rag_documents.v1.jsonl"))!);
const k = Number(option("--k", "3"));
const repository = new MemoryKnowledgeRepository(new HashEmbedder());
for (const document of documents) await repository.upsert(document, "tenant-local");
const cases = [];
for (const row of rows) {
  const retrieved = await repository.search(row.query, k, "tenant-local");
  const rank = retrieved.findIndex((doc) => row.relevant_document_ids.includes(doc.id));
  const relevant = retrieved.find((doc) => row.relevant_document_ids.includes(doc.id));
  cases.push({
    id: row.id,
    retrieved: retrieved.map((doc) => doc.id),
    recall_at_k: relevant ? 1 : 0,
    reciprocal_rank: rank >= 0 ? 1 / (rank + 1) : 0,
    citation_correct: Boolean(
      relevant?.page_number &&
        row.relevant_pages.includes(relevant.page_number) &&
        relevant.citation
    ),
  });
}
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const metrics = { recall_at_k: mean(cases.map((row) => row.recall_at_k)), mrr: mean(cases.map((row) => row.reciprocal_rank)), citation_accuracy: mean(cases.map((row) => Number(row.citation_correct))) };
const thresholds = { recall_at_k: 0.85, mrr: 0.8, citation_accuracy: 1 };
const failed_thresholds = Object.fromEntries(Object.entries(thresholds).filter(([name, required]) => metrics[name as keyof typeof metrics] < required).map(([name, required]) => [name, { actual: metrics[name as keyof typeof metrics], required }]));
await output({ case_count: rows.length, k, metrics, failed_thresholds, passed: !Object.keys(failed_thresholds).length, cases }, option("--report"));
if (Object.keys(failed_thresholds).length) process.exitCode = 1;
