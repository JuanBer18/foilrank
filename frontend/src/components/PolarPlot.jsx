import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine
} from 'recharts'

const API = 'http://localhost:5000/api'

const COLORS = [
  '#4fffb0', '#ff6b6b', '#6b8fff', '#ffb86c',
  '#ff79c6', '#8be9fd', '#50fa7b', '#f1fa8c'
]

const X_OPTIONS = [
  { value: 'CL',    label: 'CL' },
  { value: 'alpha', label: 'Alpha (°)' },
  { value: 'CD',    label: 'CD' },
]

const Y_OPTIONS = [
  { value: 'LD',    label: 'CL/CD  (L/D)' },
  { value: 'CL',    label: 'CL' },
  { value: 'CD',    label: 'CD' },
  { value: 'Cm',    label: 'Cm' },
  { value: 'XTr_top', label: 'XTr top' },
  { value: 'XTr_bot', label: 'XTr bot' },
]

function useDebounce(value, delay) {
  const [dv, setDv] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDv(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return dv
}

export default function PolarPlot({ selectedAirfoils, onRemoveAirfoil, wingParams }) {
  const [xAxis, setXAxis]       = useState('CL')
  const [yAxis, setYAxis]       = useState('LD')
  const [analysisType, setAt]   = useState(2)
  const [reFixed, setReFixed]   = useState(100000)
  const [ncrit, setNcrit]       = useState(7.0)
  const [polars, setPolars]     = useState({})
  const [loading, setLoading]   = useState({})
  const [showShape, setShowShape] = useState(false)
  const [shapeData, setShapeData] = useState(null)
  const [shapeAirfoil, setShapeAirfoil] = useState(null)

  const reSqrtCl = wingParams?.re_sqrt_cl
  const clCruise = wingParams?.cl_cruise
  const clStall  = wingParams?.cl_stall

  // Load polar whenever selection or settings change
  const fetchPolar = useCallback(async (airfoil) => {
    const key = `${airfoil}_t${analysisType}_n${ncrit}_${analysisType === 1 ? reFixed : reSqrtCl}`
    if (polars[key] || loading[key]) return

    setLoading(prev => ({ ...prev, [key]: true }))
    try {
      let url
      if (analysisType === 2) {
        url = `${API}/polar?airfoil=${airfoil}&type=2&re_sqrt_cl=${reSqrtCl}&ncrit=${ncrit}`
      } else {
        url = `${API}/polar?airfoil=${airfoil}&type=1&re_fixed=${reFixed}&ncrit=${ncrit}`
      }
      const res = await axios.get(url)
      setPolars(prev => ({ ...prev, [key]: res.data.data }))
    } catch {
      // Not in DB — run T1 on demand
      if (analysisType === 1) {
        try {
          const res = await axios.post(`${API}/polar/run-t1`, {
            airfoil, re_fixed: reFixed, ncrit
          })
          setPolars(prev => ({ ...prev, [key]: res.data.data }))
        } catch {}
      }
    }
    setLoading(prev => ({ ...prev, [key]: false }))
  }, [analysisType, ncrit, reFixed, reSqrtCl, polars, loading])

  useEffect(() => {
    selectedAirfoils.forEach(a => fetchPolar(a))
  }, [selectedAirfoils, analysisType, ncrit, reFixed])

  async function loadShape(airfoil) {
    if (shapeAirfoil === airfoil) { setShowShape(false); setShapeAirfoil(null); return }
    try {
      const res = await axios.get(`${API}/coordinates/${airfoil}`)
      setShapeData(res.data.coordinates)
      setShapeAirfoil(airfoil)
      setShowShape(true)
    } catch {}
  }

  // Build chart data — merge all airfoils on same x-axis
  function buildChartData() {
    if (selectedAirfoils.length === 0) return []
    const allPoints = {}

    selectedAirfoils.forEach(airfoil => {
      const key = `${airfoil}_t${analysisType}_n${ncrit}_${analysisType === 1 ? reFixed : reSqrtCl}`
      const data = polars[key]
      if (!data) return

      data.forEach(pt => {
        const xVal = pt[xAxis]
        if (xVal === undefined || xVal === null) return
        const xKey = xVal.toFixed(4)
        if (!allPoints[xKey]) allPoints[xKey] = { [xAxis]: xVal }
        allPoints[xKey][airfoil] = pt[yAxis]
      })
    })

    return Object.values(allPoints).sort((a, b) => a[xAxis] - b[xAxis])
  }

  const chartData = buildChartData()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* Controls */}
      <div className="card">
        <div className="card-title">Plot Controls</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px,1fr))', gap: '1rem' }}>

          <div className="form-group">
            <label className="form-label">X axis</label>
            <select className="form-input" value={xAxis} onChange={e => setXAxis(e.target.value)}>
              {X_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Y axis</label>
            <select className="form-input" value={yAxis} onChange={e => setYAxis(e.target.value)}>
              {Y_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Analysis type</label>
            <select className="form-input" value={analysisType} onChange={e => setAt(Number(e.target.value))}>
              <option value={2}>Type 2 — real aircraft (Re·√CL)</option>
              <option value={1}>Type 1 — fixed Re</option>
            </select>
          </div>

          {analysisType === 1 && (
            <div className="form-group">
              <label className="form-label">Re (fixed)</label>
              <input className="form-input" type="number" step={10000}
                value={reFixed} onChange={e => setReFixed(Number(e.target.value))} />
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Ncrit</label>
            <select className="form-input" value={ncrit} onChange={e => setNcrit(Number(e.target.value))}>
              <option value={5}>5 — turbulent/gusty</option>
              <option value={7}>7 — typical outdoor</option>
              <option value={9}>9 — calm / clean</option>
            </select>
          </div>

        </div>
      </div>

      {/* Selected airfoils chips */}
      {selectedAirfoils.length > 0 && (
        <div className="flex gap-1" style={{ flexWrap: 'wrap' }}>
          {selectedAirfoils.map((a, i) => (
            <div key={a} style={{
              display: 'flex', alignItems: 'center', gap: '0.4rem',
              background: 'var(--bg3)', border: `1px solid ${COLORS[i % COLORS.length]}44`,
              borderRadius: 4, padding: '0.25rem 0.6rem',
              fontFamily: 'var(--mono)', fontSize: '0.72rem',
            }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%',
                background: COLORS[i % COLORS.length], flexShrink: 0 }} />
              <span style={{ color: COLORS[i % COLORS.length] }}>{a}</span>
              <button onClick={() => loadShape(a)} title="Show shape"
                style={{ background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text2)', fontSize: '0.7rem', padding: 0 }}>◉</button>
              <button onClick={() => onRemoveAirfoil(a)}
                style={{ background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text2)', fontSize: '0.8rem', padding: 0 }}>×</button>
              {loading[`${a}_t${analysisType}_n${ncrit}_${analysisType === 1 ? reFixed : reSqrtCl}`] && (
                <span style={{ color: 'var(--text2)', fontSize: '0.65rem' }}>loading…</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Airfoil shape preview */}
      {showShape && shapeData && (
        <div className="card" style={{ padding: '1rem' }}>
          <div className="card-title">{shapeAirfoil} — airfoil shape</div>
          <svg viewBox="-0.05 -0.2 1.1 0.4" style={{ width: '100%', maxHeight: 120 }}>
            <polyline
              points={shapeData.map(p => `${p.x},${-p.y}`).join(' ')}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="0.005"
            />
          </svg>
        </div>
      )}

      {/* Main chart */}
      <div className="card" style={{ padding: '1.5rem 1rem' }}>
        {selectedAirfoils.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem',
            color: 'var(--text2)', fontFamily: 'var(--mono)', fontSize: '0.8rem' }}>
            Select airfoils from the Results tab to plot them here.
          </div>
        ) : chartData.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem',
            color: 'var(--text2)', fontFamily: 'var(--mono)', fontSize: '0.8rem' }}>
            Loading polar data…
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={420}>
            <LineChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
              <XAxis
                dataKey={xAxis}
                tickFormatter={v => Number(v).toFixed(2)}
                tick={{ fontFamily: 'Space Mono', fontSize: 11, fill: '#8888a8' }}
                label={{ value: X_OPTIONS.find(o => o.value === xAxis)?.label,
                  position: 'insideBottom', offset: -5,
                  style: { fontFamily: 'Space Mono', fontSize: 11, fill: '#8888a8' } }}
              />
              <YAxis
                tickFormatter={v => Number(v).toFixed(2)}
                tick={{ fontFamily: 'Space Mono', fontSize: 11, fill: '#8888a8' }}
                label={{ value: Y_OPTIONS.find(o => o.value === yAxis)?.label,
                  angle: -90, position: 'insideLeft',
                  style: { fontFamily: 'Space Mono', fontSize: 11, fill: '#8888a8' } }}
              />
              <Tooltip
                contentStyle={{ background: '#111118', border: '1px solid #2a2a3a',
                  fontFamily: 'Space Mono', fontSize: 11 }}
                labelFormatter={v => `${X_OPTIONS.find(o => o.value === xAxis)?.label}: ${Number(v).toFixed(3)}`}
                formatter={(v, name) => [Number(v).toFixed(3), name]}
              />
              <Legend
                wrapperStyle={{ fontFamily: 'Space Mono', fontSize: 11 }}
              />

              {/* Reference lines at cruise and stall CL */}
              {xAxis === 'CL' && clCruise && (
                <ReferenceLine x={clCruise} stroke="#4fffb044" strokeDasharray="4 4"
                  label={{ value: 'cruise', position: 'top',
                    style: { fontFamily: 'Space Mono', fontSize: 10, fill: '#4fffb0' } }} />
              )}
              {xAxis === 'CL' && clStall && (
                <ReferenceLine x={clStall} stroke="#ff6b6b44" strokeDasharray="4 4"
                  label={{ value: 'stall', position: 'top',
                    style: { fontFamily: 'Space Mono', fontSize: 10, fill: '#ff6b6b' } }} />
              )}

              {selectedAirfoils.map((a, i) => (
                <Line
                  key={a}
                  type="monotone"
                  dataKey={a}
                  stroke={COLORS[i % COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  connectNulls={true}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Reading helper */}
      {wingParams && xAxis === 'CL' && (
        <div className="card" style={{ padding: '0.75rem 1rem' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '0.72rem',
            color: 'var(--text2)', lineHeight: 1.8 }}>
            <span style={{ color: '#4fffb044', borderBottom: '1px dashed #4fffb0', paddingBottom: 1 }}>
              Green dashed
            </span> = cruise CL ({clCruise?.toFixed(3)}) &nbsp;|&nbsp;
            <span style={{ color: '#ff6b6b44', borderBottom: '1px dashed #ff6b6b', paddingBottom: 1 }}>
              Red dashed
            </span> = stall CL ({clStall?.toFixed(3)}) &nbsp;|&nbsp;
            Re·√CL = {Math.round(reSqrtCl)?.toLocaleString()}
          </div>
        </div>
      )}

    </div>
  )
}
