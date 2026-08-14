# ServicePilot AI architecture

Status: accepted for MVP

Last reviewed: 2026-08-13

## Decision

ServicePilot AI is a tenant-aware customer-service workflow, not a society of autonomous agents. The production runtime therefore uses one typed, deterministic LangGraph whose nodes call ordinary application services. Parallel Codex agents may accelerate development, but they are not part of the deployed request path.

The MVP stack is TypeScript on Node.js 22: Fastify + Zod, LangGraph.js, PostgreSQL + pgvector and full-text search, a small character n-gram Naive Bayes classifier, OpenAI embeddings, OpenTelemetry JavaScript, Node tests/custom evaluations, Nginx, and Docker Compose. The LLM provider is behind a narrow gateway; LiteLLM remains optional until a second provider is needed.

## Runtime shape

```text
Nginx -> Fastify REST/OpenAPI
  -> authenticate + bind tenant/request identity
  -> normalize ticket
  -> classify category/priority (deterministic model)
  -> retrieve tenant-filtered policy/order context (FTS + pgvector)
  -> draft grounded response or proposed action
  -> validate citations, policy, PII and tool arguments
  -> execute read-only action OR pause for human approval
  -> persist outcome + audit event

MCP adapter -> the same application-service methods (never the database directly)
```

The graph state is a versioned Zod schema. Conditional edges are explicit and covered by golden cases. A checkpointer stores only the minimum state needed to resume; sensitive raw content is encrypted or replaced with references. Every side-effecting node accepts an idempotency key.

### Why one deterministic graph

A multi-agent runtime would add delegation, negotiation, duplicated context, non-deterministic hand-offs, latency and cost without adding a useful business capability. ServicePilot has a known state machine: classify, retrieve, draft, validate, approve when necessary, and execute. One graph makes each transition inspectable, replayable and testable, and lets policy gates dominate model output. Add another autonomous agent only if a future capability has an independently owned goal, tools and success criterion that cannot be represented as a graph node.

## API and tool boundary

REST/OpenAPI is the system of record for browser, webhook and service integrations. It provides stable authentication, authorization, idempotency, rate limits and conventional operational tooling. The MCP server is a thin adapter for AI clients and exposes a deliberately small typed surface:

- `get_order_status` — read-only, tenant-scoped.
- `search_policy` — read-only retrieval with citations.
- `check_refund_status` — read-only, tenant-scoped.
- `create_escalation` — write operation; policy-gated and audited.
- `POST /api/v1/customer/orders` — server-priced purchase request; persists an order and linked support ticket, then pauses customer/financial confirmation for a staff decision.

Each adapter validates structured input, builds the same authenticated application context as REST, calls an application service, filters output, and returns a typed result. It never embeds business rules, accepts a caller-supplied tenant override, or queries PostgreSQL directly. MCP transport and SDK versions are pinned; Streamable HTTP is preferred for hosted use and its session-manager lifespan is owned by the host application.

## Hybrid retrieval

PostgreSQL is sufficient for MVP consistency and scale. Documents are chunked with `tenant_id`, source, ACL, locale, content hash, embedding model/version and timestamps. Retrieval always applies tenant/ACL filters before ranking:

1. Generate top-k lexical candidates with PostgreSQL full-text search.
2. Generate top-k semantic candidates with pgvector and multilingual embeddings.
3. Fuse ranked lists with deterministic reciprocal-rank fusion.
4. Optionally rerank the small fused set after MVP.
5. Return bounded excerpts and immutable source citations to the graph.

The model treats retrieved text as untrusted data, never instructions. No-result is an explicit outcome; the system asks for clarification or routes to a human instead of inventing an answer. Index migrations are versioned so evaluation and rollback can compare like with like.

### Operational data ownership

PostgreSQL is the source of truth for customer accounts, tickets, orders, refund status, catalogue content and knowledge documents. `catalog_products` is read by both the public catalogue and server-side price validation; `commerce_orders` is the same record used by customer tracking and live order tools; `refund_statuses` is the integration boundary for a payment/refund provider. Runtime code has no fallback rows for these domains. Compose runs the idempotent migration service before the API, and the protected catalog write endpoint lets an agent update tenant-owned catalogue rows without rebuilding the web image.

## Human approval and side effects

Read-only tools may execute after authorization and argument validation. Refunds, account changes, outbound customer commitments, escalation creation above tenant policy, or any destructive/external side effect pause the graph. The approval record binds approver identity, tenant, proposed action hash, arguments, expiry and graph checkpoint. Resumption re-checks authorization and policy, rejects modified or expired proposals, and uses the original idempotency key. A model can propose an action but cannot approve it.

## Observability

OpenTelemetry is the vendor-neutral boundary. Instrument the Node.js process once, export batches over OTLP, propagate request/trace IDs into graph, retrieval and tool spans, and exclude health endpoints. Sanitize `authorization`, cookies and tenant-sensitive headers; do not record raw ticket bodies, retrieved chunks, secrets or complete model prompts by default. Record model/provider, prompt version, token counts, latency, retrieval IDs, policy decision and error class using bounded attributes.

Langfuse can receive OTLP traces after MVP when prompt/retrieval analysis and cost views are needed. Do not run LangSmith and Langfuse in parallel unless an explicit migration requires it.

## Threat model

| Threat | Trust boundary / failure | Required control and test |
| --- | --- | --- |
| Direct or indirect prompt injection | Ticket or retrieved document instructs the model/tool layer | Delimit untrusted data, system policy outside context, allowlisted tools, typed arguments, Promptfoo direct/indirect injection tests |
| Cross-tenant disclosure | Caller or retrieved row escapes tenant scope | Server-derived tenant identity, row-level/app-layer filters on every query, adversarial tenant-isolation tests |
| PII or secret leakage | Response, trace or error includes sensitive content | Output DLP/redaction, least-data retrieval, sanitized telemetry, PII red-team probes |
| Excessive agency / unsafe tool use | Model calls a write tool or expands scope | Read/write tool classes, policy node, human approval, idempotency, exact tool-policy golden metrics |
| Forged approval or replay | Old approval resumes a changed action | Signed/immutable action hash, approver RBAC, expiry, re-authorization, replay tests |
| Retrieval poisoning | Malicious document outranks trusted policy | Source ACLs, provenance, content hashing, trust tier in rank/final validation |
| SSRF or webhook abuse | Tool follows attacker-controlled URL | Fixed destinations, egress allowlist, timeouts, response limits, no arbitrary URL tool |
| Trace/data exfiltration | Exporter receives prompts, tokens or credentials | Attribute allowlist, redaction, TLS, scoped exporter credentials, retention policy |
| Dependency/model compromise | SDK, model or embedding behavior changes | Locked dependencies, provenance/SBOM, pinned model and prompt versions, golden regression gate |
| Cost/availability exhaustion | Long context, retry storm or tool loop | Input/token/time budgets, bounded retries, graph step limit, rate limiting and circuit breakers |

Red-team scans run only against an isolated evaluation tenant with synthetic data and non-production tool credentials.

## Evaluation gates

- Every PR: schema and golden-dataset validation, unit/integration tests, exact routing/approval/tool-policy checks, frontend lint/typecheck/test/build.
- Before model/prompt/retrieval promotion: replay the golden adapter harness at temperature 0; compare by prompt, model, embedding and index version.
- Scheduled or manual: Promptfoo injection, PII, RBAC, hijacking and excessive-agency scans against an isolated deployed endpoint.
- After retrieval is stable: add Ragas faithfulness and context precision/recall as diagnostic model-based metrics. They do not replace deterministic policy gates.
- Production: latency/error/SLO and drift dashboards; sampled, redacted trace review; rollback on safety-gate regression.

The executable contract and thresholds are in `evals/`. Policy-critical approval and tool metrics fail closed at 100%.

## Staged roadmap

1. **Foundation:** typed domain services, Fastify routes, PostgreSQL schema, deterministic classifier, one LangGraph.js workflow, synthetic golden data, local OTLP collector.
2. **MVP:** tenant-filtered hybrid retrieval, citations, approval pause/resume, four bounded tools, MCP adapter, CI and audit events.

## Audit trail

Business mutations, approval decisions, sensitive read tools, webhook intake, and denied write requests produce append-only audit events. Each event is tenant-scoped and stores the server-verified actor, outcome, resource identifier, timestamp, and request correlation ID. A metadata allowlist/redaction boundary removes customer messages, contact details, credentials, cookies, and tokens before persistence. PostgreSQL rejects `UPDATE` and `DELETE` on `audit_events`; the admin interface reads the log with role checks, filters, and opaque cursor pagination rather than loading the full history.
3. **Hardening:** Langfuse via OTLP, Promptfoo scheduled scans, Ragas diagnostics, backup/restore and load/chaos tests, Docling for complex PDF/table/OCR ingestion.
4. **Scale only when measured:** LiteLLM for a second provider, reranking, managed infrastructure and horizontal workers. Kubernetes, fine-tuning, a second vector database and autonomous multi-agent orchestration are explicitly deferred.

## Primary implementation references

- [OpenTelemetry JavaScript](https://github.com/open-telemetry/opentelemetry-js)
- [Official MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Promptfoo red-team configuration](https://github.com/promptfoo/promptfoo/tree/main/site/docs/red-team)
