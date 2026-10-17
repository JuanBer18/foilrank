import sqlite3
import json
import os

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'airfoils.db')

def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_conn()
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS polars (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            airfoil TEXT NOT NULL,
            analysis_type INTEGER NOT NULL,
            re_sqrt_cl REAL,
            re_fixed REAL,
            ncrit REAL,
            data TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(airfoil, analysis_type, re_sqrt_cl, re_fixed, ncrit)
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS metrics (
            airfoil TEXT PRIMARY KEY,
            ld_cruise REAL,
            cd_cruise REAL,
            cm_cruise REAL,
            ld_max REAL,
            cl_at_ld_max REAL,
            cl_max REAL,
            meets_stall INTEGER,
            ld_stall REAL,
            cl_cruise_used REAL,
            cl_stall_target REAL
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS analysis_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            params TEXT NOT NULL,
            started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            finished_at TIMESTAMP,
            total INTEGER,
            completed INTEGER,
            status TEXT DEFAULT 'running'
        )
    ''')
    conn.commit()
    conn.close()

def save_polar(airfoil, analysis_type, re_sqrt_cl, re_fixed, ncrit, data_array):
    conn = get_conn()
    c = conn.cursor()
    try:
        c.execute('''
            INSERT OR REPLACE INTO polars
            (airfoil, analysis_type, re_sqrt_cl, re_fixed, ncrit, data)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (airfoil, analysis_type, re_sqrt_cl, re_fixed, ncrit, json.dumps(data_array)))
        conn.commit()
    finally:
        conn.close()

def save_metrics(metrics_dict):
    conn = get_conn()
    c = conn.cursor()
    try:
        c.execute('''
            INSERT OR REPLACE INTO metrics
            (airfoil, ld_cruise, cd_cruise, cm_cruise, ld_max, cl_at_ld_max,
             cl_max, meets_stall, ld_stall, cl_cruise_used, cl_stall_target)
            VALUES (:airfoil, :ld_cruise, :cd_cruise, :cm_cruise, :ld_max,
                    :cl_at_ld_max, :cl_max, :meets_stall, :ld_stall,
                    :cl_cruise_used, :cl_stall_target)
        ''', metrics_dict)
        conn.commit()
    finally:
        conn.close()

def get_all_metrics():
    conn = get_conn()
    c = conn.cursor()
    rows = c.execute('SELECT * FROM metrics ORDER BY ld_cruise DESC').fetchall()
    conn.close()
    return [dict(r) for r in rows]

def get_polar(airfoil, analysis_type, re_sqrt_cl=None, re_fixed=None, ncrit=7.0):
    conn = get_conn()
    c = conn.cursor()
    if analysis_type == 2:
        row = c.execute('''
            SELECT data FROM polars
            WHERE airfoil=? AND analysis_type=? AND re_sqrt_cl=? AND ncrit=?
        ''', (airfoil, analysis_type, re_sqrt_cl, ncrit)).fetchone()
    else:
        row = c.execute('''
            SELECT data FROM polars
            WHERE airfoil=? AND analysis_type=? AND re_fixed=? AND ncrit=?
        ''', (airfoil, analysis_type, re_fixed, ncrit)).fetchone()
    conn.close()
    if row:
        return json.loads(row['data'])
    return None

def get_available_airfoils():
    conn = get_conn()
    c = conn.cursor()
    rows = c.execute('SELECT DISTINCT airfoil FROM polars ORDER BY airfoil').fetchall()
    conn.close()
    return [r['airfoil'] for r in rows]

def create_run(params, total):
    conn = get_conn()
    c = conn.cursor()
    c.execute('INSERT INTO analysis_runs (params, total, completed) VALUES (?, ?, 0)',
              (json.dumps(params), total))
    run_id = c.lastrowid
    conn.commit()
    conn.close()
    return run_id

def update_run(run_id, completed, status='running'):
    conn = get_conn()
    c = conn.cursor()
    if status == 'done':
        c.execute('''UPDATE analysis_runs SET completed=?, status=?, finished_at=CURRENT_TIMESTAMP
                     WHERE id=?''', (completed, status, run_id))
    else:
        c.execute('UPDATE analysis_runs SET completed=?, status=? WHERE id=?',
                  (completed, status, run_id))
    conn.commit()
    conn.close()

def get_run_status(run_id):
    conn = get_conn()
    c = conn.cursor()
    row = c.execute('SELECT * FROM analysis_runs WHERE id=?', (run_id,)).fetchone()
    conn.close()
    return dict(row) if row else None

def airfoil_already_analysed(airfoil, re_sqrt_cl, ncrit):
    conn = get_conn()
    c = conn.cursor()
    row = c.execute('''SELECT id FROM polars WHERE airfoil=? AND analysis_type=2
                       AND re_sqrt_cl=? AND ncrit=?''',
                    (airfoil, re_sqrt_cl, ncrit)).fetchone()
    conn.close()
    return row is not None
