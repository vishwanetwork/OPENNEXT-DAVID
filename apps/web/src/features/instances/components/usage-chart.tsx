'use client';

import type { InstanceUsageSnapshot } from '@/lib/instance-usage';
import { stampUtcFull } from '../lifecycle';
import { usageBars } from '../usage';

const clock = (at: number) =>
  new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });

export function UsageChart({
  snapshot,
  loading = false,
}: {
  snapshot: InstanceUsageSnapshot | null;
  loading?: boolean;
}) {
  if (!snapshot || !snapshot.intervals.length)
    return (
      <div className="instance-usage-empty">
        <span>GPU utilization</span>
        <div className="instance-usage-placeholder" aria-hidden="true" />
        <small>
          {loading
            ? 'Loading usage history…'
            : 'Usage history is not available yet. No usage or charges are estimated here.'}
        </small>
      </div>
    );
  const from = Date.parse(snapshot.windowStart);
  const to = Date.parse(snapshot.windowEnd);
  const bars = usageBars(snapshot.intervals, from, to);
  const events = snapshot.events.filter(
    (event) =>
      event.type === 'reconnected' && Date.parse(event.at) >= from && Date.parse(event.at) <= to,
  );
  return (
    <div className="instance-usage">
      <div className="row spread">
        <span>GPU utilization</span>
        <small>Recorded history (UTC)</small>
      </div>
      <div
        className="instance-usage-bars"
        role="img"
        aria-label="GPU utilization over time with interruption gaps and reconnection markers"
      >
        {bars.map((bar) => (
          <span
            key={bar.start}
            className={`instance-usage-bucket ${bar.interrupted > 0 ? 'has-interruption' : ''}`}
            title={`${stampUtcFull(new Date(bar.start).toISOString())} – ${clock(bar.end)} UTC ${bar.interrupted ? `${Math.round(bar.interrupted * 100)}% interrupted; ` : ''}${bar.connected ? (bar.utilization === null ? 'Connected; utilization not recorded' : `${bar.utilization.toFixed(1)}% GPU utilization`) : 'No connected usage recorded'}`}
          >
            {bar.connected > 0 ? (
              <i
                className={bar.utilization === null ? 'unmeasured' : ''}
                style={{
                  height: `${bar.utilization === null ? 100 : Math.max(3, bar.utilization)}%`,
                }}
              />
            ) : null}
          </span>
        ))}
        {events.map((event) => (
          <b
            key={event.id}
            className="instance-reconnect-marker"
            style={{ left: `${((Date.parse(event.at) - from) / (to - from)) * 100}%` }}
            title={`Reconnected ${stampUtcFull(event.at)}`}
          >
            <span aria-hidden="true">↻</span>
          </b>
        ))}
      </div>
      <div className="instance-usage-axis">
        <span>{clock(from)}</span>
        <span>{clock((from + to) / 2)}</span>
        <span>{clock(to)} UTC</span>
      </div>
      <div className="instance-usage-legend">
        <span>
          <i />
          Usage
        </span>
        <span>
          <i className="interrupted" />
          Interrupted
        </span>
        <span>↻ Reconnected</span>
      </div>
    </div>
  );
}

export function ReconnectingNote({ retained }: { retained: boolean }) {
  return (
    <p className="instance-reconnecting-note">
      {retained
        ? 'Your data is preserved. No re-upload is needed; you can continue once the replacement instance reconnects.'
        : 'We are finding replacement capacity. Data preservation will be confirmed before access resumes; contact support before re-uploading.'}
    </p>
  );
}
