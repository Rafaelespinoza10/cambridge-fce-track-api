/**
 * One-off backfill for MockTest rows whose estimated_standardized_score/
 * estimated_level are null even though there's real section-score data to
 * derive them from — either:
 *
 *  - a live timed attempt finished BEFORE SubmitMockAttemptService started
 *    computing estimateB2FirstResult for every attempt (full OR scoped/
 *    partial) — submit is a one-time finalization, never recomputed on read;
 *  - or a manually-registered mock (POST /mocks) that was saved with section
 *    scores but no estimatedLevel, from before the "Register Mock" form
 *    started computing one client-side.
 *
 * For the live-attempt case, recomputes the same way SubmitMockAttemptService
 * now does (MockAttemptSection rollup -> computeCoveredOverallPercentage,
 * averaging only the paper(s) that attempt actually covered ->
 * estimateB2FirstResult). For a manual entry with no matching attempt, does
 * the same rollup from that MockTest's OWN MockSectionScore rows instead —
 * the only source of truth it ever had. Either way, a row with genuinely no
 * usable section score anywhere is left untouched.
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
import { MockSectionScore } from '../src/models/MockSectionScore';
import { MockAttemptStatus, ExamType } from '../src/models/enums';
import {
  computeMockAttemptPaperScores,
  computeCoveredOverallPercentage,
} from '../src/lib/mocks/mock-attempt-paper-scores';
import type {
  MockAttemptPaperGroup,
  MockAttemptPaperScoreDto,
} from '../src/lib/mocks/mock-attempt-paper-scores';
import { findMockAttemptSectionCatalogEntry } from '../src/lib/mocks/mock-attempt-catalog';
import { estimateB2FirstResult } from '../src/lib/mocks/estimate-mock-level';

/**
 * Same grouping/rollup computeMockAttemptPaperScores does for
 * MockAttemptSection rows, but for a MockTest's own MockSectionScore rows —
 * the shape the live-attempt table and the manual-registration table use is
 * different enough (no `status`, numeric fields already the final value)
 * that reusing the exact same function isn't a clean fit for a one-off
 * script. section_code is shared between both catalogs, so the same
 * findMockAttemptSectionCatalogEntry lookup still applies.
 */
function computePaperScoresFromSectionScores(
  sections: MockSectionScore[],
): Record<MockAttemptPaperGroup, MockAttemptPaperScoreDto> {
  const scores: Record<MockAttemptPaperGroup, MockAttemptPaperScoreDto> = {
    reading: { rawScore: 0, maxScore: 0, percentage: null },
    useOfEnglish: { rawScore: 0, maxScore: 0, percentage: null },
    writing: { rawScore: 0, maxScore: 0, percentage: null },
    listening: { rawScore: 0, maxScore: 0, percentage: null },
  };

  for (const section of sections) {
    if (section.raw_score === null || section.max_score === null) continue;
    const catalogEntry = findMockAttemptSectionCatalogEntry(section.section_code);
    if (catalogEntry === undefined) continue;

    const group = scores[catalogEntry.scoreGroup];
    group.rawScore += Number(section.raw_score);
    group.maxScore += Number(section.max_score);
  }

  for (const group of Object.values(scores)) {
    group.percentage = group.maxScore > 0 ? (group.rawScore / group.maxScore) * 100 : null;
  }

  return scores;
}

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
    const sectionScoreRepo = dataSource.getRepository(MockSectionScore);

    // No mock_type filter — a scoped/partial attempt is now just as eligible
    // for an estimate as a full one (see submit-mock-attempt.service.ts).
    const candidates = await mockTestRepo.find({
      where: { estimated_standardized_score: IsNull() },
      order: { taken_at: 'ASC' },
    });

    console.log(`Found ${candidates.length} mock(s) with a null estimated score.\n`);

    let updatedFromAttempt = 0;
    let updatedFromManualEntry = 0;
    let skippedNotB2First = 0;
    let skippedNothingCovered = 0;

    for (const mockTest of candidates) {
      const attempt = await attemptRepo.findOne({
        where: { result_mock_test_id: mockTest.id, status: MockAttemptStatus.COMPLETED },
      });

      const examType = attempt?.exam_type ?? mockTest.exam_type;
      if (examType !== ExamType.B2_FIRST) {
        skippedNotB2First++;
        console.log(`  skip   ${mockTest.id}  "${mockTest.name}"  (exam_type=${examType})`);
        continue;
      }

      const paperScores =
        attempt !== null
          ? computeMockAttemptPaperScores(
              await sectionRepo.find({ where: { mock_attempt_id: attempt.id } }),
            )
          : computePaperScoresFromSectionScores(
              await sectionScoreRepo.find({ where: { mock_test_id: mockTest.id } }),
            );
      const overallPercentage = computeCoveredOverallPercentage(paperScores);
      if (overallPercentage === null) {
        skippedNothingCovered++;
        console.log(
          `  skip   ${mockTest.id}  "${mockTest.name}"  (no usable section score found to derive a score from)`,
        );
        continue;
      }
      const estimate = estimateB2FirstResult(overallPercentage);
      const source = attempt !== null ? `attempt=${attempt.id}` : 'manual entry';

      if (attempt !== null) updatedFromAttempt++;
      else updatedFromManualEntry++;
      console.log(
        `  ${APPLY ? 'update' : 'would update'} ${mockTest.id}  "${mockTest.name}"  (${mockTest.mock_type})  ->  score=${estimate.estimatedScore} level=${estimate.estimatedLevel}  (${source}, overall=${overallPercentage.toFixed(2)}%)`,
      );

      if (APPLY) {
        await mockTestRepo.update(mockTest.id, {
          estimated_standardized_score: estimate.estimatedScore,
          estimated_level: estimate.estimatedLevel,
        });
      }
    }

    const updated = updatedFromAttempt + updatedFromManualEntry;
    console.log('');
    console.log('---');
    console.log(
      `${updated} row(s) ${APPLY ? 'updated' : 'would be updated'} (${updatedFromAttempt} from a live attempt, ${updatedFromManualEntry} from a manual entry's own section scores).`,
    );
    console.log(`${skippedNotB2First} row(s) skipped (not B2 First).`);
    console.log(
      `${skippedNothingCovered} row(s) skipped (no usable section score to derive a score from).`,
    );
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
