import { UndirectedGraph } from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import type { AtlasGraph } from './graph';

export type LayoutInput = ReturnType<AtlasGraph['export']>;
export type LayoutPositions = Record<string, { x: number; y: number }>;

// One bounded solve off the UI thread. Only graph topology and display attributes leave the page.
self.onmessage = ({ data }: MessageEvent<LayoutInput>) => {
  const graph: AtlasGraph = new UndirectedGraph({ allowSelfLoops: false });
  graph.import(data);
  const positions: LayoutPositions = forceAtlas2(graph, {
    iterations: 150,
    settings: {
      ...forceAtlas2.inferSettings(graph), barnesHutOptimize: true, strongGravityMode: true,
      gravity: 0.12, scalingRatio: 4, slowDown: 3,
    },
  });
  self.postMessage(positions);
};
