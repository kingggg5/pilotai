# ServicePilot evaluations

All deterministic gates run in TypeScript without an API key:

```powershell
npm --prefix apps/api run eval:classifier
npm --prefix apps/api run eval:rag
npm --prefix apps/api run eval:golden
npx --prefix apps/api tsx --test evals/golden-contract.test.ts
```

The classifier report contains category/priority Macro-F1, macro precision, macro recall and confusion matrices. Retrieval reports Recall@K, MRR and page-level citation accuracy. Policy-critical approval, tool-policy and critical-case thresholds fail closed at 100%.

Promptfoo remains an opt-in scheduled/manual red-team gate. Point `SERVICEPILOT_EVAL_URL` to an isolated tenant's full `POST /api/v1/assist` URL; never use production or customer data.
