'use client';

import { useEffect } from 'react';
import { useApi } from '@/components/providers/api-context';
import { useToast } from '@/components/ui/toast';
import { findCatalogItem, getModelQuote } from '@/features/site';
import { tokenMoney } from '@/features/terminal/components/ModelsPage';
import { openContact, registerTerminalModal } from '@/features/terminal/components/TerminalModal';
import { registerOpportunityOpener } from '@/features/terminal/components/TerminalOverlays';
import { registerMatchesPanel } from '@/features/terminal/components/Matches';
import { registerListingTable } from '@/features/terminal/components/MarketPage';
import {
  registerIntentResumer,
  registerWorkspaceRefresher,
  useTerminal,
} from '@/features/terminal/context';
import { useWorkspaceStore } from '@/features/terminal/store';
import { money } from '@/lib/format';
import { setBillingApi } from '@/features/billing/account';
import { ListingTable } from './components/ListingTable';
import { MatchesPanel } from './components/MatchesPanel';
import { procurementModalRenderer } from './components/ProcurementModals';
import { resumeOpportunity, useOpportunity } from './components/opportunity';
import { refreshMarketplace, setProcurementApi } from './workspace';
import './procurement.css';

/**
 * Mounts the procurement hooks into the terminal shell: API client, modal renderer, market
 * page listing table and matches, workspace refresher, opportunity opener and the resume of
 * public-site intents (`?listing=&intent=` / `?opportunity=&intent=`).
 */
export function ProcurementRegistrar() {
  const api = useApi();
  const toast = useToast();
  const { go } = useTerminal();
  const { open } = useOpportunity();
  useEffect(() => {
    setProcurementApi(api);
    setBillingApi(api);
    return () => {
      setProcurementApi(null);
      setBillingApi(null);
    };
  }, [api]);
  useEffect(() => {
    const offModal = registerTerminalModal(procurementModalRenderer);
    registerListingTable(() => <ListingTable />);
    registerMatchesPanel((kind) => <MatchesPanel key={kind} kind={kind} />);
    const offRefresh = registerWorkspaceRefresher(refreshMarketplace);
    registerOpportunityOpener(open);
    registerIntentResumer((intent) => {
      const S = useWorkspaceStore.getState();
      if (intent.kind === 'opportunity') {
        resumeOpportunity(go, toast);
        return true;
      }
      const item = findCatalogItem(intent.id);
      if (!item) return true;
      if (
        (intent.intent === 'offer' && S.role !== 'Seller') ||
        (intent.intent === 'buy' && S.role !== 'Buyer')
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
        if (quote) S.openModal('model-rfq-form', { sku: quote.sku });
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
        S.openModal('rfq-form', {
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
        if (S.review.status !== 'Approved') {
          S.patch({ afterReview: { type: 'respond', requirement } });
          S.openModal('review');
        } else S.openModal('respond', { requirement });
      } else S.openModal('rfq-form', { model: item.model, prefill: requirement });
      return true;
    });
    return () => {
      offModal();
      offRefresh();
      registerListingTable(null);
      registerMatchesPanel(null);
      registerOpportunityOpener(null);
      registerIntentResumer(null);
    };
  }, [open, go, toast]);
  return null;
}
