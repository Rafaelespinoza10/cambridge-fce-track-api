import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { stripRepeatedHeadersAndFooters } from './cambridge-text-cleaner';

// Padding lines keep `body` at index 2 — safely outside both the top
// {0,1} and bottom edge zones — regardless of how short the page is,
// so tests can assert on body content without also fighting edge-zone math.
function pageWith(header: string, body: string, footer: string): string {
  return [header, 'pad-top', body, 'pad-bottom', footer].join('\n');
}

describe('stripRepeatedHeadersAndFooters', () => {
  it('removes a header/footer line repeated (with a changing page number) across most pages', () => {
    const pages = [
      pageWith('Cambridge English: First for Schools', 'Reading Part 1 content.', 'Page 1'),
      pageWith('Cambridge English: First for Schools', 'Reading Part 2 content.', 'Page 2'),
      pageWith('Cambridge English: First for Schools', 'Reading Part 3 content.', 'Page 3'),
      pageWith('Cambridge English: First for Schools', 'Reading Part 4 content.', 'Page 4'),
    ];

    const cleaned = stripRepeatedHeadersAndFooters(pages);

    for (const page of cleaned) {
      assert.ok(!page.includes('Cambridge English: First for Schools'));
      assert.ok(!/^Page \d+$/m.test(page));
    }
    // Body content is never touched.
    assert.ok(cleaned[0].includes('Reading Part 1 content.'));
    assert.ok(cleaned[3].includes('Reading Part 4 content.'));
  });

  it('never removes a long line even if it sits in the edge zone and repeats', () => {
    const longRepeated =
      'This exact long instructional sentence appears at the top of every single page of this handbook section.';
    const pages = [
      pageWith(longRepeated, 'Body A', 'Footer'),
      pageWith(longRepeated, 'Body B', 'Footer'),
      pageWith(longRepeated, 'Body C', 'Footer'),
    ];

    const cleaned = stripRepeatedHeadersAndFooters(pages);

    for (const page of cleaned) {
      assert.ok(page.includes(longRepeated));
    }
  });

  it('never removes short edge content that genuinely differs (not just by digits) across pages', () => {
    const pages = [
      pageWith('Introduction', 'Unique exercise A', 'End of section'),
      pageWith('Grammar Focus', 'Unique exercise B', 'Answer key'),
      pageWith('Vocabulary Bank', 'Unique exercise C', 'Further practice'),
    ];

    const cleaned = stripRepeatedHeadersAndFooters(pages);

    assert.ok(cleaned[0].includes('Introduction'));
    assert.ok(cleaned[1].includes('Grammar Focus'));
    assert.ok(cleaned[2].includes('Vocabulary Bank'));
  });

  it('strips a running header even when it embeds a changing part/page number', () => {
    // "Part 1"/"Part 2"/"Part 3" normalize to the same "part #" pattern —
    // this is real running-header behavior (e.g. "Page 1 of 12"), not noise.
    const pages = [
      pageWith('Part 1', 'Unique exercise A', 'Footer'),
      pageWith('Part 2', 'Unique exercise B', 'Footer'),
      pageWith('Part 3', 'Unique exercise C', 'Footer'),
    ];

    const cleaned = stripRepeatedHeadersAndFooters(pages);

    assert.ok(!cleaned[0].includes('Part 1'));
    assert.ok(!cleaned[1].includes('Part 2'));
    assert.ok(cleaned[0].includes('Unique exercise A'));
  });

  it('leaves every page byte-for-byte unchanged when there are too few pages to detect a pattern', () => {
    const pages = ['Header\nBody\nFooter', 'Header\nBody\nFooter'];
    assert.deepEqual(stripRepeatedHeadersAndFooters(pages), pages);
  });

  it('never mutates body content safely inside the page, only the edge zone', () => {
    // 9 lines: 2-line edge zones (top/bottom) bracket a body that's never
    // touched, regardless of repetition.
    const page = [
      'Running Header',
      'pad-top',
      'Line A',
      'Line B',
      'Line C',
      'pad-bottom',
      'Running Footer',
    ].join('\n');
    const pages = [page, page, page];

    const cleaned = stripRepeatedHeadersAndFooters(pages);

    for (const cleanedPage of cleaned) {
      assert.ok(cleanedPage.includes('Line A'));
      assert.ok(cleanedPage.includes('Line B'));
      assert.ok(cleanedPage.includes('Line C'));
      assert.ok(!cleanedPage.includes('Running Header'));
      assert.ok(!cleanedPage.includes('Running Footer'));
    }
  });
});
