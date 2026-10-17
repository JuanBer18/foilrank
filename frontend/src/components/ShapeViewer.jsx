import { useState, useEffect } from 'react'
import axios from 'axios'

const API = 'http://localhost:5000/api'

const COLORS = [
  '#4fffb0', '#ff6b6b', '#6b8fff', '#ffb86c',
  '#ff79c6', '#8be9fd', '#50fa7b', '#f1fa8c'
]

function useCoordinates(airfoils) {
  const [coords, setCoords] = useState({})
  const [loading, setLoading] = useState({})

  useEffect(() => {
    airfoils.forEach(async (name) => {
      if (coords[name] || loading[name]) return
      setLoading(prev => ({ ...prev, [name]: true }))
      try {
        const res = await axios.get(`${API}/coordinates/${name}`)
        setCoords(prev => ({ ...prev, [name]: res.data.coordinates }))
      } catch {
        setCoords(prev => ({ ...prev, [name]: null }))
      }
      setLoading(prev => ({ ...prev, [name]: false }))
    })
  }, [airfoils])

  return { coords, loading }
}

function getMetrics(pts) {
  if (!pts || pts.length === 0) return null
  const upper = pts.filter((_, i) => i < pts.length / 2)
  const maxY = Math.max(...pts.map(p => p.y))
  const minY = Math.min(...pts.map(p => p.y))
  const thickness = maxY - minY
  const camber = (maxY + minY) / 2
  const maxThicknessX = pts.find(p => p.y === maxY)?.x ?? 0
  return {
    thickness: (thickness * 100).toFixed(2),
    camber:    (camber * 100).toFixed(2),
    maxThicknessX: (maxThicknessX * 100).toFixed(1),
    points: pts.length,
  }
}

// Single airfoil card
function AirfoilCard({ name, pts, color, loading }) {
  const metrics = getMetrics(pts)

  return (
    <div className="card" style={{ borderColor: color + '44' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%',
            background: color, display: 'inline-block' }} />
          <span style={{ fontFamily: 'var(--mono)', fontWeight: 700,
            fontSize: '0.85rem', color: 'var(--text)' }}>
            {name}
          </span>
        </div>
        {metrics && (
          <div style={{ display: 'flex', gap: '1rem',
            fontFamily: 'var(--mono)', fontSize: '0.68rem', color: 'var(--text2)' }}>
            <span>t/c = <span style={{ color }}>{metrics.thickness}%</span></span>
            <span>camber = <span style={{ color }}>{metrics.camber}%</span></span>
            <span>max-t @ <span style={{ color }}>{metrics.maxThicknessX}%c</span></span>
            <span>{metrics.points} pts</span>
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ height: 100, display: 'flex', alignItems: 'center',
          justifyContent: 'center', color: 'var(--text2)',
          fontFamily: 'var(--mono)', fontSize: '0.75rem' }}>
          Loading…
        </div>
      ) : pts ? (
        <svg viewBox="-0.02 -0.22 1.04 0.44"
          style={{ width: '100%', height: 120, display: 'block' }}
          preserveAspectRatio="xMidYMid meet">

          {/* Grid lines */}
          {[0.25, 0.5, 0.75].map(x => (
            <line key={x} x1={x} y1="-0.2" x2={x} y2="0.2"
              stroke="var(--border)" strokeWidth="0.002" />
          ))}
          <line x1="0" y1="0" x2="1" y2="0"
            stroke="var(--border2)" strokeWidth="0.003" strokeDasharray="0.025 0.015" />

          {/* Thickness envelope */}
          <polyline
            points={pts.map(p => `${p.x},${-p.y}`).join(' ')}
            fill={color + '12'}
            stroke={color}
            strokeWidth="0.006"
            strokeLinejoin="round"
          />

          {/* Camber line — midpoint between upper and lower at each x */}
          {(() => {
            const upper = []
            const lower = []
            const seen = {}
            pts.forEach(p => {
              if (!seen[p.x]) { seen[p.x] = []; }
              seen[p.x].push(p.y)
            })
            const camberPts = Object.entries(seen)
              .filter(([, ys]) => ys.length === 2)
              .map(([x, ys]) => ({ x: parseFloat(x), y: (ys[0] + ys[1]) / 2 }))
              .sort((a, b) => a.x - b.x)
            if (camberPts.length < 2) return null
            return (
              <polyline
                points={camberPts.map(p => `${p.x},${-p.y}`).join(' ')}
                fill="none"
                stroke={color + '66'}
                strokeWidth="0.003"
                strokeDasharray="0.02 0.01"
              />
            )
          })()}

          {/* LE / TE markers */}
          <circle cx="0" cy="0" r="0.010" fill={color} opacity="0.9" />
          <circle cx="1" cy="0" r="0.010" fill="var(--accent2)" opacity="0.7" />

          {/* Max thickness marker */}
          {metrics && (
            <line
              x1={parseFloat(metrics.maxThicknessX) / 100}
              y1={-parseFloat(metrics.thickness) / 200}
              x2={parseFloat(metrics.maxThicknessX) / 100}
              y2={parseFloat(metrics.thickness) / 200}
              stroke={color + '88'}
              strokeWidth="0.003"
              strokeDasharray="0.008 0.005"
            />
          )}
        </svg>
      ) : (
        <div style={{ height: 80, display: 'flex', alignItems: 'center',
          justifyContent: 'center', color: 'var(--accent2)',
          fontFamily: 'var(--mono)', fontSize: '0.75rem' }}>
          Coordinates not available
        </div>
      )}
    </div>
  )
}

// Overlay view — all airfoils on one plot
function OverlayView({ airfoils, coords, loading }) {
  return (
    <div className="card">
      <div className="card-title">Overlay — all selected airfoils</div>
      <svg viewBox="-0.02 -0.28 1.04 0.56"
        style={{ width: '100%', height: 200, display: 'block' }}
        preserveAspectRatio="xMidYMid meet">

        {/* Grid */}
        {[0.25, 0.5, 0.75].map(x => (
          <line key={x} x1={x} y1="-0.25" x2={x} y2="0.25"
            stroke="var(--border)" strokeWidth="0.002" />
        ))}
        <line x1="0" y1="0" x2="1" y2="0"
          stroke="var(--border2)" strokeWidth="0.003" strokeDasharray="0.025 0.015" />
        {/* x/c labels */}
        {[0, 0.25, 0.5, 0.75, 1.0].map(x => (
          <text key={x} x={x} y="0.27" textAnchor="middle"
            style={{ font: '0.018px Space Mono, monospace', fill: 'var(--text2)' }}>
            {x === 0 ? 'LE' : x === 1 ? 'TE' : `${x * 100}%`}
          </text>
        ))}

        {airfoils.map((name, i) => {
          const pts = coords[name]
          if (!pts) return null
          const color = COLORS[i % COLORS.length]
          return (
            <polyline key={name}
              points={pts.map(p => `${p.x},${-p.y}`).join(' ')}
              fill="none"
              stroke={color}
              strokeWidth="0.005"
              strokeLinejoin="round"
              opacity="0.85"
            />
          )
        })}
      </svg>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap',
        marginTop: '0.75rem', fontFamily: 'var(--mono)', fontSize: '0.72rem' }}>
        {airfoils.map((name, i) => (
          <span key={name} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ width: 20, height: 2, background: COLORS[i % COLORS.length],
              display: 'inline-block', borderRadius: 1 }} />
            <span style={{ color: COLORS[i % COLORS.length] }}>{name}</span>
            {loading[name] && <span style={{ color: 'var(--text2)' }}>…</span>}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function ShapeViewer({ selectedAirfoils, onRemoveAirfoil }) {
  const [view, setView] = useState('both') // 'both' | 'overlay' | 'individual'
  const { coords, loading } = useCoordinates(selectedAirfoils)

  if (selectedAirfoils.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '4rem',
        color: 'var(--text2)', fontFamily: 'var(--mono)', fontSize: '0.8rem' }}>
        <div style={{ fontSize: '2rem', marginBottom: '0.75rem', opacity: 0.3 }}>◎</div>
        No airfoils selected — tick airfoils in the Results tab to view their shapes here.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          {[
            { val: 'both',       label: '⊞ Both'       },
            { val: 'overlay',    label: '⊕ Overlay'    },
            { val: 'individual', label: '⊟ Individual' },
          ].map(opt => (
            <button key={opt.val}
              className={`btn ${view === opt.val ? 'btn-primary' : ''}`}
              style={{ fontSize: '0.75rem' }}
              onClick={() => setView(opt.val)}>
              {opt.label}
            </button>
          ))}
        </div>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '0.72rem', color: 'var(--text2)' }}>
          {selectedAirfoils.length} airfoil{selectedAirfoils.length !== 1 ? 's' : ''} selected
        </span>
      </div>

      {/* Selected chips */}
      <div className="flex gap-1" style={{ flexWrap: 'wrap' }}>
        {selectedAirfoils.map((name, i) => (
          <div key={name} style={{
            display: 'flex', alignItems: 'center', gap: '0.4rem',
            background: 'var(--bg3)',
            border: `1px solid ${COLORS[i % COLORS.length]}44`,
            borderRadius: 4, padding: '0.25rem 0.6rem',
            fontFamily: 'var(--mono)', fontSize: '0.72rem',
          }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%',
              background: COLORS[i % COLORS.length], flexShrink: 0 }} />
            <span style={{ color: COLORS[i % COLORS.length] }}>{name}</span>
            <button onClick={() => onRemoveAirfoil(name)}
              style={{ background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text2)', fontSize: '0.85rem', padding: 0, lineHeight: 1 }}>
              ×
            </button>
          </div>
        ))}
      </div>

      {/* Overlay */}
      {(view === 'both' || view === 'overlay') && (
        <OverlayView
          airfoils={selectedAirfoils}
          coords={coords}
          loading={loading}
        />
      )}

      {/* Individual cards */}
      {(view === 'both' || view === 'individual') && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px,1fr))', gap: '1rem' }}>
          {selectedAirfoils.map((name, i) => (
            <AirfoilCard
              key={name}
              name={name}
              pts={coords[name]}
              color={COLORS[i % COLORS.length]}
              loading={loading[name]}
            />
          ))}
        </div>
      )}

    </div>
  )
}
