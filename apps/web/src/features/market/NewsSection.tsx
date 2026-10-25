'use client';

import { stampUtc } from '@/lib/format';
import { UNAVAILABLE_NEWS, useNews } from './hooks';

/** "Latest GPU market news" panel on the market page (legacy `news()`). */
export function NewsSection() {
  const query = useNews();
  const state = query.data ?? (query.isPending ? { status: 'loading', articles: [] } : UNAVAILABLE_NEWS);
  const status = query.isError && query.data ? 'unavailable' : state.status;
  const stale = Boolean(state.stale) || query.isError || ['cached', 'unavailable'].includes(status);
  const checked = state.fetchedAt ? 'Checked ' + stampUtc(state.fetchedAt) : status === 'loading' ? 'Checking official sources…' : 'No successful update yet';
  const items = (state.articles || []).filter((n) => /^https:\/\//.test(n.url || ''));
  const cadence = status === 'disabled' ? 'Updates paused' : 'Hourly refresh';
  const emptyNews =
    status === 'loading'
      ? 'Checking official GPU news sources…'
      : status === 'disabled'
        ? 'News updates are paused by the operator.'
        : status === 'empty'
          ? 'No recent GPU-market headlines were found in the connected sources.'
          : 'GPU market news is temporarily unavailable. The feed will retry automatically.';
  return (
    <section className="news">
      <div className="news-head">
        <div>
          <span className="eyebrow muted">Market intelligence</span> &nbsp; <strong>Latest GPU market news</strong>
        </div>
        <small>
          {checked} · {cadence}
          {stale ? ' · Cached data' : ''}
          {status === 'partial' ? ' · Some sources unavailable' : ''}
        </small>
      </div>
      <div className="news-grid">
        {items.length ? (
          items.map((n) => {
            const date = n.publishedAt || n.date;
            return (
              <a key={n.url!} className="news-card" href={n.url!} target="_blank" rel="noopener noreferrer">
                <small>
                  {n.source} · {date && Number.isFinite(Date.parse(date)) ? new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'Publication date unavailable'}
                </small>
                <h4>{n.title}</h4>
                <span className="arrow">Read source ↗</span>
              </a>
            );
          })
        ) : (
          <p className="api-empty-row">{emptyNews}</p>
        )}
      </div>
    </section>
  );
}
