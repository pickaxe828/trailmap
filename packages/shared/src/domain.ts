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
  captureDocumentId: z.string().optional(), // Groups same-document visits for late password screening.
  favicon: z.string().optional(), // Bounded local raster icon captured on browsers without a favicon cache API.
  id: z.string(),
  url: z.string(),
  canonicalUrl: z.string(),
  title: z.string(),
  tabId: z.number().int(),
  parentVisitId: z.string().nullable(),
  transition: Transition,
  startedAt: z.number(),
  activeMs: z.number(),
  lastActiveAt: z.number().optional(), // Wall-clock end of the last recorded reading interval.
  scrollDepth: z.number().min(0).max(1),
  engagement: Engagement,
  privacyBlocked: z.literal(true).optional(),
  imported: z.literal(true).optional(),
  aiConversation: z.literal(true).optional(),
  aiOpeningQuery: z.literal(true).optional(), // Synthetic Query for a session started in the AI Mode composer.
  starred: z.literal(true).optional(), // The user marked this a key page.
  expeditionId: z.string().nullable(),
  segmentationPending: z.literal(1).optional(),
  expeditionEmbedding: z.instanceof(Int8Array).nullable().optional(),
});
export type Visit = z.infer<typeof Visit>;

export const PageKind = z.enum(['article', 'docs', 'paper', 'video', 'forum', 'reference', 'tool', 'other']);
export type PageKind = z.infer<typeof PageKind>;

export const ConceptKind = z.enum(['concept', 'person', 'tool', 'work', 'event', 'place']);
export type ConceptKind = z.infer<typeof ConceptKind>;

export const ConceptMention = z.object({
  name: z.string(), kind: ConceptKind, gloss: z.string(), role: z.enum(['explains', 'mentions', 'uses']),
});
export const ConceptRelationType = z.enum([
  'is_a', 'part_of', 'uses', 'alternative_to', 'contrasts_with', 'prerequisite_of', 'related_to',
]);
export const RelationMention = z.object({ from: z.string(), to: z.string(), type: ConceptRelationType });

/** PLAN §4.4, deliberately unresolved until concept resolution. */
export const PageEnrichment = z.object({
  summary: z.string(),
  takeaways: z.array(z.string()).min(2).max(5),
  answers_question: z.string(),
  page_kind: PageKind,
  concepts: z.array(ConceptMention),
  relations: z.array(RelationMention),
});
export type PageEnrichment = z.infer<typeof PageEnrichment>;

export const ConceptMergeVerdicts = z.object({
  verdicts: z.array(z.object({ id: z.string(), verdict: z.enum(['same', 'broader', 'narrower', 'related', 'different']) })),
});
export type ConceptMergeVerdicts = z.infer<typeof ConceptMergeVerdicts>;

export const ModelSources = z.object({ visitIds: z.array(z.string()), canonicalUrls: z.array(z.string()) });
export type ModelSources = z.infer<typeof ModelSources>;

export const AiTurn = z.object({
  id: z.string(),
  question: z.string(),
  answer: z.string().nullable(),
  citations: z.array(z.string()),
  extractionFailed: z.literal(true).optional(),
});
export type AiTurn = z.infer<typeof AiTurn>;

export const Page = z.object({
  canonicalUrl: z.string(),
  text: z.string(),
  textHash: z.string(),
  aiTurns: z.array(AiTurn).optional(), // Present only for AI conversation Pages.
  sourceHash: z.string().optional(), // Fingerprint of the input DOM for the last extraction.
  sourceUrl: z.string().optional(), // Cleaned source URL, which can differ from rel=canonical.
  summary: z.string().nullable(),
  takeaways: z.array(z.string()),
  embedding: z.instanceof(Int8Array).nullable(),
  pageKind: PageKind.nullable(),
  enrichedAt: z.number().nullable(),
  sourceVisitId: z.string().optional(),
  textRevision: z.number().int().optional(), // Advances when Readability output changes.
  enrichmentVisitId: z.string().optional(), // Evidence for the unresolved mentions.
  enrichmentSourceVisitId: z.string().optional(),
  enrichmentSourceUrl: z.string().optional(),
  enrichmentSources: ModelSources.optional(),
  answersQuestion: PageEnrichment.shape.answers_question.optional(),
  conceptMentions: PageEnrichment.shape.concepts.optional(),
  relationMentions: PageEnrichment.shape.relations.optional(),
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

export const MergeSuggestion = z.object({ expeditionId: z.string(), reason: z.string() });
export type MergeSuggestion = z.infer<typeof MergeSuggestion>;

export const SuggestionTarget = z.object({ kind: z.enum(['thread', 'expedition']), id: z.string() });
export type SuggestionTarget = z.infer<typeof SuggestionTarget>;

export const Expedition = z.object({
  id: z.string(),
  rootVisitId: z.string().optional(),
  centroid: z.instanceof(Int8Array).nullable().optional(),
  title: z.string(),
  drivingQuestion: z.string().nullable(),
  kind: ExpeditionKind.or(z.literal('unclassified')),
  kindOverride: z.boolean().optional(), // Manual classification wins over later wrap-up.
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  imported: z.literal(true).optional(),
  fieldNotes: z.string().nullable(),
  userEdited: z.boolean(),
  threadId: z.string().nullable(),
  threadSuggestion: SuggestionTarget.optional(),
  dismissedSuggestions: z.array(SuggestionTarget).optional(),
  threadSignature: z.object({ vector: z.instanceof(Int8Array), conceptIds: z.array(z.string()) }).optional(),
  threadAutoExcluded: z.boolean().optional(),
  wrappedUpAt: z.number().optional(), // The wrap-up pass (title, question, kind) committed.
  wrapUpSource: ModelSources.optional(),
  mergeSuggestions: z.array(MergeSuggestion).optional(), // Same-day Expeditions on the same topic.
  notesWrittenAt: z.number().optional(), // Field notes were generated at this time.
  notesSource: ModelSources.optional(),
  unreadStops: z.array(z.object({ visitId: z.string(), title: z.string(), url: z.string() })).optional(), // Local-only loose ends.
  unseenNotes: z.literal(1).optional(), // Set with new field notes; cleared once viewed. Indexed for the badge.
});
export type Expedition = z.infer<typeof Expedition>;

/** PLAN §4.3 rule 4. Same-day candidates are offered to the model under short ids (e1, e2, ...). */
export const ExpeditionWrapUp = z.object({
  title: z.string(),
  driving_question: z.string(),
  kind: ExpeditionKind,
  merge_with: z.array(z.object({ id: z.string(), reason: z.string() })),
});
export type ExpeditionWrapUp = z.infer<typeof ExpeditionWrapUp>;

/** PLAN §4.6. Each idea cites a Page by the short ref (p1, p2, ...) it was given; code renders the Markdown. */
export const FieldNotesDraft = z.object({
  found: z.string(),
  key_ideas: z.array(z.object({ idea: z.string(), page: z.string() })).min(1),
  trail: z.string(),
  loose_ends: z.array(z.string()),
});
export type FieldNotesDraft = z.infer<typeof FieldNotesDraft>;

/** PLAN §4.7. A revision of the note from the prior synthesis and one session. */
export const LivingNoteDraft = z.object({ markdown: z.string() });

export const ThreadStatus = z.enum(['active', 'dormant', 'done']);
export type ThreadStatus = z.infer<typeof ThreadStatus>;

export const Thread = z.object({
  id: z.string(),
  title: z.string(),
  question: z.string().nullable(),
  status: ThreadStatus,
  lastActiveAt: z.number(),
  livingNote: z.string().nullable(),
  noteRevision: z.number().optional(),
  notedExpeditionIds: z.array(z.string()).optional(),
  userRenamed: z.boolean().optional(),
  centroid: z.instanceof(Int8Array).nullable(),
  conceptIds: z.array(z.string()),
});
export type Thread = z.infer<typeof Thread>;

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
  ...ConceptRelationType.options,
]);
export type EdgeType = z.infer<typeof EdgeType>;

export const Edge = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  type: EdgeType,
  weight: z.number(),
  evidence: z.array(z.string()),
  observedEvidence: z.array(z.string()).optional(),
  // A verdict is supported jointly by these Visits, not independently by each Visit.
  verdictEvidence: z.array(z.array(z.string())).optional(),
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
