import type { Query } from 'firebase-admin/firestore';
import { config } from '../config';
import { col } from '../lib/firestore';
import { embedQuery } from '../lib/gemini';

export interface RetrievedChunk {
  chunkId: string;
  workspaceId: string;
  documentId: string;
  filename: string;
  section: string | null;
  chunkIndex: number;
  content: string;
  similarity: number | null;
  vectorRank: number | null;
  keywordRank: number | null;
  rrfScore: number;
  /** True when the chunk belongs to a document explicitly shared INTO this workspace. */
  shared: boolean;
}

export interface RetrievalResult {
  workspaceId: string;
  query: string;
  chunks: RetrievedChunk[];
  /** Candidates dropped for being below the similarity floor with no keyword match. */
  droppedCount: number;
  hit: boolean;
  latencyMs: number;
}

export class VectorIndexError extends Error {
  constructor() {
    super(
      'The Firestore vector index is missing or still building. Deploy it with ' +
        '"npx firebase-tools deploy --only firestore" (SETUP_GUIDE.md, Step 4) and wait until it shows "Enabled".',
    );
    this.name = 'VectorIndexError';
  }
}

/** Max documents shared into one workspace that retrieval will consider. */
const MAX_SHARED_DOCS = 10;

const STOPWORDS = new Set(
  ('a an and are as at be by can do does for from has have how i in is it its me my of on or our that the their ' +
    'there this to was we what when where which who why will with you your about tell give please').split(' '),
);

/** Lower-cased content words, with a light plural/suffix strip so "risks" matches "risk". */
export function keywordTerms(text: string): string[] {
  return [...new Set((text.toLowerCase().match(/[a-z0-9][a-z0-9-]*/g) ?? []).filter((w) => !STOPWORDS.has(w)))].map((w) =>
    w.length > 4 ? w.replace(/(ies|es|s)$/, '') : w,
  );
}

/**
 * Re-rank vector candidates with a keyword score (IDF-weighted term overlap within the candidate set),
 * then fuse both rankings with Reciprocal Rank Fusion. Keyword matching rescues exact identifiers
 * (codes, names, numbers) that embeddings blur. It only re-orders chunks that already passed the
 * workspace filter, so it can never widen what a workspace can see.
 */
export function hybridRerank(question: string, candidates: Omit<RetrievedChunk, 'keywordRank' | 'rrfScore'>[]): RetrievedChunk[] {
  const terms = keywordTerms(question);
  const docTerms = candidates.map((c) => new Set(keywordTerms(`${c.section ?? ''} ${c.content}`)));
  const df = new Map(terms.map((t) => [t, docTerms.filter((s) => s.has(t)).length]));
  const n = candidates.length;

  const kwScores = candidates.map((_, i) =>
    terms.reduce((sum, t) => (docTerms[i].has(t) ? sum + Math.log(1 + n / (df.get(t) || 1)) : sum), 0),
  );
  const kwOrder = kwScores
    .map((score, i) => ({ score, i }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  const kwRank = new Map(kwOrder.map((x, rank) => [x.i, rank + 1]));

  return candidates
    .map((c, i) => {
      const keywordRank = kwRank.get(i) ?? null;
      const rrfScore = (c.vectorRank ? 1 / (60 + c.vectorRank) : 0) + (keywordRank ? 1 / (60 + keywordRank) : 0);
      return { ...c, keywordRank, rrfScore };
    })
    .sort((a, b) => b.rrfScore - a.rrfScore);
}

/**
 * ISOLATION: every nearest-neighbour query carries an equality pre-filter that Firestore applies
 * INSIDE the vector search (composite vector index):
 *   - where('workspace_id', '==', activeWorkspace)  → the workspace's own chunks
 *   - where('document_id', '==', id)               → only for documents explicitly shared into it
 * Chunks from any other workspace are never candidates, so they can't be ranked, cited or acted on.
 */
export async function retrieve(workspaceId: string, question: string, topK = config.RAG_TOP_K): Promise<RetrievalResult> {
  const started = Date.now();
  const [embedding, sharedSnap] = await Promise.all([
    embedQuery(question),
    col.documents.where('shared_with', 'array-contains', workspaceId).limit(MAX_SHARED_DOCS).get(),
  ]);

  const nearest = (base: Query) =>
    base
      .findNearest({
        vectorField: 'embedding',
        queryVector: embedding,
        limit: config.RAG_CANDIDATES,
        distanceMeasure: 'COSINE',
        distanceResultField: 'vector_distance',
      })
      .get();

  let snaps;
  try {
    snaps = await Promise.all([
      nearest(col.chunks.where('workspace_id', '==', workspaceId)),
      ...sharedSnap.docs
        .filter((d) => d.get('status') === 'ready')
        .map((d) => nearest(col.chunks.where('document_id', '==', d.id))),
    ]);
  } catch (err) {
    // gRPC code 9 = FAILED_PRECONDITION: the composite vector index is missing or still building.
    if ((err as { code?: number }).code === 9) throw new VectorIndexError();
    throw err;
  }

  const candidates = snaps
    .flatMap((s) => s.docs)
    .map((d) => {
      const distance = Number(d.get('vector_distance'));
      return {
        chunkId: d.id,
        workspaceId: d.get('workspace_id') as string,
        documentId: d.get('document_id') as string,
        filename: d.get('filename') as string,
        section: (d.get('section') as string | null) ?? null,
        chunkIndex: d.get('chunk_index') as number,
        content: d.get('content') as string,
        similarity: Number.isFinite(distance) ? 1 - distance : null,
        shared: d.get('workspace_id') !== workspaceId,
      };
    })
    .sort((a, b) => (b.similarity ?? -1) - (a.similarity ?? -1))
    .slice(0, config.RAG_CANDIDATES)
    .map((c, i) => ({ ...c, vectorRank: i + 1 }));

  const ranked = hybridRerank(question, candidates);
  // Drop weak vector-only matches: they tempt the model into confident nonsense.
  const relevant = ranked.filter((c) => c.keywordRank !== null || (c.similarity ?? 0) >= config.RAG_MIN_SIMILARITY);
  const chunks = relevant.slice(0, topK);

  return {
    workspaceId,
    query: question,
    chunks,
    droppedCount: ranked.length - relevant.length,
    hit: chunks.length > 0,
    latencyMs: Date.now() - started,
  };
}
