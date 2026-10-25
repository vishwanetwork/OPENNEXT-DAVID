'use client';

import type { FormEvent } from 'react';
import { useToast } from '@/components/ui/toast';
import { useConsoleStore } from '../store';
import { initials } from '../helpers';
import { Field, Head, Note, SelectField, formValues } from '../components/forms';

export function SettingsPage() {
  const p = useConsoleStore((s) => s.db.profile);
  const toast = useToast();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const { get, has } = formValues(event.currentTarget);
    if (!get('name') || !/^\S+@\S+\.\S+$/.test(get('email'))) {
      toast('Enter your name and a valid email.');
      return;
    }
    useConsoleStore.getState().mutate((d) => {
      d.profile = {
        name: get('name'),
        email: get('email'),
        company: get('company'),
        timezone: get('timezone'),
        notifications: has('notifications'),
      };
    });
    useConsoleStore.getState().record('Operator preferences updated', 'My account');
    toast('Account preferences saved.');
  };
  return (
    <>
      <Head title="My account" copy="Your operator identity and workspace preferences." />
      <section className="panel account-panel">
        <div className="panel-body">
          <div className="user-identity">
            <span className="avatar">{initials(p.name)}</span>
            <div>
              <h2>{p.name}</h2>
              <p>{p.email} · Administrator</p>
            </div>
          </div>
          <form id="profile-form" onSubmit={submit} key={`${p.name}|${p.email}|${p.timezone}`}>
            <div className="form-grid">
              <Field label="Full name" name="name" defaultValue={p.name} />
              <Field label="Work email" name="email" defaultValue={p.email} type="email" />
              <Field label="Company" name="company" defaultValue={p.company} />
              <SelectField
                label="Timezone"
                name="timezone"
                items={[
                  'Asia/Singapore',
                  'Asia/Shanghai',
                  'America/Los_Angeles',
                  'America/New_York',
                  'Europe/London',
                ]}
                defaultValue={p.timezone}
              />
            </div>
            <div className="toggle-line">
              <div>
                <strong>Operations notifications</strong>
                <p>Show supplier, approval and delivery reminders.</p>
              </div>
              <label className="toggle">
                <input type="checkbox" name="notifications" defaultChecked={p.notifications} />
                <span />
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
              <button className="primary" type="submit">
                Save preferences
              </button>
            </div>
          </form>
        </div>
      </section>
      <Note />
    </>
  );
}
