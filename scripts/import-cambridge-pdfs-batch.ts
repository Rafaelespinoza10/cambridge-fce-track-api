/**
 * Batch version of scripts/import-cambridge-pdf.ts — imports every *.pdf in
 * a directory into the Cambridge Knowledge Base, one at a time (sequential,
 * not parallel, so one document's classification calls don't compete with
 * another's for OpenAI rate limits). Same direct-service-call approach, so
 * it isn't subject to the ~29s httpApi hard timeout and doesn't need an
 * admin JWT.
 *
 * Each PDF's `name` is derived from its filename (e.g. "b2-first-handbook-2024.pdf"
 * -> "B2 First Handbook 2024"). All files in one run share the same
 * `version`/`description` — run the script again with a different version
 * for a different batch.
 *
 * Usage:
 *   npx ts-node -r ./scripts/md-require-hook.js scripts/import-cambridge-pdfs-batch.ts <version> ["<description>"] [directory=scripts/fixtures]
 *
 * Example:
 *   npx ts-node -r ./scripts/md-require-hook.js scripts/import-cambridge-pdfs-batch.ts "2024" "Sample papers batch"
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');
const ENV_FILE = path.join(ROOT, 'serverless.env.yml');
const STAGE = process.env.STAGE || 'dev';
const DEFAULT_FIXTURES_DIR = path.join(ROOT, 'scripts', 'fixtures');

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

function nameFromFilename(fileName: string): string {
  const base = fileName.replace(/\.pdf$/i, '');
  return base
    .replace(/[-_]+/g, ' ')
    .trim()
    .split(' ')
    .map((word) => (word.length > 0 ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
}

async function main(): Promise<void> {
  const [version, description, dirArg] = process.argv.slice(2);
  if (!version) {
    console.error(
      'Usage: import-cambridge-pdfs-batch.ts <version> ["<description>"] [directory=scripts/fixtures]',
    );
    process.exit(1);
  }

  const targetDir = dirArg ? path.resolve(dirArg) : DEFAULT_FIXTURES_DIR;
  if (!fs.existsSync(targetDir)) {
    console.error(`ERROR: directory not found: ${targetDir}`);
    process.exit(1);
  }

  const pdfFiles = fs
    .readdirSync(targetDir)
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .sort();

  if (pdfFiles.length === 0) {
    console.error(`No .pdf files found in ${targetDir}`);
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
    `Model : ${process.env.OPENAI_MODEL} / ${process.env.OPENAI_EMBEDDING_MODEL || '(client default)'}`,
  );
  console.log(`Found : ${pdfFiles.length} PDF(s) in ${targetDir}\n`);

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {
    buildCambridgeKnowledgeServices,
  } = require('../src/services/cambridge-knowledge/cambridge-knowledge-composition');
  const { importKnowledge } = await buildCambridgeKnowledgeServices();

  let ok = 0;
  let replay = 0;
  let failed = 0;

  for (const fileName of pdfFiles) {
    const filePath = path.join(targetDir, fileName);
    const name = nameFromFilename(fileName);
    process.stdout.write(`→ ${fileName} as "${name}"... `);
    const startedAt = Date.now();

    try {
      const file = fs.readFileSync(filePath);
      const result = await importKnowledge.execute({
        name,
        description: description ?? null,
        version,
        file,
      });
      const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);

      if (result.idempotentReplay) {
        replay++;
        console.log(`already imported (${elapsedSec}s, sourceId=${result.source.id})`);
      } else {
        ok++;
        console.log(
          `ok, ${result.chunkCount} chunks (${elapsedSec}s, sourceId=${result.source.id})`,
        );
      }
    } catch (err) {
      failed++;
      console.log('FAILED');
      console.error(`  ${(err as Error).name}: ${(err as Error).message}`);
    }
  }

  console.log('\n---');
  console.log(
    `${ok} imported, ${replay} already existed, ${failed} failed (of ${pdfFiles.length})`,
  );
  process.exit(failed > 0 ? 1 : 0);
}

main();
