# Cambridge Knowledge Base

Shared, admin-managed corpus of B2 First (FCE) material, built to feed future
AI-driven features (Daily Lessons, Practice generation, Mock Exams, Writing
feedback) with real Cambridge content instead of the model's own
(unverifiable) training knowledge. Introduced in `feat/cambridge-knowledge-base`.

**Scope of this PR:** the ingestion + search infrastructure only. No Daily
Lesson, no Mock Exam integration, no Practice changes, no Speaking, no public
frontend — see "Fuera de alcance" in the PR description. This document
covers what _is_ built, plus how the modules listed above should consume it
once they exist.

## 1. Purpose

Students never see or interact with this Knowledge Base directly — it isn't
a resource library. It exists so that when this app asks an LLM to generate
a Daily Lesson, a Practice exercise, or grade a Writing submission, the
prompt can be grounded in real, page-traceable Cambridge material (official
handbooks, past papers, sample tasks) instead of the model inventing exam
content from memory. An admin imports PDFs once; every AI-generation feature
in the app can then search the resulting corpus.

## 2. Architecture

```
Admin uploads PDF (base64, JSON body)
        │
        ▼
ImportCambridgeKnowledgeService
        │
        ├─ extractPdf            (lib/cambridge-pdf-extractor.ts)   — real text + sha256 checksum, per page
        ├─ findByChecksum        — idempotency short-circuit, see §5
        ├─ stripRepeatedHeadersAndFooters (lib/cambridge-text-cleaner.ts)
        ├─ chunkPages            (lib/cambridge-chunker.ts)          — semantic chunks, page-bounded
        ├─ classifier.classify   (classify-cambridge-chunk.ts)       — 1 LLM call per chunk, Structured Outputs
        ├─ embeddingClient.embed (embed-cambridge-chunks.ts)         — 1 batched OpenAI Embeddings call
        └─ dataSource.transaction(...)                               — persists source + all chunks atomically
                │
                ▼
    cambridge_sources / cambridge_knowledge_items (Postgres)
                │
                ▼
SearchCambridgeKnowledgeService  ── metadata filters (SQL) + cosine similarity (application code)
                │
                ▼
   Daily Lesson / Practice / Mock / Writing prompts (future consumers, see §9)
```

Every network call (classification, embeddings) happens **before** the DB
transaction opens — the same rule `SubmitWritingSubmissionService` follows
elsewhere in this codebase: never hold a transaction open across network
I/O. The transaction only ever does local persistence, so a mid-import
failure rolls back cleanly (see §5 and the "rollback ante importación
fallida" test).

### File map

| Concern                           | File                                                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| PDF → per-page text + checksum    | `src/lib/cambridge-pdf-extractor.ts`                                                                           |
| Strip running headers/footers     | `src/lib/cambridge-text-cleaner.ts`                                                                            |
| Text → semantic chunks            | `src/lib/cambridge-chunker.ts`                                                                                 |
| JSONB/array guards                | `src/lib/cambridge-jsonb-validators.ts`                                                                        |
| Classification validation catalog | `src/lib/cambridge-knowledge-catalog.ts`                                                                       |
| Classify one chunk (LLM)          | `src/services/cambridge-knowledge/classify-cambridge-chunk.ts`                                                 |
| Embed chunks (OpenAI)             | `src/services/cambridge-knowledge/embed-cambridge-chunks.ts`                                                   |
| Import orchestrator               | `src/services/cambridge-knowledge/import-cambridge-knowledge.service.ts`                                       |
| Search orchestrator               | `src/services/cambridge-knowledge/search-cambridge-knowledge.service.ts`                                       |
| List sources                      | `src/services/cambridge-knowledge/list-cambridge-sources.service.ts`                                           |
| DI wiring                         | `src/services/cambridge-knowledge/cambridge-knowledge-composition.ts`                                          |
| Repositories                      | `src/repositories/cambridge-sources.repository.ts`, `src/repositories/cambridge-knowledge-items.repository.ts` |
| Admin endpoints                   | `src/controllers/adminCambridgeKnowledgeController.ts`                                                         |
| Admin auth gate                   | `src/lib/admin-auth.ts`                                                                                        |
| Infra                             | `src/infra/cambridge-knowledge.serverless.yml`                                                                 |
| Migration                         | `src/migrations/1787300000000-AddCambridgeKnowledgeBase.ts`                                                    |

## 3. Data schema

### `cambridge_sources` — one row per imported PDF

| Column                     | Type                        | Notes                                                 |
| -------------------------- | --------------------------- | ----------------------------------------------------- |
| `id`                       | uuid pk                     |                                                       |
| `name`                     | varchar(255)                |                                                       |
| `description`              | text, nullable              |                                                       |
| `version`                  | varchar(50)                 | admin-supplied, e.g. `"2024"`, `"sample-paper-3"`     |
| `status`                   | enum `active` \| `inactive` | inactive sources are excluded from search (§6)        |
| `checksum`                 | varchar(64), **unique**     | sha256 hex of the raw PDF bytes — the idempotency key |
| `page_count`               | integer                     |                                                       |
| `created_at`, `updated_at` | timestamptz                 |                                                       |

### `cambridge_knowledge_items` — one row per chunk

| Column                    | Type                                               | Notes                                                                                                                                          |
| ------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                      | uuid pk                                            |                                                                                                                                                |
| `source_id`               | uuid fk → `cambridge_sources`, `ON DELETE CASCADE` |                                                                                                                                                |
| `exam_code`               | varchar(50)                                        | always `B2_FIRST` today — a column, not a hardcoded value, so a future exam never needs a migration (same pattern as Practice's `examCode`)    |
| `paper_code`, `part_code` | varchar(50), nullable                              | validated against the real `PRACTICE_EXAM_CATALOG` at classification time; **null when the classifier couldn't determine it — never guessed**  |
| `skills`                  | `text[]`                                           | subset of `reading`, `use-of-english`, `writing`, `listening`, `speaking`                                                                      |
| `topics`                  | `text[]`                                           | subset of `lib/exam-topics.ts`'s `EXAM_TOPICS` bank — the same bank Practice/Writing generation already draws on                               |
| `content`                 | text                                               | the chunk's raw text                                                                                                                           |
| `source_page`             | integer, **never null**                            | 1-based page number in the source PDF                                                                                                          |
| `source_section`          | varchar(255), nullable                             | reserved for a future finer-grained heading; unset today                                                                                       |
| `embedding`               | jsonb                                              | `number[]` — see §7 for why JSONB, not `pgvector`                                                                                              |
| `metadata`                | jsonb, nullable                                    | small, non-sensitive bag (embedding model id, classifier model id, chunk index within its page) — guarded by `isSafeCambridgeMetadata`, see §8 |
| `created_at`              | timestamptz                                        |                                                                                                                                                |

No `user_id` anywhere in either table — the Knowledge Base is global, not
owned by any individual user (see §8).

## 4. Import pipeline, step by step

1. **Extract** (`extractPdf`) — parses the PDF with `pdf-parse`, capturing
   each page's text separately via a custom `pagerender` hook (rather than
   trusting the library's single concatenated `.text` output), and computes
   the sha256 checksum of the raw bytes.
2. **Idempotency check** — `findByChecksum` looks up that checksum. If a
   source with it already exists, the import returns immediately
   (`idempotentReplay: true`) — no re-extraction, re-classification,
   re-embedding, or new rows. `cambridge_sources.checksum` is also `UNIQUE`
   at the DB level, so a concurrent duplicate import still can't slip
   through the pre-check race.
3. **Clean** (`stripRepeatedHeadersAndFooters`) — removes running
   headers/footers (page numbers, "Cambridge English: ..." boilerplate).
   Conservative by design: only removes a line that's short, sits in the
   top/bottom 2-line margin of a page, _and_ repeats (after digit
   normalization) across at least half the document's pages. See the doc
   comment on that file for the full reasoning — the bias is toward
   under-cleaning over losing real content.
4. **Chunk** (`chunkPages`) — splits each page's cleaned text into
   semantic chunks. Chunks never cross a page boundary. Within a page, a
   split point prefers the start of a new numbered item/exercise/question
   (`1.`, `Part 2`, `Example:`, ...) once the current chunk has passed a
   soft size target, so a numbered exercise is never cut in half. A hard
   character cap is the fallback for a block with no numbered breaks (e.g.
   a long reading passage) — it still only ever splits at a line boundary.
5. **Classify** (`CambridgeChunkClassifierAdapter.classify`, run with
   bounded concurrency — 5 at a time by default) — one Structured Outputs
   call per chunk. See §8 for what "never invents metadata" means in
   practice.
6. **Embed** (`OpenAIEmbeddingClient.embed`) — **one batched call** for
   every chunk in the document (`text-embedding-3-small` by default,
   overridable via `OPENAI_EMBEDDING_MODEL`).
7. **Persist** — a single `dataSource.transaction(...)` creates the
   `cambridge_sources` row and bulk-inserts every `cambridge_knowledge_items`
   row. If the item count actually persisted doesn't match the number of
   chunks sent, the whole transaction throws (`PERSISTENCE_INCONSISTENCY`)
   and rolls back — never a source row with a partial/missing chunk set.

## 5. Idempotency & rollback

- **Idempotency** is checksum-based, not name/version-based — re-uploading
  the exact same file (even under a different `name`) is a no-op.
- **Rollback**: extraction, cleaning, chunking, classification and embedding
  all happen _before_ any transaction opens. The transaction itself only
  does two local writes (create source, bulk-insert items) — if either
  fails, Postgres rolls back both, so there's never a source row with zero
  or partial chunks sitting in the DB. Covered by
  `import-cambridge-knowledge.service.test.ts`'s rollback test, which uses a
  fake `DataSource.transaction` with real staging/commit semantics (a
  failure inside `work()` never merges into the "committed" store) — not
  just a spy asserting the fake was called.

## 6. Search

`SearchCambridgeKnowledgeService` combines two layers:

1. **Metadata filters** (`paperCode`, `partCode`, `skill`, `topic`) — plain
   SQL `WHERE`/array-containment clauses in
   `CambridgeKnowledgeItemsRepository.search`, always scoped to
   `cambridge_sources.status = 'active'` (an inactive source's chunks are
   structurally excluded from every search, not filtered out after the
   fact).
2. **Semantic ranking** (optional `query`) — the query string is embedded
   with the same `EmbeddingClient`, and every candidate row is ranked by
   cosine similarity **in application code**, not in SQL. Without a
   `query`, results are still metadata-filtered, just ordered by recency
   instead of relevance (`relevanceScore: 0`).

A search result never includes the embedding vector — the response DTO
(`CambridgeKnowledgeSearchResult`) simply has no `embedding` field, so
there's nothing to remember to strip.

**Why cosine similarity in JS instead of `pgvector`:** this app's Postgres
has no verified `pgvector` extension, and the Knowledge Base is a curated,
admin-only B2 First corpus — small enough (expected: low thousands of
chunks) that ranking in application code is fast and adds zero new
infrastructure dependency. `CambridgeKnowledgeItemsRepository` caps a single
search at 1000 candidate rows before ranking. If the corpus ever grows well
past that, migrating `embedding` to a real `pgvector` column is the natural
next step — nothing else in this design has to change, since the search
service already treats "how candidates are ranked" as its own concern
separate from "how candidates are fetched".

## 7. Embeddings

- Provider: OpenAI, via `OpenAIEmbeddingClient` (`text-embedding-3-small`
  by default).
- One request per import (all chunks batched into a single
  `embeddings.create({ input: string[] })` call), one request per search
  query.
- Stored as `jsonb` (`number[]`), not `pgvector` — see §6.
- The embedding model id is recorded in `metadata.embeddingModel` so a
  future re-embedding migration can tell which rows used which model
  (never mix cosine-similarity comparisons across two different embedding
  models).

## 8. Security & traceability

- **No PII, no user data** anywhere in either table — the Knowledge Base is
  global.
- **`metadata` (JSONB) is guarded** by `isSafeCambridgeMetadata`
  (`lib/cambridge-jsonb-validators.ts`), which rejects a write containing an
  API key, a full prompt, or a raw provider response body — enforced at the
  repository boundary, the only place a JSONB column's shape can actually be
  checked.
- **Classification never invents metadata.** `validateClassification`
  (`classify-cambridge-chunk.ts`) cross-checks the LLM's `paperCode`/
  `partCode` against `PRACTICE_EXAM_CATALOG` (the same real, Cambridge-
  verified catalog Practice generation validates against) and `skills`/
  `topics` against fixed known lists. Anything outside those lists is
  **dropped, never kept** — a paper/part that can't be verified becomes
  `null`, not a guess. Covered by `classify-cambridge-chunk.test.ts`.
- **Every chunk is traceable.** `source_id` (FK, cascade-delete) and
  `source_page` (1-based, never null) mean any chunk surfaced by search can
  always be traced back to the exact document and page it came from — the
  search DTO's `sourceName`/`sourcePage` fields expose exactly that.
- **Admin-only.** Every `/admin/cambridge-knowledge/*` endpoint requires a
  JWT whose `role` is `UserRole.ADMIN` (`lib/admin-auth.ts`,
  `getAuthenticatedAdminPayload`). A non-admin, authenticated user gets the
  same `401` an unauthenticated request gets — there's no distinct
  "authenticated but forbidden" response to probe for.

## 9. How Daily Lesson / Practice / Mocks should consume this later

None of these exist yet (out of scope for this PR) — this is guidance for
whoever builds them next:

- Inject `SearchCambridgeKnowledgeService` (built via
  `buildCambridgeKnowledgeServices()` in `cambridge-knowledge-composition.ts`,
  same DI pattern every other module here uses) into the new
  generation service.
- Before calling the LLM, run 1-2 searches scoped to the exam
  part/skill/topic the feature is generating for (e.g. Daily Lesson picks a
  topic from `EXAM_TOPICS`, searches `{ topic, skill }`, and folds the top
  N chunks' `content` into the prompt as grounding context — the same
  "inject real material, don't trust the model's memory" idea this whole
  module exists for).
- Never forward a chunk's raw `content` back out to the end user verbatim
  without attribution if licensing requires it — that's a product decision
  for whoever builds the consuming feature, not something this
  infrastructure enforces.
- Reuse `EXAM_TOPICS` (`lib/exam-topics.ts`) as the shared topic vocabulary
  for whatever "pick a topic for today's lesson" logic Daily Lesson ends up
  needing — the Knowledge Base's `topics` column is already constrained to
  that exact bank, so a search by topic reliably finds matching material.

## 10. How to import a new source

There is no admin UI in this PR — import via the API directly (e.g. from a
small script, Postman, or `curl`):

```bash
curl -X POST https://<api>/admin/cambridge-knowledge/sources \
  -H "Authorization: Bearer <admin JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "B2 First Handbook 2024",
    "description": "Official Cambridge handbook for teachers",
    "version": "2024",
    "fileBase64": "<base64-encoded PDF bytes>"
  }'
```

- `fileBase64` is the raw PDF, base64-encoded — not multipart. Every other
  endpoint in this API parses a plain JSON body; this keeps that
  consistency instead of adding a multipart-parsing dependency for an
  admin-only path.
- Re-running the exact same request (same file bytes) is safe — see §5.
- `GET /admin/cambridge-knowledge/sources` lists every imported source (id,
  name, version, status, pageCount, timestamps) — use it to confirm an
  import landed and to get a source's id for a future "deactivate this
  source" admin action (not implemented in this PR — `status` exists on the
  model and migration, but no endpoint flips it yet).
- `POST /admin/cambridge-knowledge/search` — same request shape as
  `SearchCambridgeKnowledgeFilters` (`query`, `paperCode`, `partCode`,
  `skill`, `topic`, `limit`) — useful for manually sanity-checking an
  import's classification/chunking quality right after uploading it.

### Known limitation — large PDFs and the synchronous import endpoint

`POST /admin/cambridge-knowledge/sources` classifies every chunk with its
own LLM call (bounded to 5 concurrent) and does this all inside one Lambda
invocation. The Lambda timeout is set to the platform max (900s), but
`httpApi` itself still enforces a ~29s hard timeout regardless of the
function's own setting. For the small/medium PDFs this PR targets (a
handbook chapter, a sample paper — tens of chunks) this is fine; a document
producing hundreds of chunks will not finish inside that window. The real
fix — an async pipeline (e.g. SQS + a worker Lambda, with the admin polling
`GET .../sources` for completion) — is explicitly out of scope here; see
the PR's "Riesgos" section.
