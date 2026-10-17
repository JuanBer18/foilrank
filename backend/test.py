import sqlite3

conn = sqlite3.connect(r'C:\foilrank\airfoils.db')
c = conn.cursor()

print('--- Polars table ---')
rows = c.execute('''
    SELECT analysis_type, re_sqrt_cl, re_fixed, ncrit, COUNT(*) as n
    FROM polars
    GROUP BY analysis_type, re_sqrt_cl, re_fixed, ncrit
    ORDER BY analysis_type, n DESC
''').fetchall()
for r in rows:
    print(f'  Type={r[0]}  re_sqrt_cl={r[1]}  re_fixed={r[2]}  ncrit={r[3]}  count={r[4]}')

print()
print('--- Metrics table ---')
row = c.execute('SELECT COUNT(*) FROM metrics').fetchone()
print(f'  Total airfoils with metrics: {row[0]}')
conn.close()