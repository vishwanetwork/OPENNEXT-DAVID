(() => {
  'use strict';
  const statuses = ['New', 'Contacted', 'Qualified', 'Closed'];
  const POLL_MS = 15000;
  const accessRequired = '<div class="on-leads-empty"><strong>Administrator access required</strong><p>Connect the server administrator session to view private contact details.</p><button class="btn primary" data-lead-action="login">Connect administrator session</button></div>';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[character]));
  const time = value => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString('en-GB', {
      day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit', timeZone:'UTC'
    }) : '—';
  };
  let root, controller, dialog, timer, pendingRefresh;
  let leads = [], query = '', filter = 'All requests';
  let generation = 0, revision = 0, authBlocked = false;

  function render() {
    return `<section class="on-leads"><div class="page-head"><div><h1>Contact requests</h1><p>Website enquiries, ready for a personal follow-up.</p></div><button class="btn" data-lead-action="refresh">Refresh</button></div><div class="on-leads-message" role="status" hidden></div><div class="on-leads-stats"></div><section class="panel"><div class="on-leads-toolbar"><label><span class="sr-only">Search contact requests</span><input type="search" data-lead-search maxlength="256" placeholder="Search name, company, email or request…" value="${esc(query)}"></label><label><span class="sr-only">Request status</span><select data-lead-filter>${['All requests', ...statuses].map(value => `<option ${value === filter ? 'selected' : ''}>${value}</option>`).join('')}</select></label></div><div class="on-leads-table"><p class="on-leads-empty">Loading contact requests…</p></div></section><p class="on-leads-footnote">Private customer data · Refreshes automatically while this page is open · Status changes do not send emails automatically.</p></section>`;
  }
  function session() { return {root, controller, generation}; }
  function active(current) {
    return current.generation === generation && current.root === root && Boolean(root?.isConnected) && !current.controller?.signal.aborted;
  }
  function notice(message, error = false) {
    if (!root?.isConnected) return;
    const box = root.querySelector('.on-leads-message');
    box.textContent = message;
    box.hidden = false;
    box.classList.toggle('is-error', error);
  }
  async function api(url, method = 'GET', body, current = session()) {
    const response = await fetch(url, {
      method, credentials:'same-origin', cache:'no-store', signal:current.controller?.signal,
      headers:body ? {'Content-Type':'application/json'} : {}, body:body ? JSON.stringify(body) : undefined
    });
    let data;
    try { data = await response.json(); }
    catch {
      const error = Error('Contact requests could not be loaded. Check the server connection.');
      error.status = response.status;
      throw error;
    }
    if (!response.ok) {
      const error = Error(data.error || 'The request failed.');
      error.status = response.status;
      throw error;
    }
    return data;
  }
  function update() {
    if (!root?.isConnected) return;
    root.querySelector('.on-leads-stats').innerHTML = statuses.map(status => `<div><span>${status}</span><strong>${leads.filter(lead => lead.status === status).length}</strong></div>`).join('');
    if (authBlocked) { root.querySelector('.on-leads-table').innerHTML = accessRequired; return; }
    const matches = leads.filter(lead => (filter === 'All requests' || lead.status === filter) && [lead.id, lead.name, lead.company, lead.title, lead.email, lead.message].join(' ').toLowerCase().includes(query.toLowerCase()));
    root.querySelector('.on-leads-table').innerHTML = matches.length ? `<table><thead><tr><th>Email</th><th>Company</th><th>Submitted time <small>UTC</small></th><th>Status</th><th><span class="sr-only">Request details</span></th></tr></thead><tbody>${matches.map(lead => {
      const status = statuses.includes(lead.status) ? lead.status : 'Unknown';
      return `<tr><td><strong class="on-lead-email">${esc(lead.email)}</strong><small>${esc(lead.name)}</small></td><td><strong>${esc(lead.company)}</strong><small>${esc(lead.title)}</small></td><td class="on-lead-submitted">${esc(time(lead.createdAt))}</td><td><span class="on-lead-status ${status.toLowerCase()}">${status}</span></td><td class="on-lead-action-cell"><button class="btn small" data-lead-action="details" data-id="${esc(lead.id)}" aria-label="View details for ${esc(lead.email)}">Detail</button></td></tr>`;
    }).join('')}</tbody></table>` : `<div class="on-leads-empty"><strong>${leads.length ? 'No matching requests' : 'No contact requests yet'}</strong><p>${leads.length ? 'Try a different search or status.' : 'Submissions from the website Contact us form will appear here.'}</p></div>`;
    // Refresh only the table and a passive conflict hint, never the editor fields.
    const form = dialog?.querySelector('[data-lead-form="update"]');
    if (form) {
      const latest = leads.find(lead => lead.id === form.dataset.id);
      const changed = form.querySelector('[data-lead-changed]');
      if (changed) changed.hidden = !latest || latest.updatedAt === form.dataset.version;
    }
  }
  function requireAccess(error) {
    authBlocked = true;
    leads = [];
    revision += 1;
    close();
    update();
    notice(error.message, true);
  }
  async function refresh({automatic = false} = {}) {
    if (!root?.isConnected || (automatic && (authBlocked || document.hidden))) return;
    if (pendingRefresh) return pendingRefresh.promise;
    const current = session(), startedRevision = revision;
    const pending = {promise:null};
    pendingRefresh = pending;
    pending.promise = (async () => {
      try {
        const data = await api('/api/admin/contacts', 'GET', undefined, current);
        if (!active(current) || startedRevision !== revision) return;
        if (!Array.isArray(data.leads)) throw Error('The server returned an invalid contact request list. Please refresh.');
        leads = data.leads;
        authBlocked = false;
        const message = root.querySelector('.on-leads-message');
        if (message.classList.contains('is-error')) message.hidden = true;
        update();
      } catch (error) {
        if (error.name === 'AbortError' || !active(current)) return;
        if (error.status === 401 || error.status === 403) requireAccess(error);
        else notice(error.message, true);
      } finally {
        if (pendingRefresh === pending) pendingRefresh = null;
      }
    })();
    return pending.promise;
  }
  function close() {
    const current = dialog;
    dialog = null;
    current?.close();
    current?.remove();
  }
  function modal(title, content) {
    close();
    const current = document.createElement('dialog');
    dialog = current;
    current.className = 'on-lead-dialog';
    current.setAttribute('aria-labelledby', 'on-lead-heading');
    current.innerHTML = `<header><h2 id="on-lead-heading">${esc(title)}</h2><button class="btn" data-lead-action="close" aria-label="Close request details">×</button></header>${content}`;
    document.body.append(current);
    current.showModal();
    current.addEventListener('click', event => { event.stopPropagation(); click(event); });
    current.addEventListener('submit', submit);
    current.addEventListener('keydown', event => { if (event.key === 'Escape') event.stopPropagation(); });
    current.addEventListener('close', () => { current.remove(); if (dialog === current) dialog = null; });
  }
  function details(id) {
    const lead = leads.find(item => item.id === id);
    if (!lead) return;
    modal(lead.id, `<div class="on-lead-detail-grid">${[['Name', lead.name], ['Title', lead.title], ['Email', lead.email], ['Company', lead.company], ['Submitted time · UTC', time(lead.createdAt)], ['Source', lead.source]].map(([label, value]) => `<div><small>${label}</small><strong>${esc(value)}</strong></div>`).join('')}</div><h3>How can we help?</h3><div class="on-lead-message">${esc(lead.message)}</div><form data-lead-form="update" data-id="${esc(lead.id)}" data-version="${esc(lead.updatedAt)}"><p class="on-lead-changed" data-lead-changed role="status" hidden>This request was updated elsewhere. Your draft has been preserved. Copy any notes before reopening the latest version.</p><div class="on-lead-form-row"><label>Status<select name="status">${statuses.map(status => `<option ${lead.status === status ? 'selected' : ''}>${status}</option>`).join('')}</select></label><label>Internal note <span>(optional)</span><textarea name="note" rows="3" maxlength="2000" placeholder="Next step, assigned owner or follow-up context"></textarea></label></div><p class="on-lead-form-error" role="alert" hidden></p><button class="btn primary" type="submit">Save update</button></form><h3>Request history</h3><ol class="on-lead-history">${(Array.isArray(lead.history) ? lead.history : []).map(item => `<li><strong>${esc(item.status)}</strong><time>${esc(time(item.at))} UTC</time>${item.note ? `<p>${esc(item.note)}</p>` : ''}</li>`).join('')}</ol>`);
  }
  function click(event) {
    const button = event.target.closest('[data-lead-action]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const action = button.dataset.leadAction;
    if (action === 'refresh') refresh();
    if (action === 'details') details(button.dataset.id);
    if (action === 'close') close();
    if (action === 'login') modal('Administrator session', '<form data-lead-form="login"><p>Use your OpenNEXT server administrator token. It is exchanged for a short-lived, HTTP-only session.</p><label>Administrator token<input name="token" type="password" autocomplete="new-password" required></label><p class="on-lead-form-error" role="alert" hidden></p><button class="btn primary">Connect</button></form>');
  }
  async function submit(event) {
    event.preventDefault();
    event.stopPropagation();
    const form = event.target, currentDialog = dialog, current = session();
    const button = form.querySelector('button[type="submit"],button:not([type])');
    const errorBox = form.querySelector('.on-lead-form-error');
    if (!button || button.disabled || !active(current) || !form.isConnected) return;
    button.disabled = true;
    errorBox.hidden = true;
    try {
      const data = new FormData(form);
      if (form.dataset.leadForm === 'login') {
        const token = String(data.get('token'));
        form.querySelector('[name="token"]').value = '';
        await api('/api/admin/pricing/session', 'POST', {token}, current);
        if (!active(current) || dialog !== currentDialog) return;
        authBlocked = false;
        close();
        await pendingRefresh?.promise;
        if (active(current)) await refresh();
        return;
      }
      // Preserve the version the operator actually reviewed, even after polling.
      const id = form.dataset.id;
      const result = await api('/api/admin/contacts/' + encodeURIComponent(id), 'PATCH', {
        status:String(data.get('status')), note:String(data.get('note')), updatedAt:form.dataset.version
      }, current);
      if (!active(current)) return;
      revision += 1;
      if (result.lead?.id === id) leads = leads.map(lead => lead.id === id ? result.lead : lead);
      update();
      if (dialog === currentDialog && form.isConnected) details(id);
      notice('Request status saved. No email has been sent.');
      await pendingRefresh?.promise;
      if (active(current)) await refresh();
    } catch (error) {
      if (error.name === 'AbortError' || !active(current)) return;
      if (error.status === 401 || error.status === 403) { requireAccess(error); return; }
      if (dialog === currentDialog && form.isConnected) {
        errorBox.textContent = error.status === 409 ? 'This request has changed. Your draft has been preserved. Copy any notes, close the details, and reopen the latest version before saving.' : error.message;
        errorBox.hidden = false;
      }
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  }
  function automaticRefresh() { refresh({automatic:true}); }
  function destroy() {
    generation += 1;
    controller?.abort();
    controller = null;
    clearInterval(timer);
    timer = null;
    window.removeEventListener('focus', automaticRefresh);
    document.removeEventListener('visibilitychange', automaticRefresh);
    close();
    root = null;
    leads = [];
    pendingRefresh = null;
    authBlocked = false;
  }
  function mount() {
    destroy();
    root = document.querySelector('.on-leads');
    if (!root) return;
    controller = new AbortController();
    root.addEventListener('click', click);
    root.querySelector('[data-lead-search]').addEventListener('input', event => { query = event.target.value; update(); });
    root.querySelector('[data-lead-filter]').addEventListener('change', event => { filter = event.target.value; update(); });
    window.addEventListener('focus', automaticRefresh);
    document.addEventListener('visibilitychange', automaticRefresh);
    timer = setInterval(automaticRefresh, POLL_MS);
    refresh();
  }
  window.OpenNEXTConsoleLeads = {render, mount, destroy, refresh};
})();
