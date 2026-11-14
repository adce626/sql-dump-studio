import { useEffect, useMemo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
} from 'reactflow';
import 'reactflow/dist/style.css';
import type { RelationEdge, TableMeta } from '../worker/protocol';
import { formatNumber } from '../lib/format';

interface TableNodeData {
  table: TableMeta;
  highlight?: string[];
}

function TableNode({ data }: NodeProps<TableNodeData>) {
  const { table, highlight = [] } = data;
  return (
    <div className="w-56 overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-card)]">
      <Handle id="target" type="target" position={Position.Left} className="!size-2 !border-0 !bg-accent" />
      <div className="flex items-center justify-between gap-2 bg-accent-soft px-3 py-1.5">
        <span className="truncate text-[12px] font-bold text-accent" dir="auto">
          {table.name}
        </span>
        <span className="text-[10px] text-text-soft">{formatNumber(table.rowCount)}</span>
      </div>
      <ul className="max-h-44 overflow-auto py-1">
        {table.columns.slice(0, 12).map((column) => (
          <li
            key={column.name}
            className={[
              'flex items-center justify-between gap-2 px-3 py-[3px] text-[11px]',
              highlight.includes(column.name) ? 'bg-accent-soft/70 text-accent' : 'text-text-soft',
            ].join(' ')}
          >
            <span className="truncate" dir="auto">
              {column.isPrimaryKey ? '🔑 ' : ''}
              {column.name}
            </span>
            <span className="shrink-0 text-[10px] text-muted" dir="auto">
              {column.originalType}
            </span>
          </li>
        ))}
        {table.columns.length > 12 && (
          <li className="px-3 py-1 text-[10px] text-muted">+{table.columns.length - 12} …</li>
        )}
      </ul>
      <Handle id="source" type="source" position={Position.Right} className="!size-2 !border-0 !bg-accent" />
    </div>
  );
}

const nodeTypes = { tableNode: TableNode };

interface ErDiagramProps {
  tables: TableMeta[];
  edges: RelationEdge[];
  showDeclared: boolean;
  showInferred: boolean;
}

export function ErDiagram({ tables, edges, showDeclared, showInferred }: ErDiagramProps) {
  const layout = useMemo(() => {
    const columns = Math.max(1, Math.ceil(Math.sqrt(Math.max(tables.length, 1))));
    const visible = new Set(tables.map((t) => t.name));

    const nodes: Node[] = tables.map((table, index) => ({
      id: table.name,
      type: 'tableNode',
      position: { x: (index % columns) * 300, y: Math.floor(index / columns) * 230 },
      data: { table },
    }));

    const flowEdges: Edge[] = edges
      .filter((edge) => visible.has(edge.fromTable) && visible.has(edge.toTable))
      .filter((edge) => (edge.source === 'declared' ? showDeclared : showInferred))
      .map((edge) => ({
        id: edge.id,
        source: edge.fromTable,
        target: edge.toTable,
        sourceHandle: 'source',
        targetHandle: 'target',
        label: edge.fromColumns.join(', ') + ' → ' + edge.toColumns.join(', '),
        animated: false,
        style:
          edge.source === 'declared'
            ? { stroke: 'var(--c-accent)', strokeWidth: 1.8 }
            : { stroke: 'var(--c-muted)', strokeWidth: 1.4, strokeDasharray: '6 4' },
        labelStyle: { fontSize: 10, fill: 'var(--c-text-soft)' },
        labelBgStyle: { fill: 'var(--c-surface)' },
        markerEnd: { type: 'arrow', color: 'var(--c-accent)' } as Edge['markerEnd'],
      }));

    return { nodes, flowEdges };
  }, [tables, edges, showDeclared, showInferred]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(layout.nodes);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState<Edge>(layout.flowEdges);

  useEffect(() => {
    setNodes(layout.nodes);
    setFlowEdges(layout.flowEdges);
  }, [layout, setNodes, setFlowEdges]);

  return (
    <div className="h-[68vh] overflow-hidden rounded-xl border border-border bg-surface">
      <ReactFlow
        nodes={nodes}
        edges={flowEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.15}
        proOptions={{ hideAttribution: true }}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
      >
        <Background gap={22} size={1} color="var(--c-border)" />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          style={{ background: 'var(--c-surface-2)', borderRadius: '0.6rem' }}
          nodeColor={() => 'var(--c-accent)'}
        />
      </ReactFlow>
    </div>
  );
}
