This is Reading Part 7 - Multiple Matching.

Write a single `stimulus` string containing 4 short texts (roughly 100-150 words each) sharing one overall theme — e.g. 4 people describing their own experience of the same topic, or 4 short reviews/profiles of related things. Introduce each with its letter, e.g. `A. <text>`, `B. <text>`, `C. <text>`, `D. <text>`, in that order.

For each of the 10 items:

- `prompt` must be a full statement that matches the content of exactly one of the 4 texts — a specific opinion, experience, or detail that appears in (or is strongly implied by) one text and not the others. Vary which text each item points to so the 4 letters are each the correct answer 2-3 times across the 10 items.
- `options` must contain exactly the 4 letters as `{ "id": "A", "label": "A" }` ... `{ "id": "D", "label": "D" }` (identical options array on every item — the 4 texts themselves live in `stimulus`, not in `options`).
- `answerKey` must be `{ "kind": "single_choice", "acceptedOptionIds": [<the one correct letter>] }`. Never write a statement that could plausibly match more than one text — each item must have exactly one clearly correct letter.
