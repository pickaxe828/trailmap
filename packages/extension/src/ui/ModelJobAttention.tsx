import { Banner } from '@astryxdesign/core/Banner';
import { Link } from '@astryxdesign/core/Link';
import type { TrailmapDb } from '../db/db';
import { modelFailureMessage } from '../jobs/labels';
import { useJournalData } from '../journal/data';

async function readAttention(db: TrailmapDb) {
  return (await db.modelHealth.get('jobs'))?.attention;
}

export function ModelJobAttention() {
  const attention = useJournalData(readAttention)?.data;
  if (!attention) return null;
  return <Banner role="status" status="warning" title="AI notes are failing" description={<>
    {modelFailureMessage(attention.code, attention.provider)}{' '}
    <Link href="/settings.html#diagnostics" target="_blank" rel="noopener noreferrer">Details in Diagnostics</Link>
  </>} />;
}
