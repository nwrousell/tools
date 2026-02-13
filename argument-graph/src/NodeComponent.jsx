import { memo } from 'preact/compat';
import { useState, useRef } from 'preact/hooks';
import { Handle, Position } from 'reactflow';

function formatParagraphId(paragraphId) {
  if (!paragraphId) return '';
  const match = paragraphId.match(/p-(\d+)/);
  return match ? `Paragraph ${match[1]}` : paragraphId;
}

export const ArgumentNode = memo(({ data }) => {
  const [hovered, setHovered] = useState(false);
  const isBackbone = data.isBackbone;
  
  return (
    <>
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="target" position={Position.Left} id="left" />
      <Handle type="target" position={Position.Right} id="right" />
      <Handle type="target" position={Position.Bottom} id="bottom" />
      
      <div 
        className={`node-content ${isBackbone ? 'node-backbone' : ''}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div className="node-statement">
          {data.statement}
        </div>

        {hovered && (data.grounding?.quote || data.grounding?.paragraph_id) && (
          <div className="node-tooltip">
            <div className="tooltip-type">{data.type.replace(/_/g, ' ')}</div>
            {data.grounding?.quote && (
              <div className="tooltip-quote">"{data.grounding.quote}"</div>
            )}
            {data.grounding?.paragraph_id && (
              <div className="tooltip-grounding">
                {formatParagraphId(data.grounding.paragraph_id)}
              </div>
            )}
          </div>
        )}
      </div>
      
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Left} id="left" />
      <Handle type="source" position={Position.Right} id="right" />
      <Handle type="source" position={Position.Top} id="top" />
    </>
  );
});
