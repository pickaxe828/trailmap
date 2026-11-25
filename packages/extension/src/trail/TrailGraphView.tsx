import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Center } from '@astryxdesign/core/Center';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon } from '@astryxdesign/core/Icon';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import {
  Background, Handle, MarkerType, Panel, Position, ReactFlow, useReactFlow,
  type Edge, type Node, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import { memo, useMemo } from 'react';
import { formatActiveTime } from './format';
import type { TrailGraph, TrailGraphEdge, TrailGraphNode } from './graph';
import { TRAIL_CARD, useTrailLayout } from './useTrailLayout';

type CardNode = Node<{ stop: TrailGraphNode }, 'trailCard'>;

function webUrl(input: string): URL | null {
  const url = URL.parse(input);
  return url?.protocol === 'https:' || url?.protocol === 'http:' ? url : null;
}

/** Chrome's local favicon cache; it doesn't contact the site or a third party. */
function faviconUrl(pageUrl: string): string {
  const url = new URL(chrome.runtime.getURL('/_favicon/'));
  url.searchParams.set('pageUrl', pageUrl);
  url.searchParams.set('size', '32');
  return url.href;
}

const TrailCard = memo(function TrailCard({ data: { stop } }: NodeProps<CardNode>) {
  const url = stop.visit && webUrl(stop.visit.url);
  const title = stop.kind === 'question' ? stop.query.q : stop.visit.title || url?.hostname || 'Untitled Visit';
  const caption = stop.kind === 'question' ? 'Search question' : url?.hostname ?? 'Page';
  const content = (
    <Card height="100%" padding={3} variant={stop.kind === 'question' ? 'blue' : 'default'} elevation="low">
      <VStack height="100%" gap={1} vAlign="center">
        <HStack gap={2} align="center">
          {stop.kind === 'question' ? <Icon icon="search" size="sm" /> : url && (
            <img src={faviconUrl(url.href)} alt="" draggable={false} className="size-4 shrink-0" />
          )}
          <Text type="label" maxLines={1} hasTruncateTooltip={false}>{title}</Text>
        </HStack>
        <HStack gap={2} justify="between" align="center">
          <Text type="supporting" maxLines={1} hasTruncateTooltip={false}>{caption}</Text>
          {stop.visit && <Text type="supporting" hasTabularNumbers>{formatActiveTime(stop.visit.activeMs)}</Text>}
        </HStack>
      </VStack>
    </Card>
  );
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} className="opacity-0" />
      {url ? (
        <a href={url.href} target="_blank" rel="noopener noreferrer" title={title}
          className="pointer-events-auto block size-full rounded-lg hover:outline focus-visible:outline outline-accent">
          {content}
        </a>
      ) : content}
      <Handle type="source" position={Position.Right} isConnectable={false} className="opacity-0" />
    </>
  );
});

const nodeTypes = { trailCard: TrailCard };
const fitOptions = { maxZoom: 1.15, padding: '12%' } as const;

function GraphControls() {
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  return (
    <Panel position="bottom-right">
      <Card padding={1} elevation="low">
        <HStack gap={1}>
          <Button size="sm" variant="ghost" label="Zoom out" onClick={() => void zoomOut()} />
          <Button size="sm" variant="ghost" label="Fit trail" onClick={() => void fitView(fitOptions)} />
          <Button size="sm" variant="ghost" label="Zoom in" onClick={() => void zoomIn()} />
        </HStack>
      </Card>
    </Panel>
  );
}

/** Read-only graph canvas shared by the raw Trail and Expedition views. */
export function TrailGraphView({ graph }: { graph: TrailGraph }) {
  const layout = useTrailLayout(graph);
  const nodes = useMemo(() => graph.nodes.flatMap((stop): CardNode[] => {
    const position = layout && 'positions' in layout ? layout.positions.get(stop.id) : undefined;
    return position ? [{ id: stop.id, type: 'trailCard', position, data: { stop }, ...TRAIL_CARD }] : [];
  }), [graph.nodes, layout]);
  const edges = useMemo(() => graph.edges.map((edge): Edge<{ lineage: TrailGraphEdge }> => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    data: { lineage: edge },
    type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed },
  })), [graph.edges]);

  if (!layout || 'error' in layout) return (
    <Center height="100%">
      <Text type="supporting" as="p">
        {layout ? 'Could not lay out this trail. Try reloading the page.' : 'Laying out your trail…'}
      </Text>
    </Center>
  );

  return (
    <ReactFlow
      nodes={nodes} edges={edges} nodeTypes={nodeTypes}
      className="bg-body [--xy-edge-stroke:var(--color-icon-secondary)] [--xy-edge-stroke-width:1.5]"
      defaultMarkerColor="var(--color-icon-secondary)"
      fitView fitViewOptions={fitOptions} minZoom={0.01} maxZoom={2}
      nodesDraggable={false} nodesConnectable={false} nodesFocusable={false}
      edgesFocusable={false} elementsSelectable={false} zoomOnDoubleClick={false}
      onlyRenderVisibleElements={nodes.length > 200}
      proOptions={{ hideAttribution: true }}
    >
      <Background color="var(--color-border)" />
      <GraphControls />
    </ReactFlow>
  );
}
