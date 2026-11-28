import type { SentToModel, TrailmapDb } from '../db/db';

async function fingerprint(text: string) {
  const bytes = new TextEncoder().encode(text);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return { length: bytes.length, sha256: Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('') };
}

async function redact({ instructions, input, output, ...metadata }: SentToModel) {
  const [sent, body, returned] = await Promise.all([
    fingerprint(instructions),
    fingerprint(JSON.stringify(input)),
    output === undefined ? undefined : fingerprint(metadata.outcome === 'failed' && typeof output === 'string' ? output : JSON.stringify(output)),
  ]);
  return { ...metadata, instructions: sent, input: body, output: returned };
}

/** The optional job diagnostics describe the current matching jobs, not the history of a call. */
export async function exportModelLog(db: TrailmapDb, count: number, redactText: boolean, includeJobs: boolean) {
  if (!Number.isSafeInteger(count) || count < 1) throw new RangeError('Select at least one call.');
  const { entries, diagnostics } = await db.transaction('r', db.sentToModel, db.jobs, async () => {
    const entries = await db.sentToModel.orderBy('at').reverse().limit(count).toArray();
    const ids = [...new Set(entries.flatMap(({ jobId }) => jobId ? [jobId] : []))];
    const jobs = includeJobs ? await db.jobs.bulkGet(ids) : [];
    const diagnostics = new Map(jobs.flatMap((job) => job ? [[job.id, {
      kind: job.kind, status: job.status, availableAt: job.status === 'pending' ? job.availableAt : undefined,
      lastError: job.lastError,
    }] as const] : []));
    return { entries, diagnostics };
  });
  const lines: string[] = [];
  for (const entry of entries) {
    const row = redactText ? await redact(entry) : entry;
    const job = entry.jobId && diagnostics.get(entry.jobId);
    lines.push(JSON.stringify(job ? { ...row, jobDiagnostics: job } : row) + '\n');
  }
  return new Blob(lines, { type: 'application/x-ndjson' });
}
