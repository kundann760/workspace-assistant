import { describe, expect, it } from 'vitest';
import { chunkBlocks, splitMarkdown } from '../src/services/chunker';

describe('splitMarkdown', () => {
  it('tracks the heading path as the section', () => {
    const blocks = splitMarkdown('# Plan\nintro\n## Timeline\nMay launch\n## Budget\n4 crore\n# Other\nx');
    expect(blocks).toEqual([
      { section: 'Plan', text: 'intro' },
      { section: 'Plan › Timeline', text: 'May launch' },
      { section: 'Plan › Budget', text: '4 crore' },
      { section: 'Other', text: 'x' },
    ]);
  });

  it('ignores headings inside code fences', () => {
    const blocks = splitMarkdown('# A\n```\n# not a heading\n```\n');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toContain('# not a heading');
  });
});

describe('chunkBlocks', () => {
  it('keeps small sections as a single chunk', () => {
    const chunks = chunkBlocks([{ section: 'S', text: 'one\n\ntwo' }]);
    expect(chunks).toEqual([{ index: 0, section: 'S', content: 'one\n\ntwo' }]);
  });

  it('respects maxChars and overlaps consecutive chunks', () => {
    const paragraphs = Array.from({ length: 12 }, (_, i) => `Paragraph ${i} ` + 'word '.repeat(30)).join('\n\n');
    const chunks = chunkBlocks([{ section: null, text: paragraphs }], { maxChars: 400, overlapChars: 60 });
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(400);
    // indices are sequential across the document
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
    // overlap: the start of chunk 2 repeats text from the end of chunk 1
    const tailWords = chunks[0].content.slice(-30).trim().split(' ').slice(-2).join(' ');
    expect(chunks[1].content).toContain(tailWords);
  });

  it('splits a single huge paragraph on sentences', () => {
    const text = Array.from({ length: 50 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
    const chunks = chunkBlocks([{ section: null, text }], { maxChars: 200, overlapChars: 0 });
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(200);
    expect(chunks.map((c) => c.content).join(' ')).toContain('Sentence number 49 is here.');
  });

  it('is deterministic (same input → same chunks), which idempotent ingestion relies on', () => {
    const blocks = [{ section: 'A', text: 'x '.repeat(2000) }];
    expect(chunkBlocks(blocks)).toEqual(chunkBlocks(blocks));
  });
});
