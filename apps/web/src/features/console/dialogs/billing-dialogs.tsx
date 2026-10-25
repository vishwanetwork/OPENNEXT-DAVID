'use client';

import { type FormEvent } from 'react';
import { money } from '../helpers';
import { VERIFY_COMMAND } from '../reference-data';
import { Callout, Field, formValues } from '../components/forms';
import type { DialogContext } from './context';

/** Billing dialogs of the browser-local console (legacy OpenNEXT-admin.js). */
export function buildBillingDialogs(ctx: DialogContext) {
  const { overlay, toast, store, closeBtn } = ctx;

  function billingLimit() {
    const submit = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const { get } = formValues(event.currentTarget);
      if (+get('limit') < 1.26) {
        toast('The limit must cover the $1.26 already allocated.');
        return;
      }
      store.getState().mutate((d) => {
        d.spendLimit = +get('limit');
      });
      store
        .getState()
        .record(
          'Evaluation spending cap updated',
          'Agent billing',
          `${money(+get('limit'))} per month`,
        );
      overlay.close();
      toast('Monthly spending limit saved.');
    };
    overlay.modal({
      title: 'Monthly spending limit',
      subtitle: 'Set the maximum allocated evaluation cost.',
      body: (
        <form id="billing-limit-form" onSubmit={submit}>
          <Field
            label="Monthly limit (USD)"
            name="limit"
            defaultValue={store.getState().db.spendLimit || 100}
            type="number"
          />
          <Callout style={{ marginTop: 18 }}>
            This local cap is recorded for evaluation planning. A connected billing service is
            required to enforce external spending.
          </Callout>
        </form>
      ),
      footer: (
        <>
          {closeBtn('Cancel')}
          <button className="primary" type="submit" form="billing-limit-form">
            Save limit
          </button>
        </>
      ),
    });
  }

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(VERIFY_COMMAND);
      toast('Verification command copied.');
    } catch {
      overlay.modal({
        title: 'Verification command',
        subtitle: 'Copy and share this with the supplier.',
        body: <div className="code-box">{VERIFY_COMMAND}</div>,
        footer: closeBtn(),
      });
    }
  }

  return { billingLimit, copyCommand };
}
