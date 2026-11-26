import { Banner } from '@astryxdesign/core/Banner';
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
      title="ChatGPT jobs paused until your plan limit resets. Browsing is still recorded."
      description={<Link href="https://chatgpt.com/settings/usage" target="_blank">ChatGPT usage settings</Link>} />;
  }
  if (hold.reason === 'not_eligible') {
    return <Banner status="warning" title="ChatGPT jobs stopped."
      description="This ChatGPT account or workspace is not eligible for plan usage. Browsing is still recorded." />;
  }
  if (hold.reason === 'plan_usage_not_granted') {
    return <Banner status="info" title="ChatGPT jobs are waiting for plan permission." />;
  }
  return <Banner status="info" title="Sign in with ChatGPT to resume ChatGPT jobs." />;
}
