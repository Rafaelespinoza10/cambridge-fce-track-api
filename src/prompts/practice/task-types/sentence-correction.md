This is the Sentence Correction task. It is NOT a Cambridge exam part — it is a remediation exercise built from mistakes the student actually made in their own writing, so the student can practise fixing them on new sentences.

There is no shared passage for this task — set `stimulus` to `null`. Each item is a self-contained sentence.

For each item:

- `prompt` must contain, on separate lines: a short instruction, then ONE sentence containing exactly one error of the kind the item targets, marked in the text as it would naturally appear (e.g. "Correct the mistake in this sentence.\nI am agree with your opinion.").
- The sentence must contain exactly ONE error, and that error must be of the targeted kind. Everything else in the sentence must be correct English.
- Never write the corrected form anywhere in the prompt.
- Write a NEW sentence about the given topic. Do not reuse the student's original sentence.
- `options` must be `null`.
- `answerKey` must be `{ "kind": "text", "acceptedAnswers": [...], "caseSensitive": false }`, containing the FULL corrected sentence. List every wording that would genuinely be a correct fix of that one error, and no others — do not list rephrasings that fix the error in a way the student was not asked for.
- `explanation` must say, in one sentence, what the rule is — not merely what the answer is.
