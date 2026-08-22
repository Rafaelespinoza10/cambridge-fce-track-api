/**
 * Builds a real, valid multi-page PDF from plain text, one entry per page —
 * used only by tests (unit tests and the real-PDF validation pass for
 * ImportCambridgeKnowledgeService), never by production code.
 *
 * Hand-written PDF 1.4 syntax rather than a PDF-authoring library: an
 * earlier version of this file used `pdf-lib`, but pdf-lib's `save()`
 * intermittently produced a malformed xref table that pdf-parse's bundled
 * pdfjs rejected ("bad XRef entry") — reproducible on a fraction of calls
 * with no useObjectStreams setting that fixed it reliably. This version has
 * no compression and no embedded font program (text uses the standard
 * Helvetica base-14 font by name, which every PDF reader — including
 * pdfjs — resolves without any embedded font data), so there is nothing
 * left that could vary between runs: same input text always produces the
 * exact same bytes.
 */

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN_LEFT = 50;
const MARGIN_TOP = 760;
const LINE_HEIGHT = 16;
const FONT_SIZE = 11;

/** Escapes the 3 characters PDF string literals `( ... )` treat specially. */
function escapePdfString(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildContentStream(pageText: string): string {
  const lines = pageText.split('\n');
  const commands: string[] = ['BT', `/F1 ${FONT_SIZE} Tf`];
  let y = MARGIN_TOP;
  for (const line of lines) {
    commands.push(`1 0 0 1 ${MARGIN_LEFT} ${y} Tm`, `(${escapePdfString(line)}) Tj`);
    y -= LINE_HEIGHT;
  }
  commands.push('ET');
  return commands.join('\n');
}

/**
 * Builds a minimal, valid, fully deterministic multi-page PDF. Requires at
 * least 1 page (unlike an earlier pdf-lib-based version of this helper,
 * this one has no page-count-dependent quirks).
 */
export function buildTestPdf(pages: string[]): Buffer {
  if (pages.length === 0) {
    throw new Error('buildTestPdf requires at least 1 page');
  }

  const pageCount = pages.length;
  // Object numbering: 1 = Catalog, 2 = Pages, 3 = Font,
  // 4..(4+N-1) = Page objects, (4+N)..(4+2N-1) = content stream objects.
  const catalogObjNum = 1;
  const pagesObjNum = 2;
  const fontObjNum = 3;
  const pageObjNums = pages.map((_, i) => 4 + i);
  const contentObjNums = pages.map((_, i) => 4 + pageCount + i);

  const objects: string[] = [];
  objects[catalogObjNum] = `<< /Type /Catalog /Pages ${pagesObjNum} 0 R >>`;
  objects[pagesObjNum] =
    `<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageCount} >>`;
  objects[fontObjNum] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;

  pages.forEach((_, i) => {
    objects[pageObjNums[i]] =
      `<< /Type /Page /Parent ${pagesObjNum} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 ${fontObjNum} 0 R >> >> /Contents ${contentObjNums[i]} 0 R >>`;
  });

  pages.forEach((pageText, i) => {
    const stream = buildContentStream(pageText);
    // Byte length, not string length — content is ASCII-only here (PDF
    // literal strings), so they're equal, but computed correctly regardless.
    const length = Buffer.byteLength(stream, 'utf8');
    objects[contentObjNums[i]] = `<< /Length ${length} >>\nstream\n${stream}\nendstream`;
  });

  const totalObjects = 3 + 2 * pageCount;
  const header = '%PDF-1.4\n';
  let body = header;
  const offsets: number[] = new Array(totalObjects + 1).fill(0);

  for (let num = 1; num <= totalObjects; num++) {
    offsets[num] = Buffer.byteLength(body, 'utf8');
    body += `${num} 0 obj\n${objects[num]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(body, 'utf8');
  let xref = `xref\n0 ${totalObjects + 1}\n0000000000 65535 f \n`;
  for (let num = 1; num <= totalObjects; num++) {
    xref += `${String(offsets[num]).padStart(10, '0')} 00000 n \n`;
  }

  const trailer =
    `trailer\n<< /Size ${totalObjects + 1} /Root ${catalogObjNum} 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(body + xref + trailer, 'utf8');
}
