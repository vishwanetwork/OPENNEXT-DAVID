'use client';

import { useToast } from '@/components/ui/toast';
import { useConsoleStore } from '../store';
import { DATASET_BY_LABEL, DATASET_LABELS } from '../reference-data';
import { Btn, Callout, SelectField } from '../components/forms';
import { useOverlay } from '../components/overlay';
import type { DatasetId } from '../types';
import { importOffers } from './market-data';

function ImportDialogBody() {
  return (
    <form id="import-form">
      <div className="form-grid">
        <SelectField
          label="Dataset"
          name="dataset"
          items={Object.values(DATASET_LABELS)}
          defaultValue="Current offers"
          className="full"
        />
        <div className="field full">
          <label htmlFor="csv-file">Upload CSV</label>
          <input
            type="file"
            id="csv-file"
            name="file"
            accept=".csv,text/csv"
            style={{ padding: 7, height: 'auto' }}
          />
          <div className="hint">Or paste records below. Uploading stays in this browser.</div>
        </div>
        <div className="field full">
          <label htmlFor="csv">CSV records</label>
          <textarea
            name="csv"
            id="csv"
            className="mono"
            style={{ height: 150 }}
            placeholder={
              'provider,model,count,region,terms,rate\nNebius,H100 SXM,8,US East,Spot,2.63'
            }
          />
        </div>
      </div>
      <Callout style={{ marginTop: 18 }}>
        Current offers require provider, model, count, region, terms and rate. Invalid rows are
        skipped; all imports are recorded in the audit log.
      </Callout>
    </form>
  );
}

export function useImportDialog(onImported: (key: DatasetId) => void) {
  const overlay = useOverlay();
  const toast = useToast();
  return () => {
    const submit = async () => {
      const form = document.getElementById('import-form') as HTMLFormElement | null;
      if (!form) return;
      const f = new FormData(form);
      let text = String(f.get('csv') || '').trim();
      const file = f.get('file');
      if (!text && file instanceof File && file.size) text = await file.text();
      if (!text) {
        toast('Upload or paste CSV records first.');
        return;
      }
      const dataset = String(f.get('dataset'));
      const key = DATASET_BY_LABEL[dataset];
      let result: ReturnType<typeof importOffers> = { error: '' };
      useConsoleStore.getState().mutate((db) => {
        result = importOffers(db, key, text);
      });
      if ('error' in result) {
        toast(result.error);
        return;
      }
      const { added, skipped } = result;
      useConsoleStore
        .getState()
        .record(
          'Market records imported',
          dataset,
          `${added} accepted; ${skipped} invalid rows skipped.`,
        );
      overlay.close();
      onImported(key);
      toast(`${added} records imported${skipped ? `; ${skipped} skipped` : ''}.`);
    };
    overlay.modal({
      title: 'Import market records',
      subtitle: 'Normalize a CSV dataset for market analysis.',
      wide: true,
      body: <ImportDialogBody />,
      footer: (
        <>
          <Btn onClick={overlay.close}>Cancel</Btn>
          <Btn
            onClick={() => {
              const el = document.getElementById('csv') as HTMLTextAreaElement | null;
              if (el)
                el.value =
                  'provider,model,count,region,terms,rate\nNebius,H100 SXM,8,US East,Spot,2.63\nVultr,B200,8,Singapore,On-demand,4.96\nLambda,H200,16,US West,Reserved,3.48';
            }}
          >
            Load example
          </Btn>
          <Btn className="primary" onClick={() => void submit()}>
            Validate &amp; import
          </Btn>
        </>
      ),
    });
  };
}
