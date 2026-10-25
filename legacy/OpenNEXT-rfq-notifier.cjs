'use strict';

const {createSmtpMailer, parseAddresses} = require('./OpenNEXT-mailer.cjs');
const KIND = {gpu_rental: 'GPU rental', model_capacity: 'Model capacity', physical_gpu: 'Physical GPU'};

/* Emails the operations team when a buyer submits or resubmits an RFQ for review.
 * Delivery runs in the background after the RFQ is saved: the buyer's request never waits on
 * SMTP and a mail failure never fails the submission. Failed sends retry with backoff; the
 * queue is in memory, so a restart drops pending notifications (the RFQ itself is durable).
 */
function rfqEmail(rfq, {resubmitted = false, adminUrl}) {
  const line = (label, value) => value === undefined || value === null || value === '' ? null : label + ': ' + value;
  const subject = `[OpenNEXT] ${resubmitted ? 'RFQ updated' : 'New RFQ'} for review: ${String(rfq.title || '').slice(0, 100)} (${rfq.id})`;
  const quantity = rfq.kind === 'model_capacity'
    ? [line('Input tokens (M)', rfq.inputMillion), line('Output tokens (M)', rfq.outputMillion), line('Days', rfq.days), line('TPS', rfq.tps)]
    : [line('GPU count', rfq.count), line('Hours', rfq.hours || null), line('Term', rfq.term)];
  const text = [
    `${resubmitted ? 'A buyer updated an RFQ' : 'A buyer submitted a new RFQ'}. It is waiting for operations review before suppliers can respond.`,
    '',
    line('RFQ', rfq.id),
    line('Title', rfq.title),
    line('Type', KIND[rfq.kind] || rfq.kind),
    line('Model', rfq.model),
    line('Region', rfq.region),
    ...quantity,
    line('Budget', rfq.budget),
    line('Service start', rfq.start),
    line('Quote deadline', rfq.quoteDeadline),
    line('Urgency', rfq.urgency),
    line('Visibility', rfq.visibility),
    line('Project', rfq.project),
    '',
    line('Buyer', [rfq.ownerName, rfq.ownerEmail && '<' + rfq.ownerEmail + '>'].filter(Boolean).join(' ')),
    line('Submitted', rfq.reviewSubmittedAt),
    '',
    'Notes:',
    String(rfq.notes || '').slice(0, 4000),
    '',
    line('Review in the Operations Console', adminUrl),
  ].filter(item => item !== null).join('\n');
  return {subject, text};
}

function createRfqNotifier({env = process.env, mailer = createSmtpMailer({env}), retryDelays = [30000, 120000, 600000], logger = console} = {}) {
  const to = parseAddresses(env.OPENNEXT_RFQ_NOTIFY_TO);
  const adminUrl = String(env.OPENNEXT_ADMIN_URL || 'https://admin.opennextlab.ai/');
  const enabled = Boolean(mailer.configured && to.length);
  const timers = new Set();
  let chain = Promise.resolve();

  function deliver(job, attempt) {
    chain = chain.then(() => mailer.send(job)).then(() => {}, error => {
      const delay = retryDelays[attempt];
      if (delay === undefined) {logger.error(`RFQ notification for ${job.rfqId} failed after ${attempt + 1} attempts: ${error.message}`); return;}
      logger.warn(`RFQ notification for ${job.rfqId} failed (${error.message}); retrying in ${Math.round(delay / 1000)}s.`);
      const timer = setTimeout(() => {timers.delete(timer); deliver(job, attempt + 1);}, delay);
      timer.unref?.(); timers.add(timer);
    });
  }
  function rfqSubmitted(rfq, options = {}) {
    if (!enabled || !rfq?.id) return;
    const {subject, text} = rfqEmail(rfq, {...options, adminUrl});
    deliver({rfqId: rfq.id, to, subject, text, replyTo: rfq.ownerEmail || undefined}, 0);
  }
  return {enabled, rfqSubmitted, idle: () => chain, close() {for (const timer of timers) clearTimeout(timer); timers.clear();}};
}

module.exports = {createRfqNotifier, rfqEmail};
