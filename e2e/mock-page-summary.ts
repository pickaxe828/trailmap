import { startMockOAuth } from '../packages/companion/src/auth/mock-oauth';

const mock = startMockOAuth(async (request) => {
  const path = new URL(request.url).pathname;
  if (request.headers.get('authorization') !== 'Bearer mock-access-0') return new Response(null, { status: 401 });
  if (path === '/v1/models' && request.method === 'GET') {
    return Response.json({ models: [{ slug: 'fixture-model', display_name: 'Fixture Model', visibility: 'list' }] });
  }
  if (path !== '/v1/responses' || request.method !== 'POST') return new Response(null, { status: 404 });
  const body = await request.json() as { model?: string; input?: { content?: string }[]; stream?: boolean; store?: boolean };
  const text = body.input?.[0]?.content ?? '';
  if (body.model !== 'fixture-model' || body.store !== false || body.stream !== true ||
    !text.includes('Tombstones preserve causal history across replicas.') || text.includes('This paragraph appears after the extraction limit.')) {
    return new Response(null, { status: 400 });
  }
  const output = {
    summary: 'Tombstones let replicas learn about deletions even when updates arrive out of order.',
    takeaways: ['A deletion marker preserves causal history.', 'Each marker refers to a specific item.'],
  };
  return new Response(
    `event: response.output_text.delta\ndata: ${JSON.stringify({ delta: JSON.stringify(output) })}\n\n` +
    'event: response.completed\ndata: {"response":{"status":"completed"}}\n\n',
    { headers: { 'content-type': 'text/event-stream' } },
  );
});
console.log(mock.origin);
