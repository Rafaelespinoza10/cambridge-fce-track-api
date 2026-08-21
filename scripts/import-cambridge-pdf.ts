/**
 * Manual way to import a Cambridge PDF into the Knowledge Base without
 * going through the HTTP endpoint — calls ImportCambridgeKnowledgeService
 * directly, so it isn't subject to the ~29s httpApi hard timeout documented
 * in docs/cambridge-knowledge-base.md, and doesn't need an admin JWT.
 * Same pattern as scripts/test-flashcard-ai-draft.ts.
 *
 * Usage:
 *   npx ts-node -r ./scripts/md-require-hook.js scripts/import-cambridge-pdf.ts <path-to-pdf> "<name>" "<version>" ["<description>"]
 *
 * Example:
 *   npx ts-node -r ./scripts/md-require-hook.js scripts/import-cambridge-pdf.ts ./scripts/fixtures/handbook-2024.pdf "B2 First Handbook 2024" "2024" "Official Cambridge handbook"
 *
 * STAGE defaults to "dev" and controls which serverless.env.yml block is
 * read for DATABASE_URL / OPEN_AI_API_KEY / OPENAI_MODEL / OPENAI_EMBEDDING_MODEL.
 * An already-exported DATABASE_URL always wins (see scripts/db.js) — this
 * script follows the same rule so it never silently redirects to the
 * configured dev database.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');
const ENV_FILE = path.join(ROOT, 'serverless.env.yml');
const STAGE = process.env.STAGE || 'dev';

function readEnvValue(filePath: string, stage: string, key: string): string {
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
      const match = trimmed.match(new RegExp(`^\\s+${key}:\\s*(.+)$`));
      if (match) {
        return match[1].trim();
      }
    }
  }

  console.error(`ERROR: ${key} not found for stage "${stage}" in ${filePath}`);
  process.exit(1);
}

/** Unlike readEnvValue, returns undefined instead of exiting when the key is absent — for vars the underlying client already defaults on its own (e.g. OPENAI_EMBEDDING_MODEL -> "text-embedding-3-small"). */
function readOptionalEnvValue(filePath: string, stage: string, key: string): string | undefined {
  if (!fs.existsSync(filePath)) return undefined;

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
      const match = trimmed.match(new RegExp(`^\\s+${key}:\\s*(.+)$`));
      if (match) return match[1].trim();
    }
  }

  return undefined;
}

function maskDatabaseUrl(url: string): string {
  return url.replace(/:\/\/([^:]+):[^@]+@/, '://$1:***@');
}

async function main(): Promise<void> {
  const [pdfPath, name, version, description] = process.argv.slice(2);
  if (!pdfPath || !name || !version) {
    console.error(
      'Usage: import-cambridge-pdf.ts <path-to-pdf> "<name>" "<version>" ["<description>"]',
    );
    process.exit(1);
  }

  const resolvedPath = path.resolve(pdfPath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`ERROR: PDF not found at ${resolvedPath}`);
    process.exit(1);
  }

  // Must be set BEFORE requiring the composition module below — TypeORM's
  // DataSource (src/config/database.ts) reads process.env.DATABASE_URL at
  // module-load time, not lazily.
  process.env.DATABASE_URL =
    process.env.DATABASE_URL || readEnvValue(ENV_FILE, STAGE, 'DATABASE_URL');
  process.env.OPEN_AI_API_KEY = readEnvValue(ENV_FILE, STAGE, 'OPEN_AI_API_KEY');
  const embeddingModel = readOptionalEnvValue(ENV_FILE, STAGE, 'OPENAI_EMBEDDING_MODEL');
  process.env.OPENAI_MODEL = readEnvValue(ENV_FILE, STAGE, 'OPENAI_MODEL');
  if (embeddingModel) process.env.OPENAI_EMBEDDING_MODEL = embeddingModel;

  console.log(`Stage : ${STAGE}`);
  console.log(`DB    : ${maskDatabaseUrl(process.env.DATABASE_URL)}`);
  console.log(
    `Model : ${process.env.OPENAI_MODEL} / ${process.env.OPENAI_EMBEDDING_MODEL || '(client default)'}\n`,
  );

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {
    buildCambridgeKnowledgeServices,
  } = require('../src/services/cambridge-knowledge/cambridge-knowledge-composition');

  const file = fs.readFileSync(resolvedPath);
  console.log(`Importing ${resolvedPath} (${(file.length / 1024).toFixed(0)} KB)...`);

  const { importKnowledge } = await buildCambridgeKnowledgeServices();

  const startedAt = Date.now();
  try {
    const result = await importKnowledge.execute({
      name,
      description: description ?? null,
      version,
      file,
    });
    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`\nDone in ${elapsedSec}s`);
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('\nFAILED');
    console.error(err);
    process.exit(1);
  }
}

main();
