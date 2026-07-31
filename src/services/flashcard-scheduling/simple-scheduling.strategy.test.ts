import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { FlashcardStatus, ReviewRating } from '../../models/enums';
import { SimpleSchedulingStrategy } from './simple-scheduling.strategy';
import { SchedulingError, type FlashcardSchedulingState } from './scheduling.types';

const FIXED_DATE = new Date('2026-01-01T00:00:00.000Z');
const MINUTES_PER_DAY = 24 * 60;

const strategy = new SimpleSchedulingStrategy();

function baseState(overrides: Partial<FlashcardSchedulingState> = {}): FlashcardSchedulingState {
  return {
    status: FlashcardStatus.NEW,
    intervalMinutes: 0,
    easeFactor: 2.5,
    repetitions: 0,
    lapses: 0,
    ...overrides,
  };
}

describe('SimpleSchedulingStrategy — AGAIN', () => {
  it('from new: learning, 10 min, ease-0.20, repetitions reset, lapses+1', () => {
    const state = baseState({
      status: FlashcardStatus.NEW,
      easeFactor: 2.5,
      repetitions: 3,
      lapses: 1,
    });
    const result = strategy.calculate(state, ReviewRating.AGAIN, FIXED_DATE);
    assert.equal(result.status, FlashcardStatus.LEARNING);
    assert.equal(result.intervalMinutes, 10);
    assert.equal(result.easeFactor, 2.3);
    assert.equal(result.repetitions, 0);
    assert.equal(result.lapses, 2);
  });

  it('from learning stays in learning', () => {
    const state = baseState({ status: FlashcardStatus.LEARNING });
    const result = strategy.calculate(state, ReviewRating.AGAIN, FIXED_DATE);
    assert.equal(result.status, FlashcardStatus.LEARNING);
  });

  it('from review drops back to learning', () => {
    const state = baseState({
      status: FlashcardStatus.REVIEW,
      intervalMinutes: MINUTES_PER_DAY * 30,
    });
    const result = strategy.calculate(state, ReviewRating.AGAIN, FIXED_DATE);
    assert.equal(result.status, FlashcardStatus.LEARNING);
    assert.equal(result.intervalMinutes, 10);
  });

  it('respects the minimum ease factor floor', () => {
    const state = baseState({ easeFactor: 1.35 });
    const result = strategy.calculate(state, ReviewRating.AGAIN, FIXED_DATE);
    assert.equal(result.easeFactor, 1.3);
  });

  it('schedules exactly 10 minutes later', () => {
    const result = strategy.calculate(baseState(), ReviewRating.AGAIN, FIXED_DATE);
    assert.equal(result.nextReviewAt.getTime() - FIXED_DATE.getTime(), 10 * 60_000);
  });
});

describe('SimpleSchedulingStrategy — HARD', () => {
  it('first review (from new): 1 day, ease-0.05, repetitions+1', () => {
    const state = baseState({ status: FlashcardStatus.NEW, easeFactor: 2.5 });
    const result = strategy.calculate(state, ReviewRating.HARD, FIXED_DATE);
    assert.equal(result.status, FlashcardStatus.LEARNING);
    assert.equal(result.intervalMinutes, MINUTES_PER_DAY);
    assert.equal(result.easeFactor, 2.45);
    assert.equal(result.repetitions, 1);
    assert.equal(result.lapses, 0);
  });

  it('from learning stays in learning', () => {
    const state = baseState({ status: FlashcardStatus.LEARNING, repetitions: 1 });
    const result = strategy.calculate(state, ReviewRating.HARD, FIXED_DATE);
    assert.equal(result.status, FlashcardStatus.LEARNING);
    assert.equal(result.intervalMinutes, MINUTES_PER_DAY);
  });

  it('from review multiplies the interval by 1.20 and stays in review', () => {
    const state = baseState({
      status: FlashcardStatus.REVIEW,
      intervalMinutes: MINUTES_PER_DAY * 10,
      easeFactor: 2.0,
      repetitions: 5,
    });
    const result = strategy.calculate(state, ReviewRating.HARD, FIXED_DATE);
    assert.equal(result.status, FlashcardStatus.REVIEW);
    assert.equal(result.intervalMinutes, Math.round(MINUTES_PER_DAY * 10 * 1.2));
    assert.equal(result.repetitions, 6);
    assert.equal(result.lapses, 0);
  });

  it('reduces ease by 0.05', () => {
    const state = baseState({
      status: FlashcardStatus.REVIEW,
      intervalMinutes: MINUTES_PER_DAY,
      easeFactor: 2.0,
    });
    const result = strategy.calculate(state, ReviewRating.HARD, FIXED_DATE);
    assert.equal(result.easeFactor, 1.95);
  });

  it('never drops ease below 1.30', () => {
    const state = baseState({
      status: FlashcardStatus.REVIEW,
      intervalMinutes: MINUTES_PER_DAY,
      easeFactor: 1.32,
    });
    const result = strategy.calculate(state, ReviewRating.HARD, FIXED_DATE);
    assert.equal(result.easeFactor, 1.3);
  });

  it('interval is never below 1 day even from a tiny current interval', () => {
    const state = baseState({
      status: FlashcardStatus.REVIEW,
      intervalMinutes: 5,
      easeFactor: 2.0,
    });
    const result = strategy.calculate(state, ReviewRating.HARD, FIXED_DATE);
    assert.equal(result.intervalMinutes, MINUTES_PER_DAY);
  });
});

describe('SimpleSchedulingStrategy — GOOD', () => {
  it('first review gives 3 days', () => {
    const state = baseState({ status: FlashcardStatus.NEW });
    const result = strategy.calculate(state, ReviewRating.GOOD, FIXED_DATE);
    assert.equal(result.status, FlashcardStatus.REVIEW);
    assert.equal(result.intervalMinutes, MINUTES_PER_DAY * 3);
    assert.equal(result.repetitions, 1);
  });

  it('from learning moves to review', () => {
    const state = baseState({ status: FlashcardStatus.LEARNING });
    const result = strategy.calculate(state, ReviewRating.GOOD, FIXED_DATE);
    assert.equal(result.status, FlashcardStatus.REVIEW);
    assert.equal(result.intervalMinutes, MINUTES_PER_DAY * 3);
  });

  it('from review multiplies the interval by the ease factor', () => {
    const state = baseState({
      status: FlashcardStatus.REVIEW,
      intervalMinutes: MINUTES_PER_DAY * 10,
      easeFactor: 2.5,
      repetitions: 4,
    });
    const result = strategy.calculate(state, ReviewRating.GOOD, FIXED_DATE);
    assert.equal(result.intervalMinutes, Math.round(MINUTES_PER_DAY * 10 * 2.5));
  });

  it('does not change the ease factor', () => {
    const state = baseState({
      status: FlashcardStatus.REVIEW,
      intervalMinutes: MINUTES_PER_DAY,
      easeFactor: 2.33,
    });
    const result = strategy.calculate(state, ReviewRating.GOOD, FIXED_DATE);
    assert.equal(result.easeFactor, 2.33);
  });

  it('increments repetitions', () => {
    const state = baseState({
      status: FlashcardStatus.REVIEW,
      intervalMinutes: MINUTES_PER_DAY,
      repetitions: 9,
    });
    const result = strategy.calculate(state, ReviewRating.GOOD, FIXED_DATE);
    assert.equal(result.repetitions, 10);
  });
});

describe('SimpleSchedulingStrategy — EASY', () => {
  it('first review gives 7 days', () => {
    const state = baseState({ status: FlashcardStatus.NEW, easeFactor: 2.5 });
    const result = strategy.calculate(state, ReviewRating.EASY, FIXED_DATE);
    assert.equal(result.status, FlashcardStatus.REVIEW);
    assert.equal(result.intervalMinutes, MINUTES_PER_DAY * 7);
  });

  it('from review multiplies by ease factor and 1.30', () => {
    const state = baseState({
      status: FlashcardStatus.REVIEW,
      intervalMinutes: MINUTES_PER_DAY * 10,
      easeFactor: 2.0,
      repetitions: 4,
    });
    const result = strategy.calculate(state, ReviewRating.EASY, FIXED_DATE);
    assert.equal(result.intervalMinutes, Math.round(MINUTES_PER_DAY * 10 * 2.0 * 1.3));
    assert.equal(result.repetitions, 5);
  });

  it('increments ease by 0.15', () => {
    const state = baseState({
      status: FlashcardStatus.REVIEW,
      intervalMinutes: MINUTES_PER_DAY,
      easeFactor: 2.0,
    });
    const result = strategy.calculate(state, ReviewRating.EASY, FIXED_DATE);
    assert.equal(result.easeFactor, 2.15);
  });

  it('never exceeds the maximum ease of 3.00', () => {
    const state = baseState({
      status: FlashcardStatus.REVIEW,
      intervalMinutes: MINUTES_PER_DAY,
      easeFactor: 2.95,
    });
    const result = strategy.calculate(state, ReviewRating.EASY, FIXED_DATE);
    assert.equal(result.easeFactor, 3.0);
  });

  it('increments repetitions', () => {
    const state = baseState({
      status: FlashcardStatus.REVIEW,
      intervalMinutes: MINUTES_PER_DAY,
      repetitions: 2,
    });
    const result = strategy.calculate(state, ReviewRating.EASY, FIXED_DATE);
    assert.equal(result.repetitions, 3);
  });
});

describe('SimpleSchedulingStrategy — limits, determinism, and validation', () => {
  it('clamps the interval to a 10-year maximum', () => {
    const tenYearsMinutes = 10 * 365 * MINUTES_PER_DAY;
    const state = baseState({
      status: FlashcardStatus.REVIEW,
      intervalMinutes: tenYearsMinutes,
      easeFactor: 3.0,
      repetitions: 20,
    });
    const result = strategy.calculate(state, ReviewRating.EASY, FIXED_DATE);
    assert.equal(result.intervalMinutes, tenYearsMinutes);
  });

  it('computes nextReviewAt by adding exactly intervalMinutes to reviewedAt', () => {
    const state = baseState({
      status: FlashcardStatus.REVIEW,
      intervalMinutes: MINUTES_PER_DAY,
      easeFactor: 2.0,
    });
    const result = strategy.calculate(state, ReviewRating.GOOD, FIXED_DATE);
    assert.equal(
      result.nextReviewAt.getTime(),
      FIXED_DATE.getTime() + result.intervalMinutes * 60_000,
    );
  });

  it('does not mutate the input state object', () => {
    const state = baseState({
      status: FlashcardStatus.REVIEW,
      intervalMinutes: MINUTES_PER_DAY,
      easeFactor: 2.0,
      repetitions: 1,
      lapses: 0,
    });
    const snapshot = { ...state };
    strategy.calculate(state, ReviewRating.GOOD, FIXED_DATE);
    assert.deepEqual(state, snapshot);
  });

  it('is deterministic for identical inputs', () => {
    const state = baseState({
      status: FlashcardStatus.REVIEW,
      intervalMinutes: MINUTES_PER_DAY,
      easeFactor: 2.0,
      repetitions: 3,
      lapses: 1,
    });
    const first = strategy.calculate(state, ReviewRating.GOOD, FIXED_DATE);
    const second = strategy.calculate(state, ReviewRating.GOOD, FIXED_DATE);
    assert.deepEqual(first, second);
  });

  it('rejects an invalid date', () => {
    assert.throws(
      () => strategy.calculate(baseState(), ReviewRating.GOOD, new Date('not-a-date')),
      SchedulingError,
    );
  });

  it('rejects an ease factor out of range', () => {
    assert.throws(
      () => strategy.calculate(baseState({ easeFactor: 0.5 }), ReviewRating.GOOD, FIXED_DATE),
      SchedulingError,
    );
  });

  it('rejects negative repetitions', () => {
    assert.throws(
      () => strategy.calculate(baseState({ repetitions: -1 }), ReviewRating.GOOD, FIXED_DATE),
      SchedulingError,
    );
  });

  it('rejects negative lapses', () => {
    assert.throws(
      () => strategy.calculate(baseState({ lapses: -1 }), ReviewRating.GOOD, FIXED_DATE),
      SchedulingError,
    );
  });

  it('rejects a decimal interval', () => {
    assert.throws(
      () => strategy.calculate(baseState({ intervalMinutes: 10.5 }), ReviewRating.GOOD, FIXED_DATE),
      SchedulingError,
    );
  });

  it('rejects a suspended flashcard', () => {
    assert.throws(
      () =>
        strategy.calculate(
          baseState({ status: FlashcardStatus.SUSPENDED }),
          ReviewRating.GOOD,
          FIXED_DATE,
        ),
      SchedulingError,
    );
  });
});
