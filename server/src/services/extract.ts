import path from 'node:path';
// Import the library entry directly: pdf-parse's index.js runs a debug harness when required as main.
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { badRequest } from '../lib/errors';
import { SourceBlock, splitMarkdown } from './chunker';

export const SUPPORTED_EXTENSIONS = ['.pdf', '.md', '.markdown', '.txt', '.csv', '.json'];

export interface ExtractedDocument {
  blocks: SourceBlock[];
  /** Normalised full text — hashed to make ingestion idempotent. */
  normalizedText: string;
}

async function extractPdfPages(buffer: Buffer): Promise<SourceBlock[]> {
  const pages: SourceBlock[] = [];
  await pdfParse(buffer, {
    pagerender: async (pageData: any) => {
      const content = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
      let lastY: number | undefined;
      let text = '';
      for (const item of content.items) {
        if (lastY === undefined || lastY === item.transform[5]) text += item.str;
        else text += '\n' + item.str;
        lastY = item.transform[5];
      }
      const pageNumber: number = pageData.pageNumber ?? (pageData.pageIndex ?? pages.length) + 1;
      pages.push({ section: `Page ${pageNumber}`, text });
      return text;
    },
  });
  return pages;
}

export async function extractDocument(buffer: Buffer, filename: string): Promise<ExtractedDocument> {
  const ext = path.extname(filename).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw badRequest(`Unsupported file type "${ext || 'unknown'}". Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`);
  }

  let blocks: SourceBlock[];
  if (ext === '.pdf') {
    try {
      blocks = await extractPdfPages(buffer);
    } catch {
      throw badRequest(`Could not read PDF "${filename}". Is it a valid, unencrypted PDF?`);
    }
  } else {
    const text = buffer.toString('utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    blocks = ext === '.md' || ext === '.markdown' ? splitMarkdown(text) : [{ section: null, text }];
  }

  blocks = blocks.map((b) => ({ ...b, text: b.text.replace(/\u0000/g, '').trim() })).filter((b) => b.text);
  const normalizedText = blocks
    .map((b) => `${b.section ?? ''}\n${b.text}`)
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalizedText) {
    throw badRequest(`"${filename}" contains no extractable text (scanned PDFs are not supported).`);
  }
  return { blocks, normalizedText };
}
