import type { TrailmapDb } from '../db/db';
import { createThreadCorrections } from './corrections';
import { THREAD_CORRECTION, ThreadAction } from './messages';

export function startThreadCorrections(db: TrailmapDb) {
  const correct = createThreadCorrections({ db, now: Date.now, newId: () => crypto.randomUUID() });
  chrome.runtime.onMessage.addListener((input, sender, reply) => {
    if (input?.type !== THREAD_CORRECTION || !sender.url) return;
    const source = URL.parse(sender.url);
    if (!source) return;
    source.search = '';
    source.hash = '';
    if (!['/journal.html', '/thread.html'].some((path) => source.href === chrome.runtime.getURL(path))) return;
    const parsed = ThreadAction.safeParse(input);
    if (!parsed.success) return;
    correct(parsed.data).then(reply, () => reply(null));
    return true;
  });
}
