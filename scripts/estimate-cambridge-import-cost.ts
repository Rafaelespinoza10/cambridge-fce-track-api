/**
 * Free dry-run: extracts + cleans + chunks every PDF in a directory (same
 * steps import-cambridge-pdfs-batch.ts runs before it ever calls OpenAI) and
 * reports page/chunk counts per file. Makes zero network calls, so it costs
 * nothing — use it to see how many classification calls (1 per chunk) and
 * how much text a real import would send before committing to the batch.
 *
 * Usage:
 *   npx ts-node -r ./scripts/md-require-hook.js scripts/estimate-cambridge-import-cost.ts [directory=scripts/fixtures]
 */

import * as fs from 'fs';
import * as path from 'path';

import { extractPdf } from '../src/lib/cambridge-knowledge/cambridge-pdf-extractor';
import { stripRepeatedHeadersAndFooters } from '../src/lib/cambridge-knowledge/cambridge-text-cleaner';
import { chunkPages } from '../src/lib/cambridge-knowledge/cambridge-chunker';

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_FIXTURES_DIR = path.join(ROOT, 'scripts', 'fixtures');

async function main(): Promise<void> {
  const dirArg = process.argv[2];
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

  let totalPages = 0;
  let totalChunks = 0;
  let totalChars = 0;

  console.log(
    `${'File'.padEnd(55)} ${'Pages'.padStart(6)} ${'Chunks'.padStart(7)} ${'Chars'.padStart(9)}`,
  );
  console.log('-'.repeat(80));

  for (const fileName of pdfFiles) {
    const filePath = path.join(targetDir, fileName);
    const buffer = fs.readFileSync(filePath);

    const extracted = await extractPdf(buffer);
    const cleaned = stripRepeatedHeadersAndFooters(extracted.pages);
    const chunks = chunkPages(cleaned);
    const chars = chunks.reduce((sum, c) => sum + c.content.length, 0);

    totalPages += extracted.pageCount;
    totalChunks += chunks.length;
    totalChars += chars;

    const label = fileName.length > 55 ? fileName.slice(0, 52) + '...' : fileName;
    console.log(
      `${label.padEnd(55)} ${String(extracted.pageCount).padStart(6)} ${String(chunks.length).padStart(7)} ${String(chars).padStart(9)}`,
    );
  }

  console.log('-'.repeat(80));
  console.log(
    `${'TOTAL'.padEnd(55)} ${String(totalPages).padStart(6)} ${String(totalChunks).padStart(7)} ${String(totalChars).padStart(9)}`,
  );
  console.log('');
  console.log(
    `${totalChunks} chunks -> ${totalChunks} classification LLM calls (bounded 5-at-a-time) + ${pdfFiles.length} batched embedding calls (1 per document).`,
  );
  console.log(
    `~${Math.round(totalChars / 4)} input tokens of raw chunk text across all classification calls (rough 4 chars/token estimate; classification prompts add their own instruction overhead on top of this, and each call also spends up to 500 output tokens on the structured response).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
