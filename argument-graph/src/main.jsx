import { render } from 'preact';
import { useState } from 'preact/hooks';
import { Graph } from './Graph';
import exampleData from './example.json';
import './styles.css';

function App() {
  const [jsonInput, setJsonInput] = useState('');
  const [graphData, setGraphData] = useState(null);
  const [error, setError] = useState('');
  const [showGraph, setShowGraph] = useState(false);

  const handleLoad = () => {
    setError('');
    
    if (!jsonInput.trim()) {
      setError('Please paste JSON data');
      return;
    }

    try {
      const data = JSON.parse(jsonInput);
      
      // Validate structure
      if (!data.nodes || !Array.isArray(data.nodes)) {
        throw new Error('JSON must have a "nodes" array');
      }
      
      if (!data.edges || !Array.isArray(data.edges)) {
        throw new Error('JSON must have an "edges" array');
      }
      
      setGraphData(data);
      setShowGraph(true);
    } catch (err) {
      setError(`Invalid JSON: ${err.message}`);
    }
  };

  const handleBack = () => {
    setShowGraph(false);
  };

  if (showGraph && graphData) {
    return (
      <div className="app-container">
        <header className="header-minimal">
          <button className="back-button" onClick={handleBack}>
            ← Back to Input
          </button>
          <h1>Argument Graph Visualizer</h1>
        </header>

        <div className="graph-container">
          <Graph graphData={graphData} />
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="header">
        <h1>Argument Graph Visualizer</h1>
        <div className="input-section">
          <textarea
            className="json-input"
            placeholder="Paste your argument graph JSON here..."
            value={jsonInput}
            onInput={(e) => setJsonInput(e.target.value)}
          />
          <div className="button-group">
            <button className="load-button" onClick={handleLoad}>
              Load Graph
            </button>
            <button className="example-button" onClick={() => {
              setGraphData(exampleData);
              setShowGraph(true);
            }}>
              Load Example
            </button>
          </div>
        </div>
        {error && <div className="error-message">{error}</div>}
      </header>

      <div className="graph-container">
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          height: '100%',
          color: '#999',
          fontSize: '1.2rem'
        }}>
          Paste JSON above and click "Load Graph" to visualize
        </div>
      </div>
    </div>
  );
}

render(<App />, document.getElementById('app'));
