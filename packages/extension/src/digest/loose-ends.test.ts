import { expect, test } from 'bun:test';
import { readLooseEnds } from './loose-ends';

test('loose ends are the bullets under "Loose ends", with links reduced to their words, plus unread tabs', () => {
  expect(readLooseEnds({ id: 'e', fieldNotes: '# Notes\n\n## Found\n\n- not this\n\n## Loose ends\n\n- Read [the paper](https://x.test/p) on gossip\n- Nothing left open.\n\n## Trail\n\n- nor this\n',
    unreadStops: [{ visitId: 'v', title: 'A  tab', url: 'https://t.test/' }] })).toEqual([
    { expeditionId: 'e', text: 'Opened but never read: A tab', href: 'https://t.test/' },
    { expeditionId: 'e', text: 'Read the paper on gossip' },
  ]);
  expect(readLooseEnds({ id: 'e', fieldNotes: null })).toEqual([]);
  expect(readLooseEnds({ id: 'e', fieldNotes: '## Loose ends\n\n- Nothing left open.\n' })).toEqual([]);
});
