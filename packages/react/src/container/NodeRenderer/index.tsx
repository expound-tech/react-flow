import { memo, useMemo, useEffect, useRef, type ComponentType } from 'react';
import { shallow } from 'zustand/shallow';
import { internalsSymbol, errorMessages, Position, clampPosition, getPositionWithOrigin } from '@xyflow/system';

import useVisibleNodesIds from '../../hooks/useVisibleNodes';
import { useStore } from '../../hooks/useStore';
import { containerStyle } from '../../styles/utils';
import { GraphViewProps } from '../GraphView';
import type { NodeTypesWrapped, ReactFlowState, WrapNodeProps } from '../../types';

type NodeRendererProps = Pick<
  GraphViewProps,
  | 'onNodeClick'
  | 'onNodeDoubleClick'
  | 'onNodeMouseEnter'
  | 'onNodeMouseMove'
  | 'onNodeMouseLeave'
  | 'onNodeContextMenu'
  | 'onlyRenderVisibleElements'
  | 'noPanClassName'
  | 'noDragClassName'
  | 'rfId'
  | 'disableKeyboardA11y'
  | 'nodeOrigin'
  | 'nodeExtent'
> & {
  nodeTypes: NodeTypesWrapped;
};

const selector = (s: ReactFlowState) => ({
  nodesDraggable: s.nodesDraggable,
  nodesConnectable: s.nodesConnectable,
  nodesFocusable: s.nodesFocusable,
  elementsSelectable: s.elementsSelectable,
  updateNodeDimensions: s.updateNodeDimensions,
  onError: s.onError,
});

const NodeRenderer = (props: NodeRendererProps) => {
  const { nodesDraggable, nodesConnectable, nodesFocusable, elementsSelectable, updateNodeDimensions, onError } =
    useStore(selector, shallow);
  const nodeIds = useVisibleNodesIds(props.onlyRenderVisibleElements);
  const resizeObserverRef = useRef<ResizeObserver>();

  const resizeObserver = useMemo(() => {
    if (typeof ResizeObserver === 'undefined') {
      return null;
    }

    const observer = new ResizeObserver((entries: ResizeObserverEntry[]) => {
      const updates = new Map();

      entries.forEach((entry: ResizeObserverEntry) => {
        const id = entry.target.getAttribute('data-id') as string;
        updates.set(id, {
          id,
          nodeElement: entry.target as HTMLDivElement,
          forceUpdate: true,
        });
      });

      updateNodeDimensions(updates);
    });

    resizeObserverRef.current = observer;

    return observer;
  }, []);

  useEffect(() => {
    return () => {
      resizeObserverRef?.current?.disconnect();
    };
  }, []);

  return (
    <div className="react-flow__nodes" style={containerStyle}>
      {nodeIds.map((nodeId) => {
        return (
          // The split of responsibilities between NodeRenderer and
          // NodeComponentWrapper may appear weird. However, it’s designed to
          // minimize the cost of updates when individual nodes change.
          //
          // For example, when you’re dragging a single node, that node gets
          // updated multiple times per second. If `NodeRenderer` were to update
          // every time, it would have to re-run the `nodes.map()` loop every
          // time. This gets pricey with hundreds of nodes, especially if every
          // loop cycle does more than just rendering a JSX element!
          //
          // As a result of this choice, we took the following implementation
          // decisions:
          // - NodeRenderer subscribes *only* to node IDs – and therefore
          //   rerender *only* when visible nodes are added or removed.
          // - NodeRenderer performs all operations the result of which can be
          //   shared between nodes (such as creating the `ResizeObserver`
          //   instance, or subscribing to `selector`). This means extra prop
          //   drilling into `NodeComponentWrapper`, but it means we need to run
          //   these operations only once – instead of once per node.
          // - Any operations that you’d normally write inside `nodes.map` are
          //   moved into `NodeComponentWrapper`. This ensures they are
          //   memorized – so if `NodeRenderer` *has* to rerender, it only
          //   needs to regenerate the list of nodes, nothing else.
          <NodeComponentWrapper
            key={nodeId}
            id={nodeId}
            nodeTypes={props.nodeTypes}
            nodeExtent={props.nodeExtent}
            nodeOrigin={props.nodeOrigin}
            onNodeClick={props.onNodeClick}
            onNodeMouseEnter={props.onNodeMouseEnter}
            onNodeMouseMove={props.onNodeMouseMove}
            onNodeMouseLeave={props.onNodeMouseLeave}
            onNodeContextMenu={props.onNodeContextMenu}
            onNodeDoubleClick={props.onNodeDoubleClick}
            noDragClassName={props.noDragClassName}
            noPanClassName={props.noPanClassName}
            rfId={props.rfId}
            disableKeyboardA11y={props.disableKeyboardA11y}
            resizeObserver={resizeObserver}
            nodesDraggable={nodesDraggable}
            nodesConnectable={nodesConnectable}
            nodesFocusable={nodesFocusable}
            elementsSelectable={elementsSelectable}
            onError={onError}
          />
        );
      })}
    </div>
  );
};

const NodeComponentWrapper = memo(function NodeComponentWrapper(props: {
  id: string;
  nodeExtent: NodeRendererProps['nodeExtent'];
  nodeTypes: NodeRendererProps['nodeTypes'];
  nodeOrigin: NodeRendererProps['nodeOrigin'];
  onNodeClick: NodeRendererProps['onNodeClick'];
  onNodeMouseEnter: NodeRendererProps['onNodeMouseEnter'];
  onNodeMouseMove: NodeRendererProps['onNodeMouseMove'];
  onNodeMouseLeave: NodeRendererProps['onNodeMouseLeave'];
  onNodeContextMenu: NodeRendererProps['onNodeContextMenu'];
  onNodeDoubleClick: NodeRendererProps['onNodeDoubleClick'];
  noDragClassName: NodeRendererProps['noDragClassName'];
  noPanClassName: NodeRendererProps['noPanClassName'];
  rfId: NodeRendererProps['rfId'];
  disableKeyboardA11y: NodeRendererProps['disableKeyboardA11y'];
  resizeObserver: ResizeObserver | null;
  nodesDraggable: boolean;
  nodesConnectable: boolean;
  nodesFocusable: boolean;
  elementsSelectable: boolean;
  onError: ReactFlowState['onError'];
}) {
  const node = useStore((s) => s.nodeLookup.get(props.id));
  if (!node) return null;

  let nodeType = node.type || 'default';

  if (!props.nodeTypes[nodeType]) {
    props.onError?.('003', errorMessages['error003'](nodeType));

    nodeType = 'default';
  }

  const NodeComponent = (props.nodeTypes[nodeType] || props.nodeTypes.default) as ComponentType<WrapNodeProps>;
  const isDraggable = !!(node.draggable || (props.nodesDraggable && typeof node.draggable === 'undefined'));
  const isSelectable = !!(node.selectable || (props.elementsSelectable && typeof node.selectable === 'undefined'));
  const isConnectable = !!(node.connectable || (props.nodesConnectable && typeof node.connectable === 'undefined'));
  const isFocusable = !!(node.focusable || (props.nodesFocusable && typeof node.focusable === 'undefined'));

  const clampedPosition = props.nodeExtent
    ? clampPosition(node.computed?.positionAbsolute, props.nodeExtent)
    : node.computed?.positionAbsolute;

  const posX = clampedPosition?.x ?? 0;
  const posY = clampedPosition?.y ?? 0;
  const posOrigin = getPositionWithOrigin({
    x: posX,
    y: posY,
    width: node.computed?.width ?? node.width ?? 0,
    height: node.computed?.height ?? node.height ?? 0,
    origin: node.origin || props.nodeOrigin,
  });
  const initialized = (!!node.computed?.width && !!node.computed?.height) || (!!node.width && !!node.height);

  return (
    <NodeComponent
      key={node.id}
      id={node.id}
      className={node.className}
      style={node.style}
      width={node.width ?? undefined}
      height={node.height ?? undefined}
      type={nodeType}
      data={node.data}
      sourcePosition={node.sourcePosition || Position.Bottom}
      targetPosition={node.targetPosition || Position.Top}
      hidden={node.hidden}
      xPos={posX}
      yPos={posY}
      xPosOrigin={posOrigin.x}
      yPosOrigin={posOrigin.y}
      positionAbsolute={clampedPosition || { x: 0, y: 0 }}
      onClick={props.onNodeClick}
      onMouseEnter={props.onNodeMouseEnter}
      onMouseMove={props.onNodeMouseMove}
      onMouseLeave={props.onNodeMouseLeave}
      onContextMenu={props.onNodeContextMenu}
      onDoubleClick={props.onNodeDoubleClick}
      selected={!!node.selected}
      isDraggable={isDraggable}
      isSelectable={isSelectable}
      isConnectable={isConnectable}
      isFocusable={isFocusable}
      resizeObserver={props.resizeObserver}
      dragHandle={node.dragHandle}
      zIndex={node[internalsSymbol]?.z ?? 0}
      isParent={!!node[internalsSymbol]?.isParent}
      noDragClassName={props.noDragClassName}
      noPanClassName={props.noPanClassName}
      initialized={initialized}
      rfId={props.rfId}
      disableKeyboardA11y={props.disableKeyboardA11y}
      ariaLabel={node.ariaLabel}
    />
  );
});

NodeRenderer.displayName = 'NodeRenderer';

export default memo(NodeRenderer);
