'use client';

import { useState } from 'react';
import { dateUtc } from '@/lib/format';
import { Empty, Head, SearchBox, Status } from '../components/forms';
import {
  filterUsers,
  GROWTH_PERIODS,
  growthValue,
  type GrowthPeriod,
  type UsersSnapshot,
} from './operations-records';

/** The administrator user service is not connected; no browser-local account records are used. */
export function UsersPage({ snapshot }: { snapshot?: UsersSnapshot }) {
  const [period, setPeriod] = useState<GrowthPeriod>('7D');
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('All');
  const users = snapshot?.users ?? [];
  const roles = [...new Set(users.map((user) => user.role))].sort();
  const list = filterUsers(users, search, role);
  const growth = growthValue(snapshot, period);
  return (
    <>
      <Head title="User" copy="Platform accounts and registration growth." />
      <div className="stats">
        <div className="stat">
          <div className="stat-label">Total Users</div>
          <div className="stat-value">{snapshot?.totalUsers.toLocaleString('en-US') ?? '—'}</div>
          <div className="stat-foot">{snapshot ? 'Platform-wide total' : 'Awaiting backend'}</div>
        </div>
        <div className="stat">
          <div className="stat-label">User growth</div>
          <div className="stat-value">
            {growth === undefined ? '—' : `+${growth.toLocaleString('en-US')}`}
          </div>
          <div className="stat-foot">
            <label htmlFor="user-growth-period">New users · </label>
            <select
              id="user-growth-period"
              value={period}
              onChange={(event) => {
                const value = GROWTH_PERIODS.find((item) => item === event.target.value);
                if (value) setPeriod(value);
              }}
            >
              {GROWTH_PERIODS.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
      {!snapshot && (
        <p className="ops-state" role="status">
          Awaiting backend · The platform user directory and growth totals are not connected.
        </p>
      )}
      <section className="panel">
        <div className="table-toolbar">
          <h2>Platform users</h2>
          <SearchBox
            placeholder="Search name, company or email…"
            value={search}
            onChange={setSearch}
          />
        </div>
        <div className="ops-filters">
          <label>
            Role
            <select value={role} onChange={(event) => setRole(event.target.value)}>
              <option>All</option>
              {roles.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Company</th>
                <th>Role</th>
                <th>Status</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {list.map((user) => (
                <tr key={user.id}>
                  <td>{user.name || '—'}</td>
                  <td>{user.email}</td>
                  <td>{user.company || '—'}</td>
                  <td>{user.role}</td>
                  <td>
                    <Status label={user.status} />
                  </td>
                  <td>{dateUtc(user.joinedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!list.length && (
          <Empty
            title={snapshot ? 'No matching users' : 'User directory awaiting backend'}
            copy={
              snapshot
                ? 'Try another role or search.'
                : 'Verified account records will appear here when the administrator user service is connected.'
            }
          />
        )}
      </section>
    </>
  );
}
