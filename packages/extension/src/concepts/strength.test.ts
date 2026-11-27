import { expect, test } from 'bun:test';
import type { ConceptEvidence } from './evidence';
import { evidenceKey, evidenceStrength, summarizeStrength, type StrengthContext } from './strength';

type Row = Pick<ConceptEvidence, 'id' | 'role' | 'salience' | 'name' | 'visitId' | 'canonicalUrl' | 'expeditionId'>;
const row = (over: Partial<Row> = {}): Row => ({ id: 'r', role: 'explains', salience: 'central', name: 'Taa', visitId: 'v', canonicalUrl: 'https://a.test/', ...over });
const ctx = (visit: Partial<{ engagement: 'read' | 'skimmed' | 'bounced'; starred: true }> = {}, highlights: string[] = []): StrengthContext => ({
  visits: new Map([['v', { engagement: 'read', ...visit }]]), highlights: new Map([['v', highlights]]),
});

test.each([
  ['central on a read page', { salience: 'central' }, {}, [], 'studied'],
  ['supporting on a read page', { salience: 'supporting' }, {}, [], 'studied'],
  ['passing on a read page', { salience: 'passing' }, {}, [], 'seen'],
  ['central on a skimmed page', { salience: 'central' }, { engagement: 'skimmed' }, [], 'seen'],
  ['central on a bounced page', { salience: 'central' }, { engagement: 'bounced' }, [], 'seen'],
  ['passing in a highlight that names it', { salience: 'passing' }, { engagement: 'skimmed' }, ['The language TAA has clicks'], 'learned'],
  ['central, but a highlight names something else', { salience: 'central' }, { engagement: 'skimmed' }, ['unrelated'], 'seen'],
  ['central on a starred page', { salience: 'central' }, { starred: true, engagement: 'skimmed' }, [], 'learned'],
  ['supporting on a starred page', { salience: 'supporting' }, { starred: true, engagement: 'skimmed' }, [], 'seen'],
  ['written in My notes', { role: 'learned', salience: 'central', canonicalUrl: '' }, { engagement: 'bounced' }, [], 'learned'],
] as const)('%s is %s', (_, over, visit, highlights, expected) => {
  expect(evidenceStrength(row(over as Partial<Row>), ctx(visit as never, [...highlights]))).toBe(expected);
});

test('evidence from a Visit that no longer exists is only seen', () => {
  expect(evidenceStrength(row(), { visits: new Map(), highlights: new Map() })).toBe('seen');
});

test('a concept takes its strongest evidence, and exposure counts only studied and learned pages', () => {
  const rows = [row({ id: '1', canonicalUrl: 'https://a.test/' }), row({ id: '2', visitId: 'w', canonicalUrl: 'https://b.test/', salience: 'passing' }),
    row({ id: '3', visitId: 'x', canonicalUrl: 'https://c.test/' })];
  const context: StrengthContext = { visits: new Map([['v', { engagement: 'read' }], ['w', { engagement: 'read' }], ['x', { engagement: 'read' }]]), highlights: new Map() };
  expect(summarizeStrength(rows, context)).toEqual({ strength: 'studied', exposure: 2, dismissed: false });
  expect(summarizeStrength([rows[1]!], context)).toEqual({ strength: 'seen', exposure: 0, dismissed: false });
});

test('My notes count as one learned unit each in exposure', () => {
  const notes = (id: string, expeditionId: string) => row({ id, role: 'learned', canonicalUrl: '', visitId: expeditionId, expeditionId });
  const result = summarizeStrength([notes('1', 'e1'), notes('2', 'e1'), notes('3', 'e2')], { visits: new Map(), highlights: new Map() });
  expect(result).toEqual({ strength: 'learned', exposure: 2, dismissed: false });
});

test('a dismissed concept stays hidden: old learned evidence and studied pages no longer count, new learned evidence does', () => {
  const context = ctx();
  const old = row({ id: 'old', role: 'learned', canonicalUrl: '', visitId: 'e1', expeditionId: 'e1' });
  const dismissal = { evidenceKeys: [evidenceKey(old)] };
  expect(summarizeStrength([row(), old], context, dismissal)).toEqual({ strength: 'seen', exposure: 0, dismissed: true });
  // The same notes asked about again get a new row id but the same key.
  expect(summarizeStrength([{ ...old, id: 'rerun' }], context, dismissal).dismissed).toBe(true);
  const fresh = row({ id: 'new', role: 'learned', canonicalUrl: '', visitId: 'e2', expeditionId: 'e2' });
  expect(summarizeStrength([old, fresh], context, dismissal)).toEqual({ strength: 'learned', exposure: 1, dismissed: false });
});
