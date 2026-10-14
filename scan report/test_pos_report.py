from app.ocr.pos_report import parse_pos_payment_report as P

def show(name, md):
    r = P(md); print(name, r['strategy'], r['period'], r['payments'], r['total'], r['sum_ok'], r['fixed'])
    return r

# 1. markdown table, '$' read as 'S', thousands separator as '.'
r = show('table', """## Sale Summary
For Period 13/10/2026 00:01 To 13/10/2026 23:59
| Payment | Amount |
|---|---|
| Cash | S458.00 |
| Doordash | $81.84 |
| EFTPOS | $998.60 |
| Panda | $20.04 |
| Payo | $36.10 |
| Uber Eat | $188.04 |
| Total | $1.782.62 |
""")
assert r['total'] == 1782.62 and r['sum_ok'] and len(r['payments']) == 6 and r['date'] == '2026-10-13' and r['period'] == {'from': '2026-10-13T00:01', 'to': '2026-10-13T23:59'}

# 2. one digit wrong in Total (998.51 read 398.51) -> repaired, flagged
r = show('repair-total', """| Cash | $89.70 |
| Doordash | $34.80 |
| EFTPOS | $784.13 |
| Fantuan | $20.28 |
| Panda | $19.32 |
| Uber Eat | $50.28 |
| Total | $398.51 |""")
assert r['total'] == 998.51 and r['fixed']['method'] == 'Total' and r['sum_ok']

# 3. one digit wrong in a line (998.60 read 993.60)
r = show('repair-line', """Cash $458.00
Doordash $81.84
EFTPOS $993.60
Panda $20.04
Payo $36.10
Uber Eat $188.04
Total $1,782.62""")
assert r['fixed']['method'] == 'EFTPOS' and r['payments'][2]['amount'] == 998.60 and r['sum_ok']

# 4. labels and amounts as two separate runs
r = show('columns', """Sale Summary
For Period 13/10/2026 To 13/10/2026
Payment
Cash
EFTPOS
Total
Amount
$72.85
$488.79
$561.64
""")
assert r['strategy'] == 'columns' and any('paired by reading order' in w for w in r['warnings']) and r['payments'] == [{'method': 'Cash', 'amount': 72.85}, {'method': 'EFTPOS', 'amount': 488.79}] and r['sum_ok']

# 5. ambiguous mismatch is NOT guessed
r = show('mismatch', "| Cash | $10.00 |\n| EFTPOS | $20.00 |\n| Total | $31.00 |")
assert r['sum_ok'] is False and r['fixed'] is None and r['warnings']

# 6. nothing readable
r = show('empty', "Hello world")
assert r['payments'] == [] and r['total'] is None
# 7. real Docling output where 'Uber Eat' was read BEFORE 'Payo': the sum still matches, so only the warning flags it
r = show('real-order-swap', "Payment Amount\n\nCash\n\n$474.00\n\nEFTPOS\n\n$792.80\n\nPanda\n\n$105.36\n\nUber Eat\n\nPayo\n\n$87.50\n\n$202.56\n\nTotal\n\n$1,662.22\n")
assert r['sum_ok'] and r['strategy'] == 'columns' and r['warnings']
print('ALL OK')
