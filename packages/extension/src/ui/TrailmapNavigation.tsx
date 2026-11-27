import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon } from '@astryxdesign/core/Icon';
import { Link } from '@astryxdesign/core/Link';
import type { SVGProps } from 'react';

export const JOURNAL_PATH = '/journal.html';
const SETTINGS_PATH = '/settings.html';

// Astryx has no semantic Journal, Trail, Atlas or cog glyphs.
function JournalIcon(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
    <rect x="5" y="3" width="14" height="18" rx="2" />
    <path strokeLinecap="round" d="M9 8h6m-6 4h6m-6 4h3" />
  </svg>;
}

function TrailIcon(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
    <path strokeLinecap="round" d="M9 18h7a3 3 0 0 0 0-6H8a3 3 0 0 1 0-6h7" />
    <circle cx="7" cy="18" r="2" /><circle cx="17" cy="6" r="2" />
  </svg>;
}

function AtlasIcon(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
    <path d="m8 9 8-3m-8 5 5 6m3-2 2-7" />
    <circle cx="6" cy="10" r="2.5" /><circle cx="18" cy="5.5" r="2.5" /><circle cx="15" cy="18" r="2.5" />
  </svg>;
}

// Heroicons cog (MIT); Astryx's semantic settings icon is a wrench.
function SettingsGear(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.592c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.128.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.246c.275.476.166 1.08-.259 1.43l-1.004.827c-.293.241-.438.613-.43.992a6.8 6.8 0 0 1 0 .256c-.008.379.137.75.43.992l1.004.827c.425.35.534.954.259 1.43l-1.296 2.246a1.125 1.125 0 0 1-1.37.49l-1.217-.456c-.356-.133-.75-.072-1.075.124a6.57 6.57 0 0 1-.22.128c-.332.184-.582.496-.645.87l-.213 1.28c-.09.543-.56.941-1.11.941h-2.593c-.55 0-1.019-.398-1.109-.94l-.214-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.128c-.325-.196-.72-.257-1.075-.124l-1.217.456a1.125 1.125 0 0 1-1.37-.49l-1.296-2.246a1.125 1.125 0 0 1 .259-1.43l1.004-.827c.293-.241.438-.613.43-.992a6.77 6.77 0 0 1 0-.256c.008-.379-.137-.75-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.259-1.43L4.854 6.38a1.125 1.125 0 0 1 1.37-.491l1.217.456c.356.133.75.072 1.075-.124.073-.045.146-.087.22-.128.332-.184.582-.496.644-.87l.214-1.28Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

const destinations = [
  { section: 'journal', label: 'Journal', href: JOURNAL_PATH, icon: JournalIcon },
  { section: 'trail', label: 'Trail', href: '/trail.html', icon: TrailIcon },
  { section: 'atlas', label: 'Atlas', href: '/atlas.html', icon: AtlasIcon },
] as const;

export type TrailmapSection = (typeof destinations)[number]['section'] | 'settings';

export function TrailmapNavigation({ compact = false, section, detail = false, onSearch }: {
  compact?: boolean;
  section?: TrailmapSection;
  detail?: boolean;
  onSearch?: () => void;
}) {
  const target = compact ? '_blank' : undefined;
  return (
    <HStack as="nav" aria-label="Trailmap navigation" gap={2} align="center" justify="between" wrap="wrap"
      paddingInline={4} paddingBlock={2} className={compact
        ? 'border-b border-border bg-surface'
        : 'bg-surface sm:grid! sm:grid-cols-[1fr_auto_1fr]'}>
      <HStack>
        {compact ? <Heading level={4} accessibilityLevel={1}>
          <Link href={JOURNAL_PATH} target={target} weight="bold">Trailmap</Link>
        </Heading> : <Link href={JOURNAL_PATH} isStandalone weight="bold">Trailmap</Link>}
      </HStack>
      <HStack gap={1} align="center" className={compact ? undefined
        : '[&_a]:rounded-md [&_a]:px-1.5 [&_a]:py-1 sm:[&_a]:px-3 [&_a[aria-current]]:bg-body'}>
        {destinations.map(({ section: key, href, label, icon }) => compact ? (
          <Button key={key} href={href} target={target} label={`Open ${label}`} tooltip={label}
            icon={<Icon icon={icon} />} isIconOnly size="sm" variant="secondary" />
        ) : (
          <Link key={key} href={href} size="sm" hasUnderline
            weight={section === key ? 'bold' : 'medium'} aria-current={section === key ? (detail ? 'location' : 'page') : undefined}>
            {label}
          </Link>
        ))}
        {compact && <SettingsLink target={target} />}
      </HStack>
      {!compact && <HStack gap={1} align="center" justify="end">
        <Button label="Search" tooltip="Search Journal (/ or ⌘K)" size="sm" variant="secondary"
          aria-keyshortcuts="/ Meta+K" onClick={onSearch} />
        <SettingsLink selected={section === 'settings'} />
      </HStack>}
    </HStack>
  );
}

function SettingsLink({ target, selected }: { target?: '_blank'; selected?: boolean }) {
  return <Button href={SETTINGS_PATH} target={target} label="Settings" tooltip="Settings" isIconOnly
    size="sm" variant={selected ? 'primary' : 'secondary'} aria-current={selected ? 'page' : undefined}
    icon={<Icon icon={SettingsGear} />} />;
}
