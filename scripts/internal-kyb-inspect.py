import json,os,sqlite3
from pathlib import Path
from spotbot.config import Settings
from spotbot.opennext_ops import KYB,identity
PHASE='initializing'
TARGETS=('harry@vishwalab.com','david.lee@vishwalab.com','evan@vishwanetwork.xyz')
def inspect():
 global PHASE
 PHASE='finding_account_service'
 settings=[]
 for process in Path('/proc').iterdir():
  if not process.name.isdecimal():continue
  try:
   if b'opennext-api' not in (process/'cmdline').read_bytes().split(b'\0'):continue
   env=dict(item.decode().split('=',1) for item in (process/'environ').read_bytes().split(b'\0') if b'=' in item)
   settings.append(Settings(_env_file=None,**{k.lower():v for k,v in env.items() if k.lower() in Settings.model_fields}))
  except (PermissionError,FileNotFoundError,ProcessLookupError):continue
 if not settings:
  import urllib.request
  candidates=[]
  for process in Path('/proc').iterdir():
   if not process.name.isdecimal():continue
   try:
    args=(process/'cmdline').read_bytes().split(b'\0')
    if not any(b'server.js' in arg or b'start.cjs' in arg for arg in args):continue
    itemenv=dict(item.decode().split('=',1) for item in (process/'environ').read_bytes().split(b'\0') if b'=' in item)
    if itemenv.get('API_ORIGIN'):candidates.append(itemenv)
   except (PermissionError,FileNotFoundError,ProcessLookupError):continue
  PHASE='resolving_account_service'
  assert candidates,'API client not found'
  conf=candidates[0];origin=conf['API_ORIGIN'].rstrip('/');token=conf.get('OPENNEXT_ADMIN_TOKEN','')
  headers={'Host':'admin.opennextlab.ai','Origin':'https://admin.opennextlab.ai'}
  if token:headers['Authorization']='Bearer '+token
  PHASE='reading_authorized_kyb_states'
  print('OPENNEXT_KYB_PROGRESS_START'+json.dumps({'phase':PHASE})+'OPENNEXT_KYB_PROGRESS_END',flush=True)
  request=urllib.request.Request(origin+'/api/admin/buyer-kyb',headers=headers)
  with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request,timeout=15) as response:body=json.load(response)
  PHASE='validating_kyb_response'
  cases=body.get('cases');assert isinstance(cases,list),'KYB service response unavailable'
  rows=[]
  for email in TARGETS:
   matched=[c for c in cases if str(c.get('email','')).strip().lower()==email];assert len(matched)<=1
   case=matched[0] if matched else None
   rows.append({'email':email,'registered':True if case else None,'kybStatus':case.get('status') if case else None,'country':(case.get('company') or {}).get('country') if case else None})
  return {'event':'production_kyb_inspection','accounts':rows}
 s=settings[0];root=env.get('SPOTBOT_OPENNEXT_LEGACY_DATA_DIR') or env.get('OPENNEXT_DATA_DIR') or '/app/.opennext-data';users=json.loads((Path(root)/'auth-state.json').read_text())['users']
 result={'event':'production_kyb_inspection','accounts':[]}
 if s.spotbot_storage_backend=='sqlite':
  from urllib.parse import quote
  db=sqlite3.connect('file:'+quote(str(s.spotbot_database_path.resolve()))+'?mode=ro',uri=True)
  def get(case_id):
   row=db.execute('SELECT payload FROM workflow_records WHERE kind=? AND id=?',(KYB,case_id)).fetchone()
   return json.loads(row[0]) if row else None
 elif s.spotbot_storage_backend=='mysql':
  import sqlalchemy as sa
  from sqlalchemy.engine import make_url
  url=make_url(s.spotbot_mysql_url.get_secret_value());engine=sa.create_engine(url,hide_parameters=True)
  def get(case_id):
   with engine.connect() as c:row=c.execute(sa.text('SELECT payload FROM workflow_records WHERE kind=:kind AND id=:id'),{'kind':KYB,'id':case_id}).scalar()
   return json.loads(row) if row else None
 else:raise ValueError('Unsupported discovery storage backend')
 for email in TARGETS:
  matched=[u for u in users if u['email'].strip().lower()==email];assert len(matched)<=1
  user=matched[0] if matched else None;case=get('KYB-'+identity('kyb',user['id'])) if user else None
  result['accounts'].append({'email':email,'registered':bool(user),'role':user['role'] if user else None,'onboardingCompleted':bool(user.get('onboardingCompleted')) if user else None,'kybStatus':case.get('status') if case else None,'country':(case.get('company') or {}).get('country') if case else None})
 return result
try:result=inspect()
except Exception as exc:result={'event':'inspection_failed','errorType':type(exc).__name__,'phase':PHASE}
print('OPENNEXT_KYB_RESULT_START'+json.dumps(result)+'OPENNEXT_KYB_RESULT_END',flush=True)
