import type { WeakestExamPart } from '../../services/progress/resolve-weakest-exam-part';

/**
 * Turns "this learner is weakest at X" into an instruction the session
 * generator can actually act on.
 *
 * The constraint worth understanding: a Daily Session is always a reading
 * passage plus comprehension questions plus a sentence-production task. That
 * format is fixed, so it cannot literally serve a Use of English Part 4
 * exercise. What it CAN do is aim its two flexible halves at the sub-skill
 * the weak part exercises:
 *
 *   - the comprehension questions, for the Reading parts
 *   - the sentence-production targets, for the Use of English parts, which is
 *     a genuinely good fit — producing a sentence around a given word is the
 *     same muscle as word formation, transformations and collocation
 *
 * Anything with no honest mapping (Writing, Listening) returns null, and the
 * session falls back to a varied random topic. Pretending a reading lesson
 * trains Listening would be worse than not adapting at all.
 */
const FOCUS_BY_SECTION_SLUG: Record<string, string> = {
  'uoe-part-1':
    'Lean the sentence-production task towards precise lexical choice and collocation: pick target words whose near-synonyms differ by register or common partner words.',
  'uoe-part-2':
    'Lean the sentence-production task towards grammatical accuracy in open cloze territory: pick target words that force articles, prepositions, auxiliaries or fixed grammatical patterns.',
  'uoe-part-3':
    'Lean the sentence-production task towards word formation: pick target words that must be derived (prefix or suffix) to fit naturally, so the learner practises building the right form.',
  'uoe-part-4':
    'Lean the sentence-production task towards structural paraphrase: pick target words that commonly appear in key-word transformations, and prefer sentence contexts where more than one structure could express the same idea.',
  'reading-part-5':
    'Lean the comprehension questions towards inference, attitude and the writer\'s opinion rather than surface facts.',
  'reading-part-6':
    'Lean the comprehension questions towards text cohesion: reference words, linkers and how ideas connect across paragraphs.',
  'reading-part-7':
    'Lean the comprehension questions towards locating specific information quickly across the passage, rather than deep interpretation of one paragraph.',
};

export interface DailySessionFocus {
  /** Prompt instruction describing what to emphasise. */
  instruction: string;
  /** Persisted so the client can say WHY today's session looks like this. */
  sectionSlug: string;
  sectionName: string;
  averageScore: number;
}

export function resolveDailySessionFocus(
  weakest: WeakestExamPart | null,
): DailySessionFocus | null {
  if (weakest === null) return null;

  const instruction = FOCUS_BY_SECTION_SLUG[weakest.sectionSlug];
  if (instruction === undefined) return null;

  return {
    instruction,
    sectionSlug: weakest.sectionSlug,
    sectionName: weakest.sectionName,
    averageScore: weakest.averageScore,
  };
}

/** What the prompt receives when there is nothing to adapt to. */
export const NO_FOCUS_INSTRUCTION =
  'No specific weak area to target — cover the topic in a balanced way.';
