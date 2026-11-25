import type { Concept } from '@trailmap/shared';
import type { ConceptEvidencePage } from './evidence';

const inline = (text: string) => text.replace(/\s+/g, ' ').trim().replace(/[\\`*_{}\[\]<>#+\-.!|~&=]/g, '\\$&');

/** Pure Markdown; ticket 15 owns file naming, syncing, and deleting stale vault notes. */
export function renderConceptNote(concept: Concept, evidence: readonly ConceptEvidencePage[]): string {
  const sections = [`# ${inline(concept.name)}`];
  if (concept.gloss.trim()) sections.push(inline(concept.gloss));
  if (concept.aliases.length) sections.push(`Aliases: ${concept.aliases.map(inline).join(', ')}`);
  const links = evidence.flatMap(({ page, visits }) => {
    const url = URL.parse(page.canonicalUrl);
    if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) return [];
    const title = visits.find(({ visit }) => visit.title.trim())?.visit.title ?? url.hostname;
    return [`- [${inline(title)}](<${url.href.replace(/[<>]/g, encodeURIComponent)}>)`];
  });
  if (links.length) sections.push(`## Where I learned this\n\n${links.join('\n')}`);
  return `${sections.join('\n\n')}\n`;
}
