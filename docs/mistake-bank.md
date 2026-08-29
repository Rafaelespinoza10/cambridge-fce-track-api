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

| Next feature                         | What it needs                                                                                                                                                                                                                           |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI mistake classification            | **Shipped** — `MistakeClassifier` (`src/lib/mistakes/mistake-classifier.ts`) deterministically classifies `word_formation` mistakes on every wrong answer; every other task type still gets `unknown` until a classifier exists for it. |
| Practice my mistakes                 | **Shipped** — `GenerateMistakePracticeExerciseService` (`POST /practice/mistakes/generate`), see §9 below.                                                                                                                              |
| Mastery / weakness score             | **Shipped** — `GET /practice/weaknesses`, see §10 below.                                                                                                                                                                                |
| Mistake Remix                        | **Shipped** — `GenerateMistakeRemixExerciseService` (`POST /practice/mistakes/remix`), see §11 below.                                                                                                                                   |
| Mistakes from mocks / daily sessions | call `RecordPracticeMistakesService` (or a sibling) with `MistakeSource.MOCK_ATTEMPT` / `DAILY_SESSION`; the enum and the nullable `practice_*` columns already exist                                                                   |

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

## 10. Mastery / Weakness score

`GET /practice/weaknesses` rolls the Mistake Bank up into weakness
**patterns** — `(skill, part, errorType, errorSubtype)` — and scores each one
0-100 from its remediation evidence. RESPONSIBLE, CAREFUL, PROFESSIONAL and
EFFECTIVE all feed one `adjective_to_adverb` pattern; a different subtype
never contaminates it (`buildPatternKey`, `src/lib/mistakes/mistake-pattern.ts`).

**Nothing is persisted.** No table, no column, no snapshot: both sides are
aggregated in Postgres per request (`MistakeMasteryRepository`) — failures
from `mistake_concepts`/`mistake_occurrences`, remediation from
`practice_answers ⋈ practice_items` where `metadata->>'generationSource' =
'mistake_practice'`, bucketed per pattern and per the user's own local day.
The single schema change is one index (`idx_practice_answers_user_created`),
because `practice_answers` had none on `user_id` at all.

**The formula** (`src/lib/mistakes/mastery-score.ts`, every constant in
`MASTERY_CONSTANTS`):

```
score = clamp(100 × accuracyW × trust × staleness − failurePenalty, 0, 100)

w(a)      = 0.5 ^ (ageDays / 30)                  per-answer half-life
accuracyW = Σw(correct) / Σw(all)
trust     = 0.45 + 0.15·min(1, Σw(all)/8)         volume
                 + 0.20·min(1, families/3)        transfer
                 + 0.20·min(1, days/3)            repetition
staleness = max(0.6, 0.5 ^ (daysSinceLastPractice / 90))
penalty   = 15 × 0.5 ^ (daysSinceLastWrong / 14)
```

It never reads `MistakeConcept.times_correct`: that counter moves when the
same `concept_key` is answered right again, which says nothing about whether
the _pattern_ transfers to other words.

**Statuses**: `weak` 0-39, `learning` 40-69, `strong` 70-84, `mastered` 85+
**and** ≥3 distinct lexical families, ≥3 distinct practice days, and no
failure in the last 30 days. A pattern that clears the score but fails a gate
is capped at 84, so score and status never disagree. There is no `new`
status — `remediationAttempts === 0` already says it.

**Transfer** is measured on the _item's_ own lexical family, not the targeted
concept's: a pattern-transfer item deliberately uses a different word.
`MistakePracticeItemMetadata.itemBaseWord` records it at generation time
(deterministically, via `extractBaseWord` on the model's own prompt); items
generated before that field existed fall back to the answer the student
produced.

**Practice My Weaknesses** now ranks by mastery: `selectDiverseWeaknesses`
prefers the least-mastered pattern, with `times_wrong`/recency as tie-breaks,
so what the Weaknesses screen shows as worst is what a session targets.
"Practice this mistake" (explicit ids) is unchanged — the user already chose.

## 11. Mistake Remix

`GenerateMistakeRemixExerciseService`
(`src/services/practice/generate-mistake-remix-exercise.service.ts`) builds a
**mixed** adaptive mini-test instead of a single-pattern drill: several
weakness patterns plus plain, untargeted control items, interleaved so the
session never telegraphs which item is which. This is the difference from
Practice My Mistakes — that feature drills one chosen weakness; Remix checks
whether the student can recognize and resolve their weaknesses without being
told which pattern is being tested.

```http
POST /practice/mistakes/remix
{ "questionCount": 8 }        # Quick (default) | 15 = Challenge
```

Same response shape as every other generator (`PracticeExerciseSafeWithItems`),
same shared core (`@lib/practice/generate-practice-exercise-core.ts`) as
`GeneratePracticeExerciseService` and `GenerateMistakePracticeExerciseService`
— no second generation engine, no `mistakeConceptIds` (all weakness selection
happens server-side from the JWT user; there is nothing here for a client to
target with).

**Scope**: UoE Part 3 (Word Formation) only for v1 — the only part with
error subtypes, base words and mastery scoring today. Filtering is on
`WeaknessDto.partCode`, so widening to another part later is a config
change, not a rewrite.

**Weakness-pattern selection** (`@lib/mistakes/select-mistake-remix.ts`,
pure/DB-free): reuses `GET /practice/weaknesses`' own
`computeWeaknessProfiles` — the same weakest-first ranking the Weaknesses
screen shows. `weight = 100 - masteryScore`, tie-broken by most recent
failure; up to `MAX_REMIX_PATTERNS` (6) candidate patterns are considered.

**Composition**: `questionCount × 0.625` targeted, the rest neutral — 5/3 for
Quick (8), 9/6 for Challenge (15). Targeted slots are allocated by a
**weighted round-robin with a per-pattern cap** (`MAX_QUESTIONS_PER_PATTERN =
2`): walk the priority-ordered patterns, +1 slot per pattern per pass,
skipping any pattern already at the cap, until every targeted slot is placed
or no pattern can accept more. A shortfall (too few distinct weaknesses)
becomes extra neutral slots — never a fabricated pattern. With only one real
weakness, an 8-question Quick session comes out 2 targeted + 6 neutral;
with four weaknesses of decreasing mastery it reproduces `2/1/1/1 + 3
neutral` exactly. Zero weaknesses (or none in the supported part) is
rejected with `NO_ELIGIBLE_MISTAKES` — this is deliberately not "generate a
plain Part 3 exercise instead," since that would no longer be a Remix.

**Interleaving**: positions are assigned by round-robining across every
selected pattern plus one "neutral" group, skipping exhausted groups and
avoiding a same-group repeat when another group still has slots — so a
session reads like `targeted, neutral, targeted, targeted, neutral, ...`
rather than blocks. Best-effort only: when a single group is all that's
left, it fills the remaining slots even if that means two in a row.
Deterministic — same weakness data always produces the same plan.

**Blind practice**: nothing here is new work — `PracticeItemSafeDto` (what
the client receives before submitting) has no `metadata` field at all, so a
targeted item is indistinguishable from a neutral one until after grading.

**Metadata** (`MistakeRemixItemMetadata`) deliberately reuses
`targetErrorType`/`targetErrorSubtype`/`itemBaseWord` verbatim from
`MistakePracticeItemMetadata`, plus `questionRole: 'targeted' | 'neutral'`.
That reuse is what makes mastery integration a one-line change: `findRemediationDays`'s
`generationSource` predicate widened to
`IN ('mistake_practice', 'spaced_retest', 'mistake_remix')` — a targeted
correct answer counts as remediation evidence exactly like Practice My
Mistakes; a targeted wrong answer drags the pattern's accuracy down; a
neutral item (`targetErrorType IS NULL`) is excluded from the join with no
extra filtering. No second mastery score, no new formula.

**Neutral errors still create mistakes.** `RecordPracticeMistakesService`
never reads `PracticeItem.metadata` — every wrong answer in every submitted
attempt is graded and recorded the same way regardless of source, so a
missed neutral item can surface a brand-new weakness exactly like a normal
Part 3 attempt would.

**Results breakdown**: `PracticeAttemptItemResultDto.adaptiveMetadata`
(`src/lib/practice/practice-attempt-grading.ts`) carries the same four
fields through to the graded result — `null` for a plain catalog item — so
the client can group by role/pattern and compute targeted/neutral accuracy
by counting over data the backend already returned. Never a duplicated
mastery calculation; before/after mastery, if shown at all, is a client-side
diff of two `GET /practice/weaknesses` snapshots taken before and after the
session.

**Observability**: one structured `mistake_remix_generated` log line per
generation (`userId`, `exerciseId`, `questionCount`, `targetedCount`,
`neutralCount`, the selected patterns) — never the prompt or the raw LLM
response.

**Independent of spaced retesting.** Selection here reads only
`mistake_concepts`/`mistake_occurrences` and the mastery aggregation — never
`nextReviewAt`, `reviewStatus`, or any table/model spaced retesting owns.

## 12. Spaced retesting

The second half of the loop. Mastery answers "is this weakness being
corrected?"; spaced retesting answers the question that only time can:

```
mistake -> targeted practice -> mastery rises -> WAIT -> retest
        -> retention confirmed -> longer interval (or shorter)
```

`GET /practice/reviews` lists the user's scheduled retests (`status=due`,
`upcoming`, or `all`), most urgent first: overdue, then least-mastered, then
oldest due date. Generating one reuses Practice My Mistakes rather than
adding an endpoint — `POST /practice/mistakes/generate` with
`{ "mode": "retest", "reviewIds": [...] }` (omit `reviewIds` for everything
that is due). Completion has no endpoint at all: it happens inside the
existing submit, so a retest is graded exactly like any other attempt.

**Not SM-2.** No ease factor, no per-item state — a fixed ladder
(`src/lib/mistakes/retest-scheduler.ts`, every number in
`RETEST_CONSTANTS`):

```
ladder    [1, 3, 7, 14, 30] days
first     LEARNING 3 · STRONG 7 · MASTERED 14   (WEAK is never scheduled)
PASS      one rung up (capped at 30)
PARTIAL   same rung — retention neither confirmed nor lost
FAIL      3 days, or 1 if the pattern collapsed to WEAK
```

The 30-day cap is one `ANSWER_HALF_LIFE_DAYS`: the point where the evidence
behind a score has lost half its weight and the score starts sliding on its
own, and the same window MASTERED already uses for "no recent relapse".

**Eligibility**: `masteryScore >= 40 AND remediationCorrect >= 1`. A WEAK
pattern is one the student never learned, so there is nothing to have
forgotten — it goes to remediation, not to a retention test. A pattern that
falls back out of eligibility has its scheduled review cancelled (kept as
history, not deleted). MASTERED keeps being retested: mastered is not
permanent, and a failed retest is exactly how it stops being true.

**Grading a retest** (`gradeRetest`): `PASS` needs >= 80% correct **and >= 2
distinct lexical families**; `PARTIAL` >= 50%; `FAIL` below that. The family
gate is the point of the whole feature — answering
"responsible -> responsibly" right three times is memory of one word, not
retention of the pattern. It can only ever downgrade a PASS to a PARTIAL,
never to a FAIL, so a generator that ignored its "use new word families"
instruction costs the student nothing.

**Session size**: 3 items for one pattern, 2 each for a combined session,
capped at 3 patterns (6 items). One exercise is one taskType (an existing
invariant), so when the due patterns span several, the rest stay due.

**Mastery is untouched.** A retest is just more remediation evidence: its
answers are tagged `generationSource: 'spaced_retest'` and the mastery query
accepts them alongside `mistake_practice`, so there is exactly one score.
The scheduler only decides _when to look again_. Wrong answers in a retest
are recorded by `RecordPracticeMistakesService` like any other wrong answer,
which is what makes a failed retest visibly drop the score.

**One active review per pattern**, enforced by two partial unique indexes
(split rather than one `COALESCE(error_subtype::text, ...)` expression index
because casting a nullable enum is only STABLE, and index expressions must be
IMMUTABLE). Completed reviews stay as history: scheduled, completed, result,
interval used.

**Voluntary practice cannot postpone a retest.** Practising a weakness
before its review leaves the schedule alone; only a real retest moves the
ladder. `upsertScheduled` additionally uses `LEAST(existing, new)` on the due
date, so even a buggy caller can only ever pull a check-up closer.

**Everything is UTC.** `due_at` is stored and compared in UTC; "Today",
"in 3 days" and "2 days overdue" are the client's job in the device's own
zone. `due` / `upcoming` / `overdue` are derived from `due_at` against the
clock (`resolveTiming`), never stored — the only persisted states are
`scheduled`, `completed` and `cancelled`.

## 13. Classification beyond Word Formation

The Mistake Bank records every part; until now only Word Formation (UoE 3)
was ever _diagnosed_, so everything else collapsed into one `unknown` bucket
per part. `MistakeClassifier` is now a dispatcher that routes on task type.

| Part                          | Signal                            | Source          |
| ----------------------------- | --------------------------------- | --------------- |
| UoE 1 Multiple Choice Cloze   | none deterministic                | `ai`            |
| UoE 2 Open Cloze              | closed set of function words      | `deterministic` |
| UoE 3 Word Formation          | suffix/affix morphology           | `deterministic` |
| UoE 4 Key Word Transformation | the key word Cambridge hands over | `deterministic` |
| Writing                       | the grader's own `category`       | `ai`            |

**The subtype means something different per part**, deliberately:

- UoE 3 — the subtype IS the error (`adjective_to_adverb`).
- UoE 4 — the subtype is the **structure under test** (`passive`,
  `conditional`). That is what the key word deterministically reveals, and
  what targeted practice needs in order to generate more of the same. Two
  mechanical subtypes are the exception, because they are certainties about
  the answer rather than readings of it: `key_word_altered` (Cambridge
  forbids changing the key word) and `word_count` (the 2-5 word rule). Both
  outrank the structure — a broken rule is what to fix first.
- UoE 2 — the subtype is the **class the gap required** (`preposition`,
  `article`…), taken from the correct answer, not from whatever the student
  wrote.

Open Cloze is the one place a lookup table is not a compromise but the right
model: the answer is always a function word, and English has a finite
inventory of those. A lexical answer ("take", "way") resolves to null rather
than being forced into a class.

**Part 1 is the AI pass.** Telling a collocation from a phrasal verb from a
semantic nuance needs real lexical knowledge, so `POST
/practice/mistakes/classify` runs a second pass over concepts still marked
`unknown`. It is its own request on purpose — an LLM call has no business
holding a grading transaction open, and a submission must never fail because
a classification did. The model is offered only four categories plus
`unknown`, never the ones that belong to deterministic parts, and an
explicitly unconfident answer is discarded. Idempotent: only `unknown` rows
are ever written, so re-runs converge instead of churning.

## 14. Writing in the Mistake Bank

Writing enters through a different door, and the difference matters:

```
Practice:  closed answer key  →  a mistake is "you got THIS item wrong"
Writing:   free text          →  a mistake is "the grader rewrote THIS phrase"
```

There is no item, no `isCorrect`, no accepted-answers list — only
`WritingFeedback.corrections`, each already carrying a `category`. Those map
almost one-to-one onto `MistakeErrorType`; `punctuation` and `register` exist
precisely because Writing can produce them and Practice cannot, and `other`
becomes `unknown` rather than being forced into a category it does not fit.

`RecordWritingMistakesService` runs inside the submission's own transaction,
exactly like the Practice path, so a graded submission and the weaknesses it
revealed can never disagree. Every concept it writes is
`classification_source: 'ai'` — honest about the fact that an LLM decided it,
even though the category arrived pre-computed.

**Concepts are sparse here, by nature.** The same phrase is rarely written
twice, so most Writing concepts sit at `times_wrong: 1`. That is real signal
("you made 12 distinct grammar slips"), and the pattern rollup is where it
becomes a weakness. The concept key is built from the CORRECTED form, not the
original: two different wrong ways of writing "I agree" are one weakness.

**The loop closes through `sentence_correction`.** Writing weaknesses are
indexed by the **paper**, not by the part: every Writing mistake is filed
under the synthetic part code `WRITING` (`WRITING_PART_CODE`), and a mistake
is recorded under the task type that can _practise_ it
(`sentence_correction`), not the genre it came from.

That choice is what makes the loop possible at all. Mastery joins
remediation evidence to a weakness on `(partCode, errorType, errorSubtype)`,
while Practice maps a task type to one fixed part. Had Writing kept
`WRITING_PART_1`/`_2`, a single `sentence_correction` exercise could only
ever repair one of them and the other's evidence would land on a key no
mistake shares — silently, with nothing erroring. Indexing by paper is also
the truer model: a passive is a passive whether the student wrote an essay
or a report, and the genre changes the task, never which grammar needs
drilling.

The exercise itself gives the student a NEW sentence containing one error of
the same kind and asks them to fix it, graded against the corrected form by
the same deterministic text grader everything else uses. From there it is an
ordinary weakness: it feeds mastery, it can be practised, and it gets
retested on a schedule.

`writing-remediation-loop.test.ts` guards the one thing that would break this
without any test failing: the part code the weakness is filed under and the
part code the repair exercise is generated with must stay identical.
