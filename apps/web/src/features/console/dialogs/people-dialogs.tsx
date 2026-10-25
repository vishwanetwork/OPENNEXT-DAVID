'use client';

import { type FormEvent } from 'react';
import {
  Btn,
  Callout,
  DetailGrid,
  Field,
  SelectField,
  Status,
  formValues,
} from '../components/forms';
import type { DialogContext } from './context';

/** People dialogs of the browser-local console (legacy OpenNEXT-admin.js). */
export function buildPeopleDialogs(ctx: DialogContext) {
  const { overlay, toast, nav, store, closeBtn } = ctx;

  function adviceDetail(id: string) {
    const x = store.getState().db.advisory.find((v) => v.id === id);
    if (!x) return;
    const decide = (decision: 'Dismissed' | 'Accepted') => {
      store.getState().mutate((d) => {
        d.advisory.find((v) => v.id === id)!.status = decision;
      });
      store.getState().record(`Recommendation ${decision.toLowerCase()}`, id, x.title);
      overlay.close();
      toast(`Recommendation ${decision.toLowerCase()}.`);
    };
    overlay.drawer({
      title: x.title,
      subtitle: `${id} · ${x.type}`,
      body: (
        <>
          <Status label={x.status} />
          <p className="small-text muted" style={{ marginTop: 18, lineHeight: 1.8 }}>
            {x.desc}
          </p>
          <DetailGrid
            items={[
              ['Relevant hardware', x.model],
              ['Evidence records', x.records],
              ['Confidence', `${x.confidence}%`],
              ['Recommendation', 'Operator review required'],
            ]}
          />
          <h3>Recommended next step</h3>
          <p className="small-text muted" style={{ marginTop: 9 }}>
            {x.type === 'Supplier review'
              ? 'Review rights evidence and schedule a separate capacity test.'
              : x.type === 'Delivery readiness'
                ? 'Verify the host fingerprint, hardware evidence and delivery contact.'
                : 'Compare current supplier quotes and confirm the buyer’s constraints.'}
          </p>
          <Callout style={{ marginTop: 20 }}>
            Accepting this recommendation adds an audit record. External execution still requires
            the relevant workflow and approval.
          </Callout>
        </>
      ),
      footer: (
        <>
          <Btn onClick={() => decide('Dismissed')}>Dismiss</Btn>
          <Btn className="primary" onClick={() => decide('Accepted')}>
            Accept recommendation
          </Btn>
        </>
      ),
    });
  }

  function userDetail(id: string) {
    const x = store.getState().db.users.find((v) => v.id === id);
    if (!x) return;
    const submit = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const { get } = formValues(event.currentTarget);
      if (!get('note')) {
        toast('Add a review note or evidence reference.');
        return;
      }
      const review = {
        eligibility: get('eligibility'),
        kyb: get('kyb'),
        rights: get('rights'),
        test: get('test'),
      };
      if (
        ['Seller', 'Broker'].includes(get('role')) &&
        get('status') === 'Active' &&
        !Object.values(review).every((v) => v === 'Approved')
      ) {
        toast('All four supplier checks must be approved before activating a Seller or Broker.');
        return;
      }
      store.getState().mutate((d) => {
        Object.assign(d.users.find((v) => v.id === id)!, {
          role: get('role'),
          status: get('status'),
          review,
        });
      });
      store.getState().record('Account and supplier review updated', id, get('note'));
      userDetail(id);
      toast('Review and access role saved.');
    };
    const checks: [keyof typeof x.review, string, string][] = [
      ['eligibility', 'Eligibility', 'Identity, geography and permitted supply scope'],
      ['kyb', 'KYB', 'Company record and beneficial ownership'],
      [
        'rights',
        'Rights & authorization',
        'Evidence of ownership, allocation or resale permission',
      ],
      ['test', 'Capacity test', 'Hardware / delivery evidence reviewed'],
    ];
    overlay.drawer({
      title: x.name,
      subtitle: `${x.company} · ${x.id}`,
      body: (
        <>
          <div className="user-identity">
            <span className="avatar">
              {x.name
                .split(' ')
                .map((s) => s[0])
                .slice(0, 2)
                .join('')}
            </span>
            <div>
              <h3>{x.name}</h3>
              <p>{x.email}</p>
            </div>
            <Status label={x.status} />
          </div>
          <form id="user-review-form" onSubmit={submit}>
            <div className="form-grid">
              <SelectField
                label="Workspace role"
                name="role"
                items={['Buyer', 'Seller', 'Broker', 'Analyst', 'Operations', 'Administrator']}
                defaultValue={x.role}
              />
              <SelectField
                label="Account status"
                name="status"
                items={['Active', 'In review', 'Paused']}
                defaultValue={x.status}
              />
            </div>
            <h3 style={{ marginTop: 24 }}>Supplier review</h3>
            <p className="tiny muted" style={{ marginTop: 7 }}>
              Eligibility, KYB and rights establish supplier onboarding. Capacity tests apply to
              each new allocation.
            </p>
            {checks.map(([key, label, copy], i) => (
              <div className="review-check" key={key}>
                <span className={x.review[key] === 'Approved' ? 'complete' : ''}>
                  {x.review[key] === 'Approved' ? '✓' : i + 1}
                </span>
                <div>
                  <strong>{label}</strong>
                  <small>{copy}</small>
                </div>
                <select name={key} aria-label={label} defaultValue={x.review[key]}>
                  {['Pending', 'In review', 'Approved', 'Rejected'].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </div>
            ))}
            <div className="field" style={{ marginTop: 20 }}>
              <label htmlFor="review-note">Review note / evidence reference</label>
              <textarea
                name="note"
                id="review-note"
                style={{ height: 85 }}
                placeholder="Document what was checked and the evidence reference."
              />
            </div>
            <Callout>
              Only mark rights approved when the supplied evidence supports the permitted delivery
              scope. A successful capacity test does not establish upstream authorization.
            </Callout>
          </form>
        </>
      ),
      footer: (
        <>
          {closeBtn()}
          <button className="primary" type="submit" form="user-review-form">
            Save review
          </button>
        </>
      ),
    });
  }

  function invite() {
    const submit = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const { get } = formValues(event.currentTarget);
      if (!get('name') || !get('company') || !/^\S+@\S+\.\S+$/.test(get('email'))) {
        toast('Enter a name, company and valid email address.');
        return;
      }
      const { db } = store.getState();
      if (db.users.some((x) => x.email.toLowerCase() === get('email').toLowerCase())) {
        toast('An account with this email already exists.');
        return;
      }
      const id = `USR-${1001 + db.users.length}`;
      store.getState().mutate((d) => {
        d.users.push({
          id,
          name: get('name'),
          email: get('email'),
          company: get('company'),
          role: get('role'),
          status: ['Seller', 'Broker'].includes(get('role')) ? 'In review' : 'Active',
          joined: new Date().toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          }),
          review: { eligibility: 'Pending', kyb: 'Pending', rights: 'Pending', test: 'Pending' },
        });
      });
      store
        .getState()
        .record(
          'Account record created',
          id,
          `${get('email')} · ${get('role')}; no invitation email sent.`,
        );
      store.getState().setUi({ userTab: 'All accounts' });
      overlay.close();
      nav('users');
      toast('Account record created.');
    };
    overlay.modal({
      title: 'Invite account',
      subtitle: 'Add a procurement contact, supplier, broker or team operator.',
      body: (
        <form id="invite-form" onSubmit={submit}>
          <div className="form-grid">
            <Field label="Full name" name="name" className="full" />
            <Field label="Work email" name="email" type="email" className="full" />
            <Field label="Company" name="company" />
            <SelectField
              label="Role"
              name="role"
              items={['Buyer', 'Seller', 'Broker', 'Analyst', 'Operations', 'Administrator']}
              defaultValue="Buyer"
            />
          </div>
          <Callout style={{ marginTop: 20 }}>
            This creates an account record in the local workspace. No invitation email is sent.
          </Callout>
        </form>
      ),
      footer: (
        <>
          {closeBtn('Cancel')}
          <button type="submit" className="primary" form="invite-form">
            Create account record
          </button>
        </>
      ),
    });
  }

  return { adviceDetail, userDetail, invite };
}
