import { z } from 'zod';
import { ErrorCode } from '@trailmap/shared';

export const SUMMARIZE_PAGE = 'trailmap.summarizePage';
export const SIDE_PANEL_PATH = '/sidepanel.html';

export const PageSummary = z.strictObject({
  summary: z.string(),
  takeaways: z.array(z.string()).min(2).max(5),
});

export const PageSummaryReply = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), title: z.string(), summary: PageSummary }),
  z.object({
    ok: z.literal(false),
    code: ErrorCode.or(z.enum(['no_text', 'not_connected', 'timeout'])),
    message: z.string(),
  }),
]);
export type PageSummaryReply = z.infer<typeof PageSummaryReply>;
