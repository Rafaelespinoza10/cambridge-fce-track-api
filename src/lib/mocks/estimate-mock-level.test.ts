import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import { EnglishLevel } from '@models/enums';
import {
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
