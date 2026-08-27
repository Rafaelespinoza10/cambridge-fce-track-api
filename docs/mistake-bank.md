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
| AI mistake classification            | write `error_type` / `error_subtype` / `expected_word_class` / `user_word_class` on existing rows                                                                     |
| Mastery score                        | compute from `times_wrong`, `times_correct`, `last_wrong_at`, `last_correct_at` (all already maintained)                                                              |
| Practice my mistakes                 | read concepts ordered by weakness, feed `base_word` / `correct_answer` into generation                                                                                |
| Mistakes from mocks / daily sessions | call `RecordPracticeMistakesService` (or a sibling) with `MistakeSource.MOCK_ATTEMPT` / `DAILY_SESSION`; the enum and the nullable `practice_*` columns already exist |

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
