import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Link } from '@astryxdesign/core/Link';
import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import { openTrailmapDb } from '../../db/db';
import type { QueueHold } from '../../jobs/types';

export function AiNotesStatus() {
  const [hold, setHold] = useState<QueueHold>();
  useEffect(() => {
    const db = openTrailmapDb();
    const sub = liveQuery(() => db.queueHolds.get('ai')).subscribe({ next: setHold });
    return () => { sub.unsubscribe(); db.close(); };
  }, []);
  if (!hold) return null;
  if (hold.reason === 'usage_limit_exceeded') {
    return <Banner status="warning"
      title="ChatGPT plan limit reached"
      description={(
        <>
          AI notes using ChatGPT are paused until your limit resets. Browsing is still recorded.{' '}
          <Link hasUnderline href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener noreferrer">ChatGPT usage settings</Link>
        </>
      )} />;
  }
  if (hold.reason === 'not_eligible') {
    return <Banner status="warning" title="ChatGPT account not eligible"
      description="This account or workspace can’t use ChatGPT plan usage. Try an Anthropic API key or a local Ollama model instead. Browsing is still recorded."
      endContent={<Button label="Choose another provider" variant="secondary" size="sm" href="/settings.html#model-providers"
        target="_blank" rel="noopener noreferrer" />} />;
  }
  return <Banner status="info"
    title={hold.reason === 'plan_usage_not_granted'
      ? 'ChatGPT jobs are waiting for plan permission.' : 'Sign in with ChatGPT to resume ChatGPT jobs.'}
    description={<Link hasUnderline href="/settings.html#model-providers" target="_blank" rel="noopener noreferrer">Open model settings</Link>} />;
}
