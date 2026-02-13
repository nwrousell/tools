export const Legend = () => {
  const nodeTypes = [
    { type: 'thesis', label: 'Thesis', color: '#4a9eff' },
    { type: 'supporting_claim', label: 'Supporting Claim', color: '#52c41a' },
    { type: 'empirical_finding', label: 'Empirical Finding', color: '#fa8c16' },
    { type: 'definition', label: 'Definition', color: '#9254de' },
    { type: 'assumption', label: 'Assumption', color: '#8c8c8c' },
  ];

  const edgeTypes = [
    { type: 'supports', label: 'Supports', color: '#52c41a', style: 'solid' },
    { type: 'contradicts', label: 'Contradicts', color: '#f5222d', style: 'dashed' },
    { type: 'elaborates', label: 'Elaborates', color: '#8c8c8c', style: 'dotted' },
    { type: 'is_evidence_for', label: 'Evidence For', color: '#fa8c16', style: 'solid' },
    { type: 'assumes', label: 'Assumes', color: '#1890ff', style: 'dashed' },
    { type: 'follows_from', label: 'Follows From', color: '#1890ff', style: 'solid' },
  ];

  return (
    <div className="legend">
      <h3>Legend</h3>
      
      <div className="legend-section">
        <h4>Node Types</h4>
        {nodeTypes.map(({ type, label, color }) => (
          <div key={type} className="legend-item">
            <div 
              className="legend-color-box" 
              style={{ backgroundColor: color }}
            />
            <span>{label}</span>
          </div>
        ))}
      </div>

      <div className="legend-section">
        <h4>Edge Types</h4>
        {edgeTypes.map(({ type, label, color, style }) => (
          <div key={type} className="legend-item">
            <div 
              className={`legend-edge-line ${style}`}
              style={{ color }}
            />
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
