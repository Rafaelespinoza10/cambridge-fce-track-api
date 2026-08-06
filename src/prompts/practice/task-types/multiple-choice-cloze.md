This is the Multiple Choice Cloze task.

Write one continuous `stimulus` text with a numbered gap at each item position, marked in the text as (1), (2), (3) and so on, matching each item's `position`. Each gap is missing exactly one word.

For each item:

- `prompt` is a short instruction referencing its gap number, e.g. "Choose the best option for gap (1)."
- `options` must contain exactly 4 short options (single word or short phrase). All 4 must be plausible in isolation, but only one must fit the exact meaning, collocation, or grammar required by that specific gap in context. The other 3 must be genuine near-miss distractors (wrong collocation, wrong preposition, wrong register, or wrong meaning) — never obviously wrong or nonsensical.
- `answerKey` must be `{ "kind": "single_choice", "acceptedOptionIds": [<the one correct option's id>] }`.
