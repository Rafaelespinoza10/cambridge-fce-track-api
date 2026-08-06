This is the Key Word Transformation task.

There is no shared passage for this part — set `stimulus` to `null`. Each item is a self-contained sentence pair.

For each item:

- `prompt` must contain, on separate lines: the original sentence; the key word in capitals, unchanged; and the beginning of a second sentence with a gap that completes it with the same meaning as the original — matching the real Cambridge format (e.g. "She last visited Paris three years ago.\nBEEN\nShe **\_\_** Paris for three years.").
- The gap must require between 2 and 5 words to complete, and the key word must not be changed.
- `options` must be `null`.
- `answerKey` must be `{ "kind": "text", "acceptedAnswers": [...], "caseSensitive": false }`, listing only wordings that are genuinely, fully correct paraphrases — this task type typically has very few acceptable answers (often exactly one), so do not overgenerate loosely equivalent phrasings.
