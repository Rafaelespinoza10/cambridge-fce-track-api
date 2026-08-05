# Cambridge FCE Track API

[![CI](https://github.com/Rafaelespinoza10/cambridge-fce-track-api/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Rafaelespinoza10/cambridge-fce-track-api/actions/workflows/ci.yml)

Backend for **Cambridge Progress Tracker / ExamFlow**: turns daily study for the Cambridge B2 First (FCE) exam into measurable data — activities per skill, scores, mocks, evidence, and rule-based recommendations.

The full functional spec (valid skills, entities, score formats, business rules) lives in [`docs/SPEC.md`](docs/SPEC.md) and is the source of truth for any change in scope.

## Stack

- **Runtime:** Node.js 22, TypeScript
- **Infrastructure:** Serverless Framework v3 (AWS Lambda + API Gateway HTTP API), bundled with `serverless-esbuild`
- **Database:** PostgreSQL + TypeORM (manual migrations, `synchronize: false`)
- **Auth:** JWT (`jsonwebtoken` + `bcryptjs`)
- **Evidence storage:** S3 with pre-signed URLs (`@aws-sdk/client-s3` + `s3-request-presigner`)

## Architecture

Each domain is an **independent Serverless service** (its own CloudFormation stack), defined in `src/infra/<module>.serverless.yml` and deployable separately. Every module follows the pattern:

```
controller  →  service  →  repository  →  TypeORM entity (src/models)
```

Modules never call another module's database directly; every read/write goes through its own repository (see rule 9 in `SPEC.md`).

```
src/
├── controllers/     # Lambda handlers (event parsing, auth, HTTP response)
├── services/        # Business rules
├── repositories/     # Data access (TypeORM)
├── models/          # TypeORM entities
├── interfaces/       # Request/response types per module
├── lib/              # Shared utilities (jwt, password, response, db connection...)
├── prompts/           # Centralized LLM prompts as .md files, imported by services
├── infra/            # One *.serverless.yml per module (functions + HTTP routes)
├── migrations/        # TypeORM migrations (always committed)
└── config/seed/       # Catalog seed (skills, exam sections, activity templates)
```

## Modules and endpoints

| Module                     | Serverless service                  | Endpoints                                                                                                                                                                                                                                                                                                                                   |
| -------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth                       | `cambridge-tracker-auth`            | `POST /auth/register`, `POST /auth/login`, `GET /auth/me`                                                                                                                                                                                                                                                                                   |
| Users / Goals              | `cambridge-tracker-users`           | `GET /users/me`, `PATCH /users/me/profile`, `GET/POST /users/me/goals`, `PATCH/DELETE /users/me/goals/{goalId}`                                                                                                                                                                                                                             |
| Activity Library           | `cambridge-tracker-activities`      | `GET /skills`, `GET /exam-sections`, `GET /activity-templates`, `GET/POST /custom-activities`, `PATCH/DELETE /custom-activities/{id}`                                                                                                                                                                                                       |
| Weekly Calendar (Planning) | `cambridge-tracker-planning`        | `POST /plans/weeks`, `GET /plans/current`, `GET /plans/weeks/{weekId}`, `POST /plans/weeks/{weekId}/days/{dayId}/activities`, `PATCH/DELETE /plans/activities/{plannedActivityId}`, `PATCH /plans/activities/{plannedActivityId}/move`, `GET /plans/activities` (paginated history, spans weeks, filters by `skillId`/`status`/`from`/`to`) |
| Score Registration         | `cambridge-tracker-scoring`         | `POST/GET /scores/activities/{plannedActivityId}`, `GET /scores`, `GET/PATCH/DELETE /scores/{scoreId}`                                                                                                                                                                                                                                      |
| Evidence                   | `cambridge-tracker-evidence`        | `POST /evidence/upload-url`, `POST/GET /evidence`, `GET/DELETE /evidence/{evidenceId}`                                                                                                                                                                                                                                                      |
| Mocks                      | `cambridge-tracker-mocks`           | `POST/GET /mocks`, `GET/PATCH/DELETE /mocks/{mockId}`                                                                                                                                                                                                                                                                                       |
| Progress / Dashboard       | `cambridge-tracker-progress`        | `GET /metrics`                                                                                                                                                                                                                                                                                                                              |
| Recommendations            | `cambridge-tracker-recommendations` | `GET /recommendations`, `POST /recommendations/generate`, `PATCH/DELETE /recommendations/{recommendationId}`                                                                                                                                                                                                                                |
| Notifications              | `cambridge-tracker-notifications`   | Reserved stack, no functions yet                                                                                                                                                                                                                                                                                                            |
| Resources                  | `cambridge-tracker-resources`       | Reserved stack — Phase 2 per `SPEC.md`                                                                                                                                                                                                                                                                                                      |

All endpoints (except `auth/register` and `auth/login`) require `Authorization: Bearer <jwt>`.

## Local setup

**Requirements:** Node.js 22 (`nvm use`), a reachable PostgreSQL instance (local or remote, e.g. Neon).

1. Install dependencies:
   ```
   npm install
   ```
2. Create `serverless.env.yml` at the repo root (it's in `.gitignore`, never committed) shaped like this:
   ```yaml
   dev:
     REGION: us-east-2
     CORS_ORIGIN: http://localhost:3000
     DATABASE_URL: postgresql://<user>:<password>@<host>/<db>?sslmode=require
     JWT_SECRET: <long random string>
     JWT_EXPIRES_IN: 1d
     S3_EVIDENCE_BUCKET: <s3-bucket-name>
   ```
   Add an equivalent `prod:` block when you deploy to production.
3. Run migrations:
   ```
   npm run db:migration:run
   ```
4. (Optional) Seed the base catalog (skills, exam sections, activity templates):
   ```
   npm run db:seed
   ```

## Available scripts

| Script                                                                     | Description                                                         |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `npm run format` / `format:check`                                          | Prettier write / check                                              |
| `npm run build`                                                            | Type-check with `tsc --noEmit`                                      |
| `npm test`                                                                 | Unit tests via Node.js test runner + `ts-node` (`src/**/*.test.ts`) |
| `npm run db:test-connection`                                               | Verifies the configured database connection                         |
| `npm run db:migration:generate` / `:create` / `:run` / `:revert` / `:show` | TypeORM migration management                                        |
| `npm run db:seed`                                                          | Runs the catalog seed (`src/config/seed/run-seed.ts`)               |
| `npm run deploy` / `deploy:dev`                                            | Deploy via `deploy.sh`                                              |

## Continuous integration

On every push or pull request to `develop` or `main` (and on `workflow_dispatch`), GitHub Actions runs:

```
npm ci
npm run format:check
npm run build
npm test
```

The workflow lives at [`.github/workflows/ci.yml`](.github/workflows/ci.yml). It doesn't deploy, doesn't use AWS/OpenAI secrets, and doesn't need PostgreSQL: unit tests mock external dependencies.

## Deploy

Deploys happen **per module**, not as a monolith, using `deploy.sh` (bash) or `deploy.ps1` (PowerShell):

```bash
./deploy.sh --service activities --stage dev     # deploy the module's full stack
./deploy.sh --service activities --function activitiesGetSkills --stage dev  # deploy a single function
./deploy.sh --list                                # list all available services and functions
```

Valid service names are in `serverless.path-map.conf`: `auth`, `users`, `activities`, `evidence`, `mocks`, `notifications`, `planning`, `progress`, `recommendations`, `resources`, `scoring`.

## Development rules

Before adding an endpoint, entity, or feature, review section 13 of [`docs/SPEC.md`](docs/SPEC.md) — it covers rules like the fixed skills enum, the approved entity set for Phase 1, the score format specific to each activity type, and the ban on AI/ML outside the weakness-detection rules (Phase 1).
