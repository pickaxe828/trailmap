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
import type { Visit } from '@trailmap/shared';
import { memo, useMemo, type DragEvent } from 'react';
import { webUrl } from '../ui/web-url';
import { formatActiveTime } from './format';
import type { TrailGraph, TrailGraphEdge, TrailGraphNode } from './graph';
import { TRAIL_CARD, useTrailLayout } from './useTrailLayout';

type ReviewActions = {
  summaries: ReadonlyMap<string, string | null>;
  onSelect: (id: string) => void;
  onDragVisit?: (event: DragEvent, visit: Visit) => void;
};
type CardNode = Node<{ stop: TrailGraphNode; review?: ReviewActions }, 'trailCard'>;

// SVG geometry is in canvas units; the favicon request is bitmap pixels, not UI sizing.
const EDGE_STROKE_WIDTH = 1.5;
const SKIPPED_EDGE_DASH = '6 4';
const FAVICON_BITMAP_PX = 32;

/** Chrome's local favicon cache; it doesn't contact the site or a third party. */
function faviconUrl(pageUrl: string): string {
  const url = new URL(chrome.runtime.getURL('/_favicon/'));
  url.searchParams.set('pageUrl', pageUrl);
  url.searchParams.set('size', String(FAVICON_BITMAP_PX));
  return url.href;
}

const interactive = 'pointer-events-auto block size-full rounded-lg text-start hover:outline focus-visible:outline outline-accent';

const TrailCard = memo(function TrailCard({ data: { stop, review } }: NodeProps<CardNode>) {
  const visit = stop.kind === 'skipped' ? null : stop.visit;
  const url = visit && webUrl(visit.url);
  const title = stop.kind === 'question' ? stop.query.q : stop.kind === 'skipped' ? `+${stop.visits.length} skipped`
    : stop.visit.title || url?.hostname || 'Untitled Visit';
  const summary = visit && review?.summaries.get(visit.canonicalUrl);
  const caption = stop.kind === 'question' ? 'Search question' : stop.kind === 'skipped' ? 'Pages you didn’t read'
    : summary || url?.hostname || 'Page';
  const content = (
    <VStack as="span" height="100%" padding={3} gap={1} vAlign="center">
      <HStack as="span" gap={2} align="center">
        {stop.kind === 'question' ? <Icon icon="search" size="sm" /> : url && (
          <img src={faviconUrl(url.href)} alt="" draggable={false} className="size-4 shrink-0" />
        )}
        <Text type="label" maxLines={1} hasTruncateTooltip={false}>{title}</Text>
      </HStack>
      <HStack as="span" gap={2} justify="between" align="center">
        <Text type="supporting" maxLines={1} hasTruncateTooltip={false}>{caption}</Text>
        {visit?.imported ? <Text type="supporting">Imported</Text>
          : visit && !summary && <Text type="supporting" hasTabularNumbers>{formatActiveTime(visit.activeMs)}</Text>}
      </HStack>
    </VStack>
  );
  const drag = visit && review?.onDragVisit;
  return (
    <>
      <Handle type="target" position={Position.Left} isConnectable={false} className="opacity-0" />
      <VStack height="100%" className={stop.emphasis === 'muted' ? 'opacity-75 hover:opacity-100 focus-within:opacity-100' : undefined}>
        <Card height="100%" padding={0} variant={stop.kind === 'question' ? 'blue' : 'default'} elevation="low">
          {review ? (
            <button type="button" title={title} aria-label={title} className={`${interactive} nopan`}
              onClick={() => review.onSelect(stop.id)} draggable={!!drag}
              onDragStart={drag ? (event) => drag(event, visit) : undefined}>
              {content}
            </button>
          ) : url ? (
            <a href={url.href} target="_blank" rel="noopener noreferrer" title={title} className={interactive}>{content}</a>
          ) : content}
        </Card>
      </VStack>
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

/** Shared canvas; raw Trail cards open URLs, Expedition cards select a stop for review. */
export function TrailGraphView({ graph, review }: { graph: TrailGraph; review?: ReviewActions }) {
  const layout = useTrailLayout(graph);
  const nodes = useMemo(() => graph.nodes.flatMap((stop): CardNode[] => {
    const position = layout && 'positions' in layout ? layout.positions.get(stop.id) : undefined;
    return position ? [{ id: stop.id, type: 'trailCard', position, data: { stop, review }, ...TRAIL_CARD }] : [];
  }), [graph.nodes, layout, review]);
  const edges = useMemo(() => graph.edges.map((edge): Edge<{ lineage: TrailGraphEdge }> => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    data: { lineage: edge },
    type: 'smoothstep',
    style: { strokeWidth: EDGE_STROKE_WIDTH, strokeDasharray: edge.dashed ? SKIPPED_EDGE_DASH : undefined },
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
      className="bg-body [--xy-edge-stroke:var(--color-icon-secondary)]"
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
