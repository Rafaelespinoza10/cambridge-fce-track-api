/**
 * One-off backfill for the bug fixed in scoring.service.ts: ActivityScore
 * rows created before that fix have `percentage: null` whenever their
 * score_type didn't have a dedicated calculation (custom, percentage,
 * time_only — and correct_answers/rubric rows that, for whatever reason,
 * never got their specific fields filled in). Every home stat (weekly
 * average, recent activities, skill strengths/weaknesses, monthly progress)
 * reads `percentage`, so those rows are invisible until this runs.
 *
 * Recomputes `percentage` for existing rows using the exact same priority
 * order as ScoringService.registerScore:
 *   1. correct_answers type  -> correct_answers / total_questions
 *   2. rubric type           -> sum(detail.score) / sum(detail.maxScore),
 *                                only when every detail has a maxScore
 *   3. anything else         -> deriveFallbackPercentage(raw_score, max_score)
 *      (also used as a fallback for 1/2 when their specific fields are
 *      missing but raw_score/max_score are present — mirrors the service)
 *
 * Rows where none of the above yields a value (e.g. a `custom` score with no
 * raw_score/max_score either) are left untouched and listed separately —
 * there is nothing to derive a percentage from.
 *
 * Safety: defaults to a dry run that only prints what WOULD change. Pass
 * --apply to actually write. Always prints the masked DB target and stage
 * before doing anything, so it's never ambiguous which database is affected.
 *
 * Usage:
 *   npx ts-node -r ./scripts/md-require-hook.js scripts/backfill-activity-score-percentage.ts
 *   npx ts-node -r ./scripts/md-require-hook.js scripts/backfill-activity-score-percentage.ts --apply
 *   STAGE=prod npx ts-node -r ./scripts/md-require-hook.js scripts/backfill-activity-score-percentage.ts --apply
 */

import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { DataSource, IsNull } from 'typeorm';

import { AppDataSource } from '../src/config/database';
import { ActivityScore } from '../src/models/ActivityScore';
import { ScoreType } from '../src/models/enums';
import { deriveFallbackPercentage } from '../src/services/scoring/scoring.service';

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
    if (inStage && trimmed.length > 0 && !/^\s/.test(trimmed)) {
      inStage = false;
    }
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

function parseNumeric(value: string | null): number | null {
  if (value === null) return null;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? null : parsed;
}

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Mirrors ScoringService.registerScore's percentage-derivation priority exactly. */
function computePercentage(score: ActivityScore): number | null {
  if (score.score_type === ScoreType.CORRECT_ANSWERS) {
    const correct = score.correct_answers;
    const total = score.total_questions;
    if (correct !== null && total !== null && total > 0) {
      return roundTwo((correct / total) * 100);
    }
  }

  if (score.score_type === ScoreType.RUBRIC) {
    const details = score.score_details ?? [];
    if (details.length > 0) {
      const allHaveMax = details.every((d) => d.max_score !== null);
      if (allHaveMax) {
        const rawSum = roundTwo(details.reduce((sum, d) => sum + parseFloat(d.score), 0));
        const maxSum = roundTwo(
          details.reduce((sum, d) => sum + (parseFloat(d.max_score ?? '0') || 0), 0),
        );
        return deriveFallbackPercentage(rawSum, maxSum);
      }
    }
  }

  return deriveFallbackPercentage(parseNumeric(score.raw_score), parseNumeric(score.max_score));
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL || readDatabaseUrl(ENV_FILE, STAGE);
  if (!databaseUrl) {
    console.error(
      `ERROR: DATABASE_URL not found in the environment or in serverless.env.yml under stage "${STAGE}".`,
    );
    process.exit(1);
  }

  console.log(`Stage      : ${STAGE}`);
  console.log(`DB target  : ${maskUrl(databaseUrl)}`);
  console.log(
    `Mode       : ${APPLY ? 'APPLY (will write changes)' : 'DRY RUN (no writes — pass --apply to write)'}`,
  );
  console.log('');

  // Reuses AppDataSource's full entity list instead of a local subset —
  // ActivityScore has string-referenced relations (User, PlannedActivity,
  // Skill, ExamSection, ActivityScoreDetail) that TypeORM can't resolve
  // unless every referenced entity is registered on the same DataSource.
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
    const repo = dataSource.getRepository(ActivityScore);
    const candidates = await repo.find({
      where: { percentage: IsNull(), deleted_at: IsNull() },
      relations: { score_details: true },
      order: { created_at: 'ASC' },
    });

    console.log(`Found ${candidates.length} score(s) with percentage = null.\n`);

    let derivable = 0;
    let notDerivable = 0;

    for (const score of candidates) {
      const newPercentage = computePercentage(score);

      if (newPercentage === null) {
        notDerivable++;
        console.log(
          `  skip   ${score.id}  type=${score.score_type}  raw=${score.raw_score ?? '—'}  max=${score.max_score ?? '—'}  (nothing to derive from)`,
        );
        continue;
      }

      derivable++;
      console.log(
        `  ${APPLY ? 'update' : 'would update'} ${score.id}  type=${score.score_type}  raw=${score.raw_score ?? '—'}  max=${score.max_score ?? '—'}  ->  percentage=${newPercentage}`,
      );

      if (APPLY) {
        await repo.update(score.id, { percentage: String(newPercentage) });
      }
    }

    console.log('');
    console.log('---');
    console.log(`${derivable} row(s) ${APPLY ? 'updated' : 'would be updated'}.`);
    console.log(
      `${notDerivable} row(s) have no raw_score/max_score (or rubric details) to derive a percentage from — left as-is.`,
    );
    if (!APPLY && derivable > 0) {
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
