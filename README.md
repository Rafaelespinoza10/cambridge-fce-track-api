# Cambridge FCE Track API

Backend de **Cambridge Progress Tracker / ExamFlow**: convierte el estudio diario para el examen Cambridge B2 First (FCE) en datos medibles — actividades por skill, scores, mocks, evidencia y recomendaciones basadas en reglas.

La especificación funcional completa (skills válidos, entidades, formatos de score, reglas de negocio) vive en [`docs/SPEC.md`](docs/SPEC.md) y es la fuente de verdad para cualquier cambio de alcance.

## Stack

- **Runtime:** Node.js 22, TypeScript
- **Infraestructura:** Serverless Framework v3 (AWS Lambda + API Gateway HTTP API), bundling con `serverless-esbuild`
- **Base de datos:** PostgreSQL + TypeORM (migraciones manuales, `synchronize: false`)
- **Auth:** JWT (`jsonwebtoken` + `bcryptjs`)
- **Storage de evidencia:** S3 con URLs pre-firmadas (`@aws-sdk/client-s3` + `s3-request-presigner`)

## Arquitectura

Cada dominio es un **servicio Serverless independiente** (stack de CloudFormation propio), definido en `src/infra/<modulo>.serverless.yml` y desplegable por separado. Dentro de cada módulo se sigue el patrón:

```
controller  →  service  →  repository  →  entidad TypeORM (src/models)
```

Los módulos no hacen llamadas directas a la base de datos de otro módulo; toda lectura/escritura pasa por su propio repository (ver regla 9 de `SPEC.md`).

```
src/
├── controllers/     # Handlers Lambda (parseo de evento, auth, respuesta HTTP)
├── services/        # Reglas de negocio
├── repositories/     # Acceso a datos (TypeORM)
├── models/          # Entidades TypeORM
├── interfaces/       # Tipos de request/response por módulo
├── lib/              # Utilidades compartidas (jwt, password, response, db connection...)
├── infra/            # Un *.serverless.yml por módulo (funciones + rutas HTTP)
├── migrations/        # Migraciones TypeORM (se commitean siempre)
└── config/seed/       # Seed de catálogo (skills, exam sections, activity templates)
```

## Módulos y endpoints

| Módulo | Servicio Serverless | Endpoints |
| --- | --- | --- |
| Auth | `cambridge-tracker-auth` | `POST /auth/register`, `POST /auth/login`, `GET /auth/me` |
| Users / Goals | `cambridge-tracker-users` | `GET /users/me`, `PATCH /users/me/profile`, `GET/POST /users/me/goals`, `PATCH/DELETE /users/me/goals/{goalId}` |
| Activity Library | `cambridge-tracker-activities` | `GET /skills`, `GET /exam-sections`, `GET /activity-templates`, `GET/POST /custom-activities`, `PATCH/DELETE /custom-activities/{id}` |
| Weekly Calendar (Planning) | `cambridge-tracker-planning` | `POST /plans/weeks`, `GET /plans/current`, `GET /plans/weeks/{weekId}`, `POST /plans/weeks/{weekId}/days/{dayId}/activities`, `PATCH/DELETE /plans/activities/{plannedActivityId}`, `PATCH /plans/activities/{plannedActivityId}/move`, `GET /plans/activities` (historial paginado, cruza semanas, filtra por `skillId`/`status`/`from`/`to`) |
| Score Registration | `cambridge-tracker-scoring` | `POST/GET /scores/activities/{plannedActivityId}`, `GET /scores`, `GET/PATCH/DELETE /scores/{scoreId}` |
| Evidence | `cambridge-tracker-evidence` | `POST /evidence/upload-url`, `POST/GET /evidence`, `GET/DELETE /evidence/{evidenceId}` |
| Mocks | `cambridge-tracker-mocks` | `POST/GET /mocks`, `GET/PATCH/DELETE /mocks/{mockId}` |
| Progress / Dashboard | `cambridge-tracker-progress` | `GET /metrics` |
| Recommendations | `cambridge-tracker-recommendations` | `GET /recommendations`, `POST /recommendations/generate`, `PATCH/DELETE /recommendations/{recommendationId}` |
| Notifications | `cambridge-tracker-notifications` | Stack reservado, sin funciones aún |
| Resources | `cambridge-tracker-resources` | Stack reservado — Fase 2 según `SPEC.md` |

Todos los endpoints (excepto `auth/register` y `auth/login`) requieren `Authorization: Bearer <jwt>`.

## Setup local

**Requisitos:** Node.js 22 (`nvm use`), PostgreSQL accesible (local o remoto, ej. Neon).

1. Instalar dependencias:
   ```
   npm install
   ```
2. Crear `serverless.env.yml` en la raíz (está en `.gitignore`, nunca se commitea) con esta forma:
   ```yaml
   dev:
     REGION: us-east-2
     CORS_ORIGIN: http://localhost:3000
     DATABASE_URL: postgresql://<user>:<password>@<host>/<db>?sslmode=require
     JWT_SECRET: <cadena aleatoria larga>
     JWT_EXPIRES_IN: 1d
     S3_EVIDENCE_BUCKET: <nombre-del-bucket-s3>
   ```
   Añade un bloque `prod:` equivalente cuando despliegues a producción.
3. Ejecutar migraciones:
   ```
   npm run db:migration:run
   ```
4. (Opcional) Poblar el catálogo base (skills, exam sections, activity templates):
   ```
   npm run db:seed
   ```

## Scripts disponibles

| Script | Descripción |
| --- | --- |
| `npm run build` | Type-check con `tsc --noEmit` |
| `npm run format` / `format:check` | Prettier |
| `npm run db:test-connection` | Verifica conexión a la base de datos configurada |
| `npm run db:migration:generate` / `:create` / `:run` / `:revert` / `:show` | Gestión de migraciones TypeORM |
| `npm run db:seed` | Corre el seed de catálogo (`src/config/seed/run-seed.ts`) |
| `npm run deploy` / `deploy:dev` | Deploy vía `deploy.sh` |

## Deploy

El deploy se hace **por módulo**, no de un monolito, usando `deploy.sh` (bash) o `deploy.ps1` (PowerShell):

```bash
./deploy.sh --service activities --stage dev     # deploy del stack completo del módulo
./deploy.sh --service activities --function activitiesGetSkills --stage dev  # deploy de una sola función
./deploy.sh --list                                # lista todos los servicios y funciones disponibles
```

Los nombres de servicio válidos están en `serverless.path-map.conf`: `auth`, `users`, `activities`, `evidence`, `mocks`, `notifications`, `planning`, `progress`, `recommendations`, `resources`, `scoring`.

## Reglas de desarrollo

Antes de añadir un endpoint, entidad o feature, revisa la sección 13 de [`docs/SPEC.md`](docs/SPEC.md) — cubre reglas como el enum fijo de skills, el set aprobado de entidades para Fase 1, el formato de score específico por tipo de actividad y la prohibición de IA/ML fuera de las reglas de detección de debilidades (Fase 1).
