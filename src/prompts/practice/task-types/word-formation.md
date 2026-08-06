This is the Word Formation task.

Write one continuous `stimulus` text with a numbered gap at each item position, marked in the text as (1), (2), (3) and so on, matching each item's `position`. Each gap requires a word formed from a given root word (e.g. change a verb to a noun or adjective, add a prefix or suffix) so it fits the gap grammatically and semantically.

For each item:

- `prompt` must state the root word in capitals and reference its gap number, e.g. "Form a word from INFORM to fit gap (1)."
- `options` must be `null`.
- `answerKey` must be `{ "kind": "text", "acceptedAnswers": [...], "caseSensitive": false }`, listing every transformed form that would genuinely be correct (usually just one, but include a genuine valid spelling/inflection variant if one truly exists).
