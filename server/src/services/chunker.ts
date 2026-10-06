/**
 * Structure-aware chunking.
 *  1. Split the document into sections (Markdown headings, PDF pages, or one block for plain text).
 *  2. Inside each section, pack whole paragraphs into chunks of ~maxChars.
 *  3. Paragraphs that are too long are split on sentence boundaries (then hard-split as a last resort).
 *  4. Consecutive chunks of the same section overlap slightly so facts spanning a boundary aren't lost.
 * The section name is stored with each chunk so citations can point at "file › section".
 */
export interface SourceBlock {
  section: string | null;
  text: string;
}

export interface Chunk {
  index: number;
  section: string | null;
  content: string;
}

export interface ChunkOptions {
  maxChars?: number;
  overlapChars?: number;
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

/** Split Markdown into blocks keyed by their heading path, e.g. "Launch plan › Timeline". */
export function splitMarkdown(markdown: string): SourceBlock[] {
  const blocks: SourceBlock[] = [];
  const path: string[] = [];
  let current: string[] = [];
  let inFence = false;

  const flush = () => {
    const text = current.join('\n').trim();
    if (text) blocks.push({ section: path.filter(Boolean).join(' › ') || null, text });
    current = [];
  };

  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const match = !inFence ? HEADING.exec(line) : null;
    if (match) {
      flush();
      const level = match[1].length;
      path.length = level - 1;
      path[level - 1] = match[2].trim();
    } else {
      current.push(line);
    }
  }
  flush();
  return blocks;
}

function splitLong(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const sentences = text.split(/(?<=[.!?])\s+/);
  const pieces: string[] = [];
  let buf = '';
  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      if (buf) pieces.push(buf), (buf = '');
      for (let i = 0; i < sentence.length; i += maxChars) pieces.push(sentence.slice(i, i + maxChars));
      continue;
    }
    if (buf && buf.length + 1 + sentence.length > maxChars) {
      pieces.push(buf);
      buf = sentence;
    } else {
      buf = buf ? `${buf} ${sentence}` : sentence;
    }
  }
  if (buf) pieces.push(buf);
  return pieces;
}

function tail(text: string, chars: number): string {
  if (chars <= 0 || text.length <= chars) return chars <= 0 ? '' : text;
  const slice = text.slice(-chars);
  const firstSpace = slice.indexOf(' ');
  return firstSpace > 0 ? slice.slice(firstSpace + 1) : slice;
}

export function chunkBlocks(blocks: SourceBlock[], opts: ChunkOptions = {}): Chunk[] {
  const maxChars = opts.maxChars ?? 1000;
  const overlapChars = opts.overlapChars ?? 150;
  const chunks: Chunk[] = [];

  for (const block of blocks) {
    const paragraphs = block.text
      .split(/\n\s*\n/)
      .map((p) => p.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim())
      .filter(Boolean)
      .flatMap((p) => splitLong(p, maxChars));

    let buf = '';
    let bufHasNew = false;
    const push = () => {
      if (buf.trim() && bufHasNew) chunks.push({ index: chunks.length, section: block.section, content: buf.trim() });
    };

    for (const paragraph of paragraphs) {
      if (buf && buf.length + 2 + paragraph.length > maxChars) {
        push();
        const overlap = tail(buf, overlapChars);
        buf = overlap && overlap.length + 2 + paragraph.length <= maxChars ? `${overlap}\n\n${paragraph}` : paragraph;
      } else {
        buf = buf ? `${buf}\n\n${paragraph}` : paragraph;
      }
      bufHasNew = true;
    }
    push();
  }
  return chunks;
}
