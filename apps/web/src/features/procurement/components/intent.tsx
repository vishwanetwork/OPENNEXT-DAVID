'use client';

import { useCallback } from 'react';
import { money } from '@/lib/format';
import { findCatalogItem, getModelQuote } from '@/data';
import { useToast } from '@/components/ui/toast';
import {
  useIntentResume,
  useTerminalSlots,
  useWorkspaceData,
  useWorkspaceStore,
  type IntentResumer,
} from '@/terminal-kit';
import { useOpportunity } from './opportunity';

const tokenMoney = (value: unknown) =>
  Number.isFinite(Number(value)) ? '$' + Number(value).toFixed(2) : 'Confirm in quote';

/**
 * Resumes public-site intents (`?listing=&intent=` catalog items and `?opportunity=&intent=`
 * market rows) once the account is onboarded. Mounted by the composition root.
 */
export function ProcurementIntentResumer() {
  const toast = useToast();
  const { openContact } = useTerminalSlots();
  const { resume } = useOpportunity();
  const review = useWorkspaceData().review;
  const handler = useCallback<IntentResumer>(
    (intent) => {
      const workspace = useWorkspaceStore.getState();
      if (intent.kind === 'opportunity') {
        resume();
        return true;
      }
      const item = findCatalogItem(intent.id);
      if (!item) return true;
      if (
        (intent.intent === 'offer' && workspace.role !== 'seller') ||
        (intent.intent === 'buy' && workspace.role !== 'buyer')
      ) {
        toast(
          'Switch to ' +
            (intent.intent === 'offer' ? 'Seller' : 'Buyer') +
            ' from your account menu to continue with this listing.',
        );
        return true;
      }
      if (item.kind === 'model') {
        const quote = item.sku && getModelQuote(item.sku);
        if (quote) workspace.openModal('model-rfq-form', { sku: quote.sku });
        else
          openContact({
            message: [
              'I would like a model capacity quote for ' + item.name + '.',
              'Catalog reference: ' + item.id + '.',
              'Reference input rate: ' + tokenMoney(item.input) + ' / 1M tokens.',
              'Reference output rate: ' + tokenMoney(item.output) + ' / 1M tokens.',
              'Price observed: ' + (item.observedAt || 'Confirm in quote') + '.',
              item.context || '',
              item.note || '',
              'Please confirm the exact model, access method, throughput, availability and current commercial terms. These reference rates are not an executable offer.',
            ]
              .filter(Boolean)
              .join('\n'),
          });
        return true;
      }
      if (item.kind === 'hardware') {
        const details = [
          'Catalog item: ' + item.name + ' (' + item.id + ').',
          'Reference purchase price: ' + money(item.price) + ' / ' + item.unit + '.',
          'Price observed: ' + (item.observedAt || 'Confirm in quote') + '.',
          'Memory: ' + (item.memory || 'Confirm in quote') + '.',
          'Form factor: ' + (item.form || 'Confirm in quote') + '.',
          'Minimum order: ' + (item.minimum || 'Confirm in quote') + '.',
          item.note || '',
          item.status || '',
          'Please confirm the exact SKU, condition, availability, warranty, shipping and current payable amount.',
        ]
          .filter(Boolean)
          .join('\n');
        if (item.unit !== 'GPU') {
          openContact({
            message:
              'I would like a quote for this complete system. Pricing is per ' +
              item.unit +
              ', not per GPU.\n' +
              details,
          });
          return true;
        }
        const minimum = Number(String(item.minimum || '1').match(/\d+/)?.[0]) || 1;
        workspace.openModal('rfq-form', {
          prefill: {
            kind: 'physical_gpu',
            model: item.name,
            title: item.name + ' purchase inquiry',
            count: minimum,
            budget: item.price,
            term: 'Physical GPU',
            hours: 0,
            condition: item.condition || 'Confirm in supplier quote',
            originListingId: item.id,
            notes: details,
          },
        });
        return true;
      }
      const requirement = {
        id: 'DEMAND-' + item.id,
        title: item.model + ' cluster procurement',
        model: item.model,
        count: Number(String(item.count).replace(/[^0-9]/g, '')),
        region: item.region,
        term: 'Reserved',
        hours: item.months * 30 * 24,
        budget: item.price,
        priceKind: 'buyer_target',
        originListingId: item.id,
        notes: item.note,
      };
      if (intent.intent === 'offer') {
        if (review.status !== 'Approved') {
          workspace.patch({ afterReview: { type: 'respond', requirement } });
          workspace.openModal('review');
        } else workspace.openModal('respond', { requirement });
      } else workspace.openModal('rfq-form', { model: item.model, prefill: requirement });
      return true;
    },
    [resume, toast, openContact, review.status],
  );
  useIntentResume(handler);
  return null;
}
