import type {
  MistakeSlotPlan,
  MistakeSlotPlanEntry,
} from '@lib/mistakes/select-mistake-weaknesses';

/**
 * Renders a MistakeSlotPlan into the text block the generation prompt
 * injects as `{{weaknessesContext}}` — one line per item position, so the
 * model can't misassign a target to the wrong item. Never states the
 * correct answer as part of an item's own prompt; the anti-repetition rules
 * from the PR spec are appended once, not per line.
 */
export function buildMistakePracticeContext(
  plan: MistakeSlotPlan,
  /**
   * Spaced retesting only: lexical families this student has already been
   * drilled on for these patterns. A retention check that reuses them would
   * measure memory of those words rather than the pattern itself.
   */
  avoidWords: string[] = [],
): string {
  const lines = plan.entries.map(describeEntry);
  const avoidLine =
    avoidWords.length === 0
      ? []
      : [
          '',
          'Do NOT build items around these word families - the student has already ' +
            `practised them: ${avoidWords.join(', ')}.`,
        ];
  return [
    'Student weaknesses this session must target, by item position (position = the 1-based `position` field in your JSON response):',
    ...lines,
    '',
    'Generate NEW examples that test the same grammatical or lexical transformation.',
    'Do not reuse the original sentence.',
    'Avoid reusing the original base word unless necessary.',
    'Test transfer of the underlying pattern, not memorization of one word.',
    'Never state or hint at the correct answer inside an item\'s own prompt text.',
    ...avoidLine,
  ].join('\n');
}

function describeEntry(entry: MistakeSlotPlanEntry): string {
  const pattern = entry.targetErrorSubtype ?? entry.targetErrorType;

  if (entry.practiceMode === 'concept_specific') {
    return (
      `Position ${entry.position} (concept-specific): practice the SAME concept as a past ` +
      `mistake — base word "${entry.baseWord ?? 'n/a'}", correct answer "${entry.correctAnswer}" ` +
      `(pattern: ${pattern}). You may reuse this word family (e.g. other forms of the same root), ` +
      'but never repeat the exact original sentence.'
    );
  }

  return (
    `Position ${entry.position} (pattern-transfer): practice the GENERAL pattern "${pattern}" ` +
    `using a NEW, different word family the student may not have failed before — do not reuse ` +
    `"${entry.baseWord ?? entry.correctAnswer}" or "${entry.correctAnswer}" unless no other ` +
    'reasonable word fits the topic.'
  );
}
