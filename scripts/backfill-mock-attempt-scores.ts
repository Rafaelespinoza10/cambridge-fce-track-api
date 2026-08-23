/**
 * One-off backfill for mock attempts finished BEFORE SubmitMockAttemptService
 * started computing estimateB2FirstResult: their MockTest row still has
 * estimated_standardized_score/estimated_level = null forever (submit is a
 * one-time finalization, never recomputed on read).
 *
 * Finds every full-mock MockTest with a null estimate whose row was created
 * by a live timed attempt (mock_attempts.result_mock_test_id -> this row),
 * recomputes the same way SubmitMockAttemptService now does (paper-score
 * rollup -> estimateB2FirstResult), and fills it in. A manually-registered
 * mock (no matching attempt) is left untouched — there's no attempt data to
 * derive anything from, and it was never this bug's fault it's null.
 *
 * Safety: defaults to a dry run that only prints what WOULD change. Pass
 * --apply to actually write. Always prints the masked DB target and stage
 * before doing anything.
 *
 * Usage:
 *   npx ts-node -r ./scripts/md-require-hook.js scripts/backfill-mock-attempt-scores.ts
 *   npx ts-node -r ./scripts/md-require-hook.js scripts/backfill-mock-attempt-scores.ts --apply
 */

import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { DataSource, IsNull } from 'typeorm';

import { AppDataSource } from '../src/config/database';
import { MockTest } from '../src/models/MockTest';
import { MockAttempt } from '../src/models/MockAttempt';
import { MockAttemptSection } from '../src/models/MockAttemptSection';
import { MockAttemptStatus, MockType, ExamType } from '../src/models/enums';
import {
  computeMockAttemptPaperScores,
  PAPER_GROUPS,
} from '../src/lib/mocks/mock-attempt-paper-scores';
import { estimateB2FirstResult } from '../src/lib/mocks/estimate-mock-level';

const ROOT = path.resolve(__dirname, '..');
const ENV_FILE = path.join(ROOT, 'serverless.env.yml');
const STAGE = process.env.STAGE || 'dev';
const APPLY = process.argv.includes('--apply');

function readDatabaseUrl(filePath: string, stage: string): string | null {
  if (!fs.existsSync(filePath)) {
    console.error(`ERROR: ${filePath} not found.`);
    process.exit(1);
  }
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  let inStage = false;
  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (trimmed === `${stage}:`) {
      inStage = true;
      continue;
    }
    if (inStage && trimmed.length > 0 && !/^\s/.test(trimmed)) inStage = false;
    if (inStage) {
      const match = trimmed.match(/^\s+DATABASE_URL:\s*(.+)$/);
      if (match) return match[1].trim();
    }
  }
  return null;
}

function maskUrl(url: string): string {
  return url.replace(/:([^:@]+)@/, ':****@');
}

function getSslConfig(databaseUrl: string): boolean | { rejectUnauthorized: boolean } {
  if (databaseUrl.includes('sslmode=require') || databaseUrl.includes('ssl=true')) {
    return { rejectUnauthorized: false };
  }
  return false;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL || readDatabaseUrl(ENV_FILE, STAGE);
  if (!databaseUrl) {
    console.error(`ERROR: DATABASE_URL not found for stage "${STAGE}".`);
    process.exit(1);
  }

  console.log(`Stage      : ${STAGE}`);
  console.log(`DB target  : ${maskUrl(databaseUrl)}`);
  console.log(
    `Mode       : ${APPLY ? 'APPLY (will write changes)' : 'DRY RUN (no writes — pass --apply to write)'}`,
  );
  console.log('');

  const dataSource = new DataSource({
    type: 'postgres',
    url: databaseUrl,
    ssl: getSslConfig(databaseUrl),
    synchronize: false,
    logging: false,
    entities: AppDataSource.options.entities,
  });

  await dataSource.initialize();

  try {
    const mockTestRepo = dataSource.getRepository(MockTest);
    const attemptRepo = dataSource.getRepository(MockAttempt);
    const sectionRepo = dataSource.getRepository(MockAttemptSection);

    const candidates = await mockTestRepo.find({
      where: { mock_type: MockType.FULL, estimated_standardized_score: IsNull() },
      order: { taken_at: 'ASC' },
    });

    console.log(`Found ${candidates.length} full mock(s) with a null estimated score.\n`);

    let updated = 0;
    let skippedNoAttempt = 0;
    let skippedNotB2First = 0;

    for (const mockTest of candidates) {
      const attempt = await attemptRepo.findOne({
        where: { result_mock_test_id: mockTest.id, status: MockAttemptStatus.COMPLETED },
      });
      if (attempt === null) {
        skippedNoAttempt++;
        console.log(
          `  skip   ${mockTest.id}  "${mockTest.name}"  (no completed live attempt found)`,
        );
        continue;
      }
      if (attempt.exam_type !== ExamType.B2_FIRST) {
        skippedNotB2First++;
        console.log(
          `  skip   ${mockTest.id}  "${mockTest.name}"  (exam_type=${attempt.exam_type})`,
        );
        continue;
      }

      const sections = await sectionRepo.find({ where: { mock_attempt_id: attempt.id } });
      const paperScores = computeMockAttemptPaperScores(sections);
      const overallPercentage =
        PAPER_GROUPS.map((group) => paperScores[group].percentage ?? 0).reduce((a, b) => a + b, 0) /
        PAPER_GROUPS.length;
      const estimate = estimateB2FirstResult(overallPercentage);

      updated++;
      console.log(
        `  ${APPLY ? 'update' : 'would update'} ${mockTest.id}  "${mockTest.name}"  ->  score=${estimate.estimatedScore} level=${estimate.estimatedLevel}  (attempt=${attempt.id}, overall=${overallPercentage.toFixed(2)}%)`,
      );

      if (APPLY) {
        await mockTestRepo.update(mockTest.id, {
          estimated_standardized_score: estimate.estimatedScore,
          estimated_level: estimate.estimatedLevel,
        });
      }
    }

    console.log('');
    console.log('---');
    console.log(`${updated} row(s) ${APPLY ? 'updated' : 'would be updated'}.`);
    console.log(
      `${skippedNoAttempt} row(s) skipped (no matching completed attempt — manual entry).`,
    );
    console.log(`${skippedNotB2First} row(s) skipped (not B2 First).`);
    if (!APPLY && updated > 0) {
      console.log('\nRe-run with --apply to write these changes.');
    }
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
