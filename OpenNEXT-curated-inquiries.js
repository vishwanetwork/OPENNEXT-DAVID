(() => {
  'use strict';
  let active = null;
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const text = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';

  function requirementRows(item) {
    const fallback = [
      {label:'Location', value:item.region},
      {label:'Hardware', value:Array.isArray(item.modelOptions) ? item.modelOptions.join(' / ') : item.model},
      {label:'Quantity', value:item.quantityLabel},
      {label:'Rental term', value:item.termLabel},
      {label:'Deployment', value:item.deliveryLabel},
      {label:'Payment', value:item.paymentTerms}
    ];
    const rows = Array.isArray(item.specifications) && item.specifications.length ? item.specifications : fallback;
    const seen = new Set();
    return rows.filter(row => {
      if (!row || !text(row.label) || !text(row.value)) return false;
      const key = `${text(row.label).toLowerCase()}\n${text(row.value).toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(row => ({label:text(row.label), value:text(row.value)}));
  }

  function valid(item) {
    return !!item && !!text(item.id) && !!text(item.title) && item.sourceKind === 'customer_requirement';
  }

  function messageFor(item) {
    return [
      `I would like to offer capacity for RFQ ${text(item.id)}.`,
      '',
      text(item.title),
      text(item.description),
      ...requirementRows(item).map(row => `${row.label}: ${row.value}`),
      '',
      'My available capacity, delivery date and proposed commercial terms:',
      ''
    ].filter((value, index, all) => value || index === 1 || index === all.length - 3 || index === all.length - 1).join('\n');
  }

  function cleanup(entry) {
    if (!entry || entry.cleaned) return;
    entry.cleaned = true;
    entry.dialog.remove();
    document.body.style.overflow = entry.bodyOverflow;
    if (active === entry) active = null;
    if (entry.trigger?.isConnected) entry.trigger.focus();
  }

  function closeCurrent() {
    const entry = active;
    if (!entry) return;
    if (entry.dialog.open) entry.dialog.close();
    cleanup(entry);
  }

  function offer(item) {
    if (!valid(item)) return false;
    if (typeof window.OpenNEXTContact?.open !== 'function') {
      if (active) {
        const notice = active.dialog.querySelector('[data-curated-error]');
        notice.hidden = false;
        notice.textContent = 'The inquiry form is unavailable. Please refresh the page and try again.';
      }
      return false;
    }
    closeCurrent();
    window.OpenNEXTContact.open({message:messageFor(item)});
    return true;
  }

  function showDetails(item) {
    if (!valid(item)) return false;
    closeCurrent();
    const dialog = document.createElement('dialog');
    const entry = {dialog, trigger:document.activeElement, bodyOverflow:document.body.style.overflow, cleaned:false};
    active = entry;
    dialog.className = 'on-curated-dialog';
    dialog.setAttribute('aria-labelledby', 'on-curated-heading');
    dialog.setAttribute('aria-describedby', 'on-curated-intro');
    dialog.innerHTML = `<header><div><span class="on-curated-eyebrow">Buyer RFQ <span>${escapeHtml(item.id)}</span></span><h2 id="on-curated-heading">${escapeHtml(item.title)}</h2><p id="on-curated-intro">${escapeHtml(item.description || 'Review the requirements and share your available capacity with the OpenNEXT team.')}</p></div><button type="button" class="on-curated-close" aria-label="Close RFQ details">×</button></header><dl class="on-curated-specs">${requirementRows(item).map(row => `<div><dt>${escapeHtml(row.label)}</dt><dd>${escapeHtml(row.value)}</dd></div>`).join('')}</dl><p class="on-curated-notice">Submit your proposed capacity and terms. OpenNEXT will review your response and coordinate the next steps. Availability and final pricing are confirmed by quote.</p><p class="on-curated-error" data-curated-error role="alert" hidden></p><footer><button type="button" class="on-curated-back">Close</button><button type="button" class="on-curated-offer">Offer capacity <span aria-hidden="true">↗</span></button></footer>`;
    document.body.append(dialog);
    document.body.style.overflow = 'hidden';
    dialog.addEventListener('close', () => cleanup(entry));
    dialog.addEventListener('cancel', event => {event.preventDefault(); event.stopPropagation(); closeCurrent();});
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); closeCurrent();}
    });
    dialog.addEventListener('click', event => {
      event.stopPropagation();
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeCurrent();
    });
    dialog.querySelector('.on-curated-close').addEventListener('click', closeCurrent);
    dialog.querySelector('.on-curated-back').addEventListener('click', closeCurrent);
    dialog.querySelector('.on-curated-offer').addEventListener('click', () => offer(item));
    dialog.showModal();
    dialog.querySelector('.on-curated-close').focus();
    return true;
  }

  window.OpenNEXTCuratedInquiries = {showDetails, offer};
})();
