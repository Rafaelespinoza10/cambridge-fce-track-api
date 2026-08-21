/**
 * Splits one PDF into N smaller PDFs by page range, using pdf-lib. Written
 * to reduce the blast radius of ImportCambridgeKnowledgeService's all-or-nothing
 * per-document classification: if one chunk anywhere in a large document gets
 * an invalid LLM response, the WHOLE document's import fails and must be
 * retried from scratch. Splitting a big document first means a failed part
 * only costs re-classifying that smaller part, not the whole thing.
 *
 * Usage:
 *   npx ts-node -r ./scripts/md-require-hook.js scripts/split-cambridge-pdf.ts <path-to-pdf> <numParts> [outputDir]
 *
 * Example:
 *   npx ts-node -r ./scripts/md-require-hook.js scripts/split-cambridge-pdf.ts scripts/fixtures/batch2/b2_first_handbook_for_teachers.pdf 4 scripts/fixtures/batch2
 */

import * as fs from 'fs';
import * as path from 'path';
import { PDFDocument } from 'pdf-lib';

async function main(): Promise<void> {
  const [inputPath, numPartsArg, outDirArg] = process.argv.slice(2);
  if (!inputPath || !numPartsArg) {
    console.error('Usage: split-cambridge-pdf.ts <path-to-pdf> <numParts> [outputDir]');
    process.exit(1);
  }

  const numParts = parseInt(numPartsArg, 10);
  if (!Number.isInteger(numParts) || numParts < 2) {
    console.error('numParts must be an integer >= 2');
    process.exit(1);
  }

  const resolvedInput = path.resolve(inputPath);
  if (!fs.existsSync(resolvedInput)) {
    console.error(`ERROR: file not found: ${resolvedInput}`);
    process.exit(1);
  }
  const outDir = outDirArg ? path.resolve(outDirArg) : path.dirname(resolvedInput);
  fs.mkdirSync(outDir, { recursive: true });

  const bytes = fs.readFileSync(resolvedInput);
  const srcDoc = await PDFDocument.load(bytes);
  const totalPages = srcDoc.getPageCount();
  const pagesPerPart = Math.ceil(totalPages / numParts);
  const baseName = path.basename(resolvedInput, path.extname(resolvedInput));

  console.log(`${totalPages} pages -> ${numParts} part(s) of up to ${pagesPerPart} pages each\n`);

  for (let i = 0; i < numParts; i++) {
    const startPage = i * pagesPerPart;
    if (startPage >= totalPages) break;
    const endPage = Math.min(startPage + pagesPerPart, totalPages);

    const partDoc = await PDFDocument.create();
    const indices = Array.from({ length: endPage - startPage }, (_, k) => startPage + k);
    const copiedPages = await partDoc.copyPages(srcDoc, indices);
    copiedPages.forEach((p) => partDoc.addPage(p));

    const partBytes = await partDoc.save();
    const outPath = path.join(outDir, `${baseName}-part${i + 1}of${numParts}.pdf`);
    fs.writeFileSync(outPath, partBytes);
    console.log(`Wrote ${outPath} (pages ${startPage + 1}-${endPage})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
