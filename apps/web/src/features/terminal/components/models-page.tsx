'use client';

import { useState } from 'react';
import { listModelQuotes, type ModelQuote } from '@/data/model-quotes';
import { Button, EmptyState, PageHeading, useTerminal, useToast } from '@/terminal-kit';
import { MarketSwitcher } from './filters';

export const tokenMoney = (value: unknown): string =>
  Number.isFinite(Number(value))
    ? Number(value).toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 6,
      })
    : 'Confirm in quote';
export const tokenVolume = (value: unknown): string =>
  Number(value).toLocaleString('en-US', { maximumFractionDigits: 6 });

export function ModelRateSummary({ q }: { q: ModelQuote | null | undefined }) {
  if (!q) return <p className="form-note">Choose a quoted model SKU.</p>;
  return (
    <>
      <div className="model-price-grid model-token-rates">
        <div>
          <small>INPUT / 1M TOKENS</small>
          <strong>{tokenMoney(q.input)}</strong>
        </div>
        <div>
          <small>OUTPUT / 1M TOKENS</small>
          <strong>{tokenMoney(q.output)}</strong>
        </div>
        <div>
          <small>CACHE / 1M TOKENS</small>
          <strong>{tokenMoney(q.cache)}</strong>
        </div>
      </div>
      <p className="form-note">
        {q.context} · Cache billing treatment requires quote confirmation.
      </p>
    </>
  );
}

/** Model Capacity page (supplier token-rate indications). */
export function ModelsPage() {
  const { openModal } = useTerminal();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const quotes = listModelQuotes();
  const q = query.toLowerCase();
  return (
    <>
      <section className="filters model-market-filters">
        <MarketSwitcher />
        <div className="model-market-context">
          <strong>Model Capacity</strong>
          <span>Input / output / cache rates · USD per 1M tokens</span>
        </div>
      </section>
      <div className="page-content">
        <PageHeading
          title="Model Capacity"
          subtitle="Review supplier indications by exact model and pricing tier, then confirm capacity and terms."
          action={
            <Button data-act="new-rfq" onClick={() => openModal('model-rfq-form')}>
              Post RFQ
            </Button>
          }
        />
        <div className="toolbar">
          <input
            className="field"
            type="search"
            data-search="models"
            placeholder="Search model, brand, context tier or SKU…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="form-note">{quotes.length} quoted model tiers</span>
        </div>
        <div className="callout model-quote-note">
          Indicative supplier quotes. Availability, throughput, context limits, access rights, cache
          billing, quote validity, taxes and fees require confirmation. Reference ratios use the
          supplier sheet’s reference columns; they are not independently verified current official
          discounts.
        </div>
        <div className="model-grid">
          {quotes.map((item) => {
            const text = `${item.name} ${item.brand} ${item.context} ${item.sku}`.toLowerCase();
            return (
              <article
                key={item.sku}
                className="model-card"
                data-model-sku={item.sku}
                data-search-item={text}
                hidden={q ? !text.includes(q) : false}
              >
                <span className="tag">Indicative supplier quote</span>
                <h3 style={{ marginTop: 15 }}>{item.name}</h3>
                <span className="muted" style={{ fontSize: 11 }}>
                  {item.brand} · {item.modelId}
                </span>
                <ModelRateSummary q={item} />
                <div className="model-meta">
                  <span>Supplier-sheet reference ratio</span>
                  <strong>
                    {Number.isFinite(item.input / item.referenceInput)
                      ? (item.input / item.referenceInput).toFixed(2) + '×'
                      : 'Not supplied'}
                  </strong>
                </div>
                <div className="model-meta">
                  <span>Input type</span>
                  <span>{item.inputType}</span>
                </div>
                <div className="model-meta">
                  <span>Throughput & quote validity</span>
                  <span>Confirm in quote</span>
                </div>
                <Button
                  data-act="model-quote"
                  data-sku={item.sku}
                  data-value={item.sku}
                  onClick={() =>
                    item
                      ? openModal('model-rfq-form', { sku: item.sku })
                      : toast('This model quote is not available')
                  }
                >
                  Request quote
                </Button>
              </article>
            );
          })}
        </div>
        {quotes.length ? null : (
          <EmptyState title="Model quotes are not available">
            Try again when the supplier quote sheet has loaded.
          </EmptyState>
        )}
      </div>
    </>
  );
}
