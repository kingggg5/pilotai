CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_documents (
    id text NOT NULL,
    tenant_id text NOT NULL,
    source text NOT NULL,
    title text NOT NULL,
    content text NOT NULL,
    page_number integer CHECK (page_number IS NULL OR page_number > 0),
    page_label text,
    locale text NOT NULL DEFAULT 'en',
    acl jsonb NOT NULL DEFAULT '{}'::jsonb,
    content_hash text,
    embedding_model text NOT NULL DEFAULT 'intfloat/multilingual-e5-small',
    embedding_version text NOT NULL DEFAULT 'v1',
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    embedding vector(384),
    content_tsv tsvector GENERATED ALWAYS AS (
        to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(content, ''))
    ) STORED,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id)
);

DO $$
DECLARE
    current_columns text[];
BEGIN
    SELECT array_agg(attribute.attname ORDER BY key_column.ordinality)
      INTO current_columns
      FROM pg_constraint constraint_row
      CROSS JOIN LATERAL unnest(constraint_row.conkey)
          WITH ORDINALITY AS key_column(attnum, ordinality)
      JOIN pg_attribute attribute
        ON attribute.attrelid = constraint_row.conrelid
       AND attribute.attnum = key_column.attnum
     WHERE constraint_row.conrelid = 'knowledge_documents'::regclass
       AND constraint_row.contype = 'p';

    IF current_columns IS DISTINCT FROM ARRAY['tenant_id', 'id']::text[] THEN
        ALTER TABLE knowledge_documents DROP CONSTRAINT IF EXISTS knowledge_documents_pkey;
        ALTER TABLE knowledge_documents
            ADD CONSTRAINT knowledge_documents_pkey PRIMARY KEY (tenant_id, id);
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS knowledge_documents_tenant_idx
    ON knowledge_documents (tenant_id);
CREATE INDEX IF NOT EXISTS knowledge_documents_fts_idx
    ON knowledge_documents USING gin (content_tsv);
CREATE INDEX IF NOT EXISTS knowledge_documents_embedding_hnsw_idx
    ON knowledge_documents USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS workflow_runs (
    id uuid PRIMARY KEY,
    tenant_id text NOT NULL,
    ticket_id text NOT NULL,
    status text NOT NULL,
    graph_thread_id text NOT NULL,
    input jsonb NOT NULL,
    output jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE workflow_runs DROP CONSTRAINT IF EXISTS workflow_runs_graph_thread_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS workflow_runs_tenant_thread_idx
    ON workflow_runs (tenant_id, graph_thread_id);

CREATE INDEX IF NOT EXISTS workflow_runs_tenant_status_idx
    ON workflow_runs (tenant_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS approval_decisions (
    id uuid PRIMARY KEY,
    run_id uuid NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
    actor_id text NOT NULL,
    decision text NOT NULL CHECK (decision IN ('approve', 'reject')),
    note text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_events (
    id text PRIMARY KEY,
    tenant_id text NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz,
    status text NOT NULL DEFAULT 'received'
);

CREATE INDEX IF NOT EXISTS webhook_events_tenant_received_idx
    ON webhook_events (tenant_id, received_at DESC);

CREATE TABLE IF NOT EXISTS support_tickets (
    tenant_id text NOT NULL,
    ticket_id text NOT NULL,
    run_id text,
    status text NOT NULL,
    idempotency_key text,
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, ticket_id)
);

ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS support_tickets_tenant_idempotency_idx
    ON support_tickets (tenant_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS support_tickets_tenant_updated_idx
    ON support_tickets (tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_tenant_created_idx
    ON support_tickets (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_tenant_status_idx
    ON support_tickets (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_search_idx
    ON support_tickets USING gin ((lower(ticket_id || ' ' || coalesce(payload->>'reference','') || ' ' || coalesce(payload->>'subject','') || ' ' || coalesce(payload->>'customer','') || ' ' || coalesce(payload->>'customer_id','') || ' ' || coalesce(payload->>'customer_email','') || ' ' || coalesce(payload->>'customer_phone','') || ' ' || coalesce(payload->>'order_id','') || ' ' || coalesce(payload->>'summary',''))) gin_trgm_ops);

CREATE TABLE IF NOT EXISTS customer_accounts (
    id text NOT NULL,
    tenant_id text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    phone text NOT NULL,
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS customer_accounts_tenant_email_idx
    ON customer_accounts (tenant_id, lower(email));

CREATE TABLE IF NOT EXISTS commerce_orders (
    tenant_id text NOT NULL,
    order_id text NOT NULL,
    idempotency_key text,
    status text NOT NULL,
    customer_id text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, order_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS commerce_orders_tenant_idempotency_idx
    ON commerce_orders (tenant_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS commerce_orders_customer_idx
    ON commerce_orders (tenant_id, customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS catalog_products (
    tenant_id text NOT NULL,
    product_id text NOT NULL,
    name text NOT NULL,
    variant text NOT NULL,
    unit_price numeric(12,2) NOT NULL CHECK (unit_price >= 0),
    currency text NOT NULL DEFAULT 'THB',
    image_url text NOT NULL,
    source_url text,
    active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, product_id)
);
CREATE INDEX IF NOT EXISTS catalog_products_active_idx ON catalog_products (tenant_id, active, sort_order, name);

CREATE TABLE IF NOT EXISTS refund_statuses (
    tenant_id text NOT NULL,
    order_id text NOT NULL,
    refund_id text NOT NULL,
    status text NOT NULL,
    amount numeric(12,2),
    currency text DEFAULT 'THB',
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, refund_id)
);
CREATE INDEX IF NOT EXISTS refund_statuses_order_idx ON refund_statuses (tenant_id, order_id, updated_at DESC);

-- Global catalogue rows are operational content, not application fixtures. Replace or extend them through an admin/catalog migration.
INSERT INTO catalog_products (tenant_id, product_id, name, variant, unit_price, currency, image_url, source_url, active, sort_order)
VALUES ('*', 'iphone-17-pro-max-256gb-deep-blue', 'iPhone 17 Pro Max', '256GB · Deep Blue', 48900, 'THB', '/products/iphone-17-pro-max-deep-blue-full.webp', 'https://www.apple.com/th-en/shop/buy-iphone/iphone-17-pro/6.9-inch-display-256gb-deep-blue', true, 10)
ON CONFLICT (tenant_id, product_id) DO UPDATE SET name=EXCLUDED.name, variant=EXCLUDED.variant, unit_price=EXCLUDED.unit_price, image_url=EXCLUDED.image_url, source_url=EXCLUDED.source_url, active=EXCLUDED.active, updated_at=now();

CREATE TABLE IF NOT EXISTS escalations (
    escalation_id text PRIMARY KEY,
    tenant_id text NOT NULL,
    graph_thread_id text NOT NULL,
    status text NOT NULL,
    priority text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, graph_thread_id)
);

CREATE TABLE IF NOT EXISTS audit_events (
    id uuid PRIMARY KEY,
    tenant_id text NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    actor_id text NOT NULL,
    actor_type text NOT NULL CHECK (actor_type IN ('user', 'service', 'system')),
    action text NOT NULL,
    resource_type text NOT NULL,
    resource_id text,
    outcome text NOT NULL CHECK (outcome IN ('success', 'denied', 'failure')),
    request_id text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    CHECK (octet_length(metadata::text) <= 16384)
);

CREATE INDEX IF NOT EXISTS audit_events_tenant_time_idx
    ON audit_events (tenant_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_events_tenant_action_idx
    ON audit_events (tenant_id, action, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_tenant_resource_idx
    ON audit_events (tenant_id, resource_type, resource_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_tenant_resource_prefix_idx
    ON audit_events (tenant_id, lower(resource_id) text_pattern_ops)
    WHERE resource_id IS NOT NULL;

CREATE OR REPLACE FUNCTION prevent_audit_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audit_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS audit_events_immutable ON audit_events;
CREATE TRIGGER audit_events_immutable
    BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();

INSERT INTO schema_migrations (version) VALUES ('2026-08-13-production-baseline')
ON CONFLICT (version) DO NOTHING;
INSERT INTO schema_migrations (version) VALUES ('2026-08-14-catalog-and-refunds')
ON CONFLICT (version) DO NOTHING;
