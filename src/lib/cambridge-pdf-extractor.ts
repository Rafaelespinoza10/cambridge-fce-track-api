import { createHash } from 'node:crypto';
// `pdf-parse` ships a CommonJS `export =`; without esModuleInterop this is
// the correct import shape (same as `import * as jwt from 'jsonwebtoken'`
// in lib/jwt.ts) — `pdfParse` below is the callable function itself.
import * as pdfParse from 'pdf-parse';

export interface ExtractedPdf {
  /** sha256 hex digest of the raw PDF bytes — see CambridgeSource.checksum. */
  checksum: string;
  pageCount: number;
  /** One entry per page, 0-indexed internally but always reported 1-based to callers (see toPageNumber). */
  pages: string[];
}

export function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Extracts raw text from a PDF, one entry per page, plus the sha256
 * checksum of the input bytes (used by ImportCambridgeKnowledgeService for
 * idempotency). Page boundaries are preserved by supplying pdf-parse a
 * custom `pagerender` that captures each page's text as it's rendered,
 * instead of relying on the library's single concatenated `.text` output —
 * that's what lets every downstream chunk keep an exact source page number
 * (see cambridge-chunker.ts and the "Trazabilidad" section of
 * docs/cambridge-knowledge-base.md).
 */
export async function extractPdf(buffer: Buffer): Promise<ExtractedPdf> {
  const pages: string[] = [];

  await pdfParse(buffer, {
    version: 'v2.0.550',
    pagerender: async (pageData: {
      getTextContent: (options: {
        normalizeWhitespace: boolean;
        disableCombineTextItems: boolean;
      }) => Promise<{ items: Array<{ str: string; transform: number[] }> }>;
    }) => {
      const textContent = await pageData.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: false,
      });
      let lastY: number | undefined;
      let text = '';
      for (const item of textContent.items) {
        const y = item.transform[5];
        if (lastY === undefined || lastY === y) {
          text += item.str;
        } else {
          text += '\n' + item.str;
        }
        lastY = y;
      }
      pages.push(text);
      return text;
    },
  });

  return {
    checksum: sha256Hex(buffer),
    pageCount: pages.length,
    pages,
  };
}
