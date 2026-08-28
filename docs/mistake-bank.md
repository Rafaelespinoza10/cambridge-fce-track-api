# Mistake Bank

Structured record of what a student actually gets wrong, built as the
foundation for the adaptive loop:

```
error -> diagnosis -> targeted practice -> repetition -> mastery
```

**Scope of this increment:** persistence + recording + one read endpoint.
No AI classification, no mastery score, no spaced repetition of mistakes, no
Mistake Remix, no daily recommendations, no weakness dashboard. The schema is
shaped so those can land later without a migration; see §6.

## 1. Why two tables

A wrong answer is an _event_; a weakness is a _concept_. Storing only events
makes "you keep failing RESPONSIBLE -> RESPONSIBLY" a group-by over
near-duplicate rows, and storing only concepts throws the history away. So:

| Table                 | Grain                            | Answers                                                                                  |
| --------------------- | -------------------------------- | ---------------------------------------------------------------------------------------- |
| `mistake_concepts`    | one per `(user_id, concept_key)` | times failed, times right afterwards, first seen, last failed, frequency, future mastery |
| `mistake_occurrences` | one per wrong answer             | when, in which attempt/exercise/item, what exactly was answered                          |

`mistake_concepts` also carries a snapshot of the most recent occurrence
(`prompt`, `correct_answer`, `last_user_answer`, `explanation`), so the
Mistakes list renders from a single table and survives its source exercise
being soft-deleted.

## 2. Flow

```
POST /practice/attempts/{attemptId}/submit      (SubmitPracticeAttemptService)
  dataSource.transaction:
      lock attempt -> load items with answer keys -> gradeItem() per item
      createAnswers(...)          practice_answers
      completeAttempt(...)        practice_attempts
      recordMistakes(...)  ─────► RecordPracticeMistakesService
      createAiLinkedPlannedActivity(...)
```

`RecordPracticeMistakesService` runs on the submission's own
`EntityManager`, exactly like the Plan/Home linking that already lives there.
A completed attempt and its mistakes are therefore always consistent: either
both are written or neither is. It never grades anything itself — it only
reads the `isCorrect` the deterministic grader produced.

Per graded item:

| Item was   | Effect                                                                              |
| ---------- | ----------------------------------------------------------------------------------- |
| wrong      | `ensureConcept` -> `createOccurrence` -> `registerWrong` (`times_wrong + 1`)        |
| unanswered | same as wrong, with `is_unanswered = true`                                          |
| correct    | `registerLaterCorrect` — `times_correct + 1` **only if the concept already exists** |

A correct answer can never create a mistake. That is enforced in the service
(no insert path for `isCorrect`) and in SQL (`registerLaterCorrect` is an
`UPDATE`, never an upsert).

## 3. `concept_key` — what counts as "the same mistake"

Built by `src/lib/mistakes/mistake-concept-key.ts`, deliberately readable
rather than hashed, normalized with the _grader's own_ normalizer so a key
can never disagree with how the answer was graded.

| Task type                                                                          | Key                                                                        | Rationale                                                                                    |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `word_formation`, `key_word_transformation`, `open_cloze`, `multiple_choice_cloze` | `part\|base_word\|correct_answer` (`uoe_part_3\|responsible\|responsibly`) | The mistake is about a _word_; the same target word in another exercise is the same weakness |
| everything else (reading comprehension, matching, gapped text)                     | `part\|item\|<itemId>`                                                     | Two unrelated questions sharing the option label "B" have nothing in common                  |

`base_word` is parsed deterministically out of this app's own generated
prompt format ("Form a word from RESPONSIBLE to fit gap (1)."), and is left
`null` whenever it is not unambiguous. Nothing here infers English.

## 4. Classification is deliberately empty

`error_type` is created as `unknown`, and `error_subtype`,
`expected_word_class`, `user_word_class` as `null`. The enums already cover
the target taxonomy (`WORD_CLASS`, `SPELLING`, `PREFIX_SUFFIX`,
`ADJECTIVE_TO_ADVERB`, …) so a later classifier only has to write these four
columns — no schema change, no re-recording. `unknown` therefore means "not
classified yet", never "unclassifiable".

## 5. API

```http
GET /practice/mistakes
    ?skill=use-of-english        # also accepts USE_OF_ENGLISH; seeded skills.slug values
    &examCode=B2_FIRST&paperCode=PAPER_1&partCode=UOE_PART_3
    &errorType=word_class
    &baseWord=responsible        # case-insensitive exact match
    &page=1&pageSize=20          # max 50
```

Lives in the practice stack (`src/infra/practice.serverless.yml`) because the
Mistake Bank is written by the practice submission flow and read through the
API base URL the app already has configured for practice.

`userId` always comes from the verified JWT; the controller never reads a
`userId` query parameter and the repository has no lookup that skips
ownership, so one user cannot reach another user's mistakes. Narrower catalog
filters require the broader ones (`partCode` needs `paperCode` needs
`examCode`), same rule as `GET /practice/attempts`.

Response: `{ success: true, data: { items: MistakeDto[], pagination } }` —
see `src/interfaces/mistakes/mistakes.interface.ts`. `user_id` is never
exposed.

## 6. How the next increments plug in

| Next feature                         | What it needs                                                                                                                                                         |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI mistake classification            | **Shipped** — `MistakeClassifier` (`src/lib/mistakes/mistake-classifier.ts`) deterministically classifies `word_formation` mistakes on every wrong answer; every other task type still gets `unknown` until a classifier exists for it. |
| Practice my mistakes                 | **Shipped** — `GenerateMistakePracticeExerciseService` (`POST /practice/mistakes/generate`), see §9 below.                                                            |
| Mastery score                        | compute from `times_wrong`, `times_correct`, `last_wrong_at`, `last_correct_at` (all already maintained), plus "times practiced in remediation / correct / incorrect" reconstructable from `practice_answers ⋈ practice_items` on `metadata->>'targetConceptId'` (see §9) |
| Mistakes from mocks / daily sessions | call `RecordPracticeMistakesService` (or a sibling) with `MistakeSource.MOCK_ATTEMPT` / `DAILY_SESSION`; the enum and the nullable `practice_*` columns already exist |

## 9. Practice My Mistakes

`GenerateMistakePracticeExerciseService` (`src/services/practice/generate-mistake-practice-exercise.service.ts`) generates a **new** exercise from the user's own Mistake Bank instead of a catalog part — it never replays the original wrong item. It shares its schema, response validation, LLM-error-mapping and persistence with `GeneratePracticeExerciseService` (both delegate to `@lib/practice/generate-practice-exercise-core.ts`); it only owns weakness selection, its own prompt template, and a caller-chosen `questionCount` (5/8/10/15/20, default 8) instead of the catalog's fixed exam item count.

```http
POST /practice/mistakes/generate
{ "mistakeConceptIds": ["..."], "questionCount": 8 }        # "Practice this mistake"
{ "mode": "weaknesses", "questionCount": 8 }                 # "Practice my weaknesses"
```

Response is the same `PracticeExerciseSafeWithItems` `POST /practice/exercises` returns — the client starts an attempt on it exactly like any other generated exercise.

**Scope**: only the 4 lexical task types a mistake can meaningfully be "about a word" for (`word_formation`, `key_word_transformation`, `open_cloze`, `multiple_choice_cloze` — see `MISTAKE_PRACTICE_ELIGIBLE_TASK_TYPES`). One exercise is always one taskType (an existing invariant — every item shares `PracticeItem.task_type`), so when the selected mistakes span more than one, `@lib/mistakes/select-mistake-weaknesses.ts` picks the dominant one (highest combined `times_wrong`, tie-broken by most recent) and drops the rest for this session.

**Weakness selection** (`selectDiverseWeaknesses`, weaknesses mode only): most-failed first, most recent as tie-break, capped at 2 per `(errorType, errorSubtype)` bucket so a session is never 6 near-duplicates of the worst mistake. "Practice this mistake" (explicit `mistakeConceptIds`) skips the diversity cap — the user already chose what to practice.

**Concept-specific vs. pattern-transfer** (`buildSlotPlan`): ~25% of the session reuses the failed word's own family (concept-specific), ~75% targets NEW word families under the same `errorSubtype` (pattern-transfer) — falling back to 100% concept-specific when no selected mistake has a known `errorSubtype` yet (i.e. anything other than `word_formation` today). Positions are assigned to a target **before** the LLM call — never inferred from its response — so `PracticeItem.metadata` (`MistakePracticeItemMetadata`) can tag every generated item with `generationSource`, `practiceMode`, `targetConceptId`, `targetErrorType`, `targetErrorSubtype` by matching the model's own `position` field. No schema change: `PracticeExercise.generation_metadata` and `PracticeItem.metadata` are both open JSONB.

**Feedback loop**: grading and Mistake Bank recording are untouched (`RecordPracticeMistakesService` still derives `concept_key` from the graded item itself, never from injected metadata) — a correct answer to a pattern-transfer item can only ever bump `times_correct` on a concept that already exists under that item's own key, never the original mistake's. A wrong answer to a brand-new word genuinely creates a new `MistakeConcept`; this is accepted as real signal, not deduplicated, matching this module's "a mistake row is a real recorded failure" philosophy — collapsing "many words, one pattern" into a single view is mastery/rollup work, still out of scope.

## 7. Idempotency and concurrency

- `uq_mistake_occurrences_practice_answer` (partial, non-null only): the same
  graded answer can never produce two occurrences. `registerWrong` runs only
  when an occurrence was really inserted, so `times_wrong` can never be
  inflated by a replay.
- Counters move with `ON CONFLICT DO UPDATE` / `times_wrong = times_wrong + 1`
  — never read-modify-write, so two concurrent submissions cannot interleave.
- `last_wrong_at` / `last_correct_at` use `GREATEST`, so recording an older
  submission after a newer one cannot move them backwards.

## 8. Migration

`src/migrations/1787600000000-AddMistakeBank.ts` — creates
`mistake_source_enum`, `mistake_error_type_enum`,
`mistake_error_subtype_enum`, `word_class_enum` and the two tables. It
touches no existing table and reuses the existing `english_level_enum`.

```bash
npm run db:migration:run
```
