import { startMockOAuth } from '../packages/companion/src/auth/mock-oauth';

type Inference = {
  model?: string; instructions?: string; input?: { content?: string }[];
  stream?: boolean; store?: boolean; text?: { format: { name: string } };
};
const calls: Inference[] = [];
const modelSlugs = process.argv.slice(2);
const catalog = modelSlugs.length ? modelSlugs.map((slug) => ({ slug, display_name: slug.toUpperCase(), visibility: 'list' }))
  : [{ slug: 'fixture-model', display_name: 'Fixture Model', visibility: 'list' }];
let planErrorCleared = false;
let failWrapUp = false;
const mock = startMockOAuth(async (request) => {
  const path = new URL(request.url).pathname;
  if (path === '/test/calls') return Response.json(calls);
  if (path === '/test/clear-plan-error' && request.method === 'POST') {
    planErrorCleared = true;
    return new Response(null, { status: 204 });
  }
  if (path === '/test/wrap-up-failure' && request.method === 'POST') {
    failWrapUp = (await request.text()) === 'on';
    return new Response(null, { status: 204 });
  }
  if (request.headers.get('authorization') !== 'Bearer mock-access-0') return new Response(null, { status: 401 });
  if (path === '/v1/models' && request.method === 'GET') {
    return Response.json({ models: catalog });
  }
  if (path !== '/v1/responses' || request.method !== 'POST') return new Response(null, { status: 404 });
  const body = await request.json() as Inference;
  calls.push(body);
  if (!catalog.some(({ slug }) => slug === body.model)) return new Response(null, { status: 400 });
  const text = body.input?.[0]?.content ?? '';
  const task = body.text?.format.name;
  if (task === 'living_note') {
    const { livingNote, fieldNotes } = JSON.parse(text) as { livingNote: string | null; fieldNotes: string };
    if (!fieldNotes.includes('A tombstone records')) return new Response(null, { status: 400 });
    return stream(JSON.stringify({ markdown: livingNote ? 'Both sessions support the revised conclusion.' : 'The first session explains tombstones.' }));
  }
  if (task === 'notes_enrichment') {
    // Only the user's own notes arrive here, each with a ref.
    const { notes } = JSON.parse(text) as { notes: { ref: string; text: string }[] };
    return stream(JSON.stringify({
      concepts: notes.filter((note) => /tombstone/i.test(note.text)).map((note) => ({
        name: 'Tombstone', kind: 'concept', gloss: 'A marker that records a deletion.', note: note.ref })),
      relations: [],
    }));
  }
  if (task === 'expedition_wrap_up' && failWrapUp) {
    return Response.json({ error: { code: 'subscription_sharing_usage_unavailable', message: 'private provider detail' } }, { status: 503 });
  }
  if (task === 'expedition_wrap_up' || task === 'field_notes') {
    // Wrap-up inputs carry Page notes, never Page text.
    const input = JSON.parse(text) as { trail: { ref: string; summary?: string; contentKind?: string }[] };
    const page = input.trail.find((entry) => entry.summary);
    const ai = input.trail.find((entry) => entry.contentKind === 'ai_conversation');
    if (ai && task === 'expedition_wrap_up') return stream(JSON.stringify({
      title: 'How light scatters', driving_question: 'Why is the sky blue?', kind: 'learning', merge_with: [],
    }));
    if (ai) return stream(JSON.stringify({
      found: 'Google AI Mode described how air scatters light.',
      key_ideas: [{ idea: 'Shorter wavelengths scatter more strongly.', page: ai.ref }],
      trail: 'The conversation explored Rayleigh scattering.', loose_ends: ['Check the cited reference.'],
    }));
    if (task === 'expedition_wrap_up' && text.includes('pharyngealization')) {
      // First answer is symbol-only; the corrective retry names the symbol.
      return stream(JSON.stringify({
        title: body.instructions?.includes('no readable words') ? 'ˤ: the pharyngealization mark in IPA' : 'ˤ',
        driving_question: 'What does the IPA mark ˤ mean?', kind: 'learning', merge_with: [],
      }));
    }
    if (task === 'expedition_wrap_up') {
      return stream(JSON.stringify({
        title: 'How replicated lists delete items', driving_question: 'How do replicated lists represent deletes?',
        kind: 'learning', merge_with: [],
      }));
    }
    return stream(JSON.stringify({
      found: 'Replicated lists keep tombstones so deletes survive out-of-order updates.',
      key_ideas: [{ idea: 'A tombstone records that an item was deleted.', page: page?.ref ?? 'p1' }],
      trail: 'Opened one article and read it closely.',
      loose_ends: ['How are tombstones garbage collected?'],
    }));
  }
  if (task === 'page_enrichment' && JSON.parse(text).contentKind === 'ai_conversation') return stream(JSON.stringify({
    summary: 'The AI conversation explains Rayleigh scattering.',
    takeaways: ['Shorter wavelengths scatter more strongly.', 'Air contains particles that scatter light.'],
    answers_question: 'Why is the sky blue?', page_kind: 'other',
    concepts: [
      { name: 'Rayleigh scattering', kind: 'concept', gloss: 'Scattering by small particles.', role: 'explains', salience: 'central' },
      { name: 'Wavelength', kind: 'concept', gloss: 'Distance between wave crests.', role: 'mentions', salience: 'passing' },
    ],
    relations: [{ from: 'Rayleigh scattering', to: 'Wavelength', type: 'related_to' }],
  }));
  if (task === 'page_enrichment' && text.includes('pharyngealization')) return stream(JSON.stringify({
    summary: 'The modifier letter ˤ marks pharyngealization in the IPA.',
    takeaways: ['ˤ marks pharyngealization.', 'ʕ and ʔ are neighbouring pharyngeal and glottal sounds.'],
    answers_question: 'What does ˤ mean in the IPA?', page_kind: 'article',
    concepts: [{ name: 'Pharyngealization', kind: 'concept', gloss: 'A secondary articulation marked by ˤ.', role: 'explains', salience: 'central' }],
    relations: [],
  }));
  if (body.store !== false || body.stream !== true ||
    !text.includes('Tombstones preserve causal history across replicas.') || text.includes('This paragraph appears after the extraction limit.')) {
    return new Response(null, { status: 400 });
  }
  if (text.startsWith('{')) {
    const source = JSON.parse(text) as { url: string };
    if (!planErrorCleared) {
      const host = new URL(source.url).hostname;
      if (host === 'limit.test') {
        return Response.json({ error: { code: 'subscription_sharing_usage_limit_exceeded' } }, { status: 429 });
      }
      if (host === 'ineligible.test') {
        return Response.json({ error: { code: 'subscription_sharing_user_not_eligible' } }, { status: 403 });
      }
    }
    // Exercise all outbound attempts, including exact fallback instructions
    // and the prior assistant response sent in the repair message.
    if (body.text?.format.name === 'page_enrichment') {
      return Response.json({ error: { code: 'subscription_sharing_unsupported_capability', param: 'text.format' } }, { status: 400 });
    }
    if (body.input?.length === 1) return stream('This fixture reply needs repair.');
    return stream(JSON.stringify({
      summary: 'Tombstones retain deletion history across replicas.',
      takeaways: ['A tombstone records that an item was deleted.', 'Replicas can process updates out of order.'],
      answers_question: 'How do replicated lists represent deletes?', page_kind: 'article',
      concepts: [{ name: 'Tombstone', kind: 'concept', gloss: 'A deletion marker.', role: 'explains', salience: 'central' }],
      relations: [{ from: 'Tombstone', to: 'CRDT', type: 'part_of' }],
    }));
  }
  const output = {
    summary: 'Tombstones let replicas learn about deletions even when updates arrive out of order.',
    takeaways: ['A deletion marker preserves causal history.', 'Each marker refers to a specific item.'],
  };
  return stream(JSON.stringify(output));
});
console.log(mock.origin);

function stream(delta: string): Response {
  return new Response(
    `event: response.output_text.delta\ndata: ${JSON.stringify({ delta })}\n\n` +
    'event: response.completed\ndata: {"response":{"status":"completed"}}\n\n',
    { headers: { 'content-type': 'text/event-stream' } },
  );
}
