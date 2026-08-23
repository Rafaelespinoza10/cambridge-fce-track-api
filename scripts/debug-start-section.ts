/**
 * One-off diagnostic: reproduces POST /mocks/attempts/{attemptId}/sections/{sectionCode}/start
 * directly against the real service composition, to surface the FULL error
 * + stack trace that handleError() deliberately masks as a generic 500.
 *
 * Usage:
 *   npx ts-node -r ./scripts/md-require-hook.js scripts/debug-start-section.ts <userId> <attemptId> <sectionCode>
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
  const [userId, attemptId, sectionCode] = process.argv.slice(2);
  if (!userId || !attemptId || !sectionCode) {
    console.error('Usage: debug-start-section.ts <userId> <attemptId> <sectionCode>');
    process.exit(1);
  }

  process.env.DATABASE_URL =
    process.env.DATABASE_URL || readEnvValue(ENV_FILE, STAGE, 'DATABASE_URL');
  process.env.OPEN_AI_API_KEY = readEnvValue(ENV_FILE, STAGE, 'OPEN_AI_API_KEY');
  process.env.OPENAI_MODEL = readEnvValue(ENV_FILE, STAGE, 'OPENAI_MODEL');

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { buildMockAttemptServices } = require('../src/services/mocks/mock-attempt-composition');
  const { startSection } = await buildMockAttemptServices();

  console.log(`Calling startSection.execute(${userId}, ${attemptId}, ${sectionCode})...`);
  try {
    const result = await startSection.execute(userId, attemptId, sectionCode);
    console.log('OK:', JSON.stringify(result, null, 2).slice(0, 2000));
  } catch (err) {
    console.error('\n>>> FAILED <<<\n');
    console.error(err);
    process.exitCode = 1;
    return;
  }
  process.exit(0);
}

main();
