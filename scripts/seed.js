/**
 * Runs catalog seed (skills, exam sections, activity templates).
 * Reads DATABASE_URL from serverless.env.yml — same as scripts/db.js.
 *
 * Usage: npm run db:seed
 *        STAGE=prod npm run db:seed
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
    console.error(`[seed.js] ERROR: ${filePath} not found.`);
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
  const databaseUrl = readDatabaseUrl(ENV_FILE, STAGE);

  if (!databaseUrl) {
    console.error(`[seed.js] ERROR: DATABASE_URL not found under stage "${STAGE}".`);
    process.exit(1);
  }

  console.log(`[seed.js] Stage: ${STAGE}\n`);

  execSync(
    'npx ts-node -r tsconfig-paths/register src/config/seed/run-seed.ts',
    {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'inherit',
    },
  );
}

main();
