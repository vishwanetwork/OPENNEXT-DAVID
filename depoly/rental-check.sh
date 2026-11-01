#!/usr/bin/env bash
# Read-only cloud readiness inspection; it never creates or restores an instance.
set -euo pipefail
DEPLOY_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
test "$#" -eq 1 || { echo 'Usage: rental-check.sh /absolute/path/to/reviewed-rfq.json' >&2; exit 1; }
exec python3 - "$DEPLOY_DIR" "$1" <<'PY'
import json, sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from config import HERE, load
from operations import Deployment
config=load(HERE/'private')
deployment=Deployment(config, HERE/'private')
deployment.configure()
request=json.loads(Path(sys.argv[2]).read_text())
now=datetime.now(timezone.utc)
for field, hours in [('acquisition_deadline',1),('expires_at',2)]:
    if request['rfq'].get(field)=='AUTO':
        request['rfq'][field]=(now+timedelta(hours=hours)).isoformat()
# Stream the supplied RFQ to the existing Bot container; no customer session or order is created.
source="import json,sys,tempfile,subprocess,os; f=tempfile.NamedTemporaryFile(mode='w',suffix='.json',delete=False); json.dump(json.load(sys.stdin),f); f.close(); result=subprocess.run(['spotbot','rental-check','--rfq',f.name,'--aws']); os.unlink(f.name); raise SystemExit(result.returncode)"
deployment.compose('exec','-T','-e','SPOTBOT_LIVE_ORDERS_ENABLED=true','-e','SPOTBOT_RENTALS_ENABLED=true','bot','python','-c',source,input=json.dumps(request))
PY
