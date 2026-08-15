/**
 * One-off manual verification (not part of the test suite) for the raw SQL
 * added in progress.repository.ts — this codebase has no docker-integration-
 * test setup, so the only way to catch a CTE/JSONB/LATERAL syntax mistake
 * before it ships is to actually run it against a real database. Prints
 * results for the first real user found; does not write anything.
 *
 * Usage:
 *   npx ts-node -r ./scripts/md-require-hook.js scripts/verify-unified-progress-queries.ts
 *   STAGE=prod npx ts-node -r ./scripts/md-require-hook.js scripts/verify-unified-progress-queries.ts
 */

import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { DataSource } from 'typeorm';

import { AppDataSource } from '../src/config/database';
import { ProgressRepository } from '../src/repositories/progress.repository';

const ROOT = path.resolve(__dirname, '..');
const ENV_FILE = path.join(ROOT, 'serverless.env.yml');
const STAGE = process.env.STAGE || 'dev';

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
    const [{ id: userId }] = await dataSource.query<{ id: string }[]>(
      `SELECT sc.user_id AS id FROM activity_scores sc
       WHERE sc.deleted_at IS NULL AND sc.percentage IS NOT NULL
       GROUP BY sc.user_id
       ORDER BY COUNT(*) DESC
       LIMIT 1`,
    );
    if (!userId) {
      console.log('No users found in this database — nothing to verify against.');
      return;
    }
    console.log(`Verifying against user ${userId}\n`);

    const repo = new ProgressRepository(dataSource);
    const since = '2000-01-01';
    const weekStart = '2000-01-01';
    const weekEnd = '2100-01-01';

    const [
      weeklyScoreStats,
      skillAverages,
      studyDates,
      monthlyProgress,
      recentActivities,
      overallWeekly,
      writingMetrics,
      scoreEvolution,
      examPartMetrics,
    ] = await Promise.all([
      repo.getWeeklyScoreStats(userId, weekStart, weekEnd),
      repo.getSkillAverages(userId, since),
      repo.getStudyDates(userId),
      repo.getMonthlySkillProgress(userId, since),
      repo.getRecentActivities(userId, 10),
      repo.getOverallWeeklyScores(userId, since),
      repo.getWritingMetrics(userId),
      repo.getScoreEvolution(userId, since, weekEnd),
      repo.getExamPartMetrics(userId),
    ]);

    console.log('getWeeklyScoreStats (wide range):', weeklyScoreStats);
    console.log('getSkillAverages:', skillAverages);
    console.log(`getStudyDates: ${studyDates.length} distinct day(s)`, studyDates.slice(0, 5));
    console.log(`getMonthlySkillProgress: ${monthlyProgress.length} row(s)`, monthlyProgress.slice(0, 5));
    console.log(`getRecentActivities: ${recentActivities.length} row(s)`, recentActivities);
    console.log(`getOverallWeeklyScores: ${overallWeekly.length} row(s)`, overallWeekly.slice(0, 5));
    console.log('getWritingMetrics:', writingMetrics);
    console.log(
      `getScoreEvolution: ${scoreEvolution.length} row(s)`,
      scoreEvolution.slice(0, 5),
      scoreEvolution.length > 5 ? '...' : '',
    );
    console.log(`getExamPartMetrics: ${examPartMetrics.length} row(s)`, examPartMetrics);

    console.log('\nAll queries executed without error.');
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
