import type { RemixPlan, RemixSlotPlanEntry } from '@lib/mistakes/select-mistake-remix';

/**
 * Renders a RemixPlan into the text block the generation prompt injects as
 * `{{remixContext}}` — one line per item position, so the model can't
 * misassign a target to the wrong item, plus the shared `avoidBaseWords`
 * preference. The student never sees any of this: PracticeItemSafeDto has no
 * metadata field at all, so this text only ever reaches the LLM.
 */
export function buildMistakeRemixContext(plan: RemixPlan): string {
  const lines = plan.entries.map(describeEntry);
  const avoidLine =
    plan.avoidBaseWords.length > 0
      ? `Avoid reusing these recently-failed words unless no other reasonable word fits: ${plan.avoidBaseWords.join(', ')}.`
      : null;

  return [
    'This is a MIXED adaptive session (Mistake Remix), not a single-pattern drill.',
    'Some items target a specific weakness pattern; others are neutral, ordinary Part 3 items with no targeting at all.',
    'Do not make the neutral items easier or harder than the targeted ones, and do not hint — in wording, topic, or difficulty — at which items are targeted.',
    '',
    'Student weaknesses this session must target, by item position (position = the 1-based `position` field in your JSON response):',
    ...lines,
    '',
    'For every targeted position: write a NEW item that tests the same grammatical pattern, using a different lexical family, sentence context, and semantic domain from the other targeted items — never reuse the exact original sentence.',
    'For every neutral position: write a standard, ordinary Cambridge B2 First Part 3 item on any suitable topic. Do not aim it at any of the patterns above, and do not avoid any particular word class either — it is a plain, untargeted item.',
    avoidLine,
    'Never state or hint at the correct answer inside an item\'s own prompt text.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

function describeEntry(entry: RemixSlotPlanEntry): string {
  if (entry.role === 'neutral') {
    return `Position ${entry.position} (neutral / control): ordinary Part 3 item, no targeting.`;
  }

  const pattern = entry.targetErrorSubtype ?? entry.targetErrorType;
  return (
    `Position ${entry.position} (targeted pattern: ${pattern}): base it on the transformation ` +
    `seen in "${entry.exampleBaseWord ?? 'n/a'}" -> "${entry.exampleCorrectAnswer ?? 'n/a'}", ` +
    'but use a DIFFERENT word family — never that exact word.'
  );
}
