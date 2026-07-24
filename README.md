# Power Leads

Power Leads turns active advertiser signals into qualified, reviewable B2B contacts. It discovers companies advertising through the Ads API, qualifies them with Gemini, enriches decision-makers through Apollo, and lets an authorized operator review, export, and email approved contacts through SendGrid.

## Workflow

1. **Discover** active advertisers by keyword, category, industry, geography, platform, and minimum active days.
2. **Qualify** companies against the configured ICP using Gemini structured analysis with a deterministic fallback.
3. **Enrich** qualified companies with Apollo work emails, personal emails, phone numbers, and social profiles.
4. **Review** contacts individually or in bulk before any mail is sent.
5. **Export or send** approved contacts as an Excel-compatible CSV or personalized SendGrid email.

## Core features

- Invite-only authentication with Admin, Operator, and Reviewer roles.
- Workspace-isolated users, runs, settings, contacts, audit events, and delivery records.
- Mongo-backed durable worker queue with leases, retries, cancellation, recovery, and stage checkpoints.
- Live and mock adapters for Ads, Apollo, Gemini, and SendGrid.
- Gemini ICP scoring, explanations, provenance, token usage, and personalized email hooks.
- Apollo multi-channel enrichment for email, LinkedIn, phone/mobile, Twitter/X, Facebook, and GitHub.
- Human approval workflow with individual and bulk review.
- Editable personalized email templates with individual and bulk sending.
- SendGrid signed Event Webhook processing, suppression handling, delivery history, and duplicate-send protection.
- Per-run provider budgets and per-run/daily email safety limits.
- UTF-8 CSV reports that open directly in Excel.
- GitHub Actions verification and native Node.js release artifacts.

## Technology

- React 19, TypeScript, and Vite
- Node.js, Express, and TypeScript
- MongoDB and Mongoose
- Google Gemini through `@google/genai`
- Apollo People Search and Enrichment APIs
- SendGrid Mail and signed Event Webhooks
- Vitest, React Testing Library, Supertest, and `mongodb-memory-server`

## Repository structure

```text
client/    React application
server/    API, worker, integrations, persistence, and security
shared/    Shared TypeScript DTOs
docs/      Build, environment, and deployment documentation
.github/   CI and release workflows
```

## Local setup

Requirements:

- Node.js 22 or a compatible active LTS release
- npm
- MongoDB

Install dependencies:

```bash
npm install
```

Copy the environment template and supply local values:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Never commit `.env` or real provider credentials.

Start the API, worker, and client together:

```bash
npm run dev
```

Default local endpoints:

- Client: `http://localhost:5173`
- API: `http://localhost:4001`
- Health: `http://localhost:4001/api/health`
- Readiness: `http://localhost:4001/api/ready`

## Runtime modes

Each external integration supports `mock` or `live` mode:

```env
ADS_API_MODE=mock
APOLLO_MODE=mock
GEMINI_MODE=mock
MAIL_MODE=mock
```

Use mock mode for development and CI. Live mode requires the corresponding credentials in protected environment variables. See [Environment configuration](docs/ENVIRONMENT.md) for the complete reference.

Apollo mobile-number reveal is asynchronous and requires a public HTTPS callback configured through `APOLLO_WEBHOOK_URL`. SendGrid production delivery requires a verified sender/domain. Delivery-status tracking additionally requires a signed Event Webhook configuration.

## Authentication

Development mode uses a local development identity. Production must use password or trusted-proxy authentication:

```env
AUTH_MODE=password
```

Create the first administrator using temporary bootstrap variables:

```bash
npm run create-admin --workspace server
```

Remove bootstrap credentials immediately after the administrator is created.

## Validation

```bash
npm run typecheck
npm test
npm run build
```

The server suite covers authentication, workspace isolation, pipeline recovery, integration contracts, mail safeguards, quotas, and webhooks. The client suite covers the core application workflow.

## Production delivery

GitHub Actions verifies every pull request and produces native Node.js release artifacts. The API and worker run as separate processes and share MongoDB.

After installing dependencies, configuring the root `.env`, and building the application, start the client, API, and worker with PM2:

```bash
npm run build
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Use `pm2 status`, `pm2 logs`, and `pm2 restart ecosystem.config.cjs --update-env` for routine operations. Run the command printed by `pm2 startup` once with the required server privileges so the processes return after a reboot.

Hosting-specific deployment and rollback commands are intentionally attached after the target platform is selected. Before live delivery, configure protected production variables, rotated provider credentials, MongoDB backups, private Ads API connectivity, a verified SendGrid identity, and public webhook URLs.

See [Deployment](docs/DEPLOYMENT.md) and [Build plan](docs/BUILD_PLAN.md) for operational details.
