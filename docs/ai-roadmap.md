# ServicePilot AI roadmap

ServicePilot already has the right safety boundary: deterministic ticket classification, tenant-scoped retrieval, evidence thresholds, read-only tools, and human approval before writes. The next improvements should make agents more useful without allowing a model to become the source of truth.

## Operating principle

AI may suggest, summarize, rank, and ask for missing information. It must not choose tenant access, invent policy, or authorize a financial or account-changing action. Every generated answer remains grounded in retrieved evidence and every write remains behind approval.

## Implemented automation

- Persists a per-ticket handling mode: `manual`, `copilot`, or `autopilot`; the admin queue can filter by it.
- Skips AI business-tool calls in manual mode, prepares evidence and a draft in copilot mode, and completes verified low-risk work only in autopilot mode.
- Extracts `ORD-*`, `SO-*`, `REF-*`, and `RF-*` references from Thai–English requests.
- Detects missing order references and returns the next question automatically.
- Routes tickets, assigns priority, and adds operational tags without staff data entry.
- Runs order, refund, and policy lookups automatically.
- Marks verified low-risk autopilot answers as resolved and records the selected mode plus automation actions in the audit log.
- Keeps refunds, purchases, urgent billing, and account-security writes behind LangGraph human approval.
- Evaluates entity extraction with a deterministic bilingual golden dataset through `npm run ai:eval`.

## Delivery plan

| Phase | Capability | Why it helps | Acceptance criteria |
| --- | --- | --- | --- |
| 0 — baseline | Capture model version, evidence IDs, latency, token usage, abstention reason, and reviewer outcome for every run | Makes quality and cost measurable | 100% of workflow runs have a traceable decision record; no secret or raw credential in logs |
| 1 — agent assist | Add structured entity extraction for order ID, refund ID, product, language, and requested action; show a “next best question” when a field is missing | Reduces back-and-forth for customers and agents | Entity precision/recall is measured on a bilingual golden set; invalid IDs never trigger a tool call |
| 2 — grounded answer quality | Add query rewriting and reranking only as retrieval helpers; return the top citations and a short evidence summary to staff | Improves recall while preserving citations | Recall@5 ≥ 0.90, MRR ≥ 0.85, citation accuracy = 1.00, abstention precision ≥ 0.95 |
| 3 — staff copilot | Generate a concise ticket summary, duplicate-ticket signal, suggested team, and reply draft with an edit-before-send workflow | Helps staff clear the queue faster | Staff acceptance/edit rate is measured; generated text never changes ticket state automatically |
| 4 — safe tool planning | Recommend a read-only tool plan from structured entities, then execute only allow-listed tools; keep write tools approval-gated | Makes the workflow feel intelligent without autonomous side effects | 100% of write attempts require approval; cross-tenant and prompt-injection tests remain blocked |
| 5 — learning loop | Store de-identified reviewer corrections and customer outcomes; retrain/recalibrate the classifier on time-based splits | Improves Thai–English classification from real work | Macro-F1 and per-class recall improve without regression on safety cases |
| 6 — production operations | Add OpenTelemetry spans for retrieval, model calls, tool calls, approvals, cost, and fallback; alert on latency, failure, abstention, and approval backlog | Turns AI into an operable service | p95 latency and cost budgets are visible; alerts have an owner and runbook |

## Next increment

1. Add grounded ticket summaries, duplicate detection, and an edit-before-send staff reply workflow.
2. Expand the bilingual automation dataset to at least 30 cases covering references, account takeover, prompt injection, and ambiguous policy questions.
3. Add reviewer feedback (`accepted`, `edited`, `rejected`) without sending raw customer content to a third-party training service.
4. Add explicit latency/token/cost fields to each automation trace and dashboard.
5. Enable OpenAI drafting only after local entity, retrieval, and policy evaluations pass.

## Metrics to keep visible

- **Quality:** Macro-F1, per-class recall, Recall@5, MRR, citation accuracy, abstention precision.
- **Safety:** blocked injection rate, cross-tenant denial rate, approval bypass count (must remain zero), PII leakage cases.
- **Operations:** p50/p95 latency, model error rate, fallback rate, tokens, cost per resolved ticket, approval backlog.
- **Business:** first-response time, resolution time, repeat-contact rate, staff edit rate, customer satisfaction.

Run the deterministic baseline with:

```sh
npm run ai:eval
```

The roadmap deliberately keeps LangGraph as one controlled workflow. Adding multiple agent frameworks would make the system harder to evaluate and operate without improving the customer journey.
