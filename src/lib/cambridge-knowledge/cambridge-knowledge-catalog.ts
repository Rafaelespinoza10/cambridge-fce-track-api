import { TargetExam } from '@models/enums';
import { isPracticePaperCode, isPracticePartCode } from '@lib/practice/practice-exam-catalog';
import { EXAM_TOPICS } from '@lib/shared/exam-topics';

/**
 * Validation catalog for Cambridge Knowledge Base classification (see
 * classify-cambridge-chunk.ts). Every value here is either the exam code
 * this Knowledge Base is scoped to (B2 First only, per the PR spec) or
 * reused from an existing, already-verified catalog — nothing here is
 * invented:
 *
 *  - paperCode/partCode reuse PRACTICE_EXAM_CATALOG (practice-exam-catalog.ts),
 *    the same real, Cambridge-verified Paper 1-4 / Part 1-7 structure
 *    Practice generation already validates against.
 *  - skills mirrors config/seed/data/skills.ts's slugs exactly (mechanically,
 *    not from memory — same relationship practice-exam-catalog.ts has to
 *    exam-sections.ts).
 *  - topics reuses lib/exam-topics.ts's EXAM_TOPICS bank, so a Knowledge
 *    Base chunk and an AI-generated Practice/Writing task always draw on the
 *    same topic vocabulary.
 */

export const CAMBRIDGE_EXAM_CODE = TargetExam.B2_FIRST;

export const CAMBRIDGE_SKILL_SLUGS = [
  'reading',
  'use-of-english',
  'writing',
  'listening',
  'speaking',
] as const;

export type CambridgeSkillSlug = (typeof CAMBRIDGE_SKILL_SLUGS)[number];

export function isCambridgeSkillSlug(value: unknown): value is CambridgeSkillSlug {
  return (
    typeof value === 'string' &&
    (CAMBRIDGE_SKILL_SLUGS as readonly string[]).includes(value)
  );
}

export function isCambridgeTopic(value: unknown): value is string {
  return typeof value === 'string' && (EXAM_TOPICS as readonly string[]).includes(value);
}

export function isCambridgePaperCode(paperCode: string): boolean {
  return isPracticePaperCode(CAMBRIDGE_EXAM_CODE, paperCode);
}

export function isCambridgePartCode(paperCode: string, partCode: string): boolean {
  return isPracticePartCode(CAMBRIDGE_EXAM_CODE, paperCode, partCode);
}
