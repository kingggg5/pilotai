# Production operations

This runbook is the minimum release contract for a public deployment. The repository does not contain production credentials; use a secret manager or Docker secrets and keep `.secrets/` outside source control.

## Authentication and rotation

Production runs `AUTH_MODE=oidc`. The identity provider must issue access tokens whose `iss`, `aud`, `sub`, `tenant_id` (or configured tenant claim), role claim, and MFA claim are present. Set `AUTH_CUSTOMER_ROLE`/`AUTH_ADMIN_ROLES` to the provider's role values; ServicePilot maps them to its internal `customer`, `agent`, `approver`, and `audit:read` permissions. ServicePilot verifies the signature through the configured HTTPS `OIDC_JWKS_URL`; `jose` caches keys and refreshes when a signing `kid` rotates. Set `AUTH_REQUIRE_MFA=true` and keep `AUTH_MFA_VALUES=mfa,otp,webauthn` unless the IdP uses a different verified MFA value.

Rotate secrets by writing the new value to the current secret file and the previous value to the matching `_previous` file, deploy, wait for all old sessions/tokens to expire, then remove the previous value in a second deploy. Never log or print secret contents.

Required production secret files:

- `openai_api_key` or the provider key selected by `AI_MODE`
- `oidc_client_secret`
- `jwt_secret` and `jwt_secret_previous` (for controlled BFF/service rotation)
- `session_secret` and `session_secret_previous`
- `postgres_password`, `database_url`, `webhook_secret`, `grafana_admin_password`

## AI provider privacy and quotas

External drafting is disabled unless `AI_EXTERNAL_EGRESS_ALLOWED=true` is explicitly approved. Before enabling it, document the provider, region, retention terms, DPA, and the data categories allowed to leave the tenant boundary. ServicePilot redacts email, phone, and customer identifiers and caps prompt/output size before external calls. `AI_PROVIDER_RPM` and `AI_PROVIDER_TPM` are process-local safety caps; production deployments should also configure the provider's organization/project quota and alerting. Keep `AI_FALLBACK_ON_ERROR=false` in production so provider failures are visible instead of silently changing data-flow policy.

## OTel, metrics, and alerting

Start the optional observability stack with `npm run deploy -- --observability` after creating `.secrets/grafana_admin_password`. The API exports OTLP traces and metrics to the collector, and `/metrics` exposes bounded Prometheus counters. Grafana is bound to localhost by the overlay; put it behind an authenticated VPN or SSO before exposing it. Prometheus alerts cover API downtime, error rate, approval backlog, and p95 latency. Assign an on-call owner and link the alert to this runbook.

## Load and security checks

Run a bounded health load test against staging:

```powershell
$env:LOAD_TEST_URL = "https://staging.example.com"
$env:LOAD_TEST_CONCURRENCY = "10"
npm run load:test
```

Run unauthenticated contract checks:

```powershell
$env:SECURITY_TEST_URL = "https://staging.example.com"
npm run security:test
```

Run the manual `Security baseline` GitHub workflow with the same staging URL to trigger OWASP ZAP baseline scanning. Do not run load or ZAP against production without a change window and explicit approval.
