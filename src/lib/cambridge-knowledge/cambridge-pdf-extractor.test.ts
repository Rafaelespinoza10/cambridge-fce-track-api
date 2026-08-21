import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { extractPdf, sha256Hex } from './cambridge-pdf-extractor';
import { buildTestPdf } from '../../test-fixtures/build-test-pdf';

// Only ONE distinct real PDF buffer is parsed by more than one test in this
// file (module-level PDF below) — pdf-parse's bundled pdfjs turns out to
// leak state across DIFFERENT documents parsed back-to-back in one process
// (reproducible: 9/20 failures interleaving just 2 distinct buffers), but
// is 100% reliable re-parsing the SAME buffer repeatedly. The one
// deliberately-invalid buffer test runs last, so even if it leaves that
// leaked state dirty, nothing after it depends on a clean parser.
const PDF = buildTestPdf([
  'Reading Part 1 — Multiple Choice Cloze.',
  'Complete the text with the correct word.',
  'Answer key: 1B 2A 3C',
]);

describe('extractPdf — real pdf-parse integration', () => {
  it('extracts the exact page count and per-page text of a real multi-page PDF', async () => {
    const result = await extractPdf(PDF);

    assert.equal(result.pageCount, 3);
    assert.equal(result.pages.length, 3);
    assert.ok(result.pages[0].includes('Reading Part 1'));
    assert.ok(result.pages[1].includes('Complete the text'));
    assert.ok(result.pages[2].includes('Answer key'));
  });

  it('returns a 64-character lowercase hex sha256 checksum', async () => {
    const result = await extractPdf(PDF);
    assert.match(result.checksum, /^[0-9a-f]{64}$/);
  });

  it('checksum matches sha256Hex(buffer) directly — no separate hashing logic to drift', async () => {
    const result = await extractPdf(PDF);
    assert.equal(result.checksum, sha256Hex(PDF));
  });

  it('is idempotent: parsing the identical buffer twice yields the identical checksum and page text', async () => {
    const first = await extractPdf(PDF);
    const second = await extractPdf(PDF);
    assert.equal(first.checksum, second.checksum);
    assert.deepEqual(first.pages, second.pages);
  });

  it('rejects a buffer that is not a real PDF', async () => {
    await assert.rejects(() => extractPdf(Buffer.from('this is not a pdf at all')));
  });
});
