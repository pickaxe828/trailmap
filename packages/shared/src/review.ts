import { z } from 'zod';

/** The model's question cards for a batch of concepts. `ref` names a concept in the request (c1, c2, …); code drops any other ref. */
export const ReviewQuestions = z.object({
  questions: z.array(z.object({
    ref: z.string(),
    /** One short question the concept's name and gloss answer. It must not contain the answer itself. */
    question: z.string(),
  })),
});
export type ReviewQuestions = z.infer<typeof ReviewQuestions>;
