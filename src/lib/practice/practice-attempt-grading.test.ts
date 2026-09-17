import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  normalizeTextAnswer,
  gradeItem,
  roundToTwoDecimals,
  computeFeedbackSummary,
  buildPracticeAttemptResultDto,
  formatAcceptedAnswers,
  formatUserAnswer,
  toAdaptiveMetadata,
} from './practice-attempt-grading';

// ── normalizeTextAnswer ──────────────────────────────────────────────────────

describe('normalizeTextAnswer', () => {
  it('trims and collapses internal whitespace', () => {
    assert.equal(normalizeTextAnswer('  has   been   ', true), 'has been');
  });

  it('lowercases when caseSensitive is false', () => {
    assert.equal(normalizeTextAnswer('BEEN', false), 'been');
  });

  it('preserves case when caseSensitive is true', () => {
    assert.equal(normalizeTextAnswer('BEEN', true), 'BEEN');
  });

  it('normalizes apostrophe variants to a single canonical apostrophe', () => {
    assert.equal(normalizeTextAnswer('hasn’t', false), "hasn't");
    assert.equal(normalizeTextAnswer('hasn´t', false), "hasn't");
    assert.equal(normalizeTextAnswer('hasn`t', false), "hasn't");
  });

  it('applies Unicode NFKC normalization', () => {
    // Fullwidth "A" (U+FF21) NFKC-normalizes to ASCII "A".
    assert.equal(normalizeTextAnswer('Ａ', true), 'A');
  });

  it('does not fix spelling or accept semantically similar answers', () => {
    assert.notEqual(normalizeTextAnswer('recieve', false), normalizeTextAnswer('receive', false));
  });
});

// ── gradeItem ────────────────────────────────────────────────────────────────

describe('gradeItem — single_choice', () => {
  const key = { kind: 'single_choice' as const, acceptedOptionIds: ['a'] };

  it('is correct when optionId is accepted', () => {
    const result = gradeItem(key, { kind: 'single_choice', optionId: 'a' });
    assert.deepEqual(result, { isCorrect: true, normalizedAnswer: 'a' });
  });

  it('is incorrect when optionId is not accepted', () => {
    const result = gradeItem(key, { kind: 'single_choice', optionId: 'b' });
    assert.equal(result.isCorrect, false);
  });

  it('is incorrect (not a crash) when the payload kind does not match the key kind', () => {
    const result = gradeItem(key, { kind: 'text', value: 'a' });
    assert.equal(result.isCorrect, false);
  });
});

describe('gradeItem — text', () => {
  const key = { kind: 'text' as const, acceptedAnswers: ["hasn't"], caseSensitive: false };

  it('is correct after normalization matches an accepted answer', () => {
    const result = gradeItem(key, { kind: 'text', value: ' HASN’T  ' });
    assert.equal(result.isCorrect, true);
    assert.equal(result.normalizedAnswer, "hasn't");
  });

  it('is incorrect for a genuinely different answer (no fuzzy matching)', () => {
    const result = gradeItem(key, { kind: 'text', value: 'has not' });
    assert.equal(result.isCorrect, false);
  });

  it('respects caseSensitive: true', () => {
    const csKey = { kind: 'text' as const, acceptedAnswers: ['Paris'], caseSensitive: true };
    assert.equal(gradeItem(csKey, { kind: 'text', value: 'paris' }).isCorrect, false);
    assert.equal(gradeItem(csKey, { kind: 'text', value: 'Paris' }).isCorrect, true);
  });
});

describe('gradeItem — unanswered', () => {
  it('is always incorrect regardless of the answer key kind', () => {
    const singleChoiceKey = { kind: 'single_choice' as const, acceptedOptionIds: ['a'] };
    const textKey = { kind: 'text' as const, acceptedAnswers: ['x'], caseSensitive: false };

    assert.deepEqual(gradeItem(singleChoiceKey, { kind: 'unanswered' }), {
      isCorrect: false,
      normalizedAnswer: null,
    });
    assert.deepEqual(gradeItem(textKey, { kind: 'unanswered' }), {
      isCorrect: false,
      normalizedAnswer: null,
    });
  });
});

// ── roundToTwoDecimals ───────────────────────────────────────────────────────

describe('roundToTwoDecimals', () => {
  it('rounds to 2 decimal places', () => {
    assert.equal(roundToTwoDecimals(66.66666666), 66.67);
    assert.equal(roundToTwoDecimals(100), 100);
    assert.equal(roundToTwoDecimals(0), 0);
  });
});

// ── computeFeedbackSummary ───────────────────────────────────────────────────

describe('computeFeedbackSummary', () => {
  it('aggregates correct/total per skill tag and computes percentage', () => {
    const summary = computeFeedbackSummary([
      { skillTags: ['prepositions'], isCorrect: true, isUnanswered: false },
      { skillTags: ['prepositions'], isCorrect: false, isUnanswered: false },
      { skillTags: ['collocations'], isCorrect: true, isUnanswered: false },
    ]);

    assert.equal(summary.version, 'practice-attempt-feedback-v1');
    assert.equal(summary.unansweredCount, 0);
    const prepositions = summary.skillBreakdown.find((s) => s.skillTag === 'prepositions');
    assert.deepEqual(prepositions, {
      skillTag: 'prepositions',
      correctCount: 1,
      totalCount: 2,
      percentage: 50,
    });
    const collocations = summary.skillBreakdown.find((s) => s.skillTag === 'collocations');
    assert.deepEqual(collocations, {
      skillTag: 'collocations',
      correctCount: 1,
      totalCount: 1,
      percentage: 100,
    });
  });

  it('counts unanswered items separately from the per-skill breakdown', () => {
    const summary = computeFeedbackSummary([
      { skillTags: ['prepositions'], isCorrect: false, isUnanswered: true },
      { skillTags: ['prepositions'], isCorrect: true, isUnanswered: false },
    ]);
    assert.equal(summary.unansweredCount, 1);
  });

  it('an item can contribute to multiple skill tags', () => {
    const summary = computeFeedbackSummary([
      { skillTags: ['prepositions', 'phrasal-verbs'], isCorrect: true, isUnanswered: false },
    ]);
    assert.equal(summary.skillBreakdown.length, 2);
  });

  it('returns an empty skillBreakdown for items with no skill tags', () => {
    const summary = computeFeedbackSummary([
      { skillTags: [], isCorrect: true, isUnanswered: false },
    ]);
    assert.deepEqual(summary.skillBreakdown, []);
  });

  it('never generates recommendations or an estimated level (no such fields exist)', () => {
    const summary = computeFeedbackSummary([]);
    assert.deepEqual(Object.keys(summary).sort(), ['skillBreakdown', 'unansweredCount', 'version']);
  });
});

// ── buildPracticeAttemptResultDto ───────────────────────────────────────────

describe('buildPracticeAttemptResultDto', () => {
  const attempt = {
    id: 'attempt-1',
    exercise_id: 'exercise-1',
    submitted_at: new Date('2026-01-01T00:05:00.000Z'),
    duration_seconds: 300,
    correct_count: 1,
    total_count: 2,
    percentage: '50.00',
    feedback_summary: {
      version: 'practice-attempt-feedback-v1',
      unansweredCount: 0,
      skillBreakdown: [],
    },
  } as unknown as import('@models/PracticeAttempt').PracticeAttempt;

  const items = [
    {
      id: 'item-2',
      position: 2,
      prompt: 'p2',
      options: null,
      answer_key: { kind: 'text', acceptedAnswers: ['been'], caseSensitive: false },
      explanation: 'e2',
      skill_tags: ['present-perfect'],
    },
    {
      id: 'item-1',
      position: 1,
      prompt: 'p1',
      options: [
        { id: 'a', label: 'alpha' },
        { id: 'b', label: 'beta' },
      ],
      answer_key: { kind: 'single_choice', acceptedOptionIds: ['a'] },
      explanation: 'e1',
      skill_tags: ['collocations'],
    },
  ] as unknown as import('@models/PracticeItem').PracticeItem[];

  const answers = [
    {
      item_id: 'item-1',
      answer_payload: { kind: 'single_choice', optionId: 'a' },
      normalized_answer: 'a',
      is_correct: true,
      response_time_ms: 1200,
    },
    {
      item_id: 'item-2',
      answer_payload: { kind: 'unanswered' },
      normalized_answer: null,
      is_correct: false,
      response_time_ms: null,
    },
  ] as unknown as import('@models/PracticeAnswer').PracticeAnswer[];

  it('orders items by position regardless of input order', () => {
    const dto = buildPracticeAttemptResultDto(attempt, items, answers);
    assert.deepEqual(
      dto.items.map((i) => i.itemId),
      ['item-1', 'item-2'],
    );
  });

  it('maps accepted option ids to their labels for single_choice', () => {
    const dto = buildPracticeAttemptResultDto(attempt, items, answers);
    assert.deepEqual(dto.items[0]?.acceptedAnswers, ['alpha']);
  });

  it('uses the literal accepted answers for text items', () => {
    const dto = buildPracticeAttemptResultDto(attempt, items, answers);
    assert.deepEqual(dto.items[1]?.acceptedAnswers, ['been']);
  });

  it('converts the stored numeric-as-string percentage to a real number', () => {
    const dto = buildPracticeAttemptResultDto(attempt, items, answers);
    assert.equal(dto.percentage, 50);
    assert.equal(typeof dto.percentage, 'number');
  });

  it('carries explanation and skillTags through from the item (post-completion reveal)', () => {
    const dto = buildPracticeAttemptResultDto(attempt, items, answers);
    assert.equal(dto.items[0]?.explanation, 'e1');
    assert.deepEqual(dto.items[0]?.skillTags, ['collocations']);
  });

  it('throws if a persisted answer is missing for an item (data-integrity guard)', () => {
    assert.throws(() => buildPracticeAttemptResultDto(attempt, items, [answers[0]!]));
  });

  it('throws if the attempt is not actually completed', () => {
    const inProgress = {
      ...attempt,
      submitted_at: null,
      duration_seconds: null,
    } as unknown as import('@models/PracticeAttempt').PracticeAttempt;
    assert.throws(() => buildPracticeAttemptResultDto(inProgress, items, answers));
  });
});

// ── formatAcceptedAnswers / formatUserAnswer ────────────────────────────────────
// Exported for reuse by GeneratePracticeErrorFlashcardDraftService, which
// needs a human-readable "what was correct" / "what the student answered"
// string to send as AI context — same reasoning as buildPracticeAttemptResultDto
// above, kept here so the two never drift on how an option id resolves to a
// label.

describe('formatAcceptedAnswers', () => {
  const singleChoiceItem = {
    id: 'item-1',
    options: [
      { id: 'a', label: 'alpha' },
      { id: 'b', label: 'beta' },
    ],
    answer_key: { kind: 'single_choice', acceptedOptionIds: ['a'] },
  } as unknown as import('@models/PracticeItem').PracticeItem;

  const textItem = {
    id: 'item-2',
    options: null,
    answer_key: { kind: 'text', acceptedAnswers: ['on', 'onto'], caseSensitive: false },
  } as unknown as import('@models/PracticeItem').PracticeItem;

  it('maps accepted option ids to their labels for single_choice', () => {
    assert.deepEqual(formatAcceptedAnswers(singleChoiceItem), ['alpha']);
  });

  it('falls back to the raw option id if the option is missing from the item', () => {
    const orphanKeyItem = {
      ...singleChoiceItem,
      answer_key: { kind: 'single_choice', acceptedOptionIds: ['zzz'] },
    } as unknown as import('@models/PracticeItem').PracticeItem;
    assert.deepEqual(formatAcceptedAnswers(orphanKeyItem), ['zzz']);
  });

  it('returns the literal accepted answers for text items (possibly more than one)', () => {
    assert.deepEqual(formatAcceptedAnswers(textItem), ['on', 'onto']);
  });
});

describe('formatUserAnswer', () => {
  const singleChoiceItem = {
    id: 'item-1',
    options: [
      { id: 'a', label: 'alpha' },
      { id: 'b', label: 'beta' },
    ],
  } as unknown as import('@models/PracticeItem').PracticeItem;

  const textItem = {
    id: 'item-2',
    options: null,
  } as unknown as import('@models/PracticeItem').PracticeItem;

  it('resolves a single_choice optionId to its option label', () => {
    assert.equal(
      formatUserAnswer(singleChoiceItem, { kind: 'single_choice', optionId: 'b' }),
      'beta',
    );
  });

  it('falls back to the raw optionId if the option is missing from the item', () => {
    assert.equal(
      formatUserAnswer(singleChoiceItem, { kind: 'single_choice', optionId: 'zzz' }),
      'zzz',
    );
  });

  it('returns the literal text value for a text answer', () => {
    assert.equal(formatUserAnswer(textItem, { kind: 'text', value: 'of' }), 'of');
  });

  it('renders an explicit placeholder for unanswered (never an empty string)', () => {
    assert.equal(formatUserAnswer(textItem, { kind: 'unanswered' }), '(no answer given)');
  });
});

// ── toAdaptiveMetadata ───────────────────────────────────────────────────────

describe('toAdaptiveMetadata', () => {
  it('returns null for a plain catalog item (no metadata at all)', () => {
    assert.equal(toAdaptiveMetadata(null), null);
    assert.equal(toAdaptiveMetadata(undefined), null);
  });

  it('returns null for metadata with an unrecognized generationSource', () => {
    assert.equal(toAdaptiveMetadata({ generationSource: 'something_else' }), null);
  });

  it('maps a Practice My Mistakes item, reading the role off practiceMode', () => {
    const result = toAdaptiveMetadata({
      generationSource: 'mistake_practice',
      practiceMode: 'pattern_transfer',
      targetErrorType: 'word_class',
      targetErrorSubtype: 'adjective_to_adverb',
      targetConceptId: 'concept-1',
      itemBaseWord: 'CAREFUL',
    });
    assert.deepEqual(result, {
      generationSource: 'mistake_practice',
      questionRole: 'pattern_transfer',
      targetErrorType: 'word_class',
      targetErrorSubtype: 'adjective_to_adverb',
    });
  });

  it('maps a Mistake Remix targeted item, reading the role off questionRole', () => {
    const result = toAdaptiveMetadata({
      generationSource: 'mistake_remix',
      questionRole: 'targeted',
      targetErrorType: 'word_class',
      targetErrorSubtype: 'adjective_to_adverb',
      itemBaseWord: 'CAREFUL',
    });
    assert.deepEqual(result, {
      generationSource: 'mistake_remix',
      questionRole: 'targeted',
      targetErrorType: 'word_class',
      targetErrorSubtype: 'adjective_to_adverb',
    });
  });

  it('maps a Mistake Remix neutral item, with null target fields', () => {
    const result = toAdaptiveMetadata({
      generationSource: 'mistake_remix',
      questionRole: 'neutral',
      targetErrorType: null,
      targetErrorSubtype: null,
      itemBaseWord: null,
    });
    assert.deepEqual(result, {
      generationSource: 'mistake_remix',
      questionRole: 'neutral',
      targetErrorType: null,
      targetErrorSubtype: null,
    });
  });

  it('never throws on a malformed/unexpected metadata shape', () => {
    assert.equal(toAdaptiveMetadata({ generationSource: 'mistake_remix' }), null);
    assert.equal(toAdaptiveMetadata({}), null);
  });
});

// ── buildPracticeAttemptResultDto — adaptiveMetadata ────────────────────────

describe('buildPracticeAttemptResultDto — adaptiveMetadata', () => {
  const attempt = {
    id: 'attempt-1',
    exercise_id: 'exercise-1',
    submitted_at: new Date('2026-01-01T00:05:00.000Z'),
    duration_seconds: 300,
    correct_count: 1,
    total_count: 1,
    percentage: '100.00',
    feedback_summary: {
      version: 'practice-attempt-feedback-v1',
      unansweredCount: 0,
      skillBreakdown: [],
    },
  } as unknown as import('@models/PracticeAttempt').PracticeAttempt;

  it('carries the item metadata through as adaptiveMetadata', () => {
    const items = [
      {
        id: 'item-1',
        position: 1,
        prompt: 'p1',
        options: null,
        answer_key: { kind: 'text', acceptedAnswers: ['carefully'], caseSensitive: false },
        explanation: 'e1',
        skill_tags: ['word-formation'],
        metadata: {
          generationSource: 'mistake_remix',
          questionRole: 'targeted',
          targetErrorType: 'word_class',
          targetErrorSubtype: 'adjective_to_adverb',
          itemBaseWord: 'CAREFUL',
        },
      },
    ] as unknown as import('@models/PracticeItem').PracticeItem[];
    const answers = [
      {
        item_id: 'item-1',
        answer_payload: { kind: 'text', value: 'carefully' },
        normalized_answer: 'carefully',
        is_correct: true,
        response_time_ms: 900,
      },
    ] as unknown as import('@models/PracticeAnswer').PracticeAnswer[];

    const dto = buildPracticeAttemptResultDto(attempt, items, answers);

    assert.deepEqual(dto.items[0]?.adaptiveMetadata, {
      generationSource: 'mistake_remix',
      questionRole: 'targeted',
      targetErrorType: 'word_class',
      targetErrorSubtype: 'adjective_to_adverb',
    });
  });

  it('is null for a plain catalog item with no metadata', () => {
    const items = [
      {
        id: 'item-1',
        position: 1,
        prompt: 'p1',
        options: null,
        answer_key: { kind: 'text', acceptedAnswers: ['carefully'], caseSensitive: false },
        explanation: 'e1',
        skill_tags: ['word-formation'],
        metadata: null,
      },
    ] as unknown as import('@models/PracticeItem').PracticeItem[];
    const answers = [
      {
        item_id: 'item-1',
        answer_payload: { kind: 'text', value: 'carefully' },
        normalized_answer: 'carefully',
        is_correct: true,
        response_time_ms: 900,
      },
    ] as unknown as import('@models/PracticeAnswer').PracticeAnswer[];

    const dto = buildPracticeAttemptResultDto(attempt, items, answers);

    assert.equal(dto.items[0]?.adaptiveMetadata, null);
  });
});
