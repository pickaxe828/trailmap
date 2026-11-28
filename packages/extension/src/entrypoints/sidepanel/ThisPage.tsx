import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Heading } from '@astryxdesign/core/Heading';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useCallback } from 'react';
import { correct } from '../../corrections/client';
import { MY_NOTES_LIMIT, PAGE_NOTE_LIMIT } from '../../corrections/messages';
import type { TrailmapDb } from '../../db/db';
import { useJournalData } from '../../journal/data';
import { expeditionHref } from '../../journal/links';
import { siteKey } from '../../privacy/policy';
import { NoteEditor } from './NoteEditor';
import { PageNotes } from './PageNotes';

async function readCurrentPage(db: TrailmapDb, visitId: string) {
  return db.transaction('r', db.visits, db.expeditions, db.pages, db.notes, async () => {
    const visit = await db.visits.get(visitId);
    if (!visit || visit.privacyBlocked) return undefined;
    const expedition = visit.expeditionId ? await db.expeditions.get(visit.expeditionId) : undefined;
    const page = await db.pages.get(visit.canonicalUrl);
    const note = await db.notes.where('nodeId').equals(visitId).first();
    return { visit, expedition, page, text: note?.text ?? '' };
  });
}

export function ThisPage({ visitId, aiModeWaiting }: { visitId: string | null; aiModeWaiting: boolean }) {
  const read = useCallback((db: TrailmapDb) => visitId ? readCurrentPage(db, visitId) : Promise.resolve(undefined), [visitId]);
  const current = useJournalData(read)?.data;
  return (
    <VStack as="section" aria-label="This page" gap={2}>
      <Heading level={2}>This page</Heading>
      {current ? <CurrentPage key={current.visit.id} {...current} /> : (
        <Text type="supporting">{aiModeWaiting
          ? 'Ask a question in AI Mode to start recording this conversation.' : 'This page isn’t recorded.'}</Text>
      )}
    </VStack>
  );
}

function CurrentPage({ visit, expedition, page, text }: NonNullable<Awaited<ReturnType<typeof readCurrentPage>>>) {
  const host = siteKey(visit.url);
  return (
    <>
      <VStack gap={0.5} className="min-w-0">
        <Heading level={3} maxLines={2} className="wrap-anywhere">{visit.title || host || 'Untitled page'}</Heading>
        <Text type="supporting" className="wrap-anywhere">{host}</Text>
        {expedition && (
          <Text as="p" type="supporting" className="wrap-anywhere">
            Expedition: <Link hasUnderline href={expeditionHref(expedition.id)} target="_blank" rel="noopener noreferrer">
              {expedition.title}
            </Link>
          </Text>
        )}
      </VStack>
      <NoteEditor label="Page note" stored={text} limit={PAGE_NOTE_LIMIT}
        save={async (text, sessionId) => await correct('note', { nodeId: visit.id, text, sessionId }) === true} />
      {expedition && (
        <Collapsible key={expedition.id} trigger={<Text weight="semibold">My notes for this expedition</Text>} defaultIsOpen={false}>
          <NoteEditor label="My notes Markdown" stored={expedition.myNotes ?? ''} limit={MY_NOTES_LIMIT}
            save={async (text, sessionId) => await correct('my-notes', {
              expeditionId: expedition.id, text, edit: { sessionId, visitId: visit.id },
            }) === true} />
        </Collapsible>
      )}
      {page?.summary && page.enrichedAt !== null && <PageNotes summary={page.summary} takeaways={page.takeaways} />}
    </>
  );
}
