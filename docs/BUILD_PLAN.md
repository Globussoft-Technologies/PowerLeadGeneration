# Power Leads Prospecting Pipeline — Build Plan

**Status:** Prototype accepted. Production P1 and the deliberately scoped P2 are complete. P3 integration-hardening code is complete; live production verification still requires hosting/network selection, rotated credentials, a verified SendGrid domain/sender, and a configured signed Event Webhook.
**Tech stack:** React + TypeScript (frontend) · Node + TypeScript + Express (backend) · MongoDB (persistence)
**MVP scope decision:** Phase 1 ships the **full app** (backend + Mongo + React review UI + CSV export). The rep-facing review screen is the core value, so it is built in Phase 1, not deferred.

---

## 1. Summary

An automated pipeline that turns *"company X is running an ad"* into *"a qualified contact receives a relevant email"*.

Flow:

```
[POST /advertiser/names] --> [Gemini classify + score] --> [Apollo enrichment] --> [Review] --> [Mail / CSV]
```

## Production roadmap

### Production objective

Turn the accepted single-user prototype into a secure, recoverable, observable application that can be used by a controlled internal sales team without duplicate sends, uncontrolled vendor spend, or loss of run state.

Production v1 deliberately keeps the proven workflow:

```text
Discover ads -> qualify with Gemini -> enrich with Apollo -> human review -> SendGrid or CSV
```

Scheduling, CRM deduplication, and full ROI reporting remain post-launch work. They are useful, but they are not required to make the manual production workflow safe and reliable.

### Current prototype baseline

Already implemented and proven:

- React/TypeScript single-page application.
- Express/TypeScript API and MongoDB persistence.
- Live Ads API discovery, capped at 100 results per run.
- Category and industry catalog mapping from `category.json`.
- Gemini structured ICP classification, scoring, explanations, and email hooks, with deterministic fallback.
- Apollo people search and enrichment, currently capped at 3 candidates/contacts per qualified company through `APOLLO_CONTACTS_PER_COMPANY`.
- Optional human review, approve/reject, automatic completion after all decisions, and CSV export.
- SendGrid provider integration, editable templates, per-contact personalization, individual send, bulk send, retry handling, sent timestamps, provider message IDs, and cross-run email deduplication.
- Run deletion and automatic repair of previously stuck review statuses.

Prototype limitations that must be removed before production:

- No login, authorization, workspace ownership, or tenant isolation.
- Pipeline work starts inside the API process instead of a durable background worker.
- Limited operational visibility, alerting, and recovery controls.
- Production SendGrid identity, webhook processing, suppression handling, and sending policies are incomplete.
- No formal retention, deletion, compliance, or incident-response process.
- The Ads API currently uses a private-network address that a hosted production service may not be able to reach.
- Test coverage does not yet meet the production gate, especially database integration, component, and browser E2E coverage.
- Prototype credentials were used during development and must be rotated before go-live.

### Production phase P0 - Decisions and readiness

**Goal:** resolve the decisions that materially affect architecture, security, cost, and deployment before implementation begins.

**Decisions and inputs:**

- Select the hosting platform and production region.
- Confirm whether production is single-organization or multi-organization. The implementation should still store an organization/workspace ID so isolation can be enforced.
- Use the built-in invite-only email/password authentication and define Admin, Operator, and Reviewer roles.
- Use the existing MongoDB connection model through `MONGO_URI`; choose the final host and backup schedule at deployment time.
- Decide how the hosted service reaches the private Ads API: secured public HTTPS endpoint, VPN/VPC connection, or an internal gateway.
- Confirm the Apollo plan, credit rules, account quotas, and production call budget.
- Obtain a production SendGrid account, verified sender/domain, and webhook destination.
- Assign security, compliance, deliverability, and incident-response owners.
- Define initial service objectives: acceptable pipeline duration, failure rate, and recovery time.
- Define pilot quotas for Ads results, Apollo enrichment, and daily email sends.

**Security action:** rotate every Ads, Apollo, Gemini, and SendGrid credential used during prototyping. Production credentials must never be committed or placed in client-side code.

**Deliverables:**

- Architecture decision record.
- Environment and ownership matrix.
- Approved vendor quotas and pilot limits.
- Network-connectivity design for the Ads API.
- Compliance checklist and data-retention decision.

**Exit criteria:** all blocking decisions have named owners and approved values; staging credentials and network access are available.

---

### Production phase P1 - Security and platform foundation

**Goal:** establish deployable, isolated, and secure development, staging, and production environments.

**Build:**

- Use native Node.js build artifacts for client, API, and worker processes; containerization is explicitly out of scope for production v1.
- Create separate development, staging, and production configurations.
- Add GitHub Actions CI/CD for install, typecheck, tests, build artifacts, database migration checks, staging delivery, and controlled production promotion.
- Manage infrastructure through repeatable configuration or infrastructure-as-code.
- Supply deployed secrets through protected staging/production environment variables. Local `.env` files remain development-only.
- Add authentication and secure session/token handling.
- Add role-based authorization:
  - Admin: integrations, global settings, users, quotas, all runs.
  - Operator: create runs, review contacts, export, compose, and send.
  - Reviewer: inspect runs and approve/reject contacts; no integration or bulk-send administration.
- Add `organizationId`/`workspaceId` and `createdBy` to runs, companies, contacts, settings, templates, and audit records.
- Enforce organization ownership in every query and API endpoint.
- Add an immutable audit log for run creation/deletion, setting changes, contact decisions, exports, individual sends, and bulk sends.
- Add API rate limits, secure headers, strict CORS, request-size limits, and centralized validation/error responses.
- Create production Mongo indexes and a safe index/migration process.
- Enable automated backups and document a restore procedure.

**Tests:**

- Authentication and session tests.
- Role/permission matrix tests.
- Cross-organization isolation tests for every resource type.
- API rate-limit and validation tests.
- Migration/index tests against an isolated MongoDB.
- Backup/restore smoke test in staging.

**Exit criteria:** a clean environment can be deployed automatically; unauthorized and cross-workspace access is rejected; secrets are absent from builds and repository history; staging backup restoration succeeds.

**Phase status: application foundation complete. Hosting-specific deployment binding is intentionally deferred until the host is selected.**

**Implementation status:**

- Completed: GitHub Actions CI for dependency audit, shared build, typecheck, tests, production build, and artifact upload.
- Completed: GitHub Actions delivery workflow producing native Node.js release artifacts for staging/production promotion.
- Completed: Helmet security headers, configurable CORS, request IDs, configurable API rate limiting, and trusted-proxy configuration.
- Completed: provider-neutral request identity with development and trusted-auth-proxy modes; production refuses development authentication.
- Completed: Admin/Operator/Reviewer server-side role checks for run creation/deletion/sending, contact decisions, settings changes, and audit access.
- Completed: workspace ownership on runs, companies, contacts, settings, and sent-registry entries, including workspace-scoped database queries.
- Completed: audit-event model and audit capture for run creation/deletion/export/send, contact decisions, and settings changes.
- Completed: one-time workspace migration script for accepted-prototype data and index conversion.
- Completed: invite-only users, first-admin bootstrap, email/password login, Mongo-backed sessions, secure cookies/CSRF, logout/logout-all, invitation acceptance, password recovery/change, account UI, and admin user management.
- Deferred by scope decision: public signup, social login, MFA, organization billing, and external identity-provider integration.
- Completed: database-backed integration coverage for login sessions, CSRF, invitations, password reset/change, role enforcement, workspace isolation, and audit persistence.
- Completed: readiness endpoint, graceful shutdown, release-artifact smoke checks, environment contract, and backup/restore procedure.
- Deferred until hosting is selected: add the provider's deploy/rollback command, production process configuration, domain/CORS values, HTTPS binding, and backup schedule.

---

### Production phase P2 - Durable pipeline and data integrity

**Goal:** make every run recoverable, idempotent, cancellable, and safe across process restarts.

**Phase status: complete for production v1. Advanced reconciliation, caching, and high-volume streaming remain backlog items, not release blockers.**

**Implemented milestone:**

- Replaced the API process's `setImmediate` execution with a Mongo-backed `PipelineJob` queue.
- Added a separately runnable worker (`npm run dev:worker --workspace server` / `npm run start:worker --workspace server`). Root `npm run dev` now starts API, worker, and client together.
- Added atomic job claiming, worker identity, expiring leases, heartbeat renewal, and abandoned-lease recovery. Multiple worker processes can safely compete for jobs.
- Added bounded automatic retries with exponential backoff, attempt metadata, terminal job failure, and persisted error messages.
- Split pipeline execution into persisted Discover, Qualify, and Enrich checkpoints. Completed stages are skipped after a retry or worker restart.
- Kept stage operations idempotent through company/contact upserts; completed Gemini analysis and existing Apollo contacts are reused.
- Added queued and cancelled run states, cooperative cancellation checks within bounded loops, operator Cancel run and Retry run controls, and audit events for both actions.
- Added UI visibility for the current stage and worker attempt count.
- Added integration tests for competing workers, lease recovery, retry/terminal failure, queued cancellation, bounded backoff, and checkpointed restart behavior.
- Persisted Ads request/result counts, Gemini attempts/fallbacks/successful-response token usage, Apollo search/enrichment calls and saved contacts, plus stage attempts and durations.
- Snapshotted configurable Ads, Gemini, and Apollo call budgets onto every run. Provider attempts reserve budget atomically, including internal retries, so concurrent work cannot exceed the stored limit.
- Added a terminal `quota_limited` outcome that preserves partial results without treating an intentional cost stop as a provider failure or retrying it automatically.
- Added a compact run-usage panel showing calls versus budgets, Gemini tokens/fallbacks, Apollo yield, and completed-stage timing.
- Added integration coverage proving a concurrent Gemini stage stops at the exact persisted budget and a quota-limited job completes without entering failure retry.

**Remaining in P2:**

- Add an admin failed-job/dead-letter view beyond the current failed run state and error detail.
- Add periodic status/counter reconciliation for intentionally corrupted or stale data.
- Extend initial call budgets with optional token, contact, mail-recipient, daily-workspace, and estimated-cost budgets after production account quotas and pricing are confirmed.
- Add provider-result cache keys/versioning and stronger protection against repeating a provider call when a process dies after the remote response but before its local checkpoint commits.
- Page/stream high-volume stage datasets instead of materializing the complete run in memory.
- Extend recovery tests to forced process termination during every provider boundary and to duplicate-send scenarios.

**Build:**

- Move orchestration out of `setImmediate` and into a dedicated background worker. **Completed.**
- Use a small native Mongo-backed queue so the system retains one datastore and avoids another scheduling dependency. Reassess Agenda or Redis/BullMQ only if scheduling, throughput, or queue isolation requires it. **Completed for current scale.**
- Persist stage checkpoints and attempt metadata for Discover, Qualify, Enrich, Review, and Send.
- Add worker leases/heartbeats so abandoned jobs can be recovered without two workers processing the same stage.
- Make each stage idempotent:
  - Ads records upsert by run/domain.
  - Gemini results cache by normalized domain plus relevant ad-content hash and prompt version.
  - Apollo enrichment skips existing usable contacts and records provider attempts.
  - SendGrid uses the sent registry and atomic reservation to prevent duplicate delivery.
- Add bounded retry with exponential backoff and jitter for temporary provider failures.
- Add terminal failure classification and a dead-letter/failed-job view.
- Add Retry stage, Retry run, and Cancel run controls with clear state transitions.
- Reconcile run status and counters from persisted companies/contacts so stale status cannot survive indefinitely.
- Add run-level budgets for Ads pages, Gemini calls/tokens, Apollo calls/contacts, and mail recipients. **Initial Ads/Gemini/Apollo call budgets completed; token/contact/mail extensions remain.**
- Stream or page large datasets instead of holding an entire high-volume run in memory.
- Record stage timings, provider-call counts, retry counts, and cost-related usage on each run. **Stage timing, provider attempts, successful Gemini token usage, fallbacks, Apollo yield, and worker/stage attempts completed; monetary estimates remain.**

**Tests:**

- Restart the worker during every stage and prove the run resumes.
- Run the same job twice and prove no duplicate company, contact, provider charge where avoidable, or email occurs.
- Simulate timeouts, 429s, malformed provider responses, and temporary 5xx responses.
- Verify cancellation between stages and during bounded provider work.
- Verify status/counter reconciliation after intentionally corrupting stale run counters.
- Run concurrent workers and assert lease and idempotency behavior.

**Exit criteria:** API and worker processes can restart during a run without data loss or duplicate sending; operators can see and recover actionable failures.

---

### Production phase P3 - External integration hardening

**Goal:** make Ads, Apollo, Gemini, and SendGrid predictable under real quotas, outages, and production data.

**Phase status: implementation complete; external production setup and staging verification remain.**

**Implemented:**

- Ads responses are schema-validated, malformed records are handled safely, invalid dates are discarded, and temporary/429/5xx failures use bounded retry while permanent 4xx failures stop immediately.
- Apollo search and enrichment responses are schema-validated before use; existing bounded retry, concurrency, verified-email rules, call budgets, and three-contact default remain enforced.
- Gemini persists analysis provenance, model, prompt version, latency, successful-response token counts, and fallback reason. Deterministic fallback is explicitly distinguishable from Gemini and mock output.
- SendGrid errors preserve provider response details and distinguish retryable from permanent failures.
- Exact rendered sender, recipient, subject, text, and HTML are stored for every delivery attempt together with provider message ID and status.
- A signed raw-body SendGrid Event Webhook endpoint at `POST /api/webhooks/sendgrid` verifies the official ECDSA signature and timestamp before processing.
- Webhook events are idempotent by SendGrid event ID and update accepted, processed, delivered, deferred, bounced, dropped, complaint, and unsubscribe state.
- Hard bounces, drops, spam complaints, and unsubscribes create workspace suppressions; temporary blocked bounces do not permanently suppress.
- Suppressed and previously sent recipients are removed before delivery, and configurable per-run/daily workspace email ceilings are enforced.
- Settings exposes webhook readiness and current mail safety ceilings without exposing secrets.

**External setup still required:** rotate live credentials; expose the Ads API through the chosen secure production network path; verify the SendGrid domain/sender; configure the Event Webhook URL and enable signature verification; place the public verification key in the production environment; run vendor-account staging smoke tests.

#### Ads API

- Replace the development-only private address with the approved HTTPS/VPN/gateway route.
- Use a rotated service credential supplied through the protected production environment.
- Retain the 100-results-per-run default and make the maximum admin-controlled.
- Add connect/read timeouts, retries, response validation, and clear provider-error classification.
- Validate pagination totals and record requested versus received result counts.
- Add contract fixtures for missing domains, malformed dates, unexpected platform/category values, and inconsistent `min_days_active` behavior.
- Monitor latency, error rate, and result-count changes.

#### Apollo

- Retain `APOLLO_CONTACTS_PER_COMPANY=3` as the safe initial default.
- Add an admin maximum, a per-run call/credit budget, and a daily workspace budget.
- Show estimated maximum Apollo usage before a run starts.
- Stop safely before exceeding a budget and identify the run as quota-limited rather than failed.
- Cache successful enrichment and avoid paying again for unchanged domains/people.
- Track search calls, match calls, usable contacts, verification yield, 429s, and estimated spend per run.
- Apply account-aware concurrency and retry limits.

#### Gemini

- Version prompts and structured-response schemas.
- Store prompt version, model, latency, usage, and whether the persisted result came from Gemini or deterministic fallback.
- Cache by normalized domain, ad-content hash, ICP-settings version, and prompt version.
- Validate and length-limit categories, industries, scores, explanations, and hooks before persistence.
- Permit human editing of email content; AI output never sends without the configured review/send controls.
- Monitor fallback rate, malformed-output rate, token usage, latency, and estimated cost.

#### SendGrid

- Verify the production sender and sending domain; configure the required DNS authentication and organizational deliverability policy.
- Store API keys only in protected production environment variables.
- Add webhook ingestion for accepted, delivered, bounced, blocked, deferred, spam-report, and unsubscribe events.
- Verify webhook authenticity and make webhook processing idempotent.
- Maintain global suppression/do-not-contact state and exclude suppressed recipients before reservation or delivery.
- Preserve the exact rendered subject/body, template version, sender, recipient, provider message ID, and event history for audit.
- Keep individual preview/send and bulk preview/send.
- Require explicit confirmation for bulk delivery and restrict it by role.
- Add configurable per-run and daily send limits. Initial pilot proposal: 50 recipients per run and 100 emails per workspace per day.
- Define unsubscribe and consent behavior with the compliance owner before live outreach.

**Tests:**

- Provider contract tests with recorded/sanitized fixtures.
- Retry/backoff and quota-exhaustion tests.
- Gemini malformed-output and fallback tests.
- SendGrid payload, webhook, suppression, duplicate-send, and partial-failure tests.
- Staging smoke tests using vendor-approved test accounts/recipients.

**Exit criteria:** every integration has enforced timeouts, quotas, retry policy, contract coverage, usage telemetry, and an operator-visible failure mode; live SendGrid identity is verified.

---

### Production phase P4 - Production user experience

**Goal:** let authorized users operate and understand the pipeline without database or engineering access.

**Build:**

- Login, logout, current workspace, and role-aware navigation.
- Paginated and searchable run history with creator, filters, stage, timestamps, usage, and final outcome.
- Live stage progress using polling initially; introduce SSE only if polling becomes inefficient.
- Run detail with:
  - Ads and unique-company counts.
  - Gemini scores, reasons, provenance, and email hooks.
  - Apollo contacts and verification state.
  - Approve/reject decisions and bulk review.
  - Individual recipient preview/send in the mail preview panel.
  - Bulk approved-recipient preview/send.
  - CSV export.
  - Failure details, retry, and cancellation.
- Server-side pagination/filtering for companies and contacts.
- Reusable, versioned email templates with supported-token guidance.
- Integration-health, remaining-quota, and credential-status views without exposing secret values.
- Audit/activity view for administrators.
- Clear terminology:
  - `Pending review` means at least one contact awaits a decision.
  - `Done` means pipeline processing and required review are complete; email delivery state remains visible per contact.
- Accessible keyboard navigation, labels, focus states, error messages, empty states, and responsive layouts.

**Frontend engineering:**

- Introduce TanStack Query for server state, invalidation, polling, retries, and loading/error handling.
- Split the current large application component into route/page and feature components.
- Add a component system only after the existing visual direction is captured, avoiding unnecessary redesign during production hardening.

**Tests:**

- React Testing Library coverage for filters, review decisions, templates, recipient preview, individual send, bulk send, quota warnings, and failures.
- Browser E2E for the complete happy path and the major failure/recovery paths.
- Accessibility checks for core screens.
- Responsive smoke tests at supported breakpoints.

**Exit criteria:** a non-technical operator can create, monitor, review, recover, export, and send a run in staging without engineering assistance.

---

### Production phase P5 - Observability, operations, and compliance

**Goal:** make the service supportable and the stored prospect/contact data governable.

**Build:**

- Structured logs containing request ID, run ID, stage, workspace ID, provider, and safe error metadata. Never log credentials or full sensitive payloads.
- Error monitoring for API, worker, client, and webhook failures.
- Metrics and dashboards for:
  - API latency/error rate.
  - Queue depth, oldest-job age, stage duration, and stuck runs.
  - Ads results and failures.
  - Gemini usage, fallback, and malformed-output rates.
  - Apollo calls, usable-contact yield, 429s, and budget consumption.
  - SendGrid sends, delivery, bounce, block, complaint, suppression, and duplicate-prevention counts.
- Alerts for unavailable dependencies, stuck jobs, unusual spend, high failure rates, and deliverability-policy breaches.
- Health, readiness, and worker-heartbeat endpoints.
- Operator runbooks for provider outage, quota exhaustion, stuck job, credential rotation, database restore, and mail incident.
- Approved data-retention and deletion jobs for runs, contacts, provider payloads, logs, and audit records.
- Workspace/user data export and deletion procedures where required by organizational policy.
- Formal do-not-contact/suppression process.
- Vendor/data-storage review for Apollo, Gemini, MongoDB, SendGrid, and hosting.
- Incident-response and access-review process.

**Tests and exercises:**

- Alert delivery test.
- Credential-rotation exercise.
- Database restore exercise.
- Data-retention/deletion test against seeded records.
- Incident tabletop for accidental bulk send and provider compromise.

**Exit criteria:** dashboards and alerts are active; on-call ownership and runbooks exist; backup restore and retention/deletion controls are demonstrated; compliance approval is recorded.

---

### Production phase P6 - Quality gate, pilot, and launch

**Goal:** validate the complete production system under controlled real usage before increasing volume.

**Required quality gate:**

- Unit tests for services, pipeline decisions, templates, quotas, and normalization.
- API integration tests using isolated MongoDB and mocked external services.
- Contract tests for every provider.
- Authentication, authorization, and workspace-isolation tests.
- Browser E2E for Discover -> Qualify -> Enrich -> Review -> individual send/bulk send -> delivery event.
- Duplicate-send, concurrent-worker, retry/resume, cancellation, and partial-provider-failure tests.
- Load smoke with at least 1,000 discovered-company records using mocks; memory must remain bounded.
- Security review and dependency scan.
- Production modules (`services/`, `pipeline/`, and `integrations/`) meet an 80% line-coverage gate.
- Staging deployment passes a documented go-live checklist.

**Rollout:**

1. Internal staging with all external services mocked.
2. Staging with live Ads, Gemini, and Apollo under strict budgets; mail remains mock/test-only.
3. SendGrid test delivery to an allowlist of internal recipients.
4. Pilot with 2-3 internal users, human review required, and approximately 20-50 emails per day.
5. Observe lead quality, Apollo/Gemini spend, delivery failures, bounces, complaints, and operator usability for at least two weeks.
6. Hold a go/no-go review and resolve critical findings.
7. Increase quotas gradually; do not remove hard safety ceilings.

**Exit criteria:** no known duplicate-send path; no critical security defect; costs and deliverability remain within approved thresholds; pilot owners approve general availability.

---

### Production phase P7 - Post-launch automation and reporting

**Goal:** add unattended operation and business measurement after the manual production workflow is stable.

**Deferred build:**

- Saved searches and recurring schedules through Agenda.
- CRM/customer/open-opportunity deduplication.
- Reporting ingestion for delivery, reply, and meeting outcomes.
- Funnel and source-ROI dashboard.
- Baseline comparison for ad-sourced versus other prospecting lists.
- Schedule pause, failure notification, and budget enforcement.

**Exit criteria:** scheduled runs operate unattended within quotas; CRM exclusions are proven; dashboard metrics reconcile with stored events and source systems.

### Production v1 acceptance criteria

Production v1 is complete only when all of the following are true:

- Authentication, roles, workspace isolation, and audit history are enforced.
- Staging and production deploy through CI/CD with protected environment variables.
- Pipeline jobs survive API/worker restarts and are safe to retry.
- Duplicate Apollo work is avoided where cached data is still valid.
- Duplicate email delivery is prevented across runs and concurrent workers.
- Provider quotas and daily/run limits are enforced server-side.
- SendGrid domain/sender and webhooks are production-ready.
- Operators can see failures, retry/cancel work, and understand quota usage.
- Logs, metrics, alerts, backups, restore procedures, and runbooks are active.
- Compliance, retention, suppression, and incident-response owners have signed off.
- The complete E2E production workflow and recovery paths pass in staging.
- A controlled pilot completes successfully before volume is increased.

### Estimated implementation sequence

For one focused product team with infrastructure and compliance support, production v1 is expected to require approximately 6-8 weeks:

| Week | Primary work |
|---|---|
| 1 | P0 decisions, environment design, credential rotation, Ads networking |
| 1-2 | P1 CI/CD, environments, authentication, roles, workspace isolation |
| 2-4 | P2 durable queue/worker, idempotency, recovery, cancellation, budgets |
| 3-5 | P3 integration hardening, SendGrid identity/webhooks/suppression |
| 4-6 | P4 operational frontend and production state management |
| 5-7 | P5 monitoring, alerts, backups, runbooks, compliance controls |
| 7-8 | P6 security/load/E2E validation and controlled pilot start |

Work can overlap, but P0 decisions and the P1 security/data model must not be bypassed. P7 begins only after the production pilot is stable.

**Production v1 delivery decision:** builds and delivery automation use GitHub Actions with native Node.js artifacts. No containerization work is planned. The final deployment step remains provider-specific and will be attached to the GitHub Actions delivery workflow after the hosting target is selected.

Operational packaging, migration, and authentication-proxy requirements are documented in `docs/DEPLOYMENT.md`.

The complete environment-variable contract is documented in `docs/ENVIRONMENT.md`.

**Why MongoDB is required (not optional):**
1. **Review step** — a run pauses at "pending review"; that state must survive between enrichment finishing and a rep approving later.
2. **Cross-run dedup** — `sent_registry` remembers companies/contacts already emailed so repeat runs don't re-spam them.
3. **Reporting** — open/reply/meeting rates over time need historical run data.
4. **Resumability + audit** — Apollo calls cost credits; a crashed run resumes instead of re-paying.

---

## 2. Architecture

```
+-----------------------------------------------------------+
|  React + TS  (Vite)                                       |
|  - New Run (filters)   - Review & Approve   - Dashboard   |
|  - Settings (ICP / personas / keys)                       |
+---------------------------+-------------------------------+
                            |  REST (JSON)
+---------------------------v-------------------------------+
|  Node + TS  (Express)                                     |
|  - API layer: /runs /companies /contacts /settings /reports
|  - Pipeline orchestrator: Discover -> Filter -> Enrich    |
|      -> Review -> Send / Export                           |
|  - Integration clients: AdsApi / Gemini / Apollo / Mail / Csv |
|  - Scheduler: Agenda (Mongo-backed)                       |
+---------------------------+-------------------------------+
                            |
                    +-------v--------+
                    |    MongoDB     |  runs, companies, contacts,
                    |                |  sent_registry, settings
                    +----------------+
```

---

## 3. Data Model (Mongo collections)

```ts
// runs
{
  _id, createdBy, createdAt, status,        // 'discovering'|'filtering'|'enriching'
                                            // |'pending_review'|'enrolling'|'done'|'failed'
  filters: { keyword?, industry?, geography?, platform?[], minDaysActive? },
  reviewRequired: boolean,
  stats: { discovered, qualified, enriched, approved, enrolled, skipped },
  error?: string
}

// companies  (one per run; dedup key = domain)
{
  _id, runId, name, domain, industry, employeeCount,
  adPlatform[], adFirstSeen, adLastSeen, adCreativeSnippet, adUrl,
  icpMatch: boolean, icpReason: string,
  status  // 'discovered'|'filtered_out'|'qualified'|'enriched'|'no_contacts'
}

// contacts
{
  _id, runId, companyId, name, title, email, emailVerified, linkedinUrl, seniority,
  apolloId, mailMessageId,
  enrollmentStatus,  // 'pending'|'approved'|'rejected'|'sent'|'skipped'|'failed'
  sentAt,
  tags: { source: 'power_leads', adPlatform, adSeenDate, adSnippet }
}

// sent_registry  (survives across runs — the dedup memory)
{ _id, domain, email, firstContactedAt, lastRunId }

// settings  (single doc — editable from UI)
{ icp: { industries[], sizeMin, sizeMax, geographies[], exclusions[] },
  personas: { titles[], minSeniority, requireVerifiedEmail },
  apollo: { keyRef, planTier }, mail: { provider, fromAddress, templateId },
  gemini: { keyRef, model, useForScoring, useForPersonalization } }
```

**Indexes:** `companies.{domain, runId}`, `sent_registry.email` (unique), `contacts.enrollmentStatus`.

---

## 4. Backend modules

```
server/src/
  integrations/
    adsApi.ts        // GET /ads client: paginate, retry/backoff, map -> Company
    apollo.ts        // peopleSearch + peopleEnrichment; configurable per-company cap
    gemini.ts        // required classification, ICP scoring, personalization
    sendGrid.ts      // SendGrid provider client
    csvExporter.ts   // Phase 1 output
  pipeline/
    orchestrator.ts  // state machine, advances a run stage-by-stage
    01-discover.ts   // call Ads API with run.filters -> upsert companies
    02-filter.ts     // dedupe by domain + ICP match + registry exclusion
    03-enrich.ts     // Apollo per qualified company (concurrency-limited)
    04-send.ts       // send approved email OR CSV; write to sent_registry
  models/            // Mongoose schemas above
  services/
    icpScorer.ts     // pure fn: company + settings -> {match, reason}
    gemini.ts        // required AI layer: score+rank, personalization, normalization
  api/               // Express routers: runs, companies, contacts, settings, reports
  jobs/scheduler.ts  // production P2 worker + post-launch recurring schedules
  config/env.ts      // zod-validated env: MONGO_URI, ADS_API_URL/KEY, APOLLO_KEY...
```

**Key implementation decisions:**
- **Rate limiting / concurrency:** `p-limit` (e.g. 3 concurrent Apollo calls) + `p-retry` with exponential backoff on 429s.
- **Prototype Apollo volume:** defaults to 3 candidates/contacts per qualified company through `APOLLO_CONTACTS_PER_COMPANY`. Concurrency remains bounded. Production adds per-run and daily workspace budgets based on the Apollo plan.
- **Scheduling on Mongo, not Redis:** use **Agenda** (persists jobs in Mongo) so no Redis is added just for cron — one datastore total.
- **Idempotency:** every stage is re-runnable; `discover` upserts by `domain`, `enrich` skips companies already `enriched`. A crashed run resumes without double-charging Apollo.

---

## 5. Pipeline flow (state machine)

```
POST /runs (filters)
  -> discovering:  AdsApiClient.fetchAll(filters)  -> companies[status=discovered]
  -> filtering:    dedupe by domain
                   -> drop if in sent_registry
                   -> icpScorer -> status=qualified | filtered_out
  -> enriching:    for each qualified (p-limit):
                      apollo.orgEnrich -> apollo.peopleSearch(personas)
                      -> apollo.peopleEnrichment
                      -> contacts[enrollmentStatus=pending]
                   companies with 0 contacts -> status=no_contacts
  -> reviewRequired?  -- yes --> pending_review  (UI: approve/reject leads)
                      -- no  --> auto-approve verified contacts and finish
  -> sending:      Phase 1: csvExporter -> downloadable file
                   Phase 2: SendGrid sends approved contacts
                   -> write sent_registry, contacts[sent]
  -> done:         stats finalized; reporting job later pulls mail delivery/reply outcomes
```

---

## 5.1 Gemini Enrichment (required layer)

Gemini plugs into the pipeline as a required product capability for classification, scoring, and email personalization. Calls use structured output and are validated before persistence. Provider failures fall back to deterministic rules so an external outage does not lose an entire run.

### High-value uses
1. **ICP scoring / lead ranking (Stage 2) — biggest win.** Instead of a boolean `icpMatch`, the LLM reads ad creative + firmographics and returns a ranked, explained score (e.g. `8/10 — matches ICP; ad signals active budget in our category`). Reps work the best leads first.
2. **Ad-creative -> personalization snippet (Stage 3/4).** Converts messy ad copy into a usable email opening, stored on the contact tag for review and sending.
3. **Entity resolution.** When the Ads API returns a name but no clean `domain`, the LLM normalizes it to a canonical entity for Apollo matching (fallback path only).
4. **Fuzzy dedup (FR2.3).** Decides whether two slightly-different advertiser names are the same company, beyond string similarity.
5. **Title normalization.** Maps messy Apollo titles ("Growth Ninja") onto canonical persona buckets + seniority.

### Where it does NOT belong
- API calls (Ads / Apollo / Mail) — deterministic HTTP, no LLM.
- Dedup by clean domain — a `Set` is faster and 100% correct.
- Email verification — Apollo already does this.
- Pipeline orchestration — keep the state machine deterministic.

### Insertion points
```
Stage 2 Filter:   icpScorer (fallback) ──> gemini.analyzeCompany (classify + score + reason)
                  domain Set (fast dedup) ─ ambiguous only ─> gemini entity analysis
Stage 3 Enrich:   apollo -> Gemini title ranking + email personalization
```
Single integration: `integrations/gemini.ts`, called before ICP qualification and reused during enrichment.

### Practical notes
- **Batch + cache** by `domain` — score/rewrite many companies per call; re-runs don't re-pay. LLM cost then rounds to noise next to Apollo credits.
- **Advisory, not gating** — LLM output influences ranking and copy; it never blocks a lead from flowing or overrides Apollo's verified data.

---

## 6. Frontend (React + TS, Vite)

| Page | Purpose | Key components |
|---|---|---|
| **New Run** | Set filters (keyword/industry/geo/platform/min-days), toggle "require review", launch | `FilterForm`, `RunLauncher` |
| **Runs** | List of runs with status + stats, live progress | `RunList`, `RunProgressBar` |
| **Run Detail / Review** | Human-in-the-loop screen: enriched contacts grouped by company, ad snippet shown for context, approve/reject, "Send approved" / "Export CSV" | `LeadReviewTable`, `ApprovalBar`, `AdContextCard` |
| **Dashboard** | Funnel (found -> qualified -> enriched -> enrolled) + reply/meeting rates for ad-sourced leads | `FunnelChart`, `StatCards`, `SourceRoiTable` |
| **Settings** | Edit ICP, personas, default sequence, key status | `IcpForm`, `PersonaForm` |

Stack: Vite + React + TS, TanStack Query for server state, a light component lib (shadcn/ui or MUI), Recharts for the dashboard. Poll `/runs/:id` (or SSE) for live progress.

---

## 7. Prototype delivery history + tests

### Testing stack (all phases)
- **Unit / integration:** Vitest (TS-native, one runner for FE + BE).
- **API tests:** Supertest against the Express app.
- **DB tests:** `mongodb-memory-server` — real Mongo behavior, no external dependency, wiped per test.
- **External API mocking:** `msw` (or `nock`) to stub Ads / Gemini / Apollo / Mail HTTP so tests are deterministic and cost nothing.
- **Component tests:** React Testing Library.
- **E2E:** Playwright against the app running with mocked integrations.
- **Coverage gate:** 80% lines on `services/`, `pipeline/`, and `integrations/` (the logic that matters). CI runs unit + integration on every PR; E2E on merge to main.

Test-data fixtures live in `shared/fixtures/` (sample Ads response, Apollo people/org responses) so FE, BE, and E2E all assert against the same shapes.

---

### Phase 0 — Scaffold & mocks (foundation)
**Goal:** repo builds, CI green, mocked integrations return fixtures. No real credentials.

**Build:** monorepo (`server` / `client` / `shared`), env config (zod), Mongoose connection, CI pipeline, and mock clients for all external APIs behind the same interfaces the real clients implement. Containerization is not required.

**Tests:**
- Unit: `config/env.ts` rejects missing/invalid vars; `shared` type guards.
- Integration: server boots, connects to in-memory Mongo, `GET /health` returns 200.
- CI: lint + typecheck + test all pass on a clean checkout.

**Exit criteria:** `npm run dev` runs the stack with the configured MongoDB; `npm test` is green; mock Ads client returns the sample fixture.

---

### Phase 1 — MVP (FULL APP)
**Goal:** trigger a run → reviewed, enriched CSV ready for use or later direct mail sending.

**Build:**
- Backend: `adsApi` + required `gemini` + `apollo` + `csvExporter`; orchestrator through stages 1–3 + CSV; deterministic `icpScorer` fallback.
- Mongo: `runs`, `companies`, `contacts`, `settings`.
- Frontend: New Run, Runs list, **Run Detail with review UI + CSV download**, Settings.

**Tests:**
- **Unit**
  - `icpScorer`: matches/rejects across size/industry/geo boundaries; explains reason.
  - `adsApi` mapper: raw response → `Company`; missing `domain` handled; pagination assembled.
  - `apollo` client: persona query built correctly; skips unverified email when configured; retry/backoff on 429 (mocked).
  - `csvExporter`: correct columns, escaping, tags present.
  - `gemini`: structured classification/score parsed and normalized; malformed output falls back to rules without losing the run.
- **Integration (API + in-memory Mongo, external APIs mocked)**
  - `POST /runs` → run advances discovering→filtering→enriching→pending_review; stats correct.
  - Dedup by domain within a run; ICP filter drops non-matches.
  - Approve/reject endpoints update `contacts.enrollmentStatus`.
  - `GET /runs/:id/export.csv` returns only approved contacts.
  - Resumability: kill mid-enrich, re-run stage, Apollo not re-charged (call count asserted).
- **Component**
  - `FilterForm` validation; `LeadReviewTable` approve/reject toggles; `AdContextCard` renders snippet.
- **E2E (Playwright, mocked integrations)**
  - Full happy path: launch run → watch progress → review → approve subset → download CSV; assert CSV contents.

**Exit criteria:** happy-path E2E green; coverage gate met; a run with the sample fixture produces a correct CSV of approved leads.

---

### Phase 2 — Direct mail feature
**Goal:** compose and send personalized emails to approved contacts; CSV remains available as a fallback.

**Implementation status:** SendGrid SDK delivery, editable templates, Gemini placeholders, message IDs, sent timestamps, retry handling, and cross-run email deduplication are implemented. Live verification requires a SendGrid API key and verified sender.

**Build:** configurable mail provider, sender identity, subject/body templates, Gemini personalization insertion, stage 4 sending, `sent_registry` writes, contact-level dedup, delivery status, and a "Send approved" action.

**Tests:**
- **Unit:** template rendering, recipient validation, provider retry behavior, and already-sent contacts skipped.
- **Integration:** approve → send writes `mailMessageId`, `sentAt`, and `sent_registry`; contacts already in the registry are excluded on the next run.
- **Contract test:** recorded mail-provider fixtures verify payloads against the chosen provider API.
- **E2E:** launch → review → **Send approved** → assert the mocked mail provider received personalized messages; re-run same filters → previously sent contacts do not reappear.

**Exit criteria:** mail-sending E2E green; cross-run dedup proven; CSV path still works as fallback.

---

### Phase 3 — Automation + reporting (deferred; not a prototype blocker)
**Goal:** scheduled recurring runs, CRM dedup, ROI dashboard.

**Build:** Agenda scheduler (Mongo-backed); CRM dedup source; reporting job pulling mail delivery/reply outcomes; Dashboard page.

**Tests:**
- **Unit:** cron expression → next-run calc; reporting aggregation math (open/reply/meeting rates per source).
- **Integration:** scheduled job triggers a run with saved filters (time injected, not `Date.now()`); CRM dedup excludes existing customers/open opps; reporting endpoint returns correct funnel + rates from seeded runs.
- **Component:** `FunnelChart`, `StatCards`, `SourceRoiTable` render seeded report data; empty-state handled.
- **E2E:** enable a schedule → fire it (test hook) → run appears in list; open Dashboard → funnel and ad-sourced reply rate match seeded data.

**Exit criteria:** scheduled run executes end-to-end unattended; dashboard reflects real run history; CRM dedup verified.

---

### Regression / non-functional (ongoing)
- **Rate-limit & backoff:** simulate sustained 429s from Apollo → pipeline stays within limits, no data loss.
- **Production readiness:** add plan-aware Apollo quota guardrails before moving beyond prototype volume.
- **Idempotency/resume:** re-running any stage never double-charges or double-sends (asserted via mock call counts).
- **Load smoke:** a run of ~1,000 discovered companies completes without unbounded memory (stream/paginate, not load-all).

---

## 8. Repo layout

```
power-leads/
  server/    (Node+TS+Express+Mongoose+Agenda)
  client/    (React+TS+Vite)
  shared/    (TS types shared FE/BE: Company, Contact, RunStatus...)
  .github/workflows/   (GitHub Actions CI and native artifact delivery)
  .env.example
```

`shared/` holds the TS interfaces both sides import — one source of truth for the data model.

---

## 9. Ads POST API — implemented contract

### Input
```
POST /api/v1/common/advertiser/names
```
| Body field | Type | Priority |
|---|---|---|
| `keyword` | string | nice-to-have |
| `industry` | string/enum | important |
| `geography` | country/region code | important |
| `platform` | csv enum | important |
| `min_days_active` | int | **critical — prefer server-side** |
| `page` / `page_size` | int | required |

### Output
```json
{
  "page": 1, "page_size": 100, "total_results": 2450,
  "results": [{
    "company_name": "Acme Inc",
    "domain": "acme.com",
    "platform": "meta",
    "ad_creative_snippet": "Try Acme CRM free for 30 days...",
    "ad_first_seen": "2026-06-01",
    "ad_last_seen": "2026-07-18",
    "days_active": 47,
    "ad_url": "https://...",
    "industry": "SaaS",
    "geography": "US"
  }]
}
```

**Non-negotiable:** `domain` must be present on every record — it is the join key into Apollo.
Bearer authentication and page/page-size pagination are implemented. The prototype requests at most 100 Ads records. The provider has been observed to apply `min_days_active` inconsistently and to return a parent category in the `industry` field; the app defensively reapplies reliable filters and uses the exact selected catalog category/subcategory as canonical run context.

---

## 10. ICP + Persona definitions (from sales leadership)

**ICP (which companies to pursue):** industries, employee-size band, geographies, exclusions.
**Persona (which people to contact):** target job titles, minimum seniority, and verified-email requirement.

Proposed defaults (tune in Settings): B2B SaaS / e-commerce, 50–1,000 employees, US/UK/CA; target CMO / VP Marketing / Head of Growth / Director of Demand Gen at director level and above; require verified email. The accepted prototype defaults to 3 Apollo candidates/contacts per qualified company.

---

## 11. Outstanding items before/during build

| Item | Needed by | Status |
|---|---|---|
| Ads API sample response + auth | Phase 1 start | Validated live |
| Apollo API key | Phase 1 enrichment | Validated live |
| Apollo plan tier / credit quota | Production P0 | Needed to approve per-run and daily budgets; prototype cap is 3 per company |
| ICP + persona values | Phase 1 (defaults seedable) | Defaults available |
| SendGrid API key and verified sender | Phase 2 live validation | Needed from account owner |
| CRM dedup source | Phase 3 | Deferred |
| Apollo data-storage compliance sign-off | Before go-live | Needed |

**Current verification:** the live pipeline has completed Ads discovery, live Gemini scoring/personalization, Apollo people search/enrichment, and creation of verified contacts. SendGrid delivery is implemented and covered in mock mode; a SendGrid API key and verified sender are still required for a real delivery test. Phase 3 is intentionally deferred.
