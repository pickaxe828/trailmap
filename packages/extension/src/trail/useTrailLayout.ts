import ELK, { type ElkNode } from 'elkjs/lib/elk-api.js';
import workerUrl from 'elkjs/lib/elk-worker.min.js?url';
import { useEffect, useState } from 'react';
import type { TrailGraph } from './graph';

// Shared geometry in canvas units. React Flow uses the same dimensions as ELK.
export const TRAIL_CARD = { width: 264, height: 80 } as const;
const TRAIL_GAP = { betweenLayers: 88, betweenCards: 24 } as const;

type Layout = { positions: Map<string, { x: number; y: number }> } | { error: true };

export function useTrailLayout({ nodes, edges }: TrailGraph): Layout | undefined {
  // Only geometry goes to ELK. Active time and title updates don't trigger a
  // re-layout or send browsing content to the worker.
  const geometry = JSON.stringify({
    id: 'trail',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.layered.spacing.nodeNodeBetweenLayers': String(TRAIL_GAP.betweenLayers),
      'elk.spacing.nodeNode': String(TRAIL_GAP.betweenCards),
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    },
    children: nodes.map(({ id }) => ({ id, ...TRAIL_CARD })),
    edges: edges.map(({ id, source, target }) => ({ id, sources: [source], targets: [target] })),
  } satisfies ElkNode);
  const [layout, setLayout] = useState<Layout>();

  useEffect(() => {
    const input = JSON.parse(geometry) as ElkNode;
    if (!input.children?.length) return;
    let worker: Worker | undefined;
    let cancelled = false;
    const fail = () => { if (!cancelled) setLayout({ error: true }); };
    try {
      // Vite emits the classic ELK worker as a same-origin MV3 asset.
      worker = new Worker(workerUrl);
      worker.addEventListener('error', fail);
      const elk = new ELK({ workerFactory: () => worker! });
      elk.layout(input).then(({ children = [] }) => {
        if (cancelled) return;
        setLayout({ positions: new Map(children.map(({ id, x = 0, y = 0 }) => [id, { x, y }])) });
      }, fail);
    } catch {
      fail();
    }
    return () => {
      cancelled = true;
      worker?.terminate();
    };
  }, [geometry]);

  return layout;
}
