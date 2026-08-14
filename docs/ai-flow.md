# AI flow and trust boundaries

This document identifies exactly where ServicePilot AI uses machine learning or generative AI and where it intentionally relies on deterministic code.

## End-to-end request flow

```mermaid
sequenceDiagram
    autonumber
    actor Customer
    participant Web as Next.js BFF
    participant API as Fastify API
    participant ML as Local classifier
    participant Graph as LangGraph workflow
    participant Data as PostgreSQL and pgvector
    participant LLM as Optional OpenAI model
    actor Staff
    participant Audit as Audit log

    Customer->>Web: Submit message or purchase request
    Web->>API: Authenticated, tenant-scoped request
    API->>ML: Classify category and urgency
    ML-->>Graph: Labels, confidence, model version
    Graph->>Data: Read order/refund or retrieve authorized policy pages
    Data-->>Graph: Live record or ranked evidence with citations

    alt Evidence is below threshold
        Graph-->>Customer: Abstain and request missing information
    else Evidence is sufficient
        alt AI_MODE is openai
            Graph->>LLM: Ticket, classification, and retrieved evidence
            LLM-->>Graph: Draft response only
        else AI_MODE is local
            Graph->>Graph: Build deterministic template draft
        end

        Graph->>Graph: Apply deterministic policy rules
        alt Read-only and allowed
            Graph-->>Customer: Grounded answer with citation
        else Unsafe request
            Graph-->>Customer: Refusal
        else Write action or high risk
            Graph-->>Staff: Pause with risk reasons and draft
            alt Staff rejects
                Graph-->>Customer: Rejected; no side effect
            else Staff approves
                Graph->>Data: Create escalation
                Graph->>Audit: Record approval and write result
                Graph-->>Customer: Confirm escalation reference
            end
        end
    end
```

## AI components

### 1. Traditional ML classification

`TicketClassifier` predicts ticket category and priority with a local character n-gram Naive Bayes model. It returns label probabilities, confidence, and a model version. Security-sensitive phrases also pass through explicit deterministic overrides.

This step is AI/ML, but it is not a large language model and makes no network request.

### 2. Embeddings for retrieval

The default `HashEmbedder` converts text into local hash-based vectors. It is deterministic and does not use a learned model. Setting `EMBEDDING_PROVIDER=openai` switches to `OpenAIEmbedder`, which sends document/query text to the configured embedding model.

Embeddings rank candidate evidence. They do not grant document access: tenant and role filters are applied by the repository, and a minimum evidence score controls abstention.

### 3. Generative response drafting

When `AI_MODE=openai`, `OpenAILanguageModel` calls the OpenAI Responses API only after verified evidence exists. The request contains the ticket, predicted category/priority, and retrieved evidence. The call uses `store: false`, and the model is instructed to use only supplied evidence and attach page-level citations.

The model returns a draft. It does not execute tools, change orders, create escalations, approve refunds, decide access, or write audit records. If `AI_MODE=local`, ServicePilot uses a deterministic template instead. Optional fallback can return that template when the provider fails.

## Components that are not AI

- Nginx routing and TLS boundary
- Customer/staff authentication and tenant scoping
- Zod validation and request idempotency
- Redis rate limiting
- LangGraph node order, branching, checkpointing, and pause/resume
- PostgreSQL order/refund reads and catalog writes
- Role-filtered hybrid retrieval and evidence threshold
- Prompt-injection markers and policy decisions
- Human approval and escalation execution
- Append-only audit records, logs, metrics, and OpenTelemetry traces

LangGraph is an orchestration library in this system, not an autonomous agent or a model.

## Safety contract

1. No evidence means no generated factual answer.
2. The model receives only evidence already authorized for the tenant and role.
3. Model output is a draft, never an authorization decision.
4. Read-only tools may run automatically.
5. Write actions and high-risk cases pause for a staff decision.
6. Rejection produces no external side effect.
7. Approval and execution are recorded in the append-only audit trail.

## Runtime modes

| Configuration | External AI call | Intended use |
| --- | --- | --- |
| `AI_MODE=local`, `EMBEDDING_PROVIDER=hash` | None | Development, tests, private/local deployment |
| `AI_MODE=openai`, `EMBEDDING_PROVIDER=hash` | Response drafting only | Grounded production drafting with local vectors |
| `AI_MODE=openai`, `EMBEDDING_PROVIDER=openai` | Drafting and embeddings | Managed model and embedding deployment after data-egress approval |

Provider settings do not change the approval boundary: write actions always remain human-controlled.
