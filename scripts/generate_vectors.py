"""
Regenerate the cross-language pricing vectors.

`contracts/GenBonds.py` is the source of truth. The TypeScript mirror in
`src/core/pricing.ts` is only allowed to exist because both are pinned to the
output of this script, and CI runs both suites against it. If you change the
actuarial model, run this, and expect both test suites to fail until the mirror
is updated to match.

    python3 scripts/generate_vectors.py
"""

import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'tests'/'stubs'))
sys.path.insert(0, str(ROOT/'contracts'))
import GenBonds as G

random.seed(7)
vectors = []
cases = [
    (0, 0, 24, 0, 10**20, 100),
    (0, 100_000, 4, 5*10**18, 10**20, 100),
    (3_000, 47_000, 72, 2*10**19, 10**20, 200),
    (12_000, 8_000, 168, 6*10**19, 10**20, 300),
    (0, 0, 1, 0, 0, 400),
]
for _ in range(45):
    cases.append((
        random.randrange(0, 40_000),
        random.randrange(0, 400_000),
        random.randrange(1, 500),
        random.randrange(0, 10**20),
        random.choice([0, 10**18, 10**20, 5*10**20]),
        random.randrange(80, 450),
    ))

for wf, wh, hours, exp, cap, raw in cases:
    rate = G.loss_rate_bps(wf, wh)
    vectors.append({
        "weighted_failures": wf,
        "weighted_honored": wh,
        "duration_hours": hours,
        "exposure_after": exp,
        "pool_capital": cap,
        "risk_mult_raw": raw,
        "loss_rate_bps": rate,
        "collateral_bps": G.collateral_bps(rate),
        "duration_load_bps": G.duration_load_bps(hours),
        "concentration_load_bps": G.concentration_load_bps(exp, cap),
        "risk_mult": G.quantise_risk(raw),
        "premium_bps": G.premium_bps(rate, G.duration_load_bps(hours), G.concentration_load_bps(exp, cap), G.quantise_risk(raw)),
    })
(ROOT/'tests'/'vectors.json').write_text(json.dumps(vectors, indent=2) + "\n")
print(len(vectors), "vectors")
print(f"wrote {ROOT / 'tests' / 'vectors.json'}")
