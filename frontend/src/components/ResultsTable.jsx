import { useState, useMemo, useEffect, useCallback } from 'react'
import axios from 'axios'

const API = 'http://localhost:5000/api'

const COLORS = ['#4fffb0','#ff6b6b','#6b8fff','#ffb86c','#ff79c6','#8be9fd','#50fa7b','#f1fa8c']

// All sortable columns
const COLUMNS = [
  { key: 'airfoil',      label: 'Airfoil',           fmt: v => v,               sortable: true  },
  { key: 'ld_at_cl',     label: 'L/D @ cruise CL',   fmt: v => v?.toFixed(2),   sortable: true,  highlight: true },
  { key: 'cd_at_cl',     label: 'CD @ cruise',        fmt: v => v?.toFixed(5),   sortable: true  },
  { key: 'cm_at_cl',     label: 'Cm',                 fmt: v => v?.toFixed(4),   sortable: true  },
  { key: 'ld_max',       label: 'L/D max',            fmt: v => v?.toFixed(2),   sortable: true  },
  { key: 'cl_at_ld_max', label: 'CL @ L/D max',      fmt: v => v?.toFixed(3),   sortable: true  },
  { key: 'cl_max',       label: 'CL max',             fmt: v => v?.toFixed(3),   sortable: true  },
  { key: 'meets_stall',  label: 'Stall OK',           fmt: v => v,               sortable: true  },
  { key: 'thickness',    label: 't/c %',              fmt: v => v?.toFixed(2),   sortable: true  },
  { key: 'camber',       label: 'Camber %',           fmt: v => v?.toFixed(2),   sortable: true  },
  { key: 'max_t_x',      label: 'Max-t @ %c',         fmt: v => v?.toFixed(1),   sortable: true  },
]

const PAGE_SIZE = 50

export default function ResultsTable({ results, onSelectAirfoil, selectedAirfoils,
                                        onRefresh, wingParams, onParamsChange }) {
  const [sortKey, setSortKey]   = useState('ld_at_cl')
  const [sortDir, setSortDir]   = useState('desc')
  const [filter, setFilter]     = useState('')
  const [page, setPage]         = useState(0)

  // Speed params
  const [vCruise, setVCruise]   = useState(wingParams?.V_cruise ?? 12)
  const [vStall,  setVStall]    = useState(wingParams?.V_stall  ?? 8)

  // Live L/D data (recomputed from polars)
  const [liveData,    setLiveData]    = useState([])
  const [geoData,     setGeoData]     = useState({})
  const [computing,   setComputing]   = useState(false)
  const [lastParams,  setLastParams]  = useState(null)

  // Shape preview
  const [shapeAirfoil, setShapeAirfoil] = useState(null)
  const [shapeCoords,  setShapeCoords]  = useState(null)

  // Filters
  const [filters, setFilters] = useState({
    stallOnly:    false,
    minLD:        '',
    maxCD:        '',
    minCLmax:     '',
    minThickness: '',
    maxThickness: '',
    maxCm:        '',
  })

  // Load geometry metrics once
  useEffect(() => {
    axios.get(`${API}/geometry-metrics`).then(res => {
      const map = {}
      res.data.forEach(r => { map[r.airfoil] = r })
      setGeoData(map)
    }).catch(() => {})
  }, [])

  // Recompute L/D when params change
  const recompute = useCallback(async (vc, vs, wp) => {
    if (!wp) return
    setComputing(true)
    try {
      // Get new CL values from backend
      const paramRes = await axios.post(`${API}/compute-params`, {
        W_kg: wp.W_kg, WL: wp.WL, AR: wp.AR,
        V_cruise: vc, V_stall: vs,
      })
      const newParams = { ...wp, ...paramRes.data, V_cruise: vc, V_stall: vs }
      onParamsChange(newParams)

      // Recompute L/D at new CL for all airfoils
      const ldRes = await axios.post(`${API}/ld-at-cl`, {
        cl_cruise:  newParams.cl_cruise,
        cl_stall:   newParams.cl_stall,
        re_sqrt_cl: newParams.re_sqrt_cl,
        ncrit:      wp.ncrit ?? 7.0,
      })
      setLiveData(ldRes.data)
      setLastParams({ vc, vs, cl_cruise: newParams.cl_cruise, cl_stall: newParams.cl_stall })
    } catch (e) {
      console.error('recompute failed', e)
    }
    setComputing(false)
  }, [onParamsChange])

  // Auto-recompute on load if wingParams available
  useEffect(() => {
    if (wingParams && !lastParams) {
      recompute(wingParams.V_cruise ?? 12, wingParams.V_stall ?? 8, wingParams)
    }
  }, [wingParams])

  // Merge live L/D with geometry data
  const merged = useMemo(() => {
    const base = liveData.length > 0 ? liveData : results.map(r => ({
      airfoil:      r.airfoil,
      ld_at_cl:     r.ld_cruise,
      cd_at_cl:     r.cd_cruise,
      cm_at_cl:     r.cm_cruise,
      ld_max:       r.ld_max,
      cl_at_ld_max: r.cl_at_ld_max,
      cl_max:       r.cl_max,
      meets_stall:  r.meets_stall,
    }))
    return base.map(row => ({
      ...row,
      ...(geoData[row.airfoil] ?? {}),
    }))
  }, [liveData, results, geoData])

  // Apply filters
  const filtered = useMemo(() => {
    let rows = [...merged]

    if (filter) rows = rows.filter(r =>
      r.airfoil.toLowerCase().includes(filter.toLowerCase()))

    if (filters.stallOnly)    rows = rows.filter(r => r.meets_stall)
    if (filters.minLD)        rows = rows.filter(r => (r.ld_at_cl ?? 0) >= parseFloat(filters.minLD))
    if (filters.maxCD)        rows = rows.filter(r => (r.cd_at_cl ?? 1) <= parseFloat(filters.maxCD))
    if (filters.minCLmax)     rows = rows.filter(r => (r.cl_max ?? 0) >= parseFloat(filters.minCLmax))
    if (filters.minThickness) rows = rows.filter(r => (r.thickness ?? 0) >= parseFloat(filters.minThickness))
    if (filters.maxThickness) rows = rows.filter(r => (r.thickness ?? 999) <= parseFloat(filters.maxThickness))
    if (filters.maxCm)        rows = rows.filter(r => Math.abs(r.cm_at_cl ?? 0) <= parseFloat(filters.maxCm))

    rows.sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey]
      if (av === null || av === undefined) av = sortDir === 'desc' ? -Infinity : Infinity
      if (bv === null || bv === undefined) bv = sortDir === 'desc' ? -Infinity : Infinity
      if (typeof av === 'string') return sortDir === 'desc' ? bv.localeCompare(av) : av.localeCompare(bv)
      return sortDir === 'desc' ? bv - av : av - bv
    })

    return rows
  }, [merged, filter, filters, sortKey, sortDir])

  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)

  function handleSort(key) {
    if (!key) return
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
    setPage(0)
  }

  function setF(key, val) {
    setFilters(f => ({ ...f, [key]: val }))
    setPage(0)
  }

  async function toggleShape(airfoil) {
    if (shapeAirfoil === airfoil) { setShapeAirfoil(null); setShapeCoords(null); return }
    setShapeAirfoil(airfoil)
    try {
      const res = await axios.get(`${API}/coordinates/${airfoil}`)
      setShapeCoords(res.data.coordinates)
    } catch { setShapeCoords(null) }
  }

  const activeParams = wingParams
  const clCruise = lastParams?.cl_cruise ?? wingParams?.cl_cruise
  const clStall  = lastParams?.cl_stall  ?? wingParams?.cl_stall

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* ── Speed & CL panel ── */}
      <div className="card">
        <div className="card-title">
          Operating speeds — adjusting these reranks all airfoils by L/D at the new CL
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))',
          gap: '1rem', alignItems: 'end' }}>

          <div className="form-group">
            <label className="form-label">V cruise (m/s)</label>
            <input className="form-input" type="number" step="0.5" value={vCruise}
              onChange={e => setVCruise(parseFloat(e.target.value))} />
          </div>
          <div className="form-group">
            <label className="form-label">V stall (m/s)</label>
            <input className="form-input" type="number" step="0.5" value={vStall}
              onChange={e => setVStall(parseFloat(e.target.value))} />
          </div>
          <div className="form-group">
            <label className="form-label">&nbsp;</label>
            <button className="btn btn-primary"
              onClick={() => recompute(vCruise, vStall, wingParams)}
              disabled={computing || !wingParams}>
              {computing ? '⟳ Computing…' : '▶ Apply & Rerank'}
            </button>
          </div>

          {clCruise && (
            <>
              <div className="stat-tile">
                <div className="stat-label">CL cruise</div>
                <div className="stat-value" style={{ fontSize: '1.1rem' }}>{clCruise?.toFixed(3)}</div>
              </div>
              <div className="stat-tile">
                <div className="stat-label">CL stall needed</div>
                <div className="stat-value" style={{ fontSize: '1.1rem' }}>{clStall?.toFixed(3)}</div>
              </div>
              <div className="stat-tile">
                <div className="stat-label">Speed ratio</div>
                <div className="stat-value" style={{ fontSize: '1.1rem' }}>{(vCruise/vStall).toFixed(2)}×</div>
              </div>
            </>
          )}
        </div>
        {!wingParams && (
          <div style={{ marginTop: '0.75rem', fontFamily: 'var(--mono)', fontSize: '0.75rem',
            color: 'var(--accent2)' }}>
            ⚠ Go to Setup tab → Compute Parameters first
          </div>
        )}
      </div>

      {/* ── Filters ── */}
      <div className="card">
        <div className="card-title">Filters</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px,1fr))',
          gap: '0.75rem', alignItems: 'end' }}>

          <div className="form-group">
            <label className="form-label">Name search</label>
            <input className="form-input" placeholder="e.g. e393, naca…" value={filter}
              onChange={e => { setFilter(e.target.value); setPage(0) }} />
          </div>
          <div className="form-group">
            <label className="form-label">Min L/D @ cruise</label>
            <input className="form-input" type="number" step="1" placeholder="e.g. 30"
              value={filters.minLD} onChange={e => setF('minLD', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Max CD @ cruise</label>
            <input className="form-input" type="number" step="0.001" placeholder="e.g. 0.025"
              value={filters.maxCD} onChange={e => setF('maxCD', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Min CL max</label>
            <input className="form-input" type="number" step="0.05" placeholder="e.g. 1.3"
              value={filters.minCLmax} onChange={e => setF('minCLmax', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Min thickness %</label>
            <input className="form-input" type="number" step="0.5" placeholder="e.g. 8"
              value={filters.minThickness} onChange={e => setF('minThickness', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Max thickness %</label>
            <input className="form-input" type="number" step="0.5" placeholder="e.g. 14"
              value={filters.maxThickness} onChange={e => setF('maxThickness', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Max |Cm|</label>
            <input className="form-input" type="number" step="0.01" placeholder="e.g. 0.15"
              value={filters.maxCm} onChange={e => setF('maxCm', e.target.value)} />
          </div>

          <div className="form-group" style={{ justifyContent: 'flex-end' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem',
              cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '0.75rem',
              color: 'var(--text2)', marginBottom: '0.5rem' }}>
              <input type="checkbox" checked={filters.stallOnly}
                onChange={e => setF('stallOnly', e.target.checked)}
                style={{ accentColor: 'var(--accent)' }} />
              Meets stall CL only
            </label>
            <button className="btn" onClick={() => {
              setFilters({ stallOnly: false, minLD: '', maxCD: '', minCLmax: '',
                minThickness: '', maxThickness: '', maxCm: '' })
              setFilter('')
              setPage(0)
            }}>
              ✕ Clear all
            </button>
          </div>
        </div>

        <div style={{ marginTop: '0.75rem', fontFamily: 'var(--mono)', fontSize: '0.72rem',
          color: 'var(--text2)' }}>
          Showing {filtered.length} of {merged.length} airfoils
          {computing && <span style={{ color: '#6b8fff', marginLeft: '1rem' }}>
            ⟳ recomputing L/D values…
          </span>}
        </div>
      </div>

      {/* ── Shape preview ── */}
      {shapeAirfoil && shapeCoords && (
        <div className="card">
          <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{shapeAirfoil}</span>
            <button className="btn" style={{ padding: '0.1rem 0.5rem', fontSize: '0.7rem' }}
              onClick={() => { setShapeAirfoil(null); setShapeCoords(null) }}>
              × close
            </button>
          </div>
          <svg viewBox="-0.02 -0.22 1.04 0.44" style={{ width: '100%', maxHeight: 130 }}
            preserveAspectRatio="xMidYMid meet">
            <line x1="0" y1="0" x2="1" y2="0"
              stroke="var(--border2)" strokeWidth="0.003" strokeDasharray="0.025 0.015" />
            <polyline points={shapeCoords.map(p => `${p.x},${-p.y}`).join(' ')}
              fill="rgba(79,255,176,0.06)" stroke="var(--accent)" strokeWidth="0.005" />
            <circle cx="0" cy="0" r="0.009" fill="var(--accent)" />
            <circle cx="1" cy="0" r="0.009" fill="var(--accent2)" />
          </svg>
        </div>
      )}

      {/* ── Selected chips ── */}
      {selectedAirfoils.length > 0 && (
        <div className="flex gap-1" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="text-muted text-sm text-mono">Plotting:</span>
          {selectedAirfoils.map((a, i) => (
            <span key={a} style={{
              background: COLORS[i%COLORS.length] + '18',
              border: `1px solid ${COLORS[i%COLORS.length]}44`,
              color: COLORS[i%COLORS.length],
              padding: '0.2rem 0.6rem', borderRadius: 3,
              fontFamily: 'var(--mono)', fontSize: '0.72rem',
            }}>{a}</span>
          ))}
        </div>
      )}

      {/* ── Table ── */}
      {merged.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem',
          color: 'var(--text2)', fontFamily: 'var(--mono)', fontSize: '0.8rem' }}>
          No results — run batch analysis in Setup tab first.
        </div>
      ) : (
        <>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 32 }}></th>
                    <th>#</th>
                    {COLUMNS.map(col => (
                      <th key={col.key}
                        onClick={() => col.sortable && handleSort(col.key)}
                        style={{
                          cursor: col.sortable ? 'pointer' : 'default',
                          color: sortKey === col.key ? 'var(--accent)' : undefined,
                          background: col.highlight ? 'rgba(79,255,176,0.04)' : undefined,
                        }}>
                        {col.label}
                        {sortKey === col.key ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
                      </th>
                    ))}
                    <th>Shape</th>
                    <th>Plot</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((row, i) => {
                    const rank   = page * PAGE_SIZE + i + 1
                    const isSel  = selectedAirfoils.includes(row.airfoil)
                    const isShp  = shapeAirfoil === row.airfoil
                    const selIdx = selectedAirfoils.indexOf(row.airfoil)
                    return (
                      <tr key={row.airfoil} className={isSel ? 'selected' : ''}>
                        <td>
                          <input type="checkbox" checked={isSel}
                            onChange={() => onSelectAirfoil(row.airfoil)}
                            style={{ accentColor: 'var(--accent)', cursor: 'pointer' }} />
                        </td>
                        <td style={{ color: 'var(--text2)', fontSize: '0.7rem' }}>{rank}</td>
                        {COLUMNS.map(col => (
                          <td key={col.key}
                            style={{
                              background: col.highlight ? 'rgba(79,255,176,0.03)' : undefined,
                              color: col.highlight && isSel
                                ? COLORS[selIdx % COLORS.length] : undefined,
                              fontWeight: col.highlight ? 600 : undefined,
                            }}>
                            {col.key === 'meets_stall' ? (
                              <span className={`tag ${row[col.key] ? 'tag-yes' : 'tag-no'}`}>
                                {row[col.key] ? 'YES' : 'NO'}
                              </span>
                            ) : col.key === 'airfoil' ? (
                              <span style={isSel ? { color: COLORS[selIdx % COLORS.length] } : {}}>
                                {row.airfoil}
                              </span>
                            ) : (
                              col.fmt(row[col.key])
                            )}
                          </td>
                        ))}
                        <td>
                          <button className="btn"
                            style={{ padding: '0.2rem 0.55rem', fontSize: '0.68rem',
                              borderColor: isShp ? 'var(--accent)' : undefined,
                              color: isShp ? 'var(--accent)' : undefined }}
                            onClick={() => toggleShape(row.airfoil)}>
                            {isShp ? '◉' : '◎'}
                          </button>
                        </td>
                        <td>
                          <button className="btn"
                            style={{ padding: '0.2rem 0.55rem', fontSize: '0.68rem' }}
                            onClick={() => onSelectAirfoil(row.airfoil)}>
                            {isSel ? '✓' : '+'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex gap-1" style={{ alignItems: 'center', justifyContent: 'center' }}>
            <button className="btn" disabled={page === 0}
              onClick={() => setPage(p => p - 1)}>← Prev</button>
            <span className="text-muted text-mono text-sm">{page+1} / {totalPages}</span>
            <button className="btn" disabled={page >= totalPages - 1}
              onClick={() => setPage(p => p + 1)}>Next →</button>
          </div>
        </>
      )}
    </div>
  )
}
