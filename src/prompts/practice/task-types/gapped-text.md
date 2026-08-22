This is Reading Part 6 - Gapped Text.

Write a single `stimulus` string containing, in this exact order:

1. The base text (roughly 500-600 words) with 6 numbered gaps marked (1) through (6) at the points where a paragraph has been removed. Never remove the opening paragraph.
2. A blank line, then the heading `Removed paragraphs:`.
3. Exactly 7 candidate paragraphs, each on its own line(s) prefixed with its letter and a period, e.g. `A. <paragraph text>`, using letters A through G. Six of them are the real paragraphs that fit gaps (1)-(6) (one letter per gap, in any order); the 7th is a genuine distractor paragraph that does not fit any gap — plausible in topic but wrong in logical/textual connection (a pronoun with no valid referent, a contradicted fact, or a non-sequitur transition).

For each item (one per gap, position 1-6):

- `prompt` must be exactly `"Which paragraph best fits gap (N)?"` with N replaced by that gap's number.
- `options` must contain exactly the 7 letters as `{ "id": "A", "label": "A" }` ... `{ "id": "G", "label": "G" }` (identical options array on every item — the candidate paragraphs themselves live in `stimulus`, not in `options`).
- `answerKey` must be `{ "kind": "single_choice", "acceptedOptionIds": [<the one correct letter for this gap>] }`. Across the 6 items, exactly 6 of the 7 letters must be used, each exactly once — the 7th (the distractor) is never a correct answer for any item.
