# Environment configuration

All runtime configuration is supplied through environment variables. Real values must never be committed. `.env` is for local development only; staging and production values are configured in the hosting environment.

## Core application

| Variable | Production guidance |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | Port assigned by the host, default `4001` |
| `MONGO_URI` | Production MongoDB connection string; secret |
| `APP_BASE_URL` | Public HTTPS client URL used in invitation/reset links |
| `CORS_ORIGINS` | Comma-separated allowed HTTPS client origins |
| `TRUST_PROXY` | `true` only when the host terminates traffic through a trusted proxy |
| `API_RATE_LIMIT_MAX` | Requests per minute per source; initial default `1000` |

## Authentication

| Variable | Production guidance |
|---|---|
| `AUTH_MODE` | `password` for built-in invite-only accounts; `trusted_proxy` is optional |
| `SESSION_COOKIE_NAME` | Default `power_leads_session` |
| `SESSION_TTL_HOURS` | Default `168` (7 days) |
| `AUTH_TOKEN_TTL_HOURS` | Invitation/reset lifetime; default `24` |
| `AUTH_PROXY_SHARED_SECRET` | Required only for `trusted_proxy`; secret, minimum 32 characters |
| `DEV_AUTH_USER_ID` | Development/migration only |
| `DEV_AUTH_WORKSPACE_ID` | Development/migration only |
| `DEV_AUTH_ROLE` | Development only |
| `BOOTSTRAP_ADMIN_EMAIL` | Temporary first-admin creation value; remove afterward |
| `BOOTSTRAP_ADMIN_PASSWORD` | Temporary secret; minimum 12 characters, remove immediately afterward |
| `BOOTSTRAP_ADMIN_NAME` | Optional first-admin display name |

Passwords must contain at least 12 characters with uppercase, lowercase, and numeric characters.

## Ads API

`ADS_API_URL`, `ADS_API_TOKEN` (secret), `ADS_API_MODE`, and `ADS_API_MAX_PAGES`.

## Apollo

`APOLLO_REVEAL_PERSONAL_EMAILS=true` requests personal email channels in addition to the work email. Apollo may consume additional credits and may withhold personal data for privacy-regulated regions.

Mobile phone enrichment is asynchronous. After hosting is available, set `APOLLO_WEBHOOK_URL` to the public endpoint `https://<api-host>/api/webhooks/apollo?token=<secret>` and set the same value in `APOLLO_WEBHOOK_SECRET`. Without these variables, runs still capture work email, personal emails, social profiles, and any phone data returned synchronously; mobile reveal remains disabled.

`APOLLO_API_KEY` (secret), `APOLLO_MODE`, `APOLLO_BASE_URL`, `APOLLO_CONCURRENCY`, `APOLLO_CONTACTS_PER_COMPANY` (default `3`), and `APOLLO_REQUIRE_VERIFIED_EMAIL`.

## Gemini

`GEMINI_API_KEY` (secret when live), `GEMINI_MODE`, `GEMINI_MODEL`, and `GEMINI_CONCURRENCY`.

## SendGrid

`MAIL_MODE`, `SENDGRID_API_KEY` (secret when live), `SENDGRID_FROM_EMAIL`, `SENDGRID_FROM_NAME`, and `MAIL_CONCURRENCY`.

Production mail also uses:

| Variable | Guidance |
|---|---|
| `SENDGRID_WEBHOOK_PUBLIC_KEY` | Public ECDSA verification key copied from the signed SendGrid Event Webhook configuration |
| `SENDGRID_WEBHOOK_MAX_AGE_SECONDS` | Maximum accepted signed-request age; default `300` |
| `MAIL_PER_RUN_LIMIT` | Maximum reserved recipients per run; default `50` |
| `MAIL_DAILY_WORKSPACE_LIMIT` | Maximum reserved recipients per UTC day and workspace; default `100` |

Configure SendGrid to post signed events to `https://<api-host>/api/webhooks/sendgrid`. Enable processed, delivered, deferred, bounce, dropped, spam report, unsubscribe, and group unsubscribe events. The endpoint must receive the original JSON bytes; it is intentionally outside application-session authentication and accepts only a valid SendGrid signature with a fresh timestamp.

SendGrid is used for both prospect mail and invitation/password-reset messages. Production password authentication therefore requires a working sender before users can self-service invitations and password recovery.

## Production rules

- `AUTH_MODE=development` is rejected when `NODE_ENV=production`.
- Wildcard production CORS is rejected.
- Live Gemini requires a Gemini key.
- Live mail requires a SendGrid key and verified sender address.
- Rotate all prototype credentials before deployment.
## Durable pipeline worker

`PIPELINE_MAX_ATTEMPTS` controls the total automatic attempts for a pipeline job (default `3`). `WORKER_POLL_MS` controls how often an idle worker checks MongoDB (default `1000`). `WORKER_LEASE_MS` controls the renewable ownership lease (default `60000`). Keep the lease comfortably longer than the heartbeat interval; the application derives the heartbeat as one-third of the lease.

Each new run snapshots these provider call budgets, so later environment changes do not silently alter an in-progress run:

| Variable | Default | Meaning |
|---|---:|---|
| `RUN_ADS_CALL_BUDGET` | `100` | Maximum Ads HTTP page attempts per run |
| `RUN_GEMINI_CALL_BUDGET` | `300` | Maximum Gemini generation attempts per run, including retries |
| `RUN_APOLLO_CALL_BUDGET` | `1000` | Combined Apollo search and person-enrichment attempts per run, including retries |

When a budget is reached, the worker preserves partial results and completes the job with run status `quota_limited`. It does not automatically retry a deliberate budget stop. Start a new run after changing the configured budget if more provider work is required.

Production requires both processes from the same release artifact:

- API: `npm run start --workspace server`
- Worker: `npm run start:worker --workspace server`
