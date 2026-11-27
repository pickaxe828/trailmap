import { z } from 'zod';

/** The model's reply to one Ask question. `sources` are passage refs (p1, p2, …) from the request, never URLs. */
export const AskAnswer = z.object({
  /** False when the passages do not contain the answer. */
  answerable: z.boolean(),
  answer: z.string(),
  sources: z.array(z.string()),
});
export type AskAnswer = z.infer<typeof AskAnswer>;
