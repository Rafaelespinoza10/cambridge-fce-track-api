import type { MistakeErrorType, MistakeErrorSubtype } from '@models/enums';

/**
 * A weakness *pattern* — the unit mastery is measured on. Many
 * MistakeConcepts (RESPONSIBLE, CAREFUL, PROFESSIONAL…) roll up into one
 * pattern (UOE_PART_3 / word_class / adjective_to_adverb), which is what the
 * adaptive side actually needs: getting one word right three times says
 * nothing about the transformation itself.
 */
export interface MistakePattern {
  skill: string;
  examCode: string;
  paperCode: string;
  partCode: string;
  errorType: MistakeErrorType;
  errorSubtype: MistakeErrorSubtype | null;
}

/**
 * Join key between the two sides of the aggregation: recorded failures come
 * from mistake_concepts, remediation evidence from practice_items.metadata
 * (`targetErrorType`/`targetErrorSubtype`) — neither knows about the other,
 * so both must produce the identical key.
 *
 * `partCode` is included because the same errorType can mean different work
 * in different parts; `skill`/`exam`/`paper` are not, since they are all
 * derivable from the part and would only add ways for the two sides to
 * disagree. A missing subtype is a legitimate bucket of its own (nothing
 * outside Word Formation is classified into subtypes yet), not a wildcard.
 */
export function buildPatternKey(input: {
  partCode: string;
  errorType: string;
  errorSubtype: string | null;
}): string {
  return `${input.partCode}|${input.errorType}|${input.errorSubtype ?? 'none'}`;
}
