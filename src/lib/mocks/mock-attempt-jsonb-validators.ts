import { isPracticeAnswerPayload } from '@lib/practice/practice-jsonb-validators';
import type {
  MockAttemptObjectiveAnswer,
  MockAttemptSectionAnswers,
} from '@models/mock-attempt-json-types';

/**
 * Pure type guards for mock_attempt_sections.answers — Postgres cannot
 * validate a JSONB column's internal shape, so the service/repository must
 * run these before persisting anything. Mirrors the guard-before-persist
 * discipline in lib/practice/practice-jsonb-validators.ts.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export function isMockAttemptObjectiveAnswer(
  value: unknown,
): value is MockAttemptObjectiveAnswer {
  if (!isPlainObject(value)) return false;
  if (!isNonEmptyString(value.itemId)) return false;
  if (!isPracticeAnswerPayload(value.answer)) return false;
  if (
    value.responseTimeMs !== undefined &&
    value.responseTimeMs !== null &&
    (typeof value.responseTimeMs !== 'number' || value.responseTimeMs < 0)
  ) {
    return false;
  }
  return true;
}

export function isMockAttemptSectionAnswers(value: unknown): value is MockAttemptSectionAnswers {
  if (!isPlainObject(value)) return false;

  if (value.kind === 'objective') {
    return Array.isArray(value.answers) && value.answers.every(isMockAttemptObjectiveAnswer);
  }
  if (value.kind === 'writing') {
    return typeof value.content === 'string';
  }
  return false;
}
