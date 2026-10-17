# foilrank

A small tool for choosing a low-Reynolds-number airfoil. It runs XFOIL in batch over a library of airfoils, stores the polars in a database, and lets you compare them in a browser: lift-to-drag at a chosen lift coefficient, polar plots, section shapes, and a filter that flags results that look like XFOIL convergence artefacts.

It is a personal tool, shared as it is.

## What is in it

- `backend/`: a Flask API (`app.py`), XFOIL batch runner (`xfoil_runner.py`), polar parser and metrics (`parser.py`), and a SQLite store (`database.py`).
- `frontend/`: a React and Vite interface (setup panel, results table, polar plot, shape viewer).

## What you need to provide

- **XFOIL** (Mark Drela's program, https://web.mit.edu/drela/Public/web/xfoil/). It is not included. Point `XFOIL_EXE` at your own binary.
- **Airfoil coordinates**: the UIUC airfoil database in Selig format (https://m-selig.ae.illinois.edu/ads/coord_database.html). Put them in `coord_seligFmt/`, or set `AIRFOIL_DIR`.

## Running it

```
pip install flask flask-cors numpy
set XFOIL_EXE=C:\path\to\xfoil.exe
python backend/app.py

cd frontend
npm install
npm run dev
```

Results go to `backend/results/` by default (`RESULTS_DIR` changes it), and the database is created on first run.

## Licence

MIT, covering the code in this repository. XFOIL and the airfoil data have their own licences and terms.
