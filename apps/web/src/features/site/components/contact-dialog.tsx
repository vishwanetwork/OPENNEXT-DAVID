'use client';

import { useState, type FormEvent } from 'react';
import { NativeDialog } from '@/components/ui/dialog';
import { useApi } from '@/components/providers/api-context';
import { ApiError } from '@/lib/api/client';
import { submitContact } from '../api';

export interface ContactDialogProps {
  message?: string;
  onClose: () => void;
}

/** Contact Us form (legacy OpenNEXT-contact.js): `POST /api/contact` with an idempotent submission id. */
export function ContactDialog({ message = '', onClose }: ContactDialogProps) {
  const api = useApi();
  const [submissionId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();
    const form = event.currentTarget;
    if (busy || !form.reportValidity()) return;
    setError('');
    setBusy(true);
    const fields = Object.fromEntries(new FormData(form)) as Record<string, string>;
    try {
      const result = await submitContact(api, {
        name: fields.name,
        company: fields.company,
        title: fields.title,
        email: fields.email,
        message: fields.message,
        website: fields.website,
        submissionId,
      });
      if (!result.id) throw new Error('Your request was not saved. Please try again.');
      setSubmittedEmail(fields.email);
    } catch (failure) {
      const apiError = failure instanceof ApiError ? failure : null;
      setError(
        apiError && apiError.status === 0 && apiError.message === 'The request timed out.'
          ? 'The request timed out. You can safely retry without creating a duplicate request.'
          : apiError?.status === 0 && !apiError.payload
            ? 'The contact service is unavailable. Please try again.'
            : (failure as Error).message || 'Your request was not saved. Please try again.',
      );
      setBusy(false);
    }
  }

  return (
    <NativeDialog
      className={`on-contact-dialog${submittedEmail ? ' is-submitted' : ''}`}
      labelledBy={submittedEmail ? 'on-contact-success-heading' : 'on-contact-heading'}
      describedBy={submittedEmail ? undefined : 'on-contact-intro'}
      onClose={onClose}
      initialFocus="input"
    >
      <header>
        {submittedEmail ? null : (
          <div>
            <h2 id="on-contact-heading">Let&apos;s talk capacity.</h2>
            <p id="on-contact-intro">
              Tell us what you need. Our team will help you find the right next step.
            </p>
          </div>
        )}
        <button
          type="button"
          className="on-contact-close"
          aria-label="Close contact form"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <form className="on-contact-form" onSubmit={onSubmit}>
        {submittedEmail ? (
          <div className="on-contact-success" role="status">
            <span aria-hidden="true">✓</span>
            <h3 id="on-contact-success-heading">Thank you for reaching us.</h3>
            <p>
              Your request has been received. Our team will follow up at{' '}
              <strong>{submittedEmail}</strong>.
            </p>
            <button type="button" className="on-contact-submit" autoFocus onClick={onClose}>
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="on-contact-grid">
              <label>
                Name
                <input
                  name="name"
                  autoComplete="name"
                  required
                  maxLength={100}
                  placeholder="Your name"
                />
              </label>
              <label>
                Company
                <input
                  name="company"
                  autoComplete="organization"
                  required
                  maxLength={160}
                  placeholder="Company name"
                />
              </label>
              <label>
                Title
                <input
                  name="title"
                  autoComplete="organization-title"
                  required
                  maxLength={100}
                  placeholder="Your role"
                />
              </label>
              <label>
                Email
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                  placeholder="you@company.com"
                />
              </label>
            </div>
            <label>
              How can we help?
              <textarea
                name="message"
                required
                maxLength={4000}
                rows={5}
                placeholder="Share your resource needs, timeline, or partnership ideas."
                defaultValue={message.slice(0, 4000)}
              />
            </label>
            <div className="on-contact-honey" aria-hidden="true">
              <label>
                Website
                <input name="website" tabIndex={-1} autoComplete="off" />
              </label>
            </div>
            <p className="on-contact-notice">
              Your details will be used by OpenNEXT to respond to this request. Please do not
              include passwords, API keys or payment details.
            </p>
            <p className="on-contact-error" role="alert" hidden={!error}>
              {error}
            </p>
            <footer>
              <button type="submit" className="on-contact-submit" disabled={busy}>
                {busy ? (
                  'Submitting…'
                ) : (
                  <>
                    Submit request <span aria-hidden="true">↗</span>
                  </>
                )}
              </button>
            </footer>
          </>
        )}
      </form>
    </NativeDialog>
  );
}
