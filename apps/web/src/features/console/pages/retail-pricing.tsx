'use client';

import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { OperationsRetailPricing } from '@opennext/contracts';
import { useApi } from '@/components/providers/api-context';
import { AsyncButton } from '@/components/ui/async-feedback';
import { stampUtc } from '@/lib/format';
import { LiveFrame } from '../components/live-frame';
import { Head } from '../components/forms';
import { useConsoleResource } from '../live-hooks';
import { liveApi } from '../live-api';
import { draftFrom, retailPreview, updateFrom, type RuleDraft } from './retail-pricing-model';

export function RetailPricingPage() {
  const state = useConsoleResource('retailPricing');
  return (
    <LiveFrame title="Spot pricing" state={state}>
      {state.data ? <PricingEditor policy={state.data} /> : null}
    </LiveFrame>
  );
}

function PricingEditor({ policy }: { policy: OperationsRetailPricing }) {
  const api = useApi();
  const queries = useQueryClient();
  const [draft, setDraft] = useState(() => draftFrom(policy));
  const [cost, setCost] = useState('1.00');
  const [notice, setNotice] = useState('');
  const save = useMutation({
    mutationFn: () => liveApi.saveRetailPricing(api, updateFrom(draft)),
    onSuccess: async (updated) => {
      setDraft(draftFrom(updated));
      setNotice(`Pricing version ${updated.version} saved. New quotes now use this policy.`);
      await queries.invalidateQueries({ queryKey: ['admin', 'live'] });
    },
  });
  const preview = retailPreview(cost, draft.percent, policy.serviceFeeBps);
  const updateRule = (id: string, patch: Partial<RuleDraft>) =>
    setDraft((current) => ({
      ...current,
      rules: current.rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
    }));
  const move = (index: number, delta: number) =>
    setDraft((current) => {
      const rules = [...current.rules];
      const item = rules.splice(index, 1)[0];
      if (item) rules.splice(index + delta, 0, item);
      return { ...current, rules };
    });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!save.isPending) {
      setNotice('');
      save.mutate();
    }
  };
  const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  return (
    <>
      <Head
        title="Spot pricing"
        copy="Set the retail markup for executable Spot offers. Existing purchases and issued payment instructions keep their accepted prices."
      />
      <p className="muted">
        Market Insight observations retain their source prices. This policy applies to new
        executable Spot quotes; procurement price tolerance and the existing service fee are
        separate.
      </p>
      <form onSubmit={submit}>
        <section className="panel">
          <div className="panel-head">
            <h2>Default markup</h2>
          </div>
          <div className="panel-body">
            <div className="field">
              <label htmlFor="default-markup">Default Spot markup (%)</label>
              <input
                id="default-markup"
                disabled={save.isPending}
                type="number"
                min="0"
                max="100"
                step="0.01"
                required
                value={draft.percent}
                onChange={(event) => setDraft({ ...draft, percent: event.target.value })}
              />
            </div>
            <p>
              Existing service fee: {policy.serviceFeeBps / 100}%. Procurement tolerance:{' '}
              {policy.procurementToleranceBps / 100}%.
            </p>
            <p className="muted">
              Version {policy.version} · Last change{' '}
              {policy.changedAt ? stampUtc(policy.changedAt) : 'Initial server configuration'}.
            </p>
            {draft.version !== policy.version ? (
              <p role="alert">
                Settings changed elsewhere. Reload the saved policy before submitting.
              </p>
            ) : null}
            <button
              type="button"
              className="btn"
              disabled={save.isPending}
              onClick={() => {
                setDraft(draftFrom(policy));
                setNotice('Saved policy loaded.');
              }}
            >
              Reload saved policy
            </button>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>GPU, region and provider overrides</h2>
          </div>
          <div className="panel-body">
            <p>
              Rules are checked from top to bottom. The first match wins. Blank fields match any
              value; each rule needs at least one selector. GPU names use canonical models such as
              H100 or T4.
            </p>
            {draft.rules.map((rule, index) => (
              <fieldset key={rule.id} disabled={save.isPending}>
                <legend>Rule {index + 1}</legend>
                {(['gpuModel', 'region', 'provider'] as const).map((field) => (
                  <div className="field" key={field}>
                    <label htmlFor={`${rule.id}-${field}`}>
                      {field === 'gpuModel'
                        ? 'GPU model'
                        : field === 'region'
                          ? 'Region'
                          : 'Provider'}
                    </label>
                    <input
                      id={`${rule.id}-${field}`}
                      value={rule[field]}
                      maxLength={field === 'gpuModel' ? 80 : field === 'region' ? 64 : 32}
                      placeholder={
                        field === 'gpuModel' ? 'H100' : field === 'region' ? 'us-west-2' : 'aws'
                      }
                      onChange={(event) => updateRule(rule.id, { [field]: event.target.value })}
                    />
                  </div>
                ))}
                <div className="field">
                  <label htmlFor={`${rule.id}-percent`}>Markup (%)</label>
                  <input
                    id={`${rule.id}-percent`}
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    required
                    value={rule.percent}
                    onChange={(event) => updateRule(rule.id, { percent: event.target.value })}
                  />
                </div>
                <div className="row">
                  <button
                    type="button"
                    className="btn"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                    aria-label={`Move rule ${index + 1} up`}
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={index === draft.rules.length - 1}
                    onClick={() => move(index, 1)}
                    aria-label={`Move rule ${index + 1} down`}
                  >
                    Move down
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      setDraft({ ...draft, rules: draft.rules.filter((r) => r.id !== rule.id) })
                    }
                  >
                    Remove rule {index + 1}
                  </button>
                </div>
              </fieldset>
            ))}
            <button
              type="button"
              className="btn"
              disabled={save.isPending || draft.rules.length >= 20}
              onClick={() =>
                setDraft({
                  ...draft,
                  rules: [
                    ...draft.rules,
                    {
                      id: crypto.randomUUID(),
                      gpuModel: '',
                      region: '',
                      provider: '',
                      percent: draft.percent,
                    },
                  ],
                })
              }
            >
              Add override
            </button>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Default-rule preview</h2>
          </div>
          <div className="panel-body">
            <div className="field">
              <label htmlFor="supplier-price">Supplier USD / instance-hour</label>
              <input
                id="supplier-price"
                type="number"
                min="0.000001"
                max="100000"
                step="any"
                value={cost}
                onChange={(event) => setCost(event.target.value)}
              />
            </div>
            <p>Listed price before service fee: {preview ? usd(preview.rateCents) : '—'}</p>
            <p>Existing service fee: {preview ? usd(preview.feeCents) : '—'}</p>
            <p>Total for one hour: {preview ? usd(preview.totalCents) : '—'}</p>
            <p className="muted">
              Preview uses the default markup; matching overrides take precedence. Retail rates
              round up to whole cents per instance-hour.
            </p>
          </div>
        </section>
        {save.error ? (
          <p role="alert">
            {save.error instanceof Error
              ? save.error.message
              : 'The pricing policy could not be saved.'}
          </p>
        ) : null}
        {notice ? <p role="status">{notice}</p> : null}
        <AsyncButton
          type="submit"
          className="btn primary"
          busy={save.isPending}
          disabled={save.isPending || draft.version !== policy.version}
        >
          Save Spot pricing
        </AsyncButton>
      </form>
      <section className="panel">
        <div className="panel-head">
          <h2>Recent policy history</h2>
        </div>
        <div className="panel-body">
          {policy.history.length ? (
            policy.history.map((revision) => (
              <p key={revision.version}>
                Version {revision.version}: default {revision.defaultMarkupBps / 100}% ·{' '}
                {revision.rules.length} overrides ·{' '}
                {revision.changedAt ? stampUtc(revision.changedAt) : 'Initial server configuration'}
              </p>
            ))
          ) : (
            <p>No operator changes recorded.</p>
          )}
        </div>
      </section>
    </>
  );
}
