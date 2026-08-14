# ServicePilot AI — Multi-Agent Development Contract

This repository uses multiple agents to build and review the product in parallel. The
production application itself intentionally uses one explicit LangGraph workflow. Do
not turn runtime ticket processing into a swarm of autonomous agents.

## Lanes and ownership

- **Coordinator:** owns root files, API contracts, integration decisions, and the final
  verification pass.
- **Backend lane:** owns `apps/api/**`; implements the graph, domain services, provider
  boundaries, and backend tests.
- **Frontend lane:** owns `apps/web/**`; implements the operations console and browser
  tests against the published API contract.
- **Quality lane:** owns `evals/**`, `docs/**`, and `.github/**`; defines golden cases,
  red-team checks, architecture decisions, and CI.
- **Infrastructure lane:** owns `infra/**`, `compose.yaml`, and `scripts/**` when assigned
  explicitly by the coordinator.

Never have two agents edit the same file concurrently. Cross-lane changes are proposed
to the coordinator with the required contract change and acceptance criteria.

## Runtime architecture rules

1. Keep workflow routing explicit and typed: classify, retrieve, draft, policy check,
   approval, execute.
2. Any action with customer, financial, or external side effects requires a policy
   decision; high-risk actions must pause for human approval.
3. Business capabilities are REST/OpenAPI services first. MCP is a thin adapter over
   those same functions, never a second business-logic implementation.
4. `AI_MODE=local` is the safe default. Tests and CI must never make paid model calls.
5. Provider-specific code stays behind an interface. The graph must not depend directly
   on OpenAI, LiteLLM, or a cloud SDK.
6. Retrieval evidence, classifier confidence, policy reasons, tool inputs, and approval
   decisions must be preserved in the run trace.

## Definition of done

- Backend tests, frontend lint/typecheck/build, and deterministic evals pass.
- No secret is printed, committed, copied into the frontend, or included in fixtures.
- New endpoints have typed request/response models and update the API adapter.
- New graph branches have a golden evaluation case and an approval-boundary test.
- UI remains keyboard usable, responsive at 375/768/1024/1440 px, and respects reduced
  motion.
- Documentation states any demo-only behavior that still needs production data or
  infrastructure.
