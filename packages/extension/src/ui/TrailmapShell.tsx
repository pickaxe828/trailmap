import { AppShell } from '@astryxdesign/core/AppShell';
import { BreadcrumbItem, Breadcrumbs } from '@astryxdesign/core/Breadcrumbs';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useCallback, useEffect, type ReactNode } from 'react';
import { ModelJobAttention } from './ModelJobAttention';
import { JOURNAL_PATH, TrailmapNavigation, type TrailmapSection } from './TrailmapNavigation';

export const JOURNAL_SEARCH_PARAM = 'focus-search';

function searchShortcut(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing || event.repeat) return false;
  const target = event.target;
  if (target instanceof HTMLElement && target.closest('[role="dialog"], [role="menu"], dialog[open]')) return false;
  if (event.key.toLowerCase() === 'k' && event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) return true;
  if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
  return !(target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [role="textbox"]')));
}

export function TrailmapShell({ title, description, section, journalDetail = false, actions, focusJournalSearch, children }: {
  title: string;
  description: string;
  section?: TrailmapSection;
  journalDetail?: boolean;
  actions?: ReactNode;
  focusJournalSearch?: () => void;
  children: ReactNode;
}) {
  const openSearch = useCallback(() => {
    if (focusJournalSearch) focusJournalSearch();
    else window.location.assign(`${JOURNAL_PATH}?${JOURNAL_SEARCH_PARAM}`);
  }, [focusJournalSearch]);
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (!searchShortcut(event)) return;
      event.preventDefault();
      openSearch();
    }
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [openSearch]);

  const fullBleed = section === 'trail' || section === 'atlas';
  const maxWidth = fullBleed ? undefined : section === 'journal' || journalDetail ? '72rem' : '44rem';
  return (
    <VStack className="min-h-dvh bg-body [&_:is(main,[role=main])]:bg-body">
      <AppShell variant="section" height="fill" mobileNav={false} topNav={
        <TrailmapNavigation section={journalDetail ? 'journal' : section} detail={journalDetail} onSearch={openSearch} />
      }>
        <VStack width="100%" maxWidth={maxWidth} minHeight="100%" className="mx-auto">
          <VStack paddingInline={4} className="[&:not(:empty)]:pt-4">
            <ModelJobAttention />
          </VStack>
          <VStack as="header" gap={2} padding={4} className={fullBleed ? 'border-b border-border' : undefined}>
            {journalDetail && <Breadcrumbs variant="supporting">
              <BreadcrumbItem href={JOURNAL_PATH}>Journal</BreadcrumbItem>
              <BreadcrumbItem isCurrent><Text maxLines={1}>{title}</Text></BreadcrumbItem>
            </Breadcrumbs>}
            <HStack align="center" justify="between" gap={3} wrap="wrap">
              <VStack gap={1} className="min-w-0 grow basis-64">
                <Heading level={1} maxLines={2}>{title}</Heading>
                <Text as="p" type="supporting" maxLines={1}>{description}</Text>
              </VStack>
              {actions}
            </HStack>
          </VStack>
          <VStack gap={4} padding={section === 'trail' ? 0 : 4} paddingBlockStart={fullBleed ? undefined : 0}
            className="min-h-0 grow">
            {children}
          </VStack>
        </VStack>
      </AppShell>
    </VStack>
  );
}
