from flask import Flask, jsonify, request
from flask_cors import CORS
import threading
import os
import sys
import json

sys.path.insert(0, os.path.dirname(__file__))

from database import (init_db, get_all_metrics, get_polar, get_conn,
                       get_available_airfoils, get_run_status)
from xfoil_runner import (run_batch_analysis, run_single_t1,
                           get_progress, compute_re_sqrt_cl)
import numpy as np

app = Flask(__name__)
CORS(app)

init_db()

_analysis_thread = None

# ─── Sanity limits ────────────────────────────────────────────────────────────
# Physically reasonable upper bounds for low-Re airfoil analysis.
# Anything above these is an XFOIL artefact (degenerate geometry, convergence
# on a non-physical solution, etc.) and should be filtered out.
MAX_LD        = 120.0   # no real airfoil at Re<200k exceeds ~80; 120 is generous
MAX_CD_CRUISE = 0.005   # CD below this at low Re is unphysical (m20 = 0.0042)

def is_suspect(row):
    """Return True if the row looks like an XFOIL artefact."""
    ld = row.get('ld_cruise') or row.get('ld_at_cl', 0)
    cd = row.get('cd_cruise') or row.get('cd_at_cl', 1)
    if ld is not None and ld > MAX_LD:
        return True
    if cd is not None and cd < MAX_CD_CRUISE:
        return True
    return False


# ─── Health ───────────────────────────────────────────────────────────────────

@app.route('/api/health')
def health():
    return jsonify({'status': 'ok'})


# ─── Parameters helper ────────────────────────────────────────────────────────

def compute_wing_params(W_kg, WL, AR):
    g   = 9.81
    rho = 1.225
    mu  = 1.48e-5
    W_N = W_kg * g
    S   = W_N / WL
    b   = (AR * S) ** 0.5
    c   = b / AR
    re_sqrt_cl = compute_re_sqrt_cl(W_N, rho, S, c, mu)
    return {
        'W_N':        round(W_N, 3),
        'S':          round(S, 4),
        'b':          round(b, 4),
        'c':          round(c, 4),
        're_sqrt_cl': round(re_sqrt_cl, 1),
    }


@app.route('/api/compute-params', methods=['POST'])
def compute_params():
    d = request.json
    try:
        result = compute_wing_params(d['W_kg'], d['WL'], d['AR'])
        W_N = result['W_N']
        S   = result['S']
        rho = 1.225
        V_cruise = float(d.get('V_cruise', 12))
        V_stall  = float(d.get('V_stall', 8))
        cl_cruise = W_N / (0.5 * rho * S * V_cruise**2)
        cl_stall  = W_N / (0.5 * rho * S * V_stall**2)
        result['cl_cruise'] = round(cl_cruise, 4)
        result['cl_stall']  = round(cl_stall,  4)
        result['V_cruise']  = V_cruise
        result['V_stall']   = V_stall
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 400


# ─── Batch analysis ───────────────────────────────────────────────────────────

@app.route('/api/run-analysis', methods=['POST'])
def start_analysis():
    global _analysis_thread
    if _analysis_thread and _analysis_thread.is_alive():
        return jsonify({'error': 'Analysis already running'}), 409

    params = request.json
    required = ['W_kg', 'WL', 'AR', 'ncrit', 'cl_cruise', 'cl_stall']
    for key in required:
        if key not in params:
            return jsonify({'error': f'Missing parameter: {key}'}), 400

    wp = compute_wing_params(params['W_kg'], params['WL'], params['AR'])
    params['re_sqrt_cl'] = wp['re_sqrt_cl']

    def run():
        run_batch_analysis(params)

    _analysis_thread = threading.Thread(target=run, daemon=True)
    _analysis_thread.start()
    return jsonify({'message': 'Analysis started', 'params': params})


@app.route('/api/progress')
def progress():
    return jsonify(get_progress())


@app.route('/api/run-status/<int:run_id>')
def run_status(run_id):
    s = get_run_status(run_id)
    if s:
        return jsonify(s)
    return jsonify({'error': 'Not found'}), 404


# ─── Results ──────────────────────────────────────────────────────────────────

@app.route('/api/results')
def results():
    data = get_all_metrics()
    for row in data:
        row['suspect'] = is_suspect(row)
    return jsonify(data)


@app.route('/api/airfoils')
def airfoils():
    return jsonify(get_available_airfoils())


# ─── Polar data ───────────────────────────────────────────────────────────────

@app.route('/api/polar', methods=['GET'])
def polar():
    airfoil    = request.args.get('airfoil')
    atype      = int(request.args.get('type', 2))
    ncrit      = float(request.args.get('ncrit', 7.0))
    re_sqrt_cl = request.args.get('re_sqrt_cl', None)
    re_fixed   = request.args.get('re_fixed', None)

    if not airfoil:
        return jsonify({'error': 'airfoil required'}), 400

    data = None

    if atype == 2:
        if re_sqrt_cl:
            data = get_polar(airfoil, 2,
                             re_sqrt_cl=float(re_sqrt_cl),
                             ncrit=ncrit)
        if data is None:
            conn = get_conn()
            row = conn.execute('''
                SELECT data FROM polars
                WHERE airfoil=? AND analysis_type=2 AND ncrit=?
                ORDER BY id DESC LIMIT 1
            ''', (airfoil, ncrit)).fetchone()
            conn.close()
            if row:
                data = json.loads(row['data'])

    elif atype == 1:
        if re_fixed:
            data = get_polar(airfoil, 1,
                             re_fixed=float(re_fixed),
                             ncrit=ncrit)
        if data is None:
            conn = get_conn()
            row = conn.execute('''
                SELECT data FROM polars
                WHERE airfoil=? AND analysis_type=1 AND ncrit=?
                ORDER BY id DESC LIMIT 1
            ''', (airfoil, ncrit)).fetchone()
            conn.close()
            if row:
                data = json.loads(row['data'])
        if data is None and re_fixed:
            data = run_single_t1(airfoil, float(re_fixed), ncrit)

    if data is None:
        return jsonify({'error': 'No polar data found'}), 404

    return jsonify({'airfoil': airfoil, 'type': atype, 'data': data})


@app.route('/api/polar/run-t1', methods=['POST'])
def run_t1():
    d = request.json
    airfoil  = d.get('airfoil')
    re_fixed = float(d.get('re_fixed', 100000))
    ncrit    = float(d.get('ncrit', 7.0))

    if not airfoil:
        return jsonify({'error': 'airfoil required'}), 400

    data = run_single_t1(airfoil, re_fixed, ncrit)
    if data is None:
        return jsonify({'error': 'XFOIL failed or no data'}), 500

    return jsonify({'airfoil': airfoil, 'type': 1, 're_fixed': re_fixed,
                    'data': data})


# ─── Airfoil coordinates ──────────────────────────────────────────────────────

@app.route('/api/coordinates/<airfoil>')
def coordinates(airfoil):
    dat_path = os.path.join(os.path.dirname(__file__), '..', 'coord_seligFmt',
                             airfoil + '.dat')
    if not os.path.exists(dat_path):
        return jsonify({'error': 'Not found'}), 404

    coords = []
    with open(dat_path, errors='ignore') as f:
        lines = f.readlines()
    for line in lines[1:]:
        parts = line.split()
        if len(parts) == 2:
            try:
                coords.append({'x': float(parts[0]), 'y': float(parts[1])})
            except ValueError:
                continue

    return jsonify({'airfoil': airfoil, 'coordinates': coords})


# ─── Geometry metrics ─────────────────────────────────────────────────────────

@app.route('/api/geometry-metrics')
def geometry_metrics():
    import glob
    airfoil_dir = os.path.join(os.path.dirname(__file__), '..', 'coord_seligFmt')
    dat_files = glob.glob(os.path.join(airfoil_dir, '*.dat'))
    results = []
    for path in dat_files:
        name = os.path.splitext(os.path.basename(path))[0]
        coords = []
        try:
            with open(path, errors='ignore') as f:
                lines = f.readlines()
            for line in lines[1:]:
                parts = line.split()
                if len(parts) == 2:
                    try:
                        coords.append((float(parts[0]), float(parts[1])))
                    except ValueError:
                        continue
        except Exception:
            continue
        if len(coords) < 10:
            continue
        ys = [p[1] for p in coords]
        xs = [p[0] for p in coords]
        max_y = max(ys)
        min_y = min(ys)
        thickness = max_y - min_y
        camber    = (max_y + min_y) / 2
        max_t_x   = xs[ys.index(max_y)]
        results.append({
            'airfoil':   name,
            'thickness': round(thickness * 100, 3),
            'camber':    round(camber * 100, 3),
            'max_t_x':   round(max_t_x * 100, 1),
            'n_points':  len(coords),
        })
    return jsonify(results)


# ─── L/D recompute at arbitrary CL ───────────────────────────────────────────

@app.route('/api/ld-at-cl', methods=['POST'])
def ld_at_cl():
    """
    Given a target CL (from new V_cruise), recompute L/D for every airfoil
    from its stored Type 2 polar. Falls back to nearest available re_sqrt_cl
    if no exact match. Filters out unphysical XFOIL artefacts.
    """
    d          = request.json
    target_cl  = float(d.get('cl_cruise', 0.663))
    cl_stall   = float(d.get('cl_stall',  1.34))
    re_sqrt_cl = float(d.get('re_sqrt_cl', 92423))
    ncrit      = float(d.get('ncrit', 7.0))
    tol        = float(d.get('tol', 0.08))

    conn = get_conn()
    c    = conn.cursor()

    rows = c.execute('''
        SELECT airfoil, data FROM polars
        WHERE analysis_type=2 AND re_sqrt_cl=? AND ncrit=?
    ''', (round(re_sqrt_cl, 1), ncrit)).fetchall()

    if not rows:
        # Fall back to any Type 2 at this ncrit (one per airfoil, most recent)
        rows = c.execute('''
            SELECT airfoil, data FROM polars
            WHERE analysis_type=2 AND ncrit=?
            GROUP BY airfoil
        ''', (ncrit,)).fetchall()

    conn.close()

    results = []
    for row in rows:
        try:
            data = json.loads(row['data'])
        except Exception:
            continue

        cls = [pt['CL'] for pt in data]
        cds = [pt['CD'] for pt in data]
        cms = [pt.get('Cm', 0) for pt in data]

        if not cls or max(cls) < target_cl * 0.9:
            continue

        diffs = [abs(cl - target_cl) for cl in cls]
        idx   = diffs.index(min(diffs))
        if diffs[idx] > tol:
            continue

        cl_actual = cls[idx]
        cd_val    = cds[idx]
        cm_val    = cms[idx]

        # Filter unphysical results
        if cd_val <= 0 or cd_val < MAX_CD_CRUISE:
            continue
        ld_val = cl_actual / cd_val
        if ld_val > MAX_LD:
            continue

        cl_max = max(cls)
        lds    = [cl / cd if cd > 0 else 0 for cl, cd in zip(cls, cds)]
        ld_max = max(lds)
        if ld_max > MAX_LD:
            ld_max = None  # suspect peak but cruise point was OK

        results.append({
            'airfoil':      row['airfoil'],
            'ld_at_cl':     round(ld_val, 3),
            'cd_at_cl':     round(cd_val, 6),
            'cm_at_cl':     round(cm_val, 4),
            'cl_actual':    round(cl_actual, 3),
            'cl_max':       round(cl_max, 3),
            'meets_stall':  1 if cl_max >= cl_stall else 0,
            'ld_max':       round(ld_max, 3) if ld_max else None,
            'cl_at_ld_max': round(cls[lds.index(max(lds))], 3),
        })

    results.sort(key=lambda x: x['ld_at_cl'], reverse=True)
    return jsonify(results)


# ─── Suspect airfoil diagnostic ───────────────────────────────────────────────

@app.route('/api/suspect-airfoils')
def suspect_airfoils():
    """Return airfoils with unphysically high L/D or low CD — useful for QA."""
    data = get_all_metrics()
    return jsonify([
        {
            'airfoil':   r['airfoil'],
            'ld_cruise': r.get('ld_cruise'),
            'cd_cruise': r.get('cd_cruise'),
            'reason':    'ld_too_high' if (r.get('ld_cruise') or 0) > MAX_LD
                         else 'cd_too_low',
        }
        for r in data if is_suspect(r)
    ])


# ─── Entry point ──────────────────────────────────────────────────────────────

if __name__ == '__main__':
    print('Starting FOILRANK API on http://localhost:5000')
    app.run(debug=True, port=5000, threaded=True)