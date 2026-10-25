'use client';

import { download } from '../helpers';
import { Badge, Btn, Status } from '../components/forms';
import type { DialogContext } from './context';

/** Run log of the browser-local console (legacy OpenNEXT-admin.js). */
export function buildRunLog(ctx: DialogContext) {
  const { overlay, toast, store, closeBtn } = ctx;

  function runLog(id: string) {
    const x = store.getState().db.runs.find((v) => v.id === id);
    if (!x) return;
    overlay.modal({
      title: 'Execution log',
      subtitle: `${x.name} · ${x.id}`,
      wide: true,
      body: (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 17 }}>
            <Status label={x.status} />
            <Badge label={x.trigger} />
            <Badge label={x.duration} />
            <Badge label={`${x.records} records`} />
          </div>
          <div className="log-box">
            {x.log.map((v, i) => (
              <div key={i}>
                <span className="muted">{String(i + 1).padStart(2, '0')}</span>{' '}
                <span
                  className={
                    v.includes('DONE') || v.includes('completed')
                      ? 'log-ok'
                      : v.includes('POLICY') || v.includes('GATE')
                        ? 'log-blue'
                        : ''
                  }
                >
                  {v}
                </span>
              </div>
            ))}
          </div>
          <p className="tiny muted" style={{ marginTop: 14 }}>
            Completed {x.time}. This record is retained in the local audit trail.
          </p>
        </>
      ),
      footer: (
        <>
          {closeBtn()}
          <Btn
            className="primary"
            onClick={() => {
              download(`${id}.txt`, `${x.name}\n${x.time}\n\n${x.log.join('\n')}`, 'text/plain');
              toast('Export downloaded.');
            }}
          >
            Export log
          </Btn>
        </>
      ),
    });
  }

  return { runLog };
}
