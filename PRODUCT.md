# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are customers browsing products, managing a cart, and opening Thai or English support requests, plus customer-support agents and support leads handling purchase requests, order-status checks, refund-policy questions, and escalations. Customers need a clear path from product interest to authenticated help; staff need to move quickly while retaining enough evidence and audit context to make safe decisions.

## Product Purpose

ServicePilot combines a lightweight product storefront with authenticated customer support. It helps customers collect products in a browser-local cart and send a purchase request, while support staff classify tickets, retrieve grounded answers from authorized documents, inspect order or refund status, draft bilingual responses, and route cases to the appropriate team. Success means a clear customer journey and faster handling without sacrificing citations, tenant boundaries, policy controls, or human accountability.

## Positioning

ServicePilot is an auditable support workflow rather than a generic RAG chat or autonomous multi-agent swarm. One typed, resumable workflow connects deterministic ML, hybrid retrieval, citations, bounded tool calls, policy checks, human approval for write actions, and observable execution traces.

## Operating Context

- Tickets arrive in Thai or English through support channels such as email, chat, and web.
- The public homepage is the product catalog; cart state stays in the customer browser, while a signed-in purchase creates a server-side `ORD-*` record and linked support ticket. Checkout is still explicitly a purchase request, not a payment transaction.
- Opening a web support ticket requires an authenticated customer session, and profile identity is applied server-side.
- Agents work through intake, classification, evidence retrieval, response drafting, approval when required, and trace review.
- Knowledge sources include manuals, refund policies, and FAQs with page-level citations.
- Read-only tools include order-status and refund-status checks; `create_escalation` is a write action that requires a human decision.
- The production web routes use live service data. Automated checks use deterministic provider boundaries without exposing placeholder modes in the interface.
- Catalogue, order/refund status, customer, ticket, audit, and knowledge content are database-backed. There is no runtime sample-ticket, sample-order, or hardcoded product-price fallback; operational content is changed through migrations or authenticated APIs.

## Capabilities and Constraints

- Next.js/React operations console backed by Fastify and typed Zod contracts.
- A lightweight TypeScript character n-gram Naive Bayes classifier for ticket type and priority; TensorFlow.js remains an experiment rather than an MVP dependency.
- PostgreSQL, pgvector, and PostgreSQL full-text search form the intended hybrid-retrieval boundary.
- REST/OpenAPI owns business services; MCP is an adapter over the same bounded functions.
- External or financially meaningful write actions must pause for approval and use auditable, idempotent execution.
- The product must abstain when evidence is insufficient and preserve tenant isolation.
- Open decision: production identity-provider, payment/inventory provider, durable checkpoint store, real tenant corpus, and operational SLOs are not yet selected.

## Brand Commitments

- Product name: ServicePilot AI.
- The interface is bilingual where operationally useful and should communicate evidence, safety, and human control plainly.
- Claims must distinguish deterministic MVP regression evidence from real-world production performance.

## Evidence on Hand

- Architecture and threat model: `docs/architecture.md`.
- Deterministic bilingual golden datasets and evaluation harnesses: `evals/`.
- Current operational console and demo workflow data: `apps/web/`.
- API, workflow, policy, authentication, rate-limit, and tool tests: `apps/api/tests/`.
- Existing evaluation results are synthetic regression signals; no customer testimonials, production usage claims, or real tenant benchmark corpus are available and future work must not fabricate them.

## Product Principles

1. Evidence before answer: retrieved sources and page citations must support every grounded response.
2. Human authority over side effects: models may propose write actions but cannot approve them.
3. One inspectable workflow: routing, retries, approval, and tool execution remain explicit and replayable.
4. Safe failure over confident invention: insufficient evidence produces abstention or escalation.
5. Measured claims: evaluation, latency, and quality statements must identify their dataset and operating context.

## Accessibility & Inclusion

The web console must support keyboard and touch operation, reduced-motion preferences, readable Thai and English text, responsive layouts, and WCAG 2.2 AA as the release target. This AA target is inferred as the appropriate baseline for an operational enterprise web tool and remains to be formally confirmed.
