'use client';

import type { BuyerKybMode, KybDocumentKind } from '@/lib/buyer-kyb';
import { documentRequirements, type KybFiles } from '../requirements';

export function DocumentFields({
  mode,
  country,
  files,
  disabled,
  onChange,
}: {
  mode: BuyerKybMode;
  country: string;
  files: KybFiles;
  disabled: boolean;
  onChange: (kind: KybDocumentKind, files: File[]) => void;
}) {
  return (
    <section aria-label="Required company documents">
      <h3>
        <span>02</span> Supporting documents
      </h3>
      <p className="buyer-kyb-help">
        Five required categories · PDF, PNG or JPEG · 10 MB per file · 50 MB total
      </p>
      <div className="buyer-kyb-documents">
        {documentRequirements(mode, country).map((requirement, index) => (
          <div className="buyer-kyb-document" key={requirement.kind}>
            <div className="buyer-kyb-document-heading">
              <span className="buyer-kyb-document-number">{index + 1}</span>
              <div>
                <label htmlFor={`buyer-kyb-${requirement.kind}`}>{requirement.title}</label>
                <p>{requirement.help}</p>
              </div>
            </div>
            <input
              id={`buyer-kyb-${requirement.kind}`}
              type="file"
              multiple
              accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
              disabled={disabled}
              onChange={(event) => {
                onChange(requirement.kind, Array.from(event.target.files ?? []));
                event.currentTarget.value = '';
              }}
            />
            {(files[requirement.kind]?.length ?? 0) > 0 && (
              <ul aria-label={`${requirement.title} selected files`}>
                {files[requirement.kind]?.map((file, i) => (
                  <li key={`${file.name}-${i}`}>
                    <span>{file.name}</span>
                    <small>{(file.size / 1024).toFixed(0)} KB</small>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      <p className="buyer-kyb-help">
        Documents are used for OpenNEXT business verification. Closing this form discards
        unsubmitted files.
      </p>
    </section>
  );
}
