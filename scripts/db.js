/**
 * Wrapper that reads DATABASE_URL from serverless.env.yml and injects it
 * into the TypeORM CLI call. Avoids having to export the var manually.
 *
 * Usage (via npm scripts):
 *   node scripts/db.js migration:show -d src/config/database.ts
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
    console.error(`[db.js] ERROR: ${filePath} not found.`);
    console.error('[db.js] Make sure serverless.env.yml exists with a DATABASE_URL entry.');
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
  // An explicitly exported DATABASE_URL (e.g. pointing at a local/disposable
  // database for testing) always wins over serverless.env.yml, so this
  // wrapper never silently redirects a caller's intended target to the
  // configured dev database.
  const databaseUrl = process.env.DATABASE_URL || readDatabaseUrl(ENV_FILE, STAGE);

  if (!databaseUrl) {
    console.error(
      `[db.js] ERROR: DATABASE_URL not found in the environment or in serverless.env.yml under stage "${STAGE}".`,
    );
    process.exit(1);
  }

  const cliArgs = process.argv.slice(2).join(' ');

  if (!cliArgs) {
    console.error('[db.js] ERROR: No TypeORM command provided.');
    console.error('[db.js] Example: node scripts/db.js migration:run -d src/config/database.ts');
    process.exit(1);
  }

  console.log(`[db.js] Stage: ${STAGE}`);
  console.log(`[db.js] Running: typeorm-ts-node-commonjs ${cliArgs}\n`);

  execSync(`npx typeorm-ts-node-commonjs ${cliArgs}`, {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });
}

main();
