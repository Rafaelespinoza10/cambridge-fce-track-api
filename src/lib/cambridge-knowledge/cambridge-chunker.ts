/**
 * Splits cleaned per-page PDF text into semantic chunks for embedding.
 * Every chunk carries the exact 1-based `sourcePage` it came from — chunks
 * never span two pages, so page traceability (see the class doc comment on
 * CambridgeKnowledgeItem) is exact, not approximate.
 *
 * Chunking never crosses a page boundary, and within a page it prefers to
 * break right before a line that looks like the start of a new numbered
 * item, exercise, question or exam part (BOUNDARY_PATTERN) rather than at
 * an arbitrary character offset — that's what keeps a numbered exercise or
 * worked example from being split across two chunks (the "no perder
 * ejercicios, reglas o ejemplos importantes" requirement). HARD_MAX_CHARS
 * is a fallback only: if a single block of text (e.g. a long reading
 * passage with no numbered breaks) runs past it, the chunk still ends at a
 * line boundary — never mid-line, never mid-sentence-token.
 */

export interface CambridgeChunk {
  content: string;
  /** 1-based page number in the source PDF. */
  sourcePage: number;
  /** 0-based index of this chunk within its page — several chunks can share a sourcePage. */
  chunkIndexInPage: number;
}

const SOFT_MIN_CHARS = 400;
const TARGET_MAX_CHARS = 1500;
const HARD_MAX_CHARS = 2500;

const BOUNDARY_PATTERN =
  /^\s*(\d{1,2}[.)]\s|\(\d{1,2}\)\s|part\s+\d+\b|question\s+\d+\b|exercise\s+\d+\b|example\s*:)/i;

function flush(buffer: string[]): string | null {
  const content = buffer.join('\n').trim();
  return content === '' ? null : content;
}

/** Chunks a single already-cleaned page. Never returns a chunk spanning more than one page. */
function chunkPage(pageText: string): string[] {
  const lines = pageText.split('\n');
  const chunks: string[] = [];
  let buffer: string[] = [];
  let bufferLength = 0;

  for (const line of lines) {
    const isBoundary = BOUNDARY_PATTERN.test(line);
    const wouldExceedTarget = bufferLength + line.length + 1 > TARGET_MAX_CHARS;
    const mustFlush = bufferLength + line.length + 1 > HARD_MAX_CHARS;

    if (buffer.length > 0 && (mustFlush || (isBoundary && wouldExceedTarget && bufferLength >= SOFT_MIN_CHARS))) {
      const content = flush(buffer);
      if (content !== null) chunks.push(content);
      buffer = [];
      bufferLength = 0;
    }

    buffer.push(line);
    bufferLength += line.length + 1;
  }

  const last = flush(buffer);
  if (last !== null) chunks.push(last);
  return chunks;
}

/** Chunks every page of an already-cleaned PDF extraction. `pages[i]` maps to sourcePage `i + 1`. */
export function chunkPages(pages: readonly string[]): CambridgeChunk[] {
  const result: CambridgeChunk[] = [];
  pages.forEach((pageText, pageIndex) => {
    const pageChunks = chunkPage(pageText);
    pageChunks.forEach((content, chunkIndexInPage) => {
      result.push({ content, sourcePage: pageIndex + 1, chunkIndexInPage });
    });
  });
  return result;
}
