/**
 * One-off backfill: creates the missing activity_scores rows for Daily
 * Sessions graded before the score row shipped, so they show up in the
 * Progress metrics. Reads DATABASE_URL from serverless.env.yml — same as
 * scripts/db.js, scripts/seed.js and scripts/backfill-ai-activities.js.
 *
 * Usage: npm run db:backfill-daily-session-scores
 *        npm run db:backfill-daily-session-scores -- --dry-run
 *        STAGE=prod npm run db:backfill-daily-session-scores -- --dry-run
 */

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ENV_FILE = path.join(ROOT, 'serverless.env.yml');
const STAGE = process.env.STAGE || 'dev';

function readDatabaseUrl(filePath, stage) {
  if (!fs.existsSync(filePath)) {
    console.error(`[backfill-daily-session-scores.js] ERROR: ${filePath} not found.`);
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
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
      if (match) {
        return match[1].trim();
      }
    }
  }

  return null;
}

function main() {
  // An explicitly exported DATABASE_URL wins, same override rule as db.js.
  const databaseUrl = process.env.DATABASE_URL || readDatabaseUrl(ENV_FILE, STAGE);

  if (!databaseUrl) {
    console.error(
      `[backfill-daily-session-scores.js] ERROR: DATABASE_URL not found under stage "${STAGE}".`,
    );
    process.exit(1);
  }

  console.log(`[backfill-daily-session-scores.js] Stage: ${STAGE}\n`);

  const extraArgs = process.argv.slice(2);
  const argsStr = extraArgs.length > 0 ? ' ' + extraArgs.join(' ') : '';

  execSync(
    `npx ts-node -r tsconfig-paths/register src/scripts/backfill-daily-session-activity-scores.ts${argsStr}`,
    {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'inherit',
    },
  );
}

main();
