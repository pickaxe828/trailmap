import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { Visit } from '@trailmap/shared';
import { openTrailmapDb } from '../db/db';
import { createCorrections } from './corrections';
import { CORRECTION_MESSAGE, isCorrectionRequest } from './messages';
import { createCorrectionService } from './service';

let db: ReturnType<typeof openTrailmapDb>;
let skipped: string[];
let forgetCalls: number;
beforeEach(() => { db = openTrailmapDb(crypto.randomUUID()); skipped = []; forgetCalls = 0; });
afterEach(() => db.delete());

let n = 0;
const service = ({ paused = false, incognito = false } = {}) => {
  const options = { db, now: () => 10 + ++n, newId: () => `id-${++n}` };
  return createCorrectionService({
    corrections: createCorrections(options),
    ...options,
    isIncognitoTab: async () => incognito,
    recorder: {
      ready: Promise.resolve(),
      getCurrentVisit: (tabId) => (tabId === 7 ? { id: 'a' } : undefined),
      forgetVisits: async (remove) => { forgetCalls++; return remove(); },
    },
    privacy: {
      getSettings: () => ({ paused, skippedHosts: [...skipped, 'already.example'] }),
      setSiteSkipped: async (host, skip) => { if (skip) skipped.push(host); },
    },
  });
};
const visit = (id: string, host: string): Visit => ({
  id, url: `https://${host}/p`, canonicalUrl: `https://${host}/p`, title: id, tabId: 1, parentVisitId: null,
  transition: 'link', startedAt: 1, activeMs: 0, scrollDepth: 0, engagement: 'read', expeditionId: null,
});
const req = <A extends string>(action: A, rest: object) => ({ type: CORRECTION_MESSAGE, action, ...rest }) as never;

test('ignoring a site reuses the skip-list controller without logging which site was skipped', async () => {
  await db.visits.bulkPut([visit('a', 'blog.example'), visit('m', 'mail.test'), visit('k', 'already.example')]);
  const s = service();

  expect(await s.handle(req('ignore-site', { visitId: 'a' }))).toBe(true);
  expect(skipped).toEqual(['blog.example']);
  expect(await s.handle(req('ignore-site', { visitId: 'm' }))).toBe(false);
  expect(await s.handle(req('ignore-site', { visitId: 'k' }))).toBe(false);
  expect(skipped).toEqual(['blog.example']);
  const log = await db.corrections.toArray();
  expect(log).toHaveLength(1);
  expect(log[0]).toMatchObject({
    kind: 'ignore-site', targetIds: [], before: { skipped: false }, after: { skipped: true },
  });
});

test('forgetting goes through the recorder, and "current-visit" answers from it', async () => {
  await db.visits.bulkPut([visit('a', 'blog.example'), visit('b', 'other.example')]);
  const s = service();
  expect(await s.handle(req('current-visit', { tabId: 7 }))).toBe('a');
  expect(await s.handle(req('current-visit', { tabId: 8 }))).toBeNull();

  await s.handle(req('forget-site', { host: 'blog.example' }));
  expect(forgetCalls).toBe(1);
  expect((await db.visits.toArray()).map((v) => v.id)).toEqual(['b']);
});

test('the side panel cannot open a note editor for an incognito or blocked Visit', async () => {
  const allowed = visit('a', 'blog.example');
  await db.visits.put(allowed);
  const current = req('current-visit', { tabId: 7 });
  expect(await service().handle(current)).toBe('a');
  expect(await service({ incognito: true }).handle(current)).toBeNull();
  expect(await service({ paused: true }).handle(current)).toBeNull();
  for (const blocked of [
    { ...allowed, privacyBlocked: true },
    { ...allowed, canonicalUrl: 'https://mail.test/' },
    { ...allowed, url: 'https://already.example/' },
  ] satisfies Visit[]) {
    await db.visits.put(blocked);
    expect(await service().handle(current)).toBeNull();
  }
});

test('a pending autosave cannot attach to a Visit after Forget or a change in privacy', async () => {
  await db.visits.put(visit('a', 'blog.example'));
  const request = req('note', { nodeId: 'a', sessionId: 'edit-1', text: 'Draft' });
  expect(await service({ paused: true }).handle(request)).toBe(false);
  const s = service();
  expect(await s.handle(request)).toBe(true);
  await s.handle(req('forget-site', { host: 'blog.example' }));
  expect(await s.handle(request)).toBe(false);
  expect(await db.notes.toArray()).toEqual([]);
});

test('request validation rejects malformed messages', () => {
  expect(isCorrectionRequest(req('split', { visitId: 'x' }))).toBe(true);
  expect(isCorrectionRequest(req('split', {}))).toBe(false);
  expect(isCorrectionRequest(req('merge', { intoId: 'a', fromId: 5 }))).toBe(false);
  expect(isCorrectionRequest({ type: 'other', action: 'split', visitId: 'x' })).toBe(false);
});
