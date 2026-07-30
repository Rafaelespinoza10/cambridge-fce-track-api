/**
 * Quick connection test — no TypeORM, just raw pg.
 * Reads DATABASE_URL from serverless.env.yml and tries to connect.
 *
 * Usage:
 *   node scripts/test-connection.js
 *   STAGE=prod node scripts/test-connection.js
 */

'use strict';

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ENV_FILE = path.join(ROOT, 'serverless.env.yml');
const STAGE = process.env.STAGE || 'dev';

function readDatabaseUrl(filePath, stage) {
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
      if (match) {
        return match[1].trim();
      }
    }
  }
  return null;
}

async function testConnection() {
  const databaseUrl = readDatabaseUrl(ENV_FILE, STAGE);

  if (!databaseUrl) {
    console.error(`ERROR: DATABASE_URL not found in serverless.env.yml for stage "${STAGE}".`);
    process.exit(1);
  }

  const masked = databaseUrl.replace(/:([^:@]+)@/, ':****@');
  console.log(`\nStage    : ${STAGE}`);
  console.log(`URL      : ${masked}`);
  console.log('\nConnecting...\n');

  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    const versionResult = await client.query('SELECT version()');
    const version = versionResult.rows[0].version;

    const dbResult = await client.query('SELECT current_database()');
    const dbName = dbResult.rows[0].current_database;

    console.log(`✓ Connected successfully`);
    console.log(`  Database : ${dbName}`);
    console.log(`  Server   : ${version.split(' ').slice(0, 2).join(' ')}\n`);

    await client.end();
    process.exit(0);
  } catch (err) {
    console.error(`✖ Connection failed: ${err.message}\n`);
    await client.end().catch(() => {});
    process.exit(1);
  }
}

testConnection();
