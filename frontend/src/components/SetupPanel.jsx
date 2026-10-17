import { useState } from 'react'
import axios from 'axios'

const API = 'http://localhost:5000/api'

const DEFAULT_PARAMS = {
  W_kg: 1.0,
  WL: 50,
  AR: 8,
  V_cruise: 12,
  V_stall: 8,
  ncrit: 7.0,
  cl_min: 0.10,
  cl_max_sweep: 1.60,
  cl_step: 0.02,
}

export default function SetupPanel({ onAnalysisStart, onParamsComputed, wingParams }) {
  const [params, setParams] = useState(DEFAULT_PARAMS)
  const [computed, setComputed] = useState(null)
  const [loading, setLoading] = useState(false)
  const [analysisRunning, setAnalysisRunning] = useState(false)
  const [message, setMessage] = useState(null)

  function update(key, val) {
    setParams(p => ({ ...p, [key]: parseFloat(val) || val }))
  }

  async function handleCompute() {
    setLoading(true)
    try {
      const res = await axios.post(`${API}/compute-params`, {
        W_kg: params.W_kg,
        WL: params.WL,
        AR: params.AR,
        V_cruise: params.V_cruise,
        V_stall: params.V_stall,
      })
      setComputed(res.data)
      onParamsComputed({ ...params, ...res.data })
      setMessage({ type: 'ok', text: 'Parameters computed. Review below before running analysis.' })
    } catch (e) {
      setMessage({ type: 'err', text: e.message })
    }
    setLoading(false)
  }

  async function handleRunAnalysis() {
    if (!computed) {
      setMessage({ type: 'err', text: 'Compute parameters first.' })
      return
    }
    setAnalysisRunning(true)
    setMessage({ type: 'ok', text: 'Analysis started — this will take 20–40 minutes for all airfoils.' })
    try {
      const payload = {
        ...params,
        cl_cruise: computed.cl_cruise,
        cl_stall:  computed.cl_stall,
        re_sqrt_cl: computed.re_sqrt_cl,
      }
      const res = await axios.post(`${API}/run-analysis`, payload)
      onAnalysisStart({ status: 'running', completed: 0, total: 1665, current: '' })
    } catch (e) {
      setMessage({ type: 'err', text: e.response?.data?.error || e.message })
      setAnalysisRunning(false)
    }
  }

  const fields = [
    { key: 'W_kg',        label: 'Total mass',    unit: 'kg',     step: 0.1 },
    { key: 'WL',          label: 'Wing loading',  unit: 'N/m²',   step: 1 },
    { key: 'AR',          label: 'Aspect ratio',  unit: '',        step: 0.5 },
    { key: 'V_cruise',    label: 'Cruise speed',  unit: 'm/s',    step: 0.5 },
    { key: 'V_stall',     label: 'Stall speed',   unit: 'm/s',    step: 0.5 },
    { key: 'ncrit',       label: 'Ncrit',         unit: '',        step: 1 },
    { key: 'cl_min',      label: 'CL sweep min',  unit: '',        step: 0.05 },
    { key: 'cl_max_sweep',label: 'CL sweep max',  unit: '',        step: 0.05 },
    { key: 'cl_step',     label: 'CL step',       unit: '',        step: 0.01 },
  ]

  return (
    <div style={{ display: 'grid', gap: '1.5rem', maxWidth: 900 }}>

      <div className="card">
        <div className="card-title">Wing & Analysis Parameters</div>
        <div className="form-grid">
          {fields.map(f => (
            <div className="form-group" key={f.key}>
              <label className="form-label">
                {f.label}{f.unit ? ` (${f.unit})` : ''}
              </label>
              <input
                className="form-input"
                type="number"
                step={f.step}
                value={params[f.key]}
                onChange={e => update(f.key, e.target.value)}
              />
            </div>
          ))}
        </div>

        <div className="flex gap-1 mt-3">
          <button className="btn btn-primary" onClick={handleCompute} disabled={loading}>
            {loading ? 'Computing…' : 'Compute Parameters'}
          </button>
        </div>

        {message && (
          <div className="mt-2" style={{
            padding: '0.6rem 0.9rem',
            borderRadius: 4,
            background: message.type === 'ok' ? 'rgba(79,255,176,0.08)' : 'rgba(255,107,107,0.08)',
            border: `1px solid ${message.type === 'ok' ? 'rgba(79,255,176,0.3)' : 'rgba(255,107,107,0.3)'}`,
            color: message.type === 'ok' ? 'var(--accent)' : 'var(--accent2)',
            fontFamily: 'var(--mono)',
            fontSize: '0.78rem',
          }}>
            {message.text}
          </div>
        )}
      </div>

      {computed && (
        <div className="card">
          <div className="card-title">Computed Wing Geometry</div>
          <div className="stat-grid">
            <div className="stat-tile">
              <div className="stat-label">Wing area S</div>
              <div className="stat-value">{computed.S.toFixed(4)}<span className="stat-unit">m²</span></div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Wingspan b</div>
              <div className="stat-value">{computed.b.toFixed(3)}<span className="stat-unit">m</span></div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Chord c</div>
              <div className="stat-value">{(computed.c * 100).toFixed(1)}<span className="stat-unit">cm</span></div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Re·√CL</div>
              <div className="stat-value">{Math.round(computed.re_sqrt_cl).toLocaleString()}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">CL cruise</div>
              <div className="stat-value">{computed.cl_cruise?.toFixed(3)}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">CL stall (max needed)</div>
              <div className="stat-value">{computed.cl_stall?.toFixed(3)}</div>
            </div>
          </div>

          <div style={{ marginTop: '0.5rem', padding: '0.75rem 1rem', background: 'var(--bg3)',
                        borderRadius: 4, fontFamily: 'var(--mono)', fontSize: '0.75rem',
                        color: 'var(--text2)', lineHeight: 1.7 }}>
            Re at cruise = {Math.round(computed.re_sqrt_cl / Math.sqrt(computed.cl_cruise)).toLocaleString()} &nbsp;|&nbsp;
            Re at stall = {Math.round(computed.re_sqrt_cl / Math.sqrt(computed.cl_stall)).toLocaleString()} &nbsp;|&nbsp;
            Speed ratio = {(computed.V_cruise / computed.V_stall).toFixed(2)}×
          </div>

          <div className="flex gap-1 mt-3" style={{ alignItems: 'center' }}>
            <button
              className="btn btn-primary"
              onClick={handleRunAnalysis}
              disabled={analysisRunning}
            >
              {analysisRunning ? '⟳ Running…' : '▶ Run Batch Analysis (1665 airfoils)'}
            </button>
            <span className="text-muted text-sm text-mono">
              ~20–40 min · results cached in SQLite
            </span>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-title">How It Works</div>
        <div style={{ display: 'grid', gap: '0.6rem', fontFamily: 'var(--mono)',
                      fontSize: '0.75rem', color: 'var(--text2)', lineHeight: 1.8 }}>
          <div><span className="text-accent">01</span> &nbsp;Enter your wing parameters and click Compute</div>
          <div><span className="text-accent">02</span> &nbsp;Review the computed geometry and CL operating points</div>
          <div><span className="text-accent">03</span> &nbsp;Click Run Batch Analysis — XFOIL analyses all 1665 airfoils</div>
          <div><span className="text-accent">04</span> &nbsp;Results are cached — you only need to run this once per parameter set</div>
          <div><span className="text-accent">05</span> &nbsp;Switch to Results tab to rank and filter airfoils</div>
          <div><span className="text-accent">06</span> &nbsp;Select airfoils to compare in the Plot tab</div>
        </div>
      </div>

    </div>
  )
}
