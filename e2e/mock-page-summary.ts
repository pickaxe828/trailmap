import { startMockOAuth } from '../packages/companion/src/auth/mock-oauth';

type Inference = {
  model?: string; instructions?: string; input?: { content?: string }[];
  stream?: boolean; store?: boolean; text?: { format: { name: string } };
};
const calls: Inference[] = [];
const mock = startMockOAuth(async (request) => {
  const path = new URL(request.url).pathname;
  if (path === '/test/calls') return Response.json(calls);
  if (request.headers.get('authorization') !== 'Bearer mock-access-0') return new Response(null, { status: 401 });
  if (path === '/v1/models' && request.method === 'GET') {
    return Response.json({ models: [{ slug: 'fixture-model', display_name: 'Fixture Model', visibility: 'list' }] });
  }
  if (path !== '/v1/responses' || request.method !== 'POST') return new Response(null, { status: 404 });
  const body = await request.json() as Inference;
  calls.push(body);
  const text = body.input?.[0]?.content ?? '';
  if (body.model !== 'fixture-model' || body.store !== false || body.stream !== true ||
    !text.includes('Tombstones preserve causal history across replicas.') || text.includes('This paragraph appears after the extraction limit.')) {
    return new Response(null, { status: 400 });
  }
  if (text.startsWith('{')) {
    const source = JSON.parse(text) as { url: string };
    if (new URL(source.url).hostname === 'limit.test') {
      return Response.json({ error: { code: 'subscription_sharing_usage_limit_exceeded' } }, { status: 429 });
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
      concepts: [{ name: 'Tombstone', kind: 'concept', gloss: 'A deletion marker.', role: 'explains' }],
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
