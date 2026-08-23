/**
 * One-off diagnostic: builds the mock-attempt service composition exactly
 * like the Lambda does, to surface the FULL error + stack trace that
 * @lib/shared/response's handleError() deliberately masks behind a generic
 * "Internal server error" for any 5xx.
 *
 * Usage:
 *   npx ts-node -r ./scripts/md-require-hook.js scripts/debug-mock-attempt-composition.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');
const ENV_FILE = path.join(ROOT, 'serverless.env.yml');
const STAGE = process.env.STAGE || 'dev';

function readEnvValue(filePath: string, stage: string, key: string): string {
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
      const match = trimmed.match(new RegExp(`^\\s+${key}:\\s*(.+)$`));
      if (match) return match[1].trim();
    }
  }
  console.error(`ERROR: ${key} not found for stage "${stage}"`);
  process.exit(1);
}

async function main(): Promise<void> {
  process.env.DATABASE_URL =
    process.env.DATABASE_URL || readEnvValue(ENV_FILE, STAGE, 'DATABASE_URL');
  process.env.OPEN_AI_API_KEY = readEnvValue(ENV_FILE, STAGE, 'OPEN_AI_API_KEY');
  process.env.OPENAI_MODEL = readEnvValue(ENV_FILE, STAGE, 'OPENAI_MODEL');

  console.log('Requiring mock-attempt-composition...');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { buildMockAttemptServices } = require('../src/services/mocks/mock-attempt-composition');

  console.log('Calling buildMockAttemptServices()...');
  try {
    const services = await buildMockAttemptServices();
    console.log('OK — composition built successfully. Keys:', Object.keys(services));
  } catch (err) {
    console.error('\n>>> COMPOSITION FAILED <<<\n');
    console.error(err);
    process.exitCode = 1;
    return;
  }

  process.exit(0);
}

main();
