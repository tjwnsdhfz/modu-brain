# Modu Brain public review workflow

## Completion criteria and result
Accountless TXT/JSON/paste input → validation/normalization → local heuristic analysis on the service server → inspect perspectives/questions/decisions → edit a Markdown review document → download Markdown and a full JSON backup → reopen input/result/edited document without sending the file to the server.

The analysis submit action sends selected input to this service's server; the public route does not store it in the database. Default external AI stays disabled. Source excerpts can be public quote strings or project evidence references; the report preserves that distinction instead of inventing individual record links. A restored analysis is labeled as a file result, not a new verified analysis. Synthetic sample state is preserved in backup.

## Verification
- Unit/coverage, lint, migration safety and production build checks are required.
- Six real-server public browser tests passed, including edited report JSON/Markdown round trips, invalid backup preserving current results and no document overflow at375/768/1024/1440.
- Files limited to1MB, source256KB, report100,000 characters. Invalid versions, required structure and optional evidence metadata are rejected.
- Existing CI separately exercises auth and Supabase RLS. This public-flow test does not prove production multi-tenant behavior or user demand.

## Operation and budget
`npm ci`, `npm run check`, `npm start`; use existing Render deployment from main after CI. MODU_BRAIN_ANALYSIS_PROVIDER=local-heuristic; MODU_BRAIN_OPENAI_ENABLED=false. Per analysis external API cost0. At 1,000 analyses/month, compute/bandwidth must remain within the existing shared Render free quota:750instance hours,5GB bandwidth,500pipeline minutes. The deployment may sleep or pause at quota. No new paid resources or API keys added. Existing Supabase account plan/usage is not independently verified in this change.

## Recovery and limits
Download JSON before reloading or leaving the public session; there is no implicit local persistence. Restore validates before replacing the view. Revert by PR or redeploy the prior successful Render commit; do not alter databases or RLS for rollback. Markdown edits are review annotations, not edits to the source analysis. Default extraction is heuristic and can miss context; source review remains necessary. Hypothesis: teams may pay for reusable decision context and onboarding documents. Validate with real meeting records and measured review effort before proposing a price.
