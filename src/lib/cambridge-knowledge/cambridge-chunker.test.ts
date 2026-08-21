import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { chunkPages } from './cambridge-chunker';

describe('chunkPages', () => {
  it('every chunk carries the exact 1-based sourcePage it came from', () => {
    const pages = ['Page one content.', 'Page two content.', 'Page three content.'];
    const chunks = chunkPages(pages);

    assert.equal(chunks.length, 3);
    assert.equal(chunks[0].sourcePage, 1);
    assert.equal(chunks[1].sourcePage, 2);
    assert.equal(chunks[2].sourcePage, 3);
  });

  it('never merges content from two different pages into one chunk', () => {
    const pages = ['Short page A.', 'Short page B.'];
    const chunks = chunkPages(pages);

    for (const chunk of chunks) {
      assert.ok(!chunk.content.includes('page A') || !chunk.content.includes('page B'));
    }
    assert.deepEqual(
      chunks.map((c) => c.sourcePage),
      [1, 2],
    );
  });

  it('keeps a short numbered exercise intact in a single chunk rather than splitting it', () => {
    const exercise = [
      '1. Complete the sentence with the correct word.',
      'I ________ (go) to school every day.',
      '2. Choose the correct option.',
      'She (A) has gone (B) has go (C) go to Paris.',
    ].join('\n');
    const chunks = chunkPages([exercise]);

    assert.equal(chunks.length, 1);
    assert.ok(chunks[0].content.includes('1. Complete the sentence'));
    assert.ok(chunks[0].content.includes('2. Choose the correct option'));
  });

  it('prefers to split at the start of a new numbered item once the soft target size is passed', () => {
    const filler = 'This is a long reading passage sentence that adds bulk to the page. '.repeat(13);
    const page = [
      `1. ${filler}`,
      `2. ${filler}`,
    ].join('\n');
    const chunks = chunkPages([page]);

    // Each item is well past SOFT_MIN_CHARS on its own, so the boundary
    // before "2." should trigger a split instead of merging both items.
    assert.ok(chunks.length >= 2);
    assert.ok(chunks[0].content.trim().startsWith('1.'));
    assert.ok(chunks.some((c) => c.content.trim().startsWith('2.')));
  });

  it('force-splits a single block with no numbered boundaries once it exceeds the hard max, without cutting a line in half', () => {
    const longLine = 'word '.repeat(20); // ~100 chars per line, no boundary markers
    const lines = Array.from({ length: 40 }, () => longLine.trim());
    const chunks = chunkPages([lines.join('\n')]);

    assert.ok(chunks.length > 1);
    for (const chunk of chunks) {
      // Every line inside a chunk is a complete line from the source — never a truncated fragment mid-word.
      for (const line of chunk.content.split('\n')) {
        assert.ok(line === '' || line === longLine.trim());
      }
    }
  });

  it('assigns sequential 0-based chunkIndexInPage values within a page', () => {
    const longLine = 'word '.repeat(20);
    const lines = Array.from({ length: 40 }, () => longLine.trim());
    const chunks = chunkPages([lines.join('\n')]);

    assert.deepEqual(
      chunks.map((c) => c.chunkIndexInPage),
      chunks.map((_, i) => i),
    );
  });

  it('drops a blank page instead of producing an empty chunk', () => {
    const chunks = chunkPages(['Real content here.', '   \n  \n', 'More real content.']);

    assert.equal(chunks.length, 2);
    assert.deepEqual(
      chunks.map((c) => c.sourcePage),
      [1, 3],
    );
  });

  it('returns no chunks for an empty pages array', () => {
    assert.deepEqual(chunkPages([]), []);
  });
});
