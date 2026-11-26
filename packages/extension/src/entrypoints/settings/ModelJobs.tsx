import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { llmTaskGroup } from '@trailmap/shared';
import { useEffect, useState } from 'react';
import type { TrailmapDb } from '../../db/db';
import { MODEL_JOB_LABELS, modelFailureMessage } from '../../jobs/labels';
import { canRetryModelJob, isModelJob, MODEL_JOB_KINDS, RETRY_MODEL_JOBS, type Job, type ModelJobKind, type QueueHold } from '../../jobs/types';
import { useJournalData } from '../../journal/data';
import { onModelRoutesChanged, readModelRoutes, type ModelRoutes } from '../../llm/settings';

const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });

async function readModelJobs(db: TrailmapDb) {
  return db.transaction('r', db.jobs, db.queueHolds, async () => ({
    jobs: await db.jobs.where('status').anyOf('pending', 'leased', 'failed').and(({ kind }) => isModelJob(kind)).toArray(),
    hold: await db.queueHolds.get('ai'),
  }));
}

function retryTime(job: Job, hold?: QueueHold) {
  if (job.status === 'failed') return 'No automatic retry';
  if (job.status === 'leased') return 'In progress';
  if (hold && hold.reason !== 'usage_limit_exceeded') return 'Waiting for ChatGPT access';
  const at = Math.max(job.availableAt, hold?.retryAt ?? 0);
  return at > Date.now() ? date.format(at) : 'Ready to retry';
}

function JobGroup({ kind, jobs, hold, ready }: { kind: ModelJobKind; jobs: Job[]; hold?: QueueHold; ready: boolean }) {
  const [feedback, setFeedback] = useState('');
  const failed = jobs.filter(({ status }) => status === 'failed');
  const failing = jobs.filter((job) => job.status !== 'failed' && (job.lastError || job.failures > 0));
  const latest = [...failed, ...failing].sort((a, b) => (b.lastError?.at ?? 0) - (a.lastError?.at ?? 0))[0];
  const error = latest?.lastError;
  const retryable = ready && jobs.some((job) => canRetryModelJob(job, hold, Date.now()));

  async function retry() {
    setFeedback('');
    try {
      const reply: { queued: number } = await chrome.runtime.sendMessage({ type: RETRY_MODEL_JOBS, kind });
      if (reply.queued) return;
    } catch { /* The worker may be restarting. */ }
    setFeedback('No jobs could be retried. Check whether they are waiting for access or already running.');
  }

  return (
    <VStack as="section" aria-label={MODEL_JOB_LABELS[kind]} gap={1}>
      <HStack gap={2} wrap="wrap" align="center" justify="between">
        <Heading level={4}>{MODEL_JOB_LABELS[kind]}</Heading>
        {retryable && <Button label="Retry now" variant="secondary" size="sm" clickAction={retry} />}
      </HStack>
      <Text type="supporting">Pending: {jobs.length - failed.length - failing.length} · Failing: {failing.length} · Failed: {failed.length}</Text>
      {latest && <>
        {error ? <Text as="p">{modelFailureMessage(error.code)} <Text type="code">{error.code}</Text></Text>
          : <Text as="p">No error details were recorded.</Text>}
        <Text as="p" type="supporting">Attempts: {error?.attempts ?? (latest.failures || 'Unknown')} · Next retry: {retryTime(latest, hold)}</Text>
      </>}
      {feedback && <Text role="status">{feedback}</Text>}
    </VStack>
  );
}

export function ModelJobs() {
  const result = useJournalData(readModelJobs);
  const [routes, setRoutes] = useState<ModelRoutes>();
  useEffect(() => {
    let revision = 0;
    const read = () => {
      const current = ++revision;
      void readModelRoutes().then((saved) => { if (revision === current) setRoutes(saved); }).catch(() => {});
    };
    const stop = onModelRoutesChanged(read);
    read();
    return () => { revision++; stop(); };
  }, []);

  return (
    <VStack as="section" aria-labelledby="model-jobs" gap={3}>
      <Heading level={3} id="model-jobs">Model jobs</Heading>
      {!result && <Text type="supporting">Loading model jobs…</Text>}
      {result?.error && <Text role="alert">Could not read model jobs.</Text>}
      {result?.data && MODEL_JOB_KINDS.map((kind) => <JobGroup key={kind} kind={kind}
        jobs={result.data.jobs.filter((job) => job.kind === kind)} ready={!!routes}
        hold={routes?.[llmTaskGroup(kind)].provider === 'chatgpt' ? result.data.hold : undefined} />)}
    </VStack>
  );
}
