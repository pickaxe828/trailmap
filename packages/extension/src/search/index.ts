import MiniSearch from 'minisearch';
import { cosine, quantize, type Embedder } from '../embeddings/embedder';

export type SearchKind = 'page' | 'concept' | 'note';
export type SearchResult = { id: string; kind: SearchKind; title: string; href: string; detail: string; snippet: string };
export type SearchDocument = Omit<SearchResult, 'snippet'> & {
  body: string;
  semanticText?: string;
  embedding?: Int8Array | null;
};

type Entry = { document: SearchDocument; vector?: Int8Array | null };
const CANDIDATES = 100;
const BATCH_SIZE = 16;
const SEMANTIC_FLOOR = 0.3;
export const MAX_SEARCH_QUERY = 256;

export function reciprocalRankFusion(rankings: readonly (readonly string[])[]): string[] {
  const scores = new Map<string, number>();
  for (const ranking of rankings) ranking.forEach((id, rank) => {
    scores.set(id, (scores.get(id) ?? 0) + 1 / (60 + rank + 1));
  });
  // Stable sort preserves keyword order on exact ties.
  return [...scores.keys()].sort((a, b) => scores.get(b)! - scores.get(a)!);
}

function snippet(body: string, query: string): string {
  const text = body.replace(/\s+/g, ' ').trim();
  const folded = text.toLowerCase();
  const term = query.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.find((word) => folded.includes(word));
  const start = term ? Math.max(0, folded.indexOf(term) - 45) : 0;
  return `${start ? '…' : ''}${text.slice(start, start + 180)}${text.length > start + 180 ? '…' : ''}`;
}

export class SearchIndex {
  private readonly keywords = new MiniSearch<SearchDocument>({
    fields: ['title', 'body'],
    searchOptions: { boost: { title: 3 }, prefix: true },
  });
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Set<Entry>();
  private warming?: Promise<void>;

  constructor(private readonly embedder: Embedder) {}

  /** Reconcile a committed snapshot without retokenizing or re-embedding unchanged documents. */
  update(documents: readonly SearchDocument[]) {
    const ids = new Set(documents.map(({ id }) => id));
    for (const [id, entry] of this.entries) {
      if (ids.has(id)) continue;
      this.keywords.discard(id);
      this.entries.delete(id);
      this.pending.delete(entry);
    }
    for (const document of documents) {
      const previous = this.entries.get(document.id);
      let entry: Entry;
      if (!previous) {
        this.keywords.add(document);
        entry = { document };
      } else {
        if (previous.document.title !== document.title || previous.document.body !== document.body) this.keywords.replace(document);
        entry = previous;
        if (previous.document.semanticText !== document.semanticText) {
          this.pending.delete(previous);
          entry = { document };
        } else {
          entry.document = document;
        }
      }
      this.entries.set(document.id, entry);
      if (document.embedding || !document.semanticText) this.pending.delete(entry);
      else if (entry.vector === undefined) this.pending.add(entry);
    }
  }

  private keywordIds(query: string) {
    return this.keywords.search(query).slice(0, CANDIDATES).map(({ id }) => id as string);
  }

  private results(ids: string[], query: string, limit: number): SearchResult[] {
    return ids.slice(0, limit).map((id) => {
      const { kind, title, href, detail, body } = this.entries.get(id)!.document;
      return { id, kind, title, href, detail, snippet: snippet(body, query) };
    });
  }

  keyword(query: string, limit: number): SearchResult[] {
    return this.results(this.keywordIds(query), query, limit);
  }

  href(id: string): string | undefined {
    return this.entries.get(id)?.document.href;
  }

  private warm() {
    this.warming ??= (async () => {
      while (this.pending.size) {
        const batch: Entry[] = [];
        for (const entry of this.pending) {
          batch.push(entry);
          if (batch.length === BATCH_SIZE) break;
        }
        const vectors = await this.embedder.embed(batch.map(({ document }) => document.semanticText!));
        batch.forEach((entry, index) => {
          if (!this.pending.delete(entry)) return; // Edited or forgotten during inference.
          entry.vector = vectors[index] ? quantize(vectors[index]!) : null;
        });
      }
    })().finally(() => { this.warming = undefined; });
    return this.warming;
  }

  async search(query: string, limit: number, budgetMs?: number): Promise<SearchResult[]> {
    if (!query.trim() || !this.entries.size) return [];
    const embedded: { query?: Float32Array } = {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ready = Promise.allSettled([this.embedder.embed([query]).then(([result]) => { embedded.query = result; }), this.warm()]);
    try {
      if (budgetMs === undefined) await ready;
      else await Promise.race([ready, new Promise<void>((resolve) => { timer = setTimeout(resolve, budgetMs); })]);
      // Rank whatever is ready by the deadline; the bounded batches keep warming the index.
      const vector = embedded.query;
      const semantic = vector ? [...this.entries].flatMap(([id, { document, vector: cached }]) => {
        const embedding = document.embedding ?? cached;
        const score = embedding ? cosine(vector, embedding) : 0;
        return score >= SEMANTIC_FLOOR ? [{ id, score }] : [];
      }).sort((a, b) => b.score - a.score).slice(0, CANDIDATES).map(({ id }) => id) : [];
      return this.results(reciprocalRankFusion([this.keywordIds(query), semantic]), query, limit);
    } finally {
      clearTimeout(timer);
    }
  }
}
