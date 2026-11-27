import { z } from 'zod';

/**
 * The model's weekly digest. Every `ref` (e1…, t1…, c1…) names something in the request; code drops any ref that was not sent.
 * `why` is one sentence on why the item mattered this week.
 */
export const DigestDraft = z.object({
  /** Two or three sentences on what the user explored this week. */
  summary: z.string(),
  /** The week's most important expeditions, most important first. */
  expeditions: z.array(z.object({ ref: z.string(), why: z.string() })),
  /** The threads that moved most, most important first. */
  threads: z.array(z.object({ ref: z.string(), why: z.string() })),
  /** Refs of concepts worth remembering from this week. */
  concepts: z.array(z.string()),
});
export type DigestDraft = z.infer<typeof DigestDraft>;
