import subprocess
import os
import tempfile
import glob
import numpy as np
from parser import parse_polar_file, compute_metrics
from database import (save_polar, save_metrics, create_run, update_run,
                      airfoil_already_analysed, init_db)

_HERE = os.path.dirname(os.path.abspath(__file__))
XFOIL_EXE = os.environ.get('XFOIL_EXE', 'xfoil')   # path to your own XFOIL binary
AIRFOIL_DIR = os.environ.get('AIRFOIL_DIR', os.path.join(_HERE, '..', 'coord_seligFmt'))   # UIUC airfoil files, Selig format
RESULTS_DIR = os.environ.get('RESULTS_DIR', os.path.join(_HERE, 'results'))

# Global progress tracker
_progress = {'run_id': None, 'completed': 0, 'total': 0,
             'current': '', 'status': 'idle', 'errors': []}


def get_progress():
    return dict(_progress)


def build_xfoil_commands_t2(airfoil_path, airfoil_name, output_path,
                             re_sqrt_cl, ncrit, cl_min, cl_max, cl_step):
    return f"""PLOP
G F

LOAD {airfoil_path}
PANE
OPER
VPAR
N {ncrit:.1f}

TYPE 2
VISC {re_sqrt_cl:.1f}
PACC
{output_path}

CSEQ {cl_min:.2f} {cl_max:.2f} {cl_step:.2f}

PACC

QUIT
"""

def build_xfoil_commands_t1(airfoil_path, airfoil_name, output_path,
                             re_fixed, ncrit, alpha_min, alpha_max, alpha_step):
    return f"""PLOP
G F

LOAD {airfoil_path}
PANE
OPER
VPAR
N {ncrit:.1f}

VISC {re_fixed:.0f}
PACC
{output_path}

ASEQ {alpha_min:.1f} {alpha_max:.1f} {alpha_step:.1f}

PACC

QUIT
"""


def run_xfoil(commands, timeout=25):
    """Execute XFOIL with given stdin commands."""
    try:
        result = subprocess.run(
            [XFOIL_EXE],
            input=commands,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=os.path.dirname(XFOIL_EXE),
            creationflags=subprocess.CREATE_NO_WINDOW
        )
        return True, result.stdout
    except subprocess.TimeoutExpired:
        return False, 'timeout'
    except FileNotFoundError:
        return False, 'xfoil not found'
    except Exception as e:
        return False, str(e)


def compute_re_sqrt_cl(W_N, rho, S, c, mu):
    """Compute the Re*sqrt(CL) parameter for Type 2."""
    return (rho * np.sqrt(W_N / (0.5 * rho * S)) * c / mu)


def run_batch_analysis(params):
    """
    Run Type 2 analysis on all airfoils.
    params: dict with W, WL, AR, ncrit, cl_cruise, cl_stall, cl_min, cl_max, cl_step
    """
    global _progress

    init_db()

    # Unpack params
    W_kg   = params['W_kg']
    WL     = params['WL']
    AR     = params['AR']
    ncrit  = params['ncrit']
    cl_cruise = params['cl_cruise']
    cl_stall  = params['cl_stall']
    cl_min    = params.get('cl_min', 0.10)
    cl_max_sweep = params.get('cl_max_sweep', 1.60)
    cl_step   = params.get('cl_step', 0.02)

    rho = 1.225
    mu  = 1.48e-5
    g   = 9.81
    W_N = W_kg * g
    S   = W_N / WL
    b   = np.sqrt(AR * S)
    c   = b / AR

    re_sqrt_cl = compute_re_sqrt_cl(W_N, rho, S, c, mu)

    # Get all airfoil files
    dat_files = glob.glob(os.path.join(AIRFOIL_DIR, '*.dat'))
    dat_files.sort()
    total = len(dat_files)

    run_id = create_run(params, total)
    _progress.update({'run_id': run_id, 'completed': 0, 'total': total,
                      'status': 'running', 'errors': [], 'current': ''})

    os.makedirs(RESULTS_DIR, exist_ok=True)

    for i, dat_path in enumerate(dat_files):
        airfoil_name = os.path.splitext(os.path.basename(dat_path))[0]
        _progress['current'] = airfoil_name
        _progress['completed'] = i

        # Skip if already done with same params
        if airfoil_already_analysed(airfoil_name,
                                     round(re_sqrt_cl, 1), ncrit):
            update_run(run_id, i + 1)
            continue

        output_path = os.path.join(RESULTS_DIR,
                                    f'{airfoil_name}_T2_N{ncrit}.txt')

        # Remove old output file if exists
        if os.path.exists(output_path):
            os.remove(output_path)

        cmds = build_xfoil_commands_t2(
            dat_path, airfoil_name, output_path,
            re_sqrt_cl, ncrit, cl_min, cl_max_sweep, cl_step
        )

        ok, msg = run_xfoil(cmds)

        if not ok:
            _progress['errors'].append(f'{airfoil_name}: {msg}')
            update_run(run_id, i + 1)
            continue

        # Parse output
        data = parse_polar_file(output_path)
        if data:
            save_polar(airfoil_name, 2, round(re_sqrt_cl, 1),
                       None, ncrit, data)
            metrics = compute_metrics(data, cl_cruise, cl_stall)
            if metrics:
                metrics['airfoil'] = airfoil_name
                save_metrics(metrics)

        update_run(run_id, i + 1)

    _progress['status'] = 'done'
    _progress['completed'] = total
    update_run(run_id, total, status='done')
    return run_id


def run_single_t1(airfoil_name, re_fixed, ncrit,
                  alpha_min=-6, alpha_max=20, alpha_step=0.25):
    """Run Type 1 analysis for a single airfoil at fixed Re."""
    dat_path = os.path.join(AIRFOIL_DIR, airfoil_name + '.dat')
    if not os.path.exists(dat_path):
        return None

    output_path = os.path.join(RESULTS_DIR,
                                f'{airfoil_name}_T1_Re{int(re_fixed)}_N{ncrit}.txt')
    if os.path.exists(output_path):
        os.remove(output_path)

    cmds = build_xfoil_commands_t1(
        dat_path, airfoil_name, output_path,
        re_fixed, ncrit, alpha_min, alpha_max, alpha_step
    )

    ok, msg = run_xfoil(cmds, timeout=30)
    if not ok:
        return None

    data = parse_polar_file(output_path)
    if data:
        save_polar(airfoil_name, 1, None, re_fixed, ncrit, data)
    return data
