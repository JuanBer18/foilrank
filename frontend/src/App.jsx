import { useState, useEffect } from 'react'
import SetupPanel from './components/SetupPanel'
import ResultsTable from './components/ResultsTable'
import PolarPlot from './components/PolarPlot'
import ShapeViewer from './components/ShapeViewer'
import './App.css'

export default function App() {
  const [tab, setTab] = useState('setup')
  const [results, setResults] = useState([])
  const [selectedAirfoils, setSelectedAirfoils] = useState([])
  const [progress, setProgress] = useState(null)
  const [wingParams, setWingParams] = useState(null)

  useEffect(() => {
    let interval
    if (progress?.status === 'running') {
      interval = setInterval(async () => {
        const res = await fetch('http://localhost:5000/api/progress')
        const data = await res.json()
        setProgress(data)
        if (data.status === 'done') {
          clearInterval(interval)
          fetchResults()
        }
      }, 1000)
    }
    return () => clearInterval(interval)
  }, [progress?.status])

  async function fetchResults() {
    const res = await fetch('http://localhost:5000/api/results')
    const data = await res.json()
    setResults(data)
  }

  useEffect(() => { fetchResults() }, [])

  function handleSelectAirfoil(name) {
    setSelectedAirfoils(prev =>
      prev.includes(name) ? prev.filter(a => a !== name) : [...prev, name]
    )
  }

  const TABS = [
    { key: 'setup',   label: '⚙ Setup'   },
    { key: 'results', label: '⊞ Results' },
    { key: 'plot',    label: '∿ Plot'    },
    { key: 'shapes',  label: '◎ Shapes'  },
  ]

  return (
    <div className="app">
      <header className="app-header">
        <div className="logo">
          <span className="logo-icon">◈</span>
          <span className="logo-text">FOILRANK</span>
        </div>
        <nav className="nav">
          {TABS.map(t => (
            <button key={t.key}
              className={`nav-btn ${tab === t.key ? 'active' : ''}`}
              onClick={() => setTab(t.key)}>
              {t.label}
              {/* Badge for selected count on plot/shapes tabs */}
              {(t.key === 'plot' || t.key === 'shapes') && selectedAirfoils.length > 0 && (
                <span style={{
                  marginLeft: '0.35rem',
                  background: 'var(--accent)',
                  color: 'var(--bg)',
                  borderRadius: '999px',
                  padding: '0 0.35rem',
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  lineHeight: '1.4',
                  display: 'inline-block',
                  verticalAlign: 'middle',
                }}>
                  {selectedAirfoils.length}
                </span>
              )}
            </button>
          ))}
        </nav>

        {progress?.status === 'running' && (
          <div className="progress-bar-header">
            <div className="pb-label">
              {progress.current} — {progress.completed}/{progress.total}
            </div>
            <div className="pb-track">
              <div className="pb-fill"
                style={{ width: `${(progress.completed / progress.total) * 100}%` }} />
            </div>
          </div>
        )}
      </header>

      <main className="app-main">
        {tab === 'setup' && (
          <SetupPanel
            onAnalysisStart={setProgress}
            onParamsComputed={setWingParams}
            wingParams={wingParams}
          />
        )}
        {tab === 'results' && (
          <ResultsTable
            results={results}
            onSelectAirfoil={handleSelectAirfoil}
            selectedAirfoils={selectedAirfoils}
            onRefresh={fetchResults}
            wingParams={wingParams}
            onParamsChange={setWingParams}
          />
        )}
        {tab === 'plot' && (
          <PolarPlot
            selectedAirfoils={selectedAirfoils}
            onRemoveAirfoil={name =>
              setSelectedAirfoils(prev => prev.filter(a => a !== name))
            }
            wingParams={wingParams}
          />
        )}
        {tab === 'shapes' && (
          <ShapeViewer
            selectedAirfoils={selectedAirfoils}
            onRemoveAirfoil={name =>
              setSelectedAirfoils(prev => prev.filter(a => a !== name))
            }
          />
        )}
      </main>
    </div>
  )
}
