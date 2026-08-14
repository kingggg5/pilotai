---
version: 1
slug: "apps-web-app-admin-page-tsx"
primary_target: "apps/web/app/admin/page.tsx"
related_targets: ["apps/web/components/admin-workspace.tsx","apps/web/app/globals.css"]
---

## Scope and mode

Primary route `/admin` (`apps/web/app/admin/page.tsx`). Visitor mode: **Operate**.

## Audience, job, and action

Support agents and leads select a ticket, verify its evidence and prepared response, and approve or reject any write action. The queue, selected case, evidence, decision, and trace must remain within one workspace.

## Proof and constraints

Use live tenant-scoped tickets and runs only. Require a server-verified HttpOnly admin session in production. Approval must remain disabled until the API confirms it, and its result must survive refresh. Keep responsive mobile access, keyboard operation, and clear failure states.

## Chosen direction

**The Operations Workbench.** A dense graphite two-pane console: ordered queue on the left, complete selected-ticket workbench on the right. Paper is reserved for evidence and approval; lime means live, selected, or confirmed.

## Unresolved decisions

Replace the shared admin password with the production OAuth/OIDC provider before multi-user rollout so approvals record individual operators.
