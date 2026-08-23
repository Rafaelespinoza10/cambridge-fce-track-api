/**
 * One-off backfill: moves AI-generated plan activities onto the day the user
 * actually finished them, in the user's own timezone — repairing the rows left
 * behind by the Practice/Writing UTC-day bug and the Daily Session
 * session_date semantics. Reads DATABASE_URL from serverless.env.yml, same as
 * the other backfill scripts.
 *
 * Usage: npm run db:backfill-ai-activity-plan-days -- --dry-run
 *        npm run db:backfill-ai-activity-plan-days
 *        STAGE=prod npm run db:backfill-ai-activity-plan-days -- --dry-run
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
    console.error(`[backfill-ai-activity-plan-days.js] ERROR: ${filePath} not found.`);
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
      `[backfill-ai-activity-plan-days.js] ERROR: DATABASE_URL not found under stage "${STAGE}".`,
    );
    process.exit(1);
  }

  console.log(`[backfill-ai-activity-plan-days.js] Stage: ${STAGE}\n`);

  const extraArgs = process.argv.slice(2);
  const argsStr = extraArgs.length > 0 ? ' ' + extraArgs.join(' ') : '';

  execSync(
    `npx ts-node -r tsconfig-paths/register src/scripts/backfill-ai-activity-plan-days.ts${argsStr}`,
    {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'inherit',
    },
  );
}

main();
