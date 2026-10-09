import { createClient } from './client.mjs';
import { createLabelPhoto } from './label-photo.mjs';
import { recall } from '../src/engine.mjs';

const $ = (selector) => document.querySelector(selector);
const escaper = document.createElement('span');
const text = (value = '') => {
  escaper.textContent = String(value ?? '');
  return escaper.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
};
const url = (value) => {
  try {
    const parsed = new URL(value);
    return /^https?:$/.test(parsed.protocol) ? parsed.href : '';
  } catch { return ''; }
};
const formatDate = (value, withTime = false) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Date to be chosen';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', ...(withTime ? { hour: 'numeric', minute: '2-digit' } : { year: 'numeric' }),
  }).format(date);
};
const UI_STORAGE = 'recall-relay:handoff:v1';
const FOCUS_STORAGE = 'recall-relay:focus:v1';
const PUBLIC_HANDOFF_URL = 'https://blucca.github.io/recall-relay/';
const labelPhoto = createLabelPhoto();
const retiredCases = new Set();
const ui = {
  intent: 'pass', busy: false, paused: false, case: null, claimPacket: null,
  handoff: null, incoming: null, recipient: 'Alex', lastMessage: '',
  focus: false, syncStatus: 'connecting', change: null, pendingSnapshot: null,
};
let client;
let stopWatching;

function rememberHandoff(packet) {
  ui.handoff = packet;
  try {
    if (packet) localStorage.setItem(UI_STORAGE, JSON.stringify(packet));
    else localStorage.removeItem(UI_STORAGE);
  } catch { /* The current tab retains the portable card. */ }
}

function encodeHandoff(packet) {
  const bytes = new TextEncoder().encode(JSON.stringify(packet));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeHandoff(encoded) {
  if (encoded.length > 16000) throw new Error('Use a compact Recall Relay handoff link.');
  const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
  const packet = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0))));
  if (!packet || packet.kind !== 'recall-relay-handoff' || typeof packet.senderLabel !== 'string') {
    throw new Error('Open a Recall Relay handoff card exported from this case.');
  }
  return packet;
}

function handoffLink(packet = ui.handoff) {
  const loopback = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const link = new URL(loopback ? PUBLIC_HANDOFF_URL : location.href);
  link.searchParams.delete('view');
  link.hash = `handoff=${encodeHandoff(packet)}`;
  return link.href;
}

function clearIncomingLink() {
  if (location.hash.startsWith('#handoff=')) history.replaceState(null, '', `${location.pathname}${location.search}`);
  ui.incoming = null;
}

function banner(message, error = false) {
  const element = $('#message-banner');
  element.textContent = message;
  element.hidden = !message;
  element.classList.toggle('is-error', error);
  element.setAttribute('role', error ? 'alert' : 'status');
  $('#screen-reader-status').textContent = message;
}

function setBusy(busy) {
  ui.busy = busy;
  document.body.classList.toggle('is-busy', busy);
  $('#workspace').setAttribute('aria-busy', String(busy));
  document.querySelectorAll('button').forEach((button) => {
    if (button.closest('#import-dialog') && button.classList.contains('dialog-close')) return;
    button.disabled = busy;
  });
  if (!busy) {
    const checkbox = $('#label-confirmation');
    const submit = $('#label-submit');
    if (checkbox && submit) submit.disabled = !checkbox.checked;
  }
}

function updateMode() {
  const live = /mcp|live|server/i.test(client?.mode ?? '');
  const connection = live ? (ui.syncStatus === 'connected' ? 'MCP · live case' : ui.syncStatus === 'reconnecting' ? 'MCP · reconnecting' : 'MCP · connecting') : 'Browser-local · saved';
  $('#connection-status').innerHTML = `<span class="status-dot"></span>${connection}`;
  $('#connection-status').classList.toggle('is-reconnecting', live && ui.syncStatus === 'reconnecting');
  $('#voice-caption').textContent = live
    ? 'Your connected MCP assistant updates this case live. The phrases below are the typed conversation simulator.'
    : 'Try a suggested phrase, or use the next-step button. Typed phrases simulate the Alexa+ conversation.';
  $('#live-update').hidden = !live;
  $('#live-update').textContent = live
    ? ui.syncStatus === 'reconnecting' ? 'Reconnecting the live screen. Your saved case stays on the server.'
      : ui.change ? `MCP update · ${ui.change.tool} · ${formatDate(ui.change.at, true)}` : 'One saved case, shared by your assistant and this screen.'
    : '';
  $('#storage-note').textContent = live
    ? 'Household state is saved by the local MCP server. Photos and official form details stay with you.'
    : 'Household state is saved in this browser. Photos and official form details stay with you.';
}

function absorbResult(result) {
  const c = result.case;
  if (c && ui.case?.id !== c.id) {
    if (ui.case) retiredCases.add(ui.case.id);
    ui.claimPacket = null;
    ui.paused = false;
    ui.change = null;
    labelPhoto.clear();
  }
  if (c) {
    ui.case = c;
    ui.lastMessage = '';
    $('#spoken-reply').hidden = true;
    if (ui.incoming?.id === c.receivedHandoffId) clearIncomingLink();
    if (c.stage !== 'handoff_prepared') rememberHandoff(null);
  }
  if (result.handoff) {
    rememberHandoff(typeof result.handoff === 'string' ? JSON.parse(result.handoff) : result.handoff);
    ui.recipient = ui.handoff.recipientLabel || ui.recipient;
  }
  if (result.claimPacket) ui.claimPacket = result.claimPacket;
  if (c?.stage === 'handoff_prepared' && c.nextAction?.args?.handoff) {
    rememberHandoff(c.nextAction.args.handoff);
    ui.recipient = ui.handoff.recipientLabel || ui.recipient;
  }
  if (result.change) ui.change = result.change;
}

function receiveSnapshot(result) {
  const c = result?.case;
  if (!c || retiredCases.has(c.id)) return;
  if (ui.case?.id === c.id && ui.case.revision >= c.revision) {
    if (ui.case.revision === c.revision && result.change) { ui.change = result.change; updateMode(); }
    return;
  }
  if (ui.busy) { ui.pendingSnapshot = result; return; }
  const preserveInputs = ui.case?.id === c.id && ui.case.stage === c.stage;
  absorbResult(result);
  updateMode();
  render({ preserveInputs });
  $('#screen-reader-status').textContent = currentSpokenStep();
}

async function invoke(name, args = {}, { quiet = false } = {}) {
  const mutation = name !== 'get_case';
  const payload = mutation ? {
    ...args,
    requestId: globalThis.crypto?.randomUUID?.() ?? `ui-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    ...(Number.isInteger(ui.case?.revision) ? { expectedRevision: ui.case.revision } : {}),
  } : args;
  const result = await client.callTool(name, payload);
  absorbResult(result);
  updateMode();
  render();
  if (!result.ok) {
    const failure = new Error(result.error?.message || 'Refresh the case and try this step again.');
    failure.code = result.error?.code;
    throw failure;
  }
  if (!quiet) banner('');
  return result;
}

async function act(action) {
  if (ui.busy) return;
  if (!client || !ui.case) { banner('Refresh this page to reconnect the saved case.', true); return; }
  banner('');
  setBusy(true);
  try { await action(); }
  catch (error) { banner(error.message || 'Refresh the case and try again.', true); }
  finally {
    setBusy(false);
    const pending = ui.pendingSnapshot;
    ui.pendingSnapshot = null;
    if (pending) receiveSnapshot(pending);
  }
}

const stageIndex = {
  identify_product: 0, handoff_prepared: 0, confirm_current_owner: 1,
  remedy_required: 2, claim_ready: 2, awaiting_replacement: 2,
  replacement_arrived: 3, resolved: 3,
};

function renderJourney(c) {
  const current = ui.incoming ? 0 : stageIndex[c.stage] ?? 0;
  $('#journey').innerHTML = ['Reach owner', 'Check label', 'Get the lid', 'Finish'].map((label, index) => {
    const done = index < current || c.stage === 'resolved';
    return `<li class="${done ? 'done' : index === current ? 'current' : ''}" ${index === current ? 'aria-current="step"' : ''}><span class="journey-number">${done ? '✓' : index + 1}</span><span>${label}</span></li>`;
  }).join('');
}

function renderSidebar(c) {
  const incoming = ui.incoming;
  const owner = incoming ? incoming.senderLabel : c.owner;
  const model = incoming?.product?.reportedModel || c.rawModel || 'OP301 I07';
  $('#owner-name').textContent = owner;
  $('#owner-avatar').textContent = [...String(owner)][0]?.toUpperCase() || '•';
  $('#model-value').textContent = model;
  $('.label-strip > span').textContent = incoming ? 'Passed-on note' : c.model ? 'Label checked' : c.rawModel ? 'Model note' : 'Sample model';
  $('.owner-strip .small-label').textContent = incoming ? 'Passed on by' : 'Case kept by';
  const identity = c.facts?.find((fact) => /identity/i.test(fact.label));
  $('#label-provenance').textContent = incoming
    ? `${incoming.recipientLabel || 'The current owner'} checks the physical label next.`
    : c.rawModel ? identity?.text || 'The current owner checks the physical label.' : 'Sample transcription · the current owner verifies the label.';
  const verified = Boolean(c.model) && !incoming && c.stage !== 'handoff_prepared';
  const facts = (c.facts || []).filter((fact) => !/identity/i.test(fact.label) && (verified || !/function/i.test(fact.label)));
  $('#official-facts').innerHTML = facts.map((fact) => `<div class="fact"><span class="fact-label">${text(fact.label)}</span><p>${text(fact.text)}</p>${url(fact.sourceUrl) ? `<a href="${text(url(fact.sourceUrl))}" target="_blank" rel="noopener noreferrer">Official source ↗</a>` : ''}</div>`).join('');
  if (c.sourceRetrievedAt) $('#official-facts').insertAdjacentHTML('beforeend', `<p class="provenance-line">US listed models · source checked ${text(formatDate(c.sourceRetrievedAt))}</p>`);
  const sourceLink = $('#source-link');
  sourceLink.href = url(c.sourceUrl);
  sourceLink.hidden = !url(c.sourceUrl);
  const events = c.events || [];
  $('#event-count').textContent = events.length ? `· ${events.length} recorded` : '· fresh case';
  $('#event-list').innerHTML = [...events].reverse().map((event) => `<li>${text(event.label)}<time datetime="${text(event.at)}">${text(formatDate(event.at, true))}</time><span class="event-provenance">${text(event.actor)} · ${text(event.provenance)}</span></li>`).join('');
}

function photoPicker() {
  const photo = labelPhoto.current;
  return `<div class="label-photo"><input id="label-photo-input" class="sr-only" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" aria-label="Take or choose a photo of the product label" />${photo
    ? `<a class="label-photo-preview" href="${text(photo.url)}" target="_blank" rel="noopener"><img src="${text(photo.url)}" alt="Your selected product label. Open the image to zoom in and read the model." /><span>Open photo to zoom ↗</span></a><div class="photo-tools"><a class="text-link" href="${text(photo.url)}" download="${text(photo.name)}">Save photo for the official form ↓</a><button class="text-link" type="button" data-action="choose-photo">Choose another</button><button class="text-link" type="button" data-action="clear-photo">Clear</button></div>`
    : '<button class="secondary-button photo-button" type="button" data-action="choose-photo"><span aria-hidden="true">▣</span> Take or choose a label photo</button>'}<p class="field-help">Optional photo, viewed on this device. Read the printed model yourself. Keep the original image for the official form.</p></div>`;
}

function labelForm(c) {
  return `<form data-form="label">
    ${photoPicker()}
    <label for="model-input">Model exactly as printed on your cooker</label>
    <input id="model-input" name="model" value="${text(c.rawModel || 'OP301 I07')}" maxlength="100" autocomplete="off" spellcheck="false" required />
    <p class="field-help">Example: OP301 I07. Keep letters within the model and leave a space before an additional code.</p>
    <label class="checkbox-label" for="label-confirmation"><input id="label-confirmation" type="checkbox" name="confirmed" required /><span>I read this on the physical label of the cooker I have now.</span></label>
    <button id="label-submit" class="primary-button" type="submit" disabled>Check this model <span aria-hidden="true">→</span></button>
  </form>`;
}

function handoffForm(c) {
  return `<form data-form="handoff">
    <div class="field-row"><div><label for="remembered-model">The model you remember</label><input id="remembered-model" name="model" value="${text(c.rawModel || 'OP301 I07')}" maxlength="100" autocomplete="off" spellcheck="false" required /></div><div><label for="recipient-name">Who has it now?</label><input id="recipient-name" name="recipient" value="${text(ui.recipient)}" maxlength="80" autocomplete="given-name" required /></div></div>
    <p class="field-help">A starting note from you. The current owner will verify their own label.</p>
    <button class="primary-button" type="submit">Make a recall handoff <span aria-hidden="true">→</span></button>
    <p class="privacy-note"><span aria-hidden="true">↗</span> One link carries the official recall and the next step to the person who has the cooker.</p>
  </form>`;
}

function renderIdentify(c) {
  if (ui.intent === 'self' || c.priorOwner) {
    return `<p class="eyebrow">02 / The cooker in your hands</p><h2>Start with the label.</h2><p class="body-copy">One exact model. A clear next step. Find the model on the label on the back or side of your cooker.</p>${c.rawModel ? `<p class="inherited-note">${text(c.facts?.find((fact) => /identity/i.test(fact.label))?.text || '')}</p>` : ''}${labelForm(c)}${c.priorOwner ? '' : '<div class="button-row"><button class="text-link" type="button" data-action="intent-pass">Passed it on? Make a handoff →</button></div>'}`;
  }
  return `<p class="eyebrow">01 / A little care, passed along</p><h2>You passed on the cooker.<br />Pass on the next step.</h2><p class="body-copy">The Foodi’s pressure-cooking lid has a recall. Help the person who has it now get the free replacement.</p><div class="choice-tabs" aria-label="Where is your cooker?"><button type="button" data-action="intent-pass" aria-pressed="true">I passed it on</button><button type="button" data-action="intent-self" aria-pressed="false">It’s with me</button></div>${handoffForm(c)}`;
}

function renderIncoming(packet) {
  return `<p class="eyebrow">A recall card, from someone you know</p><h2>${text(packet.senderLabel)} passed you<br />a useful next step.</h2><p class="body-copy">The Foodi you received may need a replacement pressure-cooking lid. Check the label on your own cooker to continue.</p><div class="handoff-summary"><span class="handoff-symbol" aria-hidden="true">↗</span><div><strong>Ninja Foodi · ${text(packet.product?.reportedModel || 'Label to check')}</strong><p>Shared model note · official US recall 25-247</p></div></div><form data-form="accept-link"><label for="incoming-owner">Your first name</label><input id="incoming-owner" name="owner" value="${text(packet.recipientLabel || 'Alex')}" maxlength="80" autocomplete="given-name" required /><button class="primary-button" type="submit">This is my cooker <span aria-hidden="true">→</span></button></form><p class="privacy-note"><span aria-hidden="true">✓</span> You start your own case. The previous owner’s private journal stays with their record.</p>`;
}

function renderHandoff(c) {
  const packet = ui.handoff;
  if (!packet) return `<p class="eyebrow">Your handoff</p><h2>Get the card ready.</h2>${handoffForm(c)}`;
  const recipient = packet.recipientLabel || ui.recipient;
  const localPreview = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  return `<p class="eyebrow">01 / Ready to travel</p><h2>For ${text(recipient)}.<br />With the next step attached.</h2><p class="body-copy">Share the handoff link. ${text(recipient)} can check the label, follow the official remedy, and keep a separate record.</p><div class="handoff-summary"><span class="handoff-symbol" aria-hidden="true">↗</span><div><strong>${text(c.owner)} → ${text(recipient)}</strong><p>Ninja Foodi · ${text(packet.product?.reportedModel || 'Label to check')} · recall 25-247</p></div></div><div class="button-row"><button class="primary-button" type="button" data-action="share-handoff">${navigator.share ? 'Share handoff link' : 'Copy handoff link'} <span aria-hidden="true">↗</span></button>${navigator.share ? '<button class="secondary-button" type="button" data-action="copy-link">Copy link</button>' : ''}</div><p class="privacy-note"><span aria-hidden="true">✓</span> Shared: first names, recall identity, model note. Private progress stays in this case. Photos and official form details stay with their owner.</p>${localPreview ? '<p class="field-help">The shared link opens the public browser companion on the recipient’s device. Their case is saved separately there.</p>' : ''}<details class="export-block"><summary>View the link or export the portable card</summary><label for="handoff-link">Handoff link</label><textarea id="handoff-link" rows="3" readonly spellcheck="false">${text(handoffLink(packet))}</textarea><label for="handoff-json">Portable JSON</label><textarea id="handoff-json" rows="4" readonly spellcheck="false">${text(JSON.stringify(packet, null, 2))}</textarea><div class="button-row"><button class="secondary-button" type="button" data-action="copy-json">Copy JSON</button><button class="secondary-button" type="button" data-action="download-handoff">Download card</button></div></details><div class="role-switch"><span class="small-label">Try the other side of the handoff</span><button type="button" class="secondary-button" data-action="try-recipient">Continue as ${text(recipient)} <span aria-hidden="true">→</span></button><p class="small-copy">Demo role switch · the current case is archived and a fresh owner journal begins.</p></div>`;
}

function functionGuidance() {
  return `<div class="function-guidance"><div class="function-stop"><span class="small-label">Stop using</span><h3>Pressure cooking</h3><p>Keep the original pressure lid out of use. Follow the replacement process.</p></div><div class="function-keep"><span class="small-label">Can continue</span><h3>Air frying &amp; other functions</h3><p>The official notice permits the other functions to continue.</p></div></div>`;
}

const stepDetails = {
  pressure_use_stopped: ['First, stop the affected function.', 'Record this after you have stopped using the pressure-cooking function.'],
  label_photo_ready: ['Keep a clear photo handy.', 'Photograph the product label so the model and serial are legible. You’ll give the photo directly to the official recall program.'],
  old_lid_disposed: ['Retire the original pressure lid.', 'Follow the recall program’s disposal instructions and your local household-waste rules. Record the step once complete.'],
  replacement_received: ['When the new lid reaches you…', 'Use this step once you have received the replacement pressure-cooking lid.'],
  replacement_installed: ['Finish with the replacement lid.', 'Fit the new pressure-cooking lid according to the manufacturer’s instructions. Record the step once complete.'],
};

function nextAction(c) {
  const next = c.nextAction;
  if (!next) return '';
  if (next.tool === 'prepare_claim') return `<div class="next-action-card"><p class="eyebrow">Ready for the official program</p><h3>Your label and photo are ready.</h3><p>Prepare the request details, then open the manufacturer’s form to claim the free replacement lid.</p><button class="primary-button" type="button" data-action="next">Prepare my free-lid request <span aria-hidden="true">→</span></button></div>`;
  if (next.tool === 'record_step') {
    const [heading, description] = stepDetails[next.args?.step] || [next.label, 'Record this step after you have completed it.'];
    return `<div class="next-action-card"><p class="eyebrow">Your next step</p><h3>${text(heading)}</h3><p>${text(description)}</p>${next.args?.step === 'label_photo_ready' ? photoPicker() : ''}<button class="primary-button" type="button" data-action="next">${text(next.label)} <span aria-hidden="true">→</span></button><p class="provenance-line">Saved as an owner-reported step.</p></div>`;
  }
  return '';
}

function progress(c, { all = false } = {}) {
  const items = (c.checklist || []).filter((step) => all || step.done);
  if (!items.length) return '';
  return `<ul class="progress-checklist" aria-label="Owner-reported progress">${items.map((item) => `<li class="${item.done ? 'is-done' : ''}"><span class="check-marker" aria-hidden="true">${item.done ? '✓' : ''}</span><span>${text(item.label)}</span></li>`).join('')}</ul>`;
}

function acknowledgementForm() {
  return `<form class="acknowledgement-form" data-form="claim"><label for="claim-reference">Confirmation reference <span class="optional-field">optional</span></label><input id="claim-reference" name="reference" placeholder="Reference from the manufacturer’s email" maxlength="160" autocomplete="off" /><p class="field-help">Use this step after receiving the manufacturer’s confirmation email. Your acknowledgement is saved as owner-reported.</p><button class="primary-button" type="submit">I received the confirmation email <span aria-hidden="true">→</span></button></form><div class="button-row"><button class="text-link" type="button" data-action="sample-ack">Demo: use SAMPLE-ACK →</button></div>`;
}

function claimPanel(c) {
  const fields = ui.claimPacket?.fields || [
    { name: 'Model', value: c.model },
    { name: 'Label photo', value: 'Model and serial clearly visible' },
    { name: 'Your contact and delivery details', value: 'Enter directly on the official form' },
  ];
  return `<section class="official-claim"><span class="small-label">Official manufacturer recall program</span><h3>Your free-lid request is ready to start.</h3><p>Complete the form on SharkNinja’s recall-program website. Its acknowledgement arrives by email.</p><ul class="claim-fields">${fields.map((field) => `<li><strong>${text(field.name)}:</strong> ${text(field.value)}</li>`).join('')}</ul><a class="primary-button" href="${text(url(ui.claimPacket?.url || c.claimUrl))}" target="_blank" rel="noopener noreferrer">Open the official claim form <span aria-hidden="true">↗</span></a><p class="field-help">Opens the manufacturer’s external recall form in a new tab.</p></section>${acknowledgementForm()}`;
}

function followUp(c) {
  const date = new Date(c.followUpAt || Date.now() + 7 * 86400000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return `<section class="followup-section"><h3>${c.followUpAt ? 'A time to check back' : 'Give yourself a gentle follow-up'}</h3>${c.followUpAt ? `<p class="small-copy">Saved for ${text(formatDate(c.followUpAt, true))}. Import the calendar file to add it to your calendar.</p>` : '<p class="small-copy">Save a date and download a calendar reminder.</p>'}<form data-form="followup"><div class="field-row"><div><label for="followup-date">Your local date and time</label><input id="followup-date" type="datetime-local" name="dueAt" value="${text(date.toISOString().slice(0, 16))}" required /></div><button class="secondary-button" type="submit">Save &amp; download .ics</button></div></form></section>`;
}

function renderAwaiting(c) {
  const disposalNext = c.nextAction?.args?.step === 'old_lid_disposed';
  return `<p class="eyebrow">03 / ${disposalNext ? 'One more step while you wait' : 'The handoff is in motion'}</p><h2>${disposalNext ? 'Request recorded.<br />Retire the original lid.' : 'The next step can wait.<br />Your case will keep.'}</h2><p class="body-copy">${disposalNext ? 'Follow the official program’s next instructions after registration. Keep pressure cooking stopped while the replacement is on its way.' : 'Your acknowledgement is saved. Keep pressure cooking stopped until the replacement lid arrives and the remedy is complete.'}</p><div class="receipt"><span class="receipt-icon" aria-hidden="true">✓</span><div><h3>${String(c.claimReference || '').startsWith('SAMPLE-') ? 'Sample acknowledgement saved' : 'Acknowledgement saved'}</h3><p>${text(c.claimReference || 'Recorded by the owner')} · owner-reported</p></div></div>${nextAction(c)}${followUp(c)}<div class="resume-note"><span>Saved. Reopen this page to pick up here.</span><button class="text-link" type="button" data-action="pause">Pause here ↗</button></div>`;
}

function renderWorkspace(c) {
  if (ui.incoming) return renderIncoming(ui.incoming);
  if (ui.paused) return `<span class="pause-symbol" aria-hidden="true">Ⅱ</span><p class="eyebrow">Saved for later</p><h2>We’ll keep your place.</h2><p class="body-copy">${text(c.owner)}’s case is saved at “${text(c.statusLabel)}”. Reopen this page whenever you’re ready.</p><div class="receipt"><span class="receipt-icon" aria-hidden="true">↗</span><div><h3>Next time</h3><p>${text(c.nextAction?.label || 'View your completed case')}</p></div></div><div class="button-row"><button class="primary-button" type="button" data-action="resume">Continue my case <span aria-hidden="true">→</span></button></div><p class="provenance-line">This preview demonstrates an interruption. Your saved domain state stays intact.</p>`;
  switch (c.stage) {
    case 'identify_product': return renderIdentify(c);
    case 'confirm_current_owner': return `<p class="eyebrow">02 / A fresh check, from you</p><h2>${text(c.owner)}, check<br />the actual label.</h2><p class="body-copy">${c.priorOwner ? `${text(c.priorOwner)} passed on a model note. Your own label check turns it into a useful next step.` : 'The model note is a starting point. Read the label on the cooker you have now.'}</p><p class="inherited-note">${c.priorOwner ? `${text(c.priorOwner)}’s note` : 'Model note'}: <strong>${text(c.rawModel || 'OP301 I07')}</strong><br />Your physical-label confirmation comes next.</p>${labelForm(c)}`;
    case 'handoff_prepared': return renderHandoff(c);
    case 'remedy_required': return `<p class="eyebrow">03 / The remedy is specific</p><h2>Pause pressure cooking.<br />Keep the next step clear.</h2><p class="body-copy">Your model is listed in the US recall. The remedy replaces the pressure-cooking lid, free of charge.</p>${functionGuidance()}${nextAction(c)}${progress(c)}`;
    case 'claim_ready': return `<p class="eyebrow">03 / A free replacement lid</p><h2>${c.nextAction?.tool === 'prepare_claim' ? 'Everything you need,<br />ready to hand over.' : 'One official form.<br />Then we keep your place.'}</h2><p class="body-copy">The manufacturer handles your replacement. Recall Relay keeps the next step and your progress together.</p>${c.nextAction?.tool === 'prepare_claim' ? `${nextAction(c)}${progress(c)}<details class="export-block"><summary>Already completed the official form?</summary>${acknowledgementForm()}</details>` : claimPanel(c)}`;
    case 'awaiting_replacement': return renderAwaiting(c);
    case 'replacement_arrived': return `<p class="eyebrow">04 / Finish the handoff</p><h2>The new lid is here.<br />Let’s close the loop.</h2><p class="body-copy">Finish the official remedy by retiring the original pressure lid and fitting its replacement.</p>${nextAction(c)}${progress(c)}`;
    case 'resolved': return `<span class="resolved-mark" aria-hidden="true">✓</span><p class="eyebrow">04 / Care, carried through</p><h2>A replacement lid.<br />A finished handoff.</h2><p class="body-copy">${text(c.owner)} recorded the replacement received, the original lid disposed of, and the new lid fitted following the manufacturer’s instructions.</p><div class="receipt"><span class="receipt-icon" aria-hidden="true">✓</span><div><h3>Remedy completed · owner-reported</h3><p>Your case history stays here. Official instructions stay linked alongside it.</p></div></div>${progress(c)}<div class="button-row"><button class="text-link" type="button" data-action="show-history">Read the case history ↗</button></div>`;
    default: return `<p class="eyebrow">Your saved case</p><h2>${text(c.statusLabel)}</h2>${nextAction(c)}`;
  }
}

function suggestions(c) {
  if (ui.incoming) return ['Open the handoff', 'What is recalled?'];
  if (ui.paused) return ['Where were we?'];
  if (c.stage === 'confirm_current_owner' || (c.stage === 'identify_product' && (ui.intent === 'self' || c.priorOwner))) return ['My label says OP301 I07', 'What is recalled?'];
  if (c.stage === 'identify_product') return ['I gave my Foodi to Alex', 'I have the cooker'];
  if (c.stage === 'handoff_prepared') return [`I’m ${ui.handoff?.recipientLabel || ui.recipient}`, 'Show the handoff'];
  if (c.stage === 'resolved') return ['Where were we?', 'Show my case history'];
  const phrase = {
    pressure_use_stopped: 'I stopped pressure cooking', label_photo_ready: 'My label photo is ready',
    old_lid_disposed: 'I disposed of the original lid', replacement_received: 'The replacement lid arrived',
    replacement_installed: 'I fitted the replacement lid',
  }[c.nextAction?.args?.step];
  if (phrase) return [phrase, c.stage === 'awaiting_replacement' ? 'Where were we?' : 'Can I still air fry?'];
  if (c.nextAction?.tool === 'prepare_claim') return ['Prepare my free-lid request', 'Can I still air fry?'];
  return ['I received the confirmation email', 'Use sample acknowledgement'];
}

function companionStep(c) {
  if (ui.incoming) return { title: 'Care came with your cooker.', description: `${ui.incoming.senderLabel} shared a recall card. Open your own case and check the physical label.`, action: 'open-details', label: 'Open my recall card' };
  if (ui.paused) return { title: 'Your place is saved.', description: `Next time: ${c.nextAction?.label || 'Read your completed record'}.`, action: 'resume', label: 'Continue my case' };
  if (c.stage === 'handoff_prepared') return { title: `Pass care along to ${ui.handoff?.recipientLabel || ui.recipient}.`, description: 'One link carries the recall and the next step. The current owner checks their own cooker.', action: 'share-handoff', label: navigator.share ? 'Share the recall card' : 'Copy the recall link' };
  if (c.stage === 'identify_product' || c.stage === 'confirm_current_owner') return {
    title: c.priorOwner || ui.intent === 'self' || c.rawModel ? 'Start with the actual label.' : 'The cooker changed hands.',
    description: c.priorOwner ? `${c.priorOwner} shared a model note. Read the exact model on the cooker you have now.` : ui.intent === 'self' || c.rawModel ? 'Read the exact model on the physical label of the cooker you have now, then confirm it here.' : 'Pass the recall to its current owner, or check the cooker in your hands.',
    action: 'open-details', label: c.priorOwner || ui.intent === 'self' || c.rawModel ? 'Open the label check' : 'Start the handoff',
  };
  if (c.stage === 'resolved') return { title: 'Care, carried through.', description: `${c.owner} reported the original lid retired and the replacement received and fitted. The completed record is saved.`, action: 'open-history', label: 'Read the case history' };
  if (c.nextAction?.tool === 'record_claim') return { title: 'One official form. Then come back.', description: 'Submit your request to the manufacturer with the label photo and delivery details. Record progress when its confirmation email arrives.', href: url(c.claimUrl), label: 'Open the official claim form', secondary: 'I have the confirmation email' };
  if (c.nextAction?.tool === 'prepare_claim') return { title: 'Your free-lid request is ready to prepare.', description: 'Your label is checked and photo readiness is recorded. Bring the details together for the official form.', action: 'next', label: c.nextAction.label };
  const step = c.nextAction?.args?.step;
  const titles = {
    pressure_use_stopped: 'Stop pressure cooking.', label_photo_ready: 'Keep the label photo handy.',
    old_lid_disposed: 'Retire the original pressure lid.', replacement_received: 'Your next step can wait.',
    replacement_installed: 'Fit the replacement. Close the loop.',
  };
  return {
    title: titles[step] || c.statusLabel,
    description: step === 'replacement_received'
      ? 'Your acknowledgement and progress are saved. Keep pressure cooking stopped. Return when the replacement arrives.'
      : stepDetails[step]?.[1] || 'Follow the saved next step, with the official instructions alongside it.',
    action: 'next', label: c.nextAction?.label || 'Continue',
  };
}

function currentSpokenStep() {
  if (!ui.case) return '';
  const step = companionStep(ui.case);
  const owner = ui.incoming?.recipientLabel || ui.case.owner;
  return `${owner}. ${step.title} ${step.description}`;
}

function renderContext(c) {
  const owner = ui.incoming?.recipientLabel || c.owner;
  $('#case-role').textContent = ui.incoming ? 'For the current owner' : c.stage === 'handoff_prepared' ? 'Ready to share' : c.priorOwner || c.model ? 'Current holder' : 'Sample household';
  $('#case-person').textContent = ui.incoming ? `${ui.incoming.senderLabel} → ${owner}` : c.priorOwner ? `${c.priorOwner} → ${owner}` : c.stage === 'handoff_prepared' ? `${owner} → ${ui.handoff?.recipientLabel || ui.recipient}` : `${owner}’s recall case`;
  $('#case-version').textContent = ui.incoming ? 'Separate owner journal' : `Saved · r${c.revision}`;
  $('#case-version').title = ui.incoming ? 'The handoff carries product context.' : `Case ${c.id}`;
  $('#case-context').dataset.caseId = c.id;
  $('#case-context').dataset.revision = String(c.revision);
  const step = companionStep(c);
  $('#companion-display').innerHTML = `<p class="eyebrow">${ui.paused ? 'Pick up here next time' : 'Your next step'}</p><h2>${text(step.title)}</h2><p class="companion-copy">${text(step.description)}</p><div class="button-row">${step.href ? `<a class="primary-button" href="${text(step.href)}" target="_blank" rel="noopener noreferrer">${text(step.label)} <span aria-hidden="true">↗</span></a>` : `<button class="primary-button" type="button" data-action="${text(step.action)}">${text(step.label)} <span aria-hidden="true">→</span></button>`}</div>${step.secondary ? `<button class="text-link companion-secondary" type="button" data-action="open-details">${text(step.secondary)} →</button>` : ''}<p class="companion-footnote">${c.model ? `${text(c.model)} · US recall 25-247 · owner-reported progress` : 'US recall 25-247 · physical-label check first'}</p>`;
  $('#companion-display').hidden = !ui.focus;
  $('#workspace').hidden = ui.focus;
  $('#workspace').setAttribute('aria-live', ui.focus ? 'off' : 'polite');
  document.body.classList.toggle('is-focus', ui.focus);
  document.body.classList.toggle('has-progress', Boolean(ui.incoming || c.revision > 0));
  $('#focus-button').setAttribute('aria-pressed', String(ui.focus));
  $('#focus-button').innerHTML = ui.focus ? 'Full view <span aria-hidden="true">⤡</span>' : 'Focus view <span aria-hidden="true">⤢</span>';
}

function setFocus(focus) {
  ui.focus = focus;
  try { sessionStorage.setItem(FOCUS_STORAGE, String(focus)); } catch { /* This tab keeps its display preference. */ }
  render();
  (focus ? $('#companion-display') : $('#workspace')).focus({ preventScroll: true });
}

function render({ preserveInputs = false } = {}) {
  if (!ui.case) return;
  const activeId = document.activeElement?.id;
  const selection = document.activeElement?.selectionStart;
  const drafts = preserveInputs ? [...$('#workspace').querySelectorAll('input, textarea')].filter(input => input.id && input.type !== 'file').map(input => ({ id: input.id, value: input.value, checked: input.checked })) : [];
  const c = ui.case;
  renderJourney(c);
  renderContext(c);
  renderSidebar(c);
  $('#workspace').innerHTML = renderWorkspace(c);
  for (const draft of drafts) {
    const input = document.getElementById(draft.id);
    if (input) { input.value = draft.value; input.checked = draft.checked; }
  }
  if (preserveInputs && activeId) {
    const active = document.getElementById(activeId);
    active?.focus({ preventScroll: true });
    if (typeof selection === 'number' && active?.setSelectionRange) active.setSelectionRange(selection, selection);
  }
  const prompts = suggestions(c);
  $('#command-suggestions').innerHTML = prompts.map((prompt) => `<button type="button" data-command="${text(prompt)}">${text(prompt)}</button>`).join('');
  $('#command-input').placeholder = `“${prompts[0]}”`;
  setBusy(ui.busy);
}

async function makeHandoff(model, recipient) {
  ui.recipient = recipient;
  await invoke('check_model', { model, confirmedFromLabel: false }, { quiet: true });
  return invoke('create_handoff', { recipientLabel: recipient });
}

async function acceptHandoff(packet, owner) {
  try {
    const result = await invoke('accept_handoff', { handoff: packet, owner });
    clearIncomingLink();
    rememberHandoff(null);
    ui.claimPacket = null;
    ui.intent = 'self';
    ui.paused = false;
    render();
    return result;
  } catch (error) {
    if (error.code === 'HANDOFF_ALREADY_OPEN') {
      clearIncomingLink();
      await invoke('get_case');
      banner('This handoff is already open. Your saved case is ready.');
      return;
    }
    throw error;
  }
}

function download(content, name, type) {
  const blob = new Blob([content], { type });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

async function copyValue(value, fallbackSelector, successMessage) {
  try {
    await navigator.clipboard.writeText(value);
    banner(successMessage);
  } catch {
    const details = $('.export-block');
    if (details) details.open = true;
    const field = $(fallbackSelector);
    if (field) {
      field.focus();
      field.select();
      banner('Selected for you. Use your device’s copy command to copy the handoff.');
    } else banner('Open the portable card details to copy the handoff link.');
  }
}

function openImport() {
  $('#import-error').hidden = true;
  $('#import-dialog').showModal();
}

async function runAction(action) {
  if (action === 'open-details') { setFocus(false); $('#workspace').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  if (action === 'open-history') { setFocus(false); action = 'show-history'; }
  if (action === 'choose-photo') { $('#label-photo-input')?.click(); return; }
  if (action === 'clear-photo') { labelPhoto.clear(); render({ preserveInputs: true }); return; }
  if (action === 'intent-self' || action === 'intent-pass') {
    ui.intent = action === 'intent-self' ? 'self' : 'pass';
    render();
    return;
  }
  if (action === 'share-handoff') {
    const link = handoffLink();
    if (navigator.share) {
      try { await navigator.share({ title: 'Recall Relay — your Foodi recall card', text: `${ui.handoff.senderLabel} passed you a recall card. Check your cooker’s label and follow the official replacement-lid process.`, url: link }); banner('Your device’s share action finished. Recipient acceptance appears in their own case.'); }
      catch (error) { if (error.name !== 'AbortError') await copyValue(link, '#handoff-link', 'Handoff link copied. Share it with the current owner.'); }
    } else await copyValue(link, '#handoff-link', 'Handoff link copied. Share it with the current owner.');
    return;
  }
  if (action === 'copy-link') return copyValue(handoffLink(), '#handoff-link', 'Handoff link copied. Share it with the current owner.');
  if (action === 'copy-json') return copyValue(JSON.stringify(ui.handoff, null, 2), '#handoff-json', 'Portable card copied.');
  if (action === 'download-handoff') { download(JSON.stringify(ui.handoff, null, 2), 'recall-relay-handoff.json', 'application/json'); banner('Portable handoff downloaded.'); return; }
  if (action === 'try-recipient') return acceptHandoff(ui.handoff, ui.handoff.recipientLabel || ui.recipient);
  if (action === 'next') {
    if (ui.case.nextAction?.tool === 'check_model') { setFocus(false); return; }
    return invoke(ui.case.nextAction.tool, ui.case.nextAction.args || {});
  }
  if (action === 'sample-ack') { await invoke('record_claim', { confirmationReceived: true, reference: 'SAMPLE-ACK' }); banner('Walkthrough: SAMPLE-ACK is a simulated acknowledgement, saved as owner-reported.'); return; }
  if (action === 'pause') { ui.paused = true; await invoke('get_case'); return; }
  if (action === 'resume') { ui.paused = false; await invoke('get_case'); banner(`Resumed: ${ui.case.statusLabel}.`); return; }
  if (action === 'show-history') { $('#journal').open = true; $('#journal').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
}

function commandReply(command, response, sources = []) {
  const element = $('#spoken-reply');
  const links = sources.filter(source => url(source.href)).map(source => `<a href="${text(url(source.href))}" target="_blank" rel="noopener noreferrer">${text(source.label)} ↗</a>`).join(' · ');
  element.innerHTML = `<span class="user-message">You: ${text(command)}</span>${text(response)}${links ? `<span class="reply-sources">${links}</span>` : ''}`;
  element.hidden = false;
  ui.lastMessage = response;
}

async function runCommand(command) {
  const phrase = command.trim();
  const normalized = phrase.toLowerCase().replace(/[’‘]/g, "'");
  let response;
  let sources = [];
  if (/\b(receipt|proof of purchase|second[ -]?hand)\b/.test(normalized)) {
    response = `SharkNinja's FAQ asks previous owners to forward the recall so the person who received or bought the cooker can participate and receive a new lid. The official form asks for a clear model-and-serial label photo, plus contact and delivery details. This case follows the 12-model US notice. Your next step: ${companionStep(ui.case).label}.`;
    sources = [{ label: 'Manufacturer FAQ', href: recall.manufacturerUrl }, { label: 'Official form requirements', href: recall.claimUrl }];
  } else if (/\b(where were we|resume|continue my case|show my case)\b/.test(normalized) && !/history/.test(normalized)) {
    ui.paused = false;
    await invoke('get_case');
    response = `${ui.case.owner}, ${ui.case.statusLabel.toLowerCase()}. Next: ${ui.case.nextAction?.label || 'Keep the completed record'}.`;
  } else if (/\b(gave|passed|sold)\b.*\bto\b/.test(normalized)) {
    const recipient = phrase.match(/\bto\s+(.+?)[.!?]?$/i)?.[1]?.trim().replace(/[.!?]$/, '') || 'Alex';
    await makeHandoff(ui.case.rawModel || 'OP301 I07', recipient);
    response = `The handoff for ${recipient} is ready. Share the link; they check their own cooker’s label next.`;
  } else if (/^(i'm|i am)\s+/i.test(normalized) && ui.handoff) {
    const owner = phrase.replace(/^(i['’]m|i am)\s+/i, '').replace(/[.!?]$/, '').trim();
    await acceptHandoff(ui.handoff, owner);
    response = `${owner}, your own case is open. Read the model on the physical label to continue.`;
  } else if (/\b(my|the)\s+(product\s+)?label\s+(says|reads|is)\s+op\d/i.test(normalized)) {
    const model = phrase.match(/\bOP\d{3}[A-Z]*(?:\s+[A-Z0-9-]{2,10})?/i)?.[0];
    ui.intent = 'self';
    await invoke('check_model', { model, confirmedFromLabel: true });
    response = ui.case.facts.find((fact) => /identity/i.test(fact.label))?.text || ui.case.statusLabel;
  } else if (/\b(i have|with me|my cooker)\b/.test(normalized) && /cooker|with me/.test(normalized)) {
    ui.intent = 'self'; render(); response = 'Read the exact model from your cooker’s physical label, then confirm it here.';
  } else if (/\bair fry|other functions|what is recalled|what.*recall\b/.test(normalized)) {
    await invoke('get_case');
    response = (ui.case.facts || []).filter((fact) => /function/i.test(fact.label)).map((fact) => fact.text).join(' ')
      || ui.case.facts?.find((fact) => /scope/i.test(fact.label))?.text
      || 'Confirm the exact model from your cooker’s physical label to open the source-linked remedy.';
  } else if (/\bi(?:'ve| have)?\s+stopped\s+pressure/.test(normalized)) {
    await invoke('record_step', { step: 'pressure_use_stopped' }); response = 'Saved as your report: pressure cooking has stopped. Keep a legible label photo ready for the official form.';
  } else if (/^(my|the)\s+(label\s+)?photo\s+(is\s+)?ready[.!]?$/.test(normalized)) {
    await invoke('record_step', { step: 'label_photo_ready' }); response = 'Your photo readiness is saved. The image stays with you for the official form.';
  } else if (/\bprepare\b.*\b(claim|request|lid)\b/.test(normalized)) {
    await invoke('prepare_claim'); response = 'Your request details are ready. Open the official form to submit them to the manufacturer.';
  } else if (/\bsample\b.*\backnowledgement\b|^sample-ack$/i.test(normalized)) {
    await invoke('record_claim', { confirmationReceived: true, reference: 'SAMPLE-ACK' }); response = 'SAMPLE-ACK is saved for this walkthrough. It records a simulated acknowledgement.';
  } else if (/^i(?:'ve| have)?\s+received\s+(the\s+)?confirmation\s+email[.!]?$/.test(normalized)) {
    await invoke('record_claim', { confirmationReceived: true }); response = `Your confirmation email is recorded as owner-reported. Next: ${ui.case.nextAction.label}.`;
  } else if (/\b(confirmation|reference|acknowledgement)\b\s+(is|was)\s+/i.test(normalized)) {
    const reference = phrase.replace(/^.*?\b(?:confirmation|reference|acknowledgement)\s+(?:is|was)\s+/i, '').trim();
    await invoke('record_claim', { confirmationReceived: true, reference }); response = `Your acknowledgement is saved as owner-reported. Next: ${ui.case.nextAction.label}.`;
  } else if (/^i(?:'ve| have)?\s+(disposed|retired|threw away)\b.*\b(lid|original)\b/.test(normalized)) {
    await invoke('record_step', { step: 'old_lid_disposed' }); response = `Original-lid disposal recorded. Next: ${ui.case.nextAction.label}.`;
  } else if (/^(the |my )?(replacement|new)\s+(pressure.cooking\s+)?lid\s+(has\s+)?(arrived|is here)[.!]?$/.test(normalized) || /^i(?:'ve| have)?\s+received\s+(the\s+)?replacement\s+lid[.!]?$/.test(normalized)) {
    await invoke('record_step', { step: 'replacement_received' }); response = `Replacement arrival recorded. Next: ${ui.case.nextAction.label}.`;
  } else if (/^i(?:'ve| have)?\s+(fitted|installed)\b.*\b(replacement|new)\b/.test(normalized)) {
    await invoke('record_step', { step: 'replacement_installed' }); response = 'Your replacement-lid remedy is recorded as complete. The case history is saved.';
  } else if (/\bremind\b.*\b(\d+)\s+days?\b/.test(normalized)) {
    const days = Number(normalized.match(/\b(\d+)\s+days?\b/)[1]);
    const result = await invoke('set_followup', { dueAt: new Date(Date.now() + days * 86400000).toISOString() });
    download(result.calendarContent, 'recall-relay-followup.ics', 'text/calendar'); response = `Follow-up saved for ${formatDate(ui.case.followUpAt, true)}. Import the downloaded .ics file into your calendar.`;
  } else if (/\b(pause|later)\b/.test(normalized)) {
    ui.paused = true; await invoke('get_case'); response = 'Your place is saved. Say “Where were we?” to continue.';
  } else if (/\bhistory\b/.test(normalized)) {
    $('#journal').open = true; response = 'Your recorded steps are in the case history, with their owner and source provenance.';
  } else if (/\bhandoff\b/.test(normalized)) {
    if (ui.incoming) $('#incoming-owner')?.focus();
    else if (ui.case.stage === 'handoff_prepared') render();
    else openImport();
    response = 'Use the handoff card to continue as the current owner. You’ll confirm your own label.';
  } else {
    const step = companionStep(ui.case);
    response = `${step.title} ${step.description} In this phrase simulator, try “${suggestions(ui.case)[0]}” or use the current step above.`;
  }
  commandReply(phrase, response, sources);
}

document.addEventListener('click', (event) => {
  const actionButton = event.target.closest('[data-action]');
  if (actionButton) { void act(() => runAction(actionButton.dataset.action)); return; }
  const commandButton = event.target.closest('[data-command]');
  if (commandButton) { void act(() => runCommand(commandButton.dataset.command)); return; }
  if (event.target.closest('.import-trigger')) openImport();
  if (event.target.closest('.dialog-close')) $('#import-dialog').close();
});

document.addEventListener('change', (event) => {
  if (event.target.id === 'label-confirmation') $('#label-submit').disabled = !event.target.checked || ui.busy;
  if (event.target.id === 'label-photo-input') {
    const file = event.target.files?.[0];
    if (!file) return;
    void act(async () => {
      await labelPhoto.select(file);
      render({ preserveInputs: true });
      banner('Photo opened on this device. Read the model from the image or the physical label.');
    });
  }
});

document.addEventListener('submit', (event) => {
  const form = event.target;
  if (!form.dataset.form) return;
  event.preventDefault();
  const data = new FormData(form);
  void act(async () => {
    if (form.dataset.form === 'handoff') await makeHandoff(String(data.get('model')).trim(), String(data.get('recipient')).trim());
    if (form.dataset.form === 'label') await invoke('check_model', { model: String(data.get('model')).trim(), confirmedFromLabel: data.get('confirmed') === 'on' });
    if (form.dataset.form === 'accept-link') await acceptHandoff(ui.incoming, String(data.get('owner')).trim());
    if (form.dataset.form === 'claim') {
      const reference = String(data.get('reference')).trim();
      await invoke('record_claim', { confirmationReceived: true, ...(reference ? { reference } : {}) });
    }
    if (form.dataset.form === 'followup') {
      const result = await invoke('set_followup', { dueAt: new Date(String(data.get('dueAt'))).toISOString() });
      download(result.calendarContent, 'recall-relay-followup.ics', 'text/calendar');
      banner('Follow-up saved. Import the downloaded .ics file to add it to your calendar.');
    }
  });
});

$('#command-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const command = $('#command-input').value.trim();
  if (!command) return;
  $('#command-input').value = '';
  void act(() => runCommand(command));
});

$('#import-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const raw = $('#import-payload').value.trim();
  const owner = $('#import-owner').value.trim();
  void act(async () => {
    try {
      if (raw.length > 24000) throw new Error('Use the compact JSON from a Recall Relay handoff card.');
      const packet = JSON.parse(raw);
      await acceptHandoff(packet, owner);
      $('#import-dialog').close();
    } catch (error) {
      $('#import-error').textContent = error instanceof SyntaxError ? 'Paste the complete JSON object from the exported handoff card.' : error.message;
      $('#import-error').hidden = false;
    }
  });
});

$('#restart-button').addEventListener('click', () => {
  if (!window.confirm('Restart this sample household? The saved demo case and its local progress will be reset.')) return;
  void act(async () => {
    const result = await client.reset();
    absorbResult(result);
    ui.claimPacket = null;
    ui.paused = false;
    ui.intent = 'pass';
    ui.recipient = 'Alex';
    rememberHandoff(null);
    clearIncomingLink();
    $('#spoken-reply').hidden = true;
    if (!ui.case) await invoke('get_case');
    render();
    banner('Sample household restarted. Start the handoff from Sam to Alex.');
  });
});

$('#focus-button').addEventListener('click', () => setFocus(!ui.focus));

$('#read-button').addEventListener('click', () => {
  if (!ui.case) { banner('Open the saved case to read its current step.'); return; }
  const voices = window.speechSynthesis?.getVoices?.() || [];
  const voice = voices.find((entry) => entry.localService && /^en/i.test(entry.lang));
  if (!voice) { banner('Read aloud uses an English on-device voice. Text and touch are ready in this browser.'); return; }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(currentSpokenStep());
  utterance.voice = voice;
  utterance.rate = 0.93;
  window.speechSynthesis.speak(utterance);
});

window.addEventListener('hashchange', () => {
  if (!location.hash.startsWith('#handoff=')) return;
  try {
    ui.incoming = decodeHandoff(location.hash.slice(9));
    if (ui.incoming.id === ui.case?.receivedHandoffId) {
      clearIncomingLink();
      banner('Your saved owner case is open at its next step.');
    } else ui.focus = false;
    render();
  }
  catch (error) { banner(error.message, true); }
});

function watchCase() {
  stopWatching?.();
  stopWatching = client.watch(receiveSnapshot, status => {
    ui.syncStatus = status;
    updateMode();
  });
}

window.addEventListener('pagehide', () => { stopWatching?.(); stopWatching = null; });
window.addEventListener('pageshow', event => { if (event.persisted && client) watchCase(); });

async function start() {
  setBusy(true);
  try {
    try { ui.handoff = JSON.parse(localStorage.getItem(UI_STORAGE) || 'null'); } catch { ui.handoff = null; }
    try { ui.focus = new URLSearchParams(location.search).get('view') === 'focus' || sessionStorage.getItem(FOCUS_STORAGE) === 'true'; } catch { /* Use the default display. */ }
    if (location.hash.startsWith('#handoff=')) ui.incoming = decodeHandoff(location.hash.slice(9));
    client = await createClient();
    await invoke('get_case');
    if (ui.incoming) { ui.focus = false; render(); }
    watchCase();
  } catch (error) {
    $('#workspace').innerHTML = '<p class="eyebrow">Reconnect your case</p><h2>Let’s pick up the thread.</h2><p class="body-copy">Refresh this page once the local server is ready. On a static host, the browser-local simulator opens the same case tools.</p>';
    banner(error.message || 'Open this page through its local server or static web host.', true);
  } finally {
    setBusy(false);
    const pending = ui.pendingSnapshot;
    ui.pendingSnapshot = null;
    if (pending) receiveSnapshot(pending);
  }
}

void start();
