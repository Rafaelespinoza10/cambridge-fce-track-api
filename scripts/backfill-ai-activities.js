/**
 * One-off backfill: registers already-completed Practice attempts / graded
 * Writing submissions (from before the AI-linked-activities feature shipped)
 * as planned_activities. Reads DATABASE_URL from serverless.env.yml — same
 * as scripts/db.js and scripts/seed.js.
 *
 * Usage: npm run db:backfill-ai-activities
 *        npm run db:backfill-ai-activities -- --dry-run
 *        STAGE=prod npm run db:backfill-ai-activities
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
    console.error(`[backfill-ai-activities.js] ERROR: ${filePath} not found.`);
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
      `[backfill-ai-activities.js] ERROR: DATABASE_URL not found under stage "${STAGE}".`,
    );
    process.exit(1);
  }

  console.log(`[backfill-ai-activities.js] Stage: ${STAGE}\n`);

  const extraArgs = process.argv.slice(2);
  const argsStr = extraArgs.length > 0 ? ' ' + extraArgs.join(' ') : '';

  execSync(
    `npx ts-node -r tsconfig-paths/register src/scripts/backfill-ai-planned-activities.ts${argsStr}`,
    {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'inherit',
    },
  );
}

main();
