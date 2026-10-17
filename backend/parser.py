import numpy as np
import re

COLUMNS = ['alpha', 'CL', 'CD', 'CDp', 'Cm', 'XTr_top', 'XTr_bot']

def parse_polar_file(filepath):
    """Parse an XFOIL polar output file. Returns list of dicts."""
    try:
        with open(filepath, 'r', errors='ignore') as f:
            lines = f.readlines()
    except Exception:
        return None

    data = []
    reading = False
    for line in lines:
        if '-------' in line:
            reading = True
            continue
        if not reading:
            continue
        parts = line.split()
        if len(parts) < 7:
            continue
        try:
            row = {
                'alpha':   float(parts[0]),
                'CL':      float(parts[1]),
                'CD':      float(parts[2]),
                'CDp':     float(parts[3]),
                'Cm':      float(parts[4]),
                'XTr_top': float(parts[5]),
                'XTr_bot': float(parts[6]),
            }
            row['LD'] = row['CL'] / row['CD'] if row['CD'] > 0 else 0
            data.append(row)
        except (ValueError, IndexError):
            continue

    return data if len(data) >= 3 else None


def compute_metrics(data, cl_cruise, cl_stall_min):
    """Extract key design metrics from parsed polar data."""
    if not data or len(data) < 3:
        return None

    cls = np.array([d['CL'] for d in data])
    lds = np.array([d['LD'] for d in data])
    cds = np.array([d['CD'] for d in data])
    cms = np.array([d['Cm'] for d in data])

    # Must have data near cruise CL
    if cls.max() < cl_cruise * 0.9:
        return None

    idx_c = int(np.argmin(np.abs(cls - cl_cruise)))
    if abs(cls[idx_c] - cl_cruise) > 0.08:
        return None

    ld_cruise = float(lds[idx_c])
    cd_cruise = float(cds[idx_c])
    cm_cruise = float(cms[idx_c])

    idx_best = int(np.argmax(lds))
    ld_max   = float(lds[idx_best])
    cl_best  = float(cls[idx_best])
    cl_max   = float(cls[-1])

    meets_stall = bool(cl_max >= cl_stall_min)

    if meets_stall:
        idx_s    = int(np.argmin(np.abs(cls - cl_stall_min)))
        ld_stall = float(lds[idx_s])
    else:
        ld_stall = None

    return {
        'ld_cruise':       round(ld_cruise, 3),
        'cd_cruise':       round(cd_cruise, 6),
        'cm_cruise':       round(cm_cruise, 4),
        'ld_max':          round(ld_max, 3),
        'cl_at_ld_max':    round(cl_best, 3),
        'cl_max':          round(cl_max, 3),
        'meets_stall':     1 if meets_stall else 0,
        'ld_stall':        round(ld_stall, 3) if ld_stall is not None else None,
        'cl_cruise_used':  round(float(cls[idx_c]), 3),
        'cl_stall_target': round(cl_stall_min, 3),
    }
