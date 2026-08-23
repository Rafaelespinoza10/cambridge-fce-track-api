import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { EnglishLevel } from '@models/enums';
import {
  CAMBRIDGE_SCALE_MAX,
  CAMBRIDGE_SCALE_MIN,
  LEVEL_BANDS,
  estimateCambridgeScaleScore,
  estimateLevelFromScore,
  estimateB2FirstResult,
} from './estimate-mock-level';

describe('estimateCambridgeScaleScore', () => {
  it('maps the published anchor points exactly', () => {
    assert.equal(estimateCambridgeScaleScore(0), 100);
    assert.equal(estimateCambridgeScaleScore(45), 140);
    assert.equal(estimateCambridgeScaleScore(60), 160);
    assert.equal(estimateCambridgeScaleScore(75), 173);
    assert.equal(estimateCambridgeScaleScore(90), 180);
    assert.equal(estimateCambridgeScaleScore(100), 190);
  });

  it('interpolates linearly between anchors', () => {
    // Halfway between the 45%->140 and 60%->160 anchors.
    assert.equal(estimateCambridgeScaleScore(52.5), 150);
  });

  it('clamps out-of-range percentages instead of extrapolating', () => {
    assert.equal(estimateCambridgeScaleScore(-10), 100);
    assert.equal(estimateCambridgeScaleScore(150), 190);
  });
});

describe('estimateLevelFromScore', () => {
  it('mirrors the real B2 First grade boundaries', () => {
    assert.equal(estimateLevelFromScore(190), EnglishLevel.C1);
    assert.equal(estimateLevelFromScore(180), EnglishLevel.C1);
    assert.equal(estimateLevelFromScore(179), EnglishLevel.B2);
    assert.equal(estimateLevelFromScore(160), EnglishLevel.B2);
    assert.equal(estimateLevelFromScore(159), EnglishLevel.B1);
    assert.equal(estimateLevelFromScore(140), EnglishLevel.B1);
    assert.equal(estimateLevelFromScore(139), EnglishLevel.A2);
    assert.equal(estimateLevelFromScore(0), EnglishLevel.A2);
  });
});

describe('LEVEL_BANDS', () => {
  it('covers the whole 100-190 scale with no gaps or overlaps', () => {
    assert.equal(LEVEL_BANDS[0]!.minScore, CAMBRIDGE_SCALE_MIN);
    assert.equal(LEVEL_BANDS[LEVEL_BANDS.length - 1]!.maxScore, CAMBRIDGE_SCALE_MAX);
    for (let i = 0; i < LEVEL_BANDS.length - 1; i += 1) {
      assert.equal(LEVEL_BANDS[i]!.maxScore + 1, LEVEL_BANDS[i + 1]!.minScore);
    }
  });

  it('stays in lockstep with estimateLevelFromScore for every score on the scale', () => {
    for (let score = CAMBRIDGE_SCALE_MIN; score <= CAMBRIDGE_SCALE_MAX; score += 1) {
      const expectedLevel = estimateLevelFromScore(score);
      const band = LEVEL_BANDS.find((b) => score >= b.minScore && score <= b.maxScore);
      assert.ok(band, `no band covers score ${score}`);
      assert.equal(band!.level, expectedLevel, `band mismatch at score ${score}`);
    }
  });
});

describe('estimateB2FirstResult', () => {
  it('bundles the score and its matching level', () => {
    assert.deepEqual(estimateB2FirstResult(60), {
      estimatedScore: 160,
      estimatedLevel: EnglishLevel.B2,
    });
    assert.deepEqual(estimateB2FirstResult(20), {
      estimatedScore: 118,
      estimatedLevel: EnglishLevel.A2,
    });
  });
});
