import { useMemo } from 'preact/compat';
import ReactFlow, { 
  Background, 
  Controls,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { ArgumentNode } from './NodeComponent';

const nodeTypes = {
  argumentNode: ArgumentNode,
};

function extractParagraphNumber(paragraphId) {
  if (!paragraphId) return 0;
  const match = paragraphId.match(/p-(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

function buildLayout(nodes, edges) {
  const nodeMap = {};
  for (const n of nodes) nodeMap[n.id] = n;

  // Backbone = thesis + all supporting_claims, sorted by paragraph order
  const backboneTypes = new Set(['thesis', 'supporting_claim']);
  const backbone = nodes
    .filter(n => backboneTypes.has(n.type))
    .sort((a, b) =>
      extractParagraphNumber(a.grounding?.paragraph_id) -
      extractParagraphNumber(b.grounding?.paragraph_id)
    );
  const backboneSet = new Set(backbone.map(n => n.id));

  // For each non-backbone node, find which backbone node it connects to
  const connectedTo = {};
  for (const edge of edges) {
    const src = edge.source;
    const tgt = edge.target;
    
    if (!backboneSet.has(src) && backboneSet.has(tgt)) {
      if (!connectedTo[src]) connectedTo[src] = tgt;
    }
    if (!backboneSet.has(tgt) && backboneSet.has(src)) {
      if (!connectedTo[tgt]) connectedTo[tgt] = src;
    }
  }

  // Group side nodes by their backbone parent
  const sideNodes = {};
  const placed = new Set(backboneSet);
  
  for (const node of nodes) {
    if (placed.has(node.id)) continue;
    const parent = connectedTo[node.id];
    if (parent) {
      if (!sideNodes[parent]) sideNodes[parent] = [];
      sideNodes[parent].push(node.id);
      placed.add(node.id);
    }
  }

  // Place remaining unconnected nodes at the last backbone level
  const unplaced = nodes.filter(n => !placed.has(n.id));
  if (unplaced.length > 0) {
    const lastId = backbone[backbone.length - 1].id;
    if (!sideNodes[lastId]) sideNodes[lastId] = [];
    for (const n of unplaced) {
      sideNodes[lastId].push(n.id);
    }
  }

  // Layout
  const nodeWidth = 300;
  const horizontalGap = 360;
  const verticalPadding = 40; // gap between rows
  const centerX = 600;
  const charsPerLine = 45; // approximate characters per line at node width
  const lineHeight = 20;  // approximate px per line of text
  const nodePadding = 40; // vertical padding inside node

  // Estimate node height from statement length
  function estimateHeight(nodeId) {
    const node = nodeMap[nodeId];
    if (!node) return 80;
    const lines = Math.ceil((node.statement || '').length / charsPerLine);
    return Math.max(60, lines * lineHeight + nodePadding);
  }

  const positions = {};

  // Place backbone vertically, accounting for estimated heights
  let currentY = 0;
  for (let i = 0; i < backbone.length; i++) {
    const bId = backbone[i].id;
    
    // Find the tallest node in this row (backbone + its side nodes)
    const sideIds = sideNodes[bId] || [];
    const allInRow = [bId, ...sideIds];
    const rowHeight = Math.max(...allInRow.map(estimateHeight));

    positions[bId] = {
      x: centerX - nodeWidth / 2,
      y: currentY,
    };

    // Place side nodes left and right, alternating
    let leftCount = 0;
    let rightCount = 0;

    for (const id of sideIds) {
      if (leftCount <= rightCount) {
        leftCount++;
        positions[id] = {
          x: centerX - nodeWidth / 2 - horizontalGap * leftCount,
          y: currentY,
        };
      } else {
        rightCount++;
        positions[id] = {
          x: centerX - nodeWidth / 2 + horizontalGap * rightCount,
          y: currentY,
        };
      }
    }

    currentY += rowHeight + verticalPadding;
  }

  // Build React Flow nodes
  const flowNodes = nodes
    .filter(n => positions[n.id])
    .map(node => ({
      id: node.id,
      type: 'argumentNode',
      position: positions[node.id],
      data: {
        type: node.type,
        statement: node.statement,
        grounding: node.grounding,
        isBackbone: backboneSet.has(node.id),
      },
    }));

  // Build React Flow edges with smart handle selection
  const flowEdges = edges.map(edge => {
    const isBackbone = backboneSet.has(edge.source) && backboneSet.has(edge.target);
    
    const srcPos = positions[edge.source];
    const tgtPos = positions[edge.target];
    
    let sourceHandle = 'bottom';
    let targetHandle = 'top';
    
    if (srcPos && tgtPos) {
      const dx = tgtPos.x - srcPos.x;
      const dy = tgtPos.y - srcPos.y;
      
      // Pick handles based on whether the connection is more
      // horizontal or vertical
      if (Math.abs(dx) > Math.abs(dy)) {
        // Horizontal: use left/right
        sourceHandle = dx > 0 ? 'right' : 'left';
        targetHandle = dx > 0 ? 'left' : 'right';
      } else {
        // Vertical: use top/bottom
        sourceHandle = dy > 0 ? 'bottom' : 'top';
        targetHandle = dy > 0 ? 'top' : 'bottom';
      }
    }

    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle,
      targetHandle,
      type: 'smoothstep',
      style: {
        stroke: '#555',
        strokeWidth: isBackbone ? 3 : 1.5,
      },
    };
  });

  return { flowNodes, flowEdges };
}

export const Graph = ({ graphData }) => {
  const { nodes, edges } = useMemo(() => {
    if (!graphData?.nodes || !graphData?.edges) {
      return { nodes: [], edges: [] };
    }
    
    const { flowNodes, flowEdges } = buildLayout(graphData.nodes, graphData.edges);
    return { nodes: flowNodes, edges: flowEdges };
  }, [graphData]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      defaultViewport={{ x: 50, y: 50, zoom: 1 }}
      minZoom={0.1}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
    >
      <Background color="#d0d0d0" gap={20} />
      <Controls />
    </ReactFlow>
  );
};
