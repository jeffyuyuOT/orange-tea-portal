from app.ocr.pos_report import parse_pos_payment_report as P

def item(text, y, l, r, h=12, origin='BOTTOMLEFT'):
    return {"text": text, "l": l, "r": r, "t": y + h / 2, "b": y - h / 2, "origin": origin}

# the real 14/10 report: Docling returned 'Uber Eat' BEFORE 'Payo' and both amounts after.
# BOTTOMLEFT origin: bigger y = higher on the picture.
rows = [("Cash", "$474.00", 300), ("EFTPOS", "$792.80", 284), ("Panda", "$105.36", 268),
        ("Payo", "$87.50", 252), ("Uber Eat", "$202.56", 236), ("Total", "$1,662.22", 200)]
items = [item("Payment", 330, 30, 80), item("Amount", 330, 400, 440)]
labels = [item(n, y, 30, 90) for n, _, y in rows]
amts = [item(a, y, 380, 440) for _, a, y in rows]
# scramble reading order: Uber Eat before Payo, amounts in their own run
scrambled = [labels[0], labels[1], labels[2], labels[4], labels[3], labels[5]] + amts
r = P("For Period 14/10/2026 00:01 To 14/10/2026 23:59", None, items + scrambled)
print(r['strategy'], r['payments'], r['total'], r['sum_ok'], r['warnings'])
assert r['strategy'] == 'position'
assert r['payments'] == [{'method': 'Cash', 'amount': 474.0}, {'method': 'EFTPOS', 'amount': 792.8}, {'method': 'Panda', 'amount': 105.36},
                         {'method': 'Payo', 'amount': 87.5}, {'method': 'Uber Eat', 'amount': 202.56}]
assert r['total'] == 1662.22 and r['sum_ok'] and r['warnings'] == [] and r['period']['from'] == '2026-10-14T00:01'

# TOPLEFT origin (y grows downward) gives the same answer
items_tl = [item(i["text"], 400 - (i["t"] + i["b"]) / 2, i["l"], i["r"], origin='TOPLEFT') for i in items + scrambled]
r2 = P("", None, items_tl)
assert r2['payments'] == r['payments'] and r2['strategy'] == 'position'

# name and amount in one text item
one = [item("Cash $65.40", 300, 30, 440), item("Payo $27.00", 284, 30, 440), item("Total $92.40", 250, 30, 440)]
r3 = P("", None, one)
assert r3['strategy'] == 'position' and r3['payments'][1] == {'method': 'Payo', 'amount': 27.0} and r3['sum_ok']

# no items -> falls back to the text strategies
r4 = P("| Cash | $10.00 |\n| Total | $10.00 |", None, None)
assert r4['strategy'] == 'rows' and r4['sum_ok']
print('POSITION OK')
