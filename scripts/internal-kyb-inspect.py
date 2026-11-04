import json,os,sqlite3
from pathlib import Path
from spotbot.config import Settings
from spotbot.opennext_ops import KYB,identity
from spotbot.opennext_console_data import LegacySnapshots
TARGETS=('harry@vishwalab.com','david.lee@vishwalab.com','evan@vishwanetwork.xyz')
def inspect():
 settings=[]
 for process in Path('/proc').iterdir():
  if not process.name.isdecimal():continue
  try:
   if b'opennext-api' not in (process/'cmdline').read_bytes().split(b'\0'):continue
   env=dict(item.decode().split('=',1) for item in (process/'environ').read_bytes().split(b'\0') if b'=' in item)
   settings.append(Settings(_env_file=None,**{k.lower():v for k,v in env.items() if k.lower() in Settings.model_fields}))
  except (PermissionError,FileNotFoundError,ProcessLookupError):continue
 assert len(settings)==1,'Running adapter not found'
 s=settings[0];users=LegacySnapshots(s.spotbot_opennext_legacy_data_dir).users()
 result={'event':'production_kyb_inspection','backend':s.spotbot_storage_backend,'accounts':[]}
 if s.spotbot_storage_backend=='sqlite':
  from urllib.parse import quote
  db=sqlite3.connect('file:'+quote(str(s.spotbot_database_path.resolve()))+'?mode=ro',uri=True)
  result['databasePath']=str(s.spotbot_database_path)
  def get(case_id):
   row=db.execute('SELECT payload FROM workflow_records WHERE kind=? AND id=?',(KYB,case_id)).fetchone()
   return json.loads(row[0]) if row else None
 elif s.spotbot_storage_backend=='mysql':
  import sqlalchemy as sa
  from sqlalchemy.engine import make_url
  url=make_url(s.spotbot_mysql_url.get_secret_value());engine=sa.create_engine(url,hide_parameters=True)
  result.update(databaseHost=url.host,databaseName=url.database)
  def get(case_id):
   with engine.connect() as c:row=c.execute(sa.text('SELECT payload FROM workflow_records WHERE kind=:kind AND id=:id'),{'kind':KYB,'id':case_id}).scalar()
   return json.loads(row) if row else None
 else:raise ValueError('Unsupported discovery storage backend')
 for email in TARGETS:
  matched=[u for u in users if u['email'].strip().lower()==email];assert len(matched)<=1
  user=matched[0] if matched else None;case=get('KYB-'+identity('kyb',user['id'])) if user else None
  result['accounts'].append({'email':email,'registered':bool(user),'role':user['role'] if user else None,'onboardingCompleted':user['status']=='Active' if user else None,'kybStatus':case.get('status') if case else None,'country':(case.get('company') or {}).get('country') if case else None})
 return result
try:result=inspect()
except Exception as exc:result={'event':'inspection_failed','errorType':type(exc).__name__}
print('OPENNEXT_KYB_RESULT_START'+json.dumps(result)+'OPENNEXT_KYB_RESULT_END',flush=True)
