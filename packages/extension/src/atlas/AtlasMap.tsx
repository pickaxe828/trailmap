import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import Sigma from 'sigma';
import { isConceptShown, type AtlasFilter, type AtlasGraph, type ConceptLink, type ConceptNode } from './graph';
import LayoutWorker from './layout-worker?worker';
import type { LayoutPositions } from './layout-worker';
import { readAtlasColors } from './theme';

type AtlasRenderer = Sigma<ConceptNode, ConceptLink>;

function centerMap(renderer: AtlasRenderer, filter: AtlasFilter) {
  const focused = filter.focused && renderer.getNodeDisplayData(filter.focused);
  const camera = renderer.getCamera();
  if (focused) {
    const center = renderer.viewportToFramedGraph(renderer.graphToViewport(focused));
    camera.animate({ ...center, ratio: Math.min(camera.ratio, 0.8) });
  } else camera.animatedReset();
}

export function AtlasMap({ graph, filter, onFocus }: {
  graph: AtlasGraph; filter: AtlasFilter; onFocus: (id?: string) => void;
}) {
  const container = useRef<HTMLElement>(null);
  const renderer = useRef<AtlasRenderer | undefined>(undefined);
  const currentFilter = useRef(filter);
  const [failed, setFailed] = useState(false);
  const focus = useEffectEvent(onFocus);

  useEffect(() => {
    const host = container.current!;
    let colors = readAtlasColors(host);
    const nodeShown = (id: string) => isConceptShown(id, graph.getNodeAttribute(id, 'firstSeen'), currentFilter.current);
    let sigma: AtlasRenderer;
    try {
      sigma = new Sigma(graph, host, {
        // Keep filtering here rather than removing nodes; the replay does not change the layout.
        nodeReducer: (id, node) => {
          const view = currentFilter.current;
          const selected = id === view.focused;
          return { ...node, hidden: !isConceptShown(id, node.firstSeen, view),
            color: (node.strength === 'seen' ? colors.faded : colors.communities)[node.community % colors.communities.length],
            forceLabel: selected || !!view.labelAll, zIndex: selected ? 1 : 0 };
        },
        edgeReducer: (id, edge) => {
          const [from, to] = graph.extremities(id);
          return { ...edge, hidden: !nodeShown(from) || !nodeShown(to), color: colors.edge };
        },
        labelColor: { color: colors.label }, labelFont: colors.font, labelRenderedSizeThreshold: 10,
        defaultDrawNodeHover: (ctx, node, settings) => settings.defaultDrawNodeLabel(ctx, node, settings),
        labelDensity: 0.6, zIndex: true, hideEdgesOnMove: true, hideLabelsOnMove: true,
        minCameraRatio: 0.08, maxCameraRatio: 5,
      });
    } catch {
      host.replaceChildren();
      setFailed(true);
      return;
    }
    renderer.current = sigma;
    sigma.on('clickNode', ({ node }) => focus(node));
    sigma.on('clickStage', () => focus());
    sigma.on('enterNode', () => host.classList.add('cursor-pointer'));
    sigma.on('leaveNode', () => host.classList.remove('cursor-pointer'));

    const media = matchMedia('(prefers-color-scheme: dark)');
    const updateTheme = () => {
      colors = readAtlasColors(host);
      sigma.setSetting('labelColor', { color: colors.label });
      sigma.scheduleRefresh();
    };
    media.addEventListener('change', updateTheme);

    const worker = new LayoutWorker();
    worker.onmessage = ({ data }: MessageEvent<LayoutPositions>) => {
      graph.updateEachNodeAttributes((id, node) => {
        const point = data[id];
        return Number.isFinite(point?.x) && Number.isFinite(point?.y) ? { ...node, ...point } : node;
      }, { attributes: ['x', 'y'] });
      sigma.refresh();
      centerMap(sigma, currentFilter.current);
      worker.terminate();
    };
    worker.onerror = () => worker.terminate();
    worker.postMessage(graph.export());
    return () => {
      worker.terminate();
      media.removeEventListener('change', updateTheme);
      sigma.kill();
      renderer.current = undefined;
      host.classList.remove('cursor-pointer');
    };
  }, [graph]);

  useEffect(() => {
    const needsCentering = currentFilter.current.focused !== filter.focused;
    currentFilter.current = filter;
    const sigma = renderer.current;
    if (!sigma) return;
    sigma.scheduleRefresh();
    if (needsCentering || filter.focused) centerMap(sigma, filter);
  }, [graph, filter]);

  return (
    <VStack className="relative min-h-[50dvh] grow overflow-hidden" aria-label="Concept map" role="region">
      <VStack ref={container} className="absolute inset-0" aria-hidden="true" />
      {failed && <Text role="status" type="supporting">The map needs WebGL. You can still find concepts and read their evidence.</Text>}
    </VStack>
  );
}
