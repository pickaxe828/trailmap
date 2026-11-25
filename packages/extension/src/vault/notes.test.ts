import { expect, test } from 'bun:test';
import { renderExpeditionNote } from './notes';

const expedition = {
  id: 'expedition:test', title: 'Replication: "deletes"', drivingQuestion: 'Does it converge?\n---',
  startedAt: 0, endedAt: 60_000, kind: 'learning' as const, fieldNotes: '## What you found\n\nA tombstone records a delete.',
  userEdited: true, threadId: null,
};

test('an Expedition note has escaped frontmatter, field notes, and Concept wikilinks', () => {
  expect(renderExpeditionNote(expedition, ['https://learn.test/crdt'], [{ path: 'trailmap-concept-id.md', title: 'Tombstone' }])).toBe(
    '---\n' +
    'title: "Replication: \\"deletes\\""\n' +
    'question: "Does it converge?\\n---"\n' +
    'startedAt: "1970-01-01T00:00:00.000Z"\n' +
    'endedAt: "1970-01-01T00:01:00.000Z"\n' +
    'kind: "learning"\n' +
    'sourceUrls: ["https://learn.test/crdt"]\n' +
    '---\n\n' +
    '# Replication: "deletes"\n\n' +
    '## What you found\n\nA tombstone records a delete.\n\n' +
    '## Concepts\n\n- [[trailmap-concept-id|Tombstone]]\n',
  );
});
