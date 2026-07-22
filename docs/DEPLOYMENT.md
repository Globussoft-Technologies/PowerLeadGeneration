# Native Node.js delivery

Production v1 uses GitHub Actions and native Node.js artifacts. Containerization is not part of the plan.

## Workflows

- `.github/workflows/ci.yml` runs on pull requests and pushes to `main`. It audits production dependencies, installs from the lockfile, builds the shared package, typechecks, tests, builds all workspaces, and uploads the compiled artifacts.
- `.github/workflows/delivery.yml` runs manually for `staging`/`production` or automatically for `v*` tags. It repeats verification and creates `power-leads-release.tgz`.

Configure `staging` and `production` as protected GitHub environments. Production should require approval before the delivery job can run.

## Release artifact

The release contains:

- `client/dist` static frontend files.
- `server/dist` compiled API files.
- `shared/dist` compiled shared types/runtime package.
- Root and workspace `package.json` files plus `package-lock.json` for deterministic production installation.

On the selected host, the provider-specific deployment adapter must:

1. Download and extract the approved artifact.
2. Run `npm ci --omit=dev`.
3. Inject protected production environment variables configured on the host.
4. Run the database migration step when the release declares one.
5. Serve `client/dist` and proxy same-origin `/api` requests to the API process.
6. Start the API with `npm run start --workspace server`.
7. Check `/api/health` and `/api/ready` before shifting traffic.
8. Retain the previous artifact for rollback.

The exact download, process-manager, static-hosting, traffic-shift, and rollback commands remain pending until the hosting platform is selected.

## Prototype workspace migration

Workspace ownership is required for Phase P1. Existing prototype documents do not contain `workspaceId` fields.

Before running the workspace-aware server against an existing database:

1. Back up the database.
2. Set `DEV_AUTH_WORKSPACE_ID` and `DEV_AUTH_USER_ID` to the owner of existing prototype data.
3. Run `npm run migrate:workspace --workspace server` once.
4. Review the printed migrated-document counts.
5. Start the updated server and confirm existing runs appear under that workspace.

The migration also replaces prototype global-unique indexes with workspace-aware compound indexes. Do not run it against production data without a verified backup.

## Authentication

Development may use `AUTH_MODE=development` and the configured local identity. Production refuses development mode. The minimal production setup uses `AUTH_MODE=password`, Mongo-backed sessions, and the invite-only user-management flows built into the application.

Create the first administrator by temporarily setting `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`, and optionally `BOOTSTRAP_ADMIN_NAME`, then run:

```bash
npm run create-admin --workspace server
```

Remove `BOOTSTRAP_ADMIN_PASSWORD` immediately after the account is created. Additional accounts must be invited from the Users screen.

`AUTH_MODE=trusted_proxy` remains available if the eventual host provides a suitable authentication gateway. It is optional, not required.

When trusted-proxy mode is selected, the proxy must remove any client-supplied identity headers and inject:

- `x-auth-proxy-secret`
- `x-auth-user-id`
- `x-auth-workspace-id`
- `x-auth-role` (`admin`, `operator`, or `reviewer`)

`AUTH_PROXY_SHARED_SECRET` must be a random value of at least 32 characters stored in the deployment environment.

## Database backup and restore

Use MongoDB's standard tools before migrations and on the production backup schedule:

```bash
mongodump --uri="$MONGO_URI" --archive=power-leads-backup.archive --gzip
mongorestore --uri="$MONGO_URI" --archive=power-leads-backup.archive --gzip --drop
```

Restore into staging first and verify `/api/ready`, login, run history, contacts, and audit events before any production restore. Keep backup files encrypted and outside the application directory.
