(() => {
  'use strict';
  let dialog = null;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  function open(options={}) {
    if (dialog?.open) {dialog.focus(); return;}
    const trigger = document.activeElement;
    const current = document.createElement('dialog'); dialog = current;
    current.className = 'on-contact-dialog';
    current.setAttribute('aria-labelledby', 'on-contact-heading');
    current.setAttribute('aria-describedby', 'on-contact-intro');
    current.innerHTML = `<header><div><h2 id="on-contact-heading">Let's talk capacity.</h2><p id="on-contact-intro">Tell us what you need. Our team will help you find the right next step.</p></div><button type="button" class="on-contact-close" aria-label="Close contact form">×</button></header><form class="on-contact-form"><div class="on-contact-grid"><label>Name<input name="name" autocomplete="name" required maxlength="100" placeholder="Your name"></label><label>Company<input name="company" autocomplete="organization" required maxlength="160" placeholder="Company name"></label><label>Title<input name="title" autocomplete="organization-title" required maxlength="100" placeholder="Your role"></label><label>Email<input name="email" type="email" autocomplete="email" required maxlength="254" placeholder="you@company.com"></label></div><label>How can we help?<textarea name="message" required maxlength="4000" rows="5" placeholder="Share your resource needs, timeline, or partnership ideas."></textarea></label><div class="on-contact-honey" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div><p class="on-contact-notice">Your details will be used by OpenNEXT to respond to this request. Please do not include passwords, API keys or payment details.</p><p class="on-contact-error" role="alert" hidden></p><footer><button type="submit" class="on-contact-submit">Submit request <span aria-hidden="true">↗</span></button></footer></form>`;
    if(typeof options.message==='string')current.querySelector('[name="message"]').value=options.message.slice(0,4000);
    document.body.append(current);
    current.showModal();
    current.querySelector('input').focus();
    current.querySelector('.on-contact-close').addEventListener('click', () => current.close());
    current.addEventListener('keydown', event => {if (event.key === 'Escape') event.stopPropagation();});
    current.addEventListener('click', event => {event.stopPropagation(); if (event.target === current) {const box = current.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) current.close();}});
    current.addEventListener('close', () => {current.remove(); if (dialog === current) dialog = null; if (trigger?.isConnected) trigger.focus();});
    const submissionId = crypto.randomUUID();
    current.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault(); event.stopPropagation();
      const form = event.currentTarget, button = form.querySelector('[type="submit"]'), error = form.querySelector('.on-contact-error');
      if (button.disabled || !form.reportValidity()) return;
      error.hidden = true; button.disabled = true; button.textContent = 'Submitting…';
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const fields = Object.fromEntries(new FormData(form));
        const response = await fetch('/api/contact', {method:'POST', headers:{'Content-Type':'application/json'}, credentials:'same-origin', body:JSON.stringify({...fields, submissionId}), signal:controller.signal});
        let result; try {result = await response.json();} catch {throw Error('The contact service is unavailable. Please try again.');}
        if (!response.ok || !result.id) throw Error(result.error || 'Your request was not saved. Please try again.');
        if (!current.isConnected) return;
        current.querySelector('header > div').remove();
        current.classList.add('is-submitted');
        current.setAttribute('aria-labelledby', 'on-contact-success-heading');
        current.removeAttribute('aria-describedby');
        form.innerHTML = `<div class="on-contact-success" role="status"><span aria-hidden="true">✓</span><h3 id="on-contact-success-heading">Thank you for reaching us.</h3><p>Your request has been received. Our team will follow up at <strong>${esc(fields.email)}</strong>.</p><button type="button" class="on-contact-submit">Done</button></div>`;
        form.querySelector('button').addEventListener('click', () => current.close()); form.querySelector('button').focus();
      } catch (failure) {
        if (!current.isConnected) return;
        error.textContent = failure.name === 'AbortError' ? 'The request timed out. You can safely retry without creating a duplicate request.' : failure.message;
        error.hidden = false; button.disabled = false; button.textContent = 'Submit request ↗';
      } finally {clearTimeout(timeout);}
    });
  }
  window.OpenNEXTContact = {open};
})();
