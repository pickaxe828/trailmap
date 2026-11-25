/**
 * Domain model (docs/PLAN.md §3). Zod schemas are the source of truth; the
 * TypeScript types are inferred from them. Both the extension and the companion
 * import these, so anything that crosses the Native Messaging boundary can be
 * validated with the same definitions.
 */
import { z } from 'zod';

/**
 * How the user arrived at a Visit. PLAN §3 lists link / typed / search / new-tab / back;
 * `form`, `reload`, `bookmark` and `auto` were added for the other `webNavigation`
 * transition types. `back` covers forward as well.
 */
export const Transition = z.enum(['link', 'typed', 'search', 'new-tab', 'back', 'form', 'reload', 'bookmark', 'auto']);
export type Transition = z.infer<typeof Transition>;

export const Engagement = z.enum(['bounced', 'skimmed', 'read']);
export type Engagement = z.infer<typeof Engagement>;

export const Visit = z.object({
  id: z.string(),
  url: z.string(),
  canonicalUrl: z.string(),
  title: z.string(),
  tabId: z.number().int(),
  parentVisitId: z.string().nullable(),
  transition: Transition,
  startedAt: z.number(),
  activeMs: z.number(),
  scrollDepth: z.number().min(0).max(1),
  engagement: Engagement,
  privacyBlocked: z.literal(true).optional(),
  expeditionId: z.string().nullable(),
  segmentationPending: z.literal(1).optional(),
  expeditionEmbedding: z.instanceof(Int8Array).nullable().optional(),
});
export type Visit = z.infer<typeof Visit>;

export const PageKind = z.enum(['article', 'docs', 'paper', 'video', 'forum', 'reference', 'tool', 'other']);
export type PageKind = z.infer<typeof PageKind>;

export const Page = z.object({
  canonicalUrl: z.string(),
  text: z.string(),
  textHash: z.string(),
  sourceHash: z.string().optional(), // Fingerprint of the input DOM for the last extraction.
  sourceUrl: z.string().optional(), // Cleaned source URL, which can differ from rel=canonical.
  summary: z.string().nullable(),
  takeaways: z.array(z.string()),
  embedding: z.instanceof(Int8Array).nullable(),
  pageKind: PageKind.nullable(),
  enrichedAt: z.number().nullable(),
});
export type Page = z.infer<typeof Page>;

export const Query = z.object({
  id: z.string(),
  visitId: z.string().optional(), // Only absent on records created before Visit linkage.
  engine: z.string(),
  q: z.string(),
  at: z.number(),
  expeditionId: z.string().nullable(),
});
export type Query = z.infer<typeof Query>;

export const ExpeditionKind = z.enum(['learning', 'errand']);
export type ExpeditionKind = z.infer<typeof ExpeditionKind>;

export const Expedition = z.object({
  id: z.string(),
  rootVisitId: z.string().optional(),
  centroid: z.instanceof(Int8Array).nullable().optional(),
  title: z.string(),
  drivingQuestion: z.string().nullable(),
  kind: ExpeditionKind,
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  fieldNotes: z.string().nullable(),
  userEdited: z.boolean(),
  threadId: z.string().nullable(),
});
export type Expedition = z.infer<typeof Expedition>;

export const ThreadStatus = z.enum(['active', 'dormant', 'done']);
export type ThreadStatus = z.infer<typeof ThreadStatus>;

export const Thread = z.object({
  id: z.string(),
  title: z.string(),
  question: z.string().nullable(),
  status: ThreadStatus,
  lastActiveAt: z.number(),
  livingNote: z.string().nullable(),
  centroid: z.instanceof(Int8Array).nullable(),
  conceptIds: z.array(z.string()),
});
export type Thread = z.infer<typeof Thread>;

export const ConceptKind = z.enum(['concept', 'person', 'tool', 'work', 'event', 'place']);
export type ConceptKind = z.infer<typeof ConceptKind>;

export const Concept = z.object({
  id: z.string(),
  name: z.string(),
  aliases: z.array(z.string()),
  kind: ConceptKind,
  gloss: z.string(),
  embedding: z.instanceof(Int8Array).nullable(),
  exposure: z.number(),
  firstSeen: z.number(),
});
export type Concept = z.infer<typeof Concept>;

export const EdgeType = z.enum([
  // trail edges
  'navigated_from',
  'searched',
  'opened_in_new_tab',
  // bridge edges
  'teaches',
  'mentions',
  // concept edges
  'is_a',
  'part_of',
  'uses',
  'alternative_to',
  'contrasts_with',
  'prerequisite_of',
  'related_to',
]);
export type EdgeType = z.infer<typeof EdgeType>;

export const Edge = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  type: EdgeType,
  weight: z.number(),
  evidence: z.array(z.string()),
});
export type Edge = z.infer<typeof Edge>;

export const Highlight = z.object({
  id: z.string(),
  visitId: z.string(),
  canonicalUrl: z.string().optional(), // Only absent on records created before Page linkage.
  text: z.string(),
  at: z.number(),
  source: z.enum(['selection', 'copy']),
});
export type Highlight = z.infer<typeof Highlight>;

/** A manual note the user attached to any node (Visit, Query, Expedition, Concept...). */
export const Note = z.object({
  id: z.string(),
  nodeId: z.string(),
  text: z.string(),
  at: z.number(),
});
export type Note = z.infer<typeof Note>;
