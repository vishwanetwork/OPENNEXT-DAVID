'use client';

import { type FormEvent } from 'react';
import { stamp } from '../helpers';
import { MODEL_SPECS, REGIONS } from '../reference-data';
import { Callout, DetailGrid, Field, SelectField, Status, formValues } from '../components/forms';
import type { DialogContext } from './context';

/** Instance dialogs of the browser-local console (legacy OpenNEXT-admin.js). */
export function buildInstanceDialogs(ctx: DialogContext) {
  const { overlay, toast, nav, store, closeBtn } = ctx;

  function instanceDetail(id: string) {
    const x = store.getState().db.instances.find((v) => v.id === id);
    if (!x) return;
    const submit = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const { get, has } = formValues(event.currentTarget);
      const config = store.getState().db.config;
      if (!get('host') || +get('port') < 1 || +get('port') > 65535 || !get('fingerprint')) {
        toast('Enter the SSH host, valid port and verified fingerprint.');
        return;
      }
      if (config.requireGPU && !get('proof')) {
        toast('Hardware evidence is required by the platform policy.');
        return;
      }
      if (!has('confirmed')) {
        toast('Confirm that you reviewed the host and hardware evidence.');
        return;
      }
      store.getState().mutate((d) => {
        Object.assign(d.instances.find((v) => v.id === id)!, {
          host: get('host'),
          port: +get('port'),
          fingerprint: get('fingerprint'),
          proof: get('proof'),
          status: 'Verified',
          verified: stamp(),
        });
      });
      store
        .getState()
        .record(
          'Instance evidence verified',
          id,
          'Operator reviewed host identity and hardware proof. No SSH session initiated.',
        );
      instanceDetail(id);
      toast('Instance verification saved.');
    };
    overlay.drawer({
      title: x.name,
      subtitle: `${x.id} · ${x.source}`,
      body: (
        <>
          <Status label={x.status} />
          <DetailGrid
            items={[
              ['Owner', x.owner],
              ['Allocation', `${x.count} × ${x.model}`],
              ['Region', x.region],
              ['Last verified', x.verified],
            ]}
          />
          <form id="instance-verify-form" onSubmit={submit}>
            <Field label="SSH host" name="host" defaultValue={x.host} />
            <Field label="SSH port" name="port" defaultValue={x.port} type="number" />
            <Field
              label="Verified host fingerprint"
              name="fingerprint"
              defaultValue={x.fingerprint}
              hint="Compare the fingerprint through a trusted supplier contact."
            />
            <div className="field">
              <label htmlFor="proof">Hardware verification evidence</label>
              <textarea
                id="proof"
                name="proof"
                className="mono"
                placeholder="Paste the nvidia-smi output received from the supplier."
                defaultValue={x.proof}
              />
              <div className="hint">Confirm GPU model, count, memory and driver version.</div>
            </div>
            <label className="check-line">
              <input type="checkbox" name="confirmed" defaultChecked={x.status === 'Verified'} />I
              reviewed the host identity and hardware evidence against the order.
            </label>
            <Callout>
              This stores an operator review. No SSH connection is initiated from this browser.
            </Callout>
          </form>
        </>
      ),
      footer: (
        <>
          {closeBtn()}
          <button className="primary" form="instance-verify-form" type="submit">
            Save verification
          </button>
        </>
      ),
    });
  }

  function instanceNew() {
    const submit = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const { get } = formValues(event.currentTarget);
      if (!get('name') || !get('owner') || !get('host') || +get('count') < 1 || +get('port') < 1) {
        toast('Complete the instance, owner, hardware count and SSH details.');
        return;
      }
      const id = `INS-${3022 + store.getState().db.instances.length}`;
      store.getState().mutate((d) => {
        d.instances.unshift({
          id,
          name: get('name'),
          source: get('source'),
          owner: get('owner'),
          model: get('model'),
          count: +get('count'),
          region: get('region'),
          host: get('host'),
          port: +get('port'),
          fingerprint: '',
          status: 'Pending',
          proof: '',
          verified: '—',
        });
      });
      store.getState().record('Instance registered', id, get('name'));
      store.getState().setUi({ instanceTab: 'All instances' });
      overlay.close();
      nav('instances');
      instanceDetail(id);
      toast('Instance registered. Add verification evidence next.');
    };
    overlay.modal({
      title: 'Register instance',
      subtitle: 'Capture delivery details for a platform or supplier allocation.',
      body: (
        <form id="instance-new-form" onSubmit={submit}>
          <div className="form-grid">
            <Field label="Instance name" name="name" className="full" />
            <SelectField
              label="Source"
              name="source"
              items={['Seller supplied', 'Platform supplied']}
              defaultValue="Seller supplied"
            />
            <Field label="Supplier / owner" name="owner" />
            <SelectField
              label="GPU model"
              name="model"
              items={MODEL_SPECS.map((x) => x[0])}
              defaultValue="H100 SXM"
            />
            <Field label="GPU count" name="count" defaultValue={8} type="number" />
            <SelectField label="Region" name="region" items={REGIONS} defaultValue="US East" />
            <Field label="SSH host" name="host" />
            <Field label="SSH port" name="port" defaultValue={22} type="number" />
          </div>
        </form>
      ),
      footer: (
        <>
          {closeBtn('Cancel')}
          <button type="submit" form="instance-new-form" className="primary">
            Register instance
          </button>
        </>
      ),
    });
  }

  return { instanceDetail, instanceNew };
}
