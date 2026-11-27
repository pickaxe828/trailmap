import { Heading } from '@astryxdesign/core/Heading';
import { Table } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import type { TrailmapDb } from '../../db/db';
import { useJournalData } from '../../journal/data';
import { THREAD_BANDS } from '../../threads/match';
import { readThreadMatchRuns, THREAD_MATCH_REASONS } from '../../threads/runs';

const time = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
const BAND = ['No match', 'Possible match', 'Strong match'] as const;

type Row = { id: string; title: string; kind: string; similarity: string; shared: number; band: string };

const columns = [
  { key: 'title', header: 'Candidate' },
  { key: 'kind', header: 'Kind' },
  { key: 'similarity', header: 'Similarity' },
  { key: 'shared', header: 'Shared concepts' },
  { key: 'band', header: 'Band' },
];

const readRuns = (db: TrailmapDb) => readThreadMatchRuns(db);

/** Settings → Diagnostics: why each recent `thread_match` did or did not suggest a thread. Titles only; never page text. */
export function ThreadMatching() {
  const result = useJournalData(readRuns);
  const { suggest, autoJoin } = THREAD_BANDS;
  return (
    <VStack as="section" aria-labelledby="thread-matching" gap={3}>
      <Heading level={3} id="thread-matching">Thread matching</Heading>
      <Text type="supporting">
        A possible match needs similarity of {suggest.similarity}, or {suggest.withSharedConcept} with a shared concept, or {suggest.withTwoSharedConcepts} with two.
        A strong match (joined automatically) needs {autoJoin.similarity}, or {autoJoin.withSharedConcept} with a shared concept.
      </Text>
      {!result && <Text type="supporting">Loading thread matching…</Text>}
      {result?.error && <Text role="alert">Could not read thread matching.</Text>}
      {result?.data && !result.data.length && <Text type="supporting">No expedition has been matched yet.</Text>}
      {result?.data?.map((run) => {
        const rows: Row[] = run.candidates.map((c) => ({ id: `${c.kind}:${c.id}`, title: c.title ?? 'Forgotten', kind: c.kind === 'thread' ? 'Thread' : 'Expedition',
          similarity: c.similarity.toFixed(3), shared: c.shared, band: BAND[c.band] }));
        return (
          <VStack as="section" key={run.expeditionId} aria-label={`Thread match for ${run.title ?? 'a forgotten expedition'}`} gap={1}>
            <Heading level={4}>{run.title ?? 'Forgotten expedition'}</Heading>
            <Text as="p">{THREAD_MATCH_REASONS[run.reason]} <Text type="supporting">{time.format(run.at)}</Text></Text>
            {run.dismissed > 0 && <Text type="supporting">{run.dismissed} dismissed candidate{run.dismissed === 1 ? '' : 's'} skipped.</Text>}
            {rows.length > 0 && <Table data={rows} columns={columns} idKey="id" density="compact" />}
          </VStack>
        );
      })}
    </VStack>
  );
}
