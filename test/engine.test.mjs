import test from 'node:test';
import assert from 'node:assert/strict';
import { assessModel, createState, executeTool, recall } from '../src/engine.mjs';

const now = '2026-10-08T15:00:00.000Z';
function session(owner = 'Sam') {
  let state = createState({ owner, now });
  return {
    call(name, args = {}) { const response = executeTool(state, name, args, { now }); state = response.state; return response.result; },
    get state() { return state; },
  };
}
function identified(s) { assert.equal(s.call('check_model', { model: 'OP301 I07', confirmedFromLabel: true }).ok, true); }
function claimPrepared(s) {
  identified(s);
  s.call('record_step', { step: 'pressure_use_stopped' });
  s.call('record_step', { step: 'label_photo_ready' });
  return s.call('prepare_claim');
}

test('exact official models and separated production code; preserve model suffixes', () => {
  assert.equal(recall.models.length, 12);
  for (const model of recall.models) assert.equal(assessModel(model).status, 'listed');
  assert.deepEqual(assessModel('op301   i07'), { raw: 'OP301 I07', model: 'OP301', suffix: 'I07', status: 'listed' });
  assert.equal(assessModel('OP301A').model, 'OP301A');
  for (const model of ['OP301X', 'OP300C', 'OP451']) assert.equal(assessModel(model).status, 'outside_curated_notice');
  for (const model of ['OP301I07', 'OP30', 'OP3O1', 'OP301 or OP302', 'OP301/OP302']) assert.equal(assessModel(model).status, 'needs_clear_label');
});

test('inherited label knowledge asks the physical holder to confirm', () => {
  const s = session();
  const candidate = s.call('check_model', { model: 'OP301 I07', confirmedFromLabel: false });
  assert.equal(candidate.case.stage, 'confirm_current_owner');
  assert.equal(candidate.case.model, null);
  assert.deepEqual(candidate.case.facts.map(f => f.label), ['Product identity', 'Official notice scope']);
  assert.equal(s.call('record_step', { step: 'pressure_use_stopped' }).error.code, 'LABEL_REQUIRED');
});

test('handoff contains a minimal product record; recipient gets an independent journal', () => {
  const sender = session('Sam');
  identified(sender);
  sender.state.serial = 'PRIVATE-SERIAL';
  sender.state.photo = 'PRIVATE-PHOTO';
  const result = sender.call('create_handoff', { recipientLabel: 'Alex' });
  assert.equal(result.case.stage, 'handoff_prepared');
  assert.equal(result.delivery, 'prepared');
  assert.equal(JSON.stringify(result.handoff).includes('PRIVATE'), false);
  const recipient = session('Alex');
  const accepted = recipient.call('accept_handoff', { owner: 'Alex', handoff: result.handoff });
  assert.equal(accepted.case.stage, 'confirm_current_owner');
  assert.equal(accepted.case.model, null);
  assert.equal(accepted.case.events.length, 1);
  assert.equal(accepted.case.owner, 'Alex');
  assert.equal(recipient.call('get_case').case.receivedHandoffId, result.handoff.id);
  assert.equal(sender.state.events.length, 2);
  assert.equal(recipient.call('accept_handoff', { owner: 'Alex', handoff: result.handoff }).error.code, 'HANDOFF_ALREADY_OPEN');
  assert.equal(recipient.call('accept_handoff', { owner: 'Alex', handoff: { ...result.handoff, recallId: 'invented' } }).error.code, 'HANDOFF_SCOPE');
});

test('form preparation, owner acknowledgement, delivery and completion have distinct states', () => {
  const s = session('Alex');
  const packet = claimPrepared(s);
  assert.equal(packet.ok, true);
  assert.equal(packet.claimPacket.url, recall.claimUrl);
  assert.equal(packet.claimPacket.submission, 'prepared');
  assert.equal(packet.case.stage, 'claim_ready');
  assert.equal(s.call('record_step', { step: 'replacement_received' }).error.code, 'ACKNOWLEDGEMENT_REQUIRED');
  const claim = s.call('record_claim', { reference: 'SAMPLE-ACK-001' });
  assert.equal(claim.case.stage, 'awaiting_replacement');
  assert.equal(claim.provenance, 'owner-reported');
  assert.equal(claim.case.nextAction.args.step, 'old_lid_disposed');
  assert.equal(s.call('record_step', { step: 'replacement_installed' }).error.code, 'REPLACEMENT_REQUIRED');
  assert.equal(s.call('record_step', { step: 'replacement_received' }).case.stage, 'replacement_arrived');
  assert.equal(s.call('record_step', { step: 'replacement_installed' }).error.code, 'ORIGINAL_LID_REQUIRED');
  s.call('record_step', { step: 'old_lid_disposed' });
  assert.equal(s.call('record_step', { step: 'replacement_installed' }).case.stage, 'resolved');
});

test('idempotent retry preserves exactly one action and returns the current case', () => {
  const s = session();
  const args = { model: 'OP301 I07', confirmedFromLabel: true, requestId: 'label-1', expectedRevision: 0 };
  assert.equal(s.call('check_model', args).ok, true);
  s.call('record_step', { step: 'pressure_use_stopped' });
  const events = s.state.events.length;
  const retried = s.call('check_model', args);
  assert.equal(retried.replayed, true);
  assert.equal(retried.case.revision, 2);
  assert.equal(s.state.events.length, events);
  assert.equal(s.call('check_model', { ...args, model: 'OP302' }).error.code, 'REQUEST_ID_REUSED');
});

test('a stale mutation preserves every saved byte', () => {
  const s = session();
  identified(s);
  const before = JSON.stringify(s.state);
  const conflict = s.call('record_step', { step: 'pressure_use_stopped', expectedRevision: 0 });
  assert.equal(conflict.error.code, 'REVISION_CONFLICT');
  assert.equal(JSON.stringify(s.state), before);
});

test('identity changes after remedy progress preserve the original product record', () => {
  const s = session();
  claimPrepared(s);
  const before = JSON.stringify(s.state);
  assert.equal(s.call('check_model', { model: 'OP302', confirmedFromLabel: true }).error.code, 'PRODUCT_LOCKED');
  assert.equal(JSON.stringify(s.state), before);
});

test('follow-up is a real calendar artifact and completion clears pending follow-up', () => {
  const s = session();
  claimPrepared(s);
  s.call('record_claim', { reference: 'SAMPLE-ACK-002' });
  const reminder = s.call('set_followup', { dueAt: '2026-10-15T10:00:00-04:00' });
  assert.equal(reminder.ok, true);
  assert.match(reminder.calendar, /DTSTART:20261015T140000Z/);
  assert.match(reminder.calendar, /BEGIN:VCALENDAR/);
  assert.equal(s.call('set_followup', { dueAt: '2026-10-01T14:00:00Z' }).error.code, 'FUTURE_DATE_REQUIRED');
  s.call('record_step', { step: 'old_lid_disposed' });
  s.call('record_step', { step: 'replacement_received' });
  const completed = s.call('record_step', { step: 'replacement_installed' });
  assert.equal(completed.case.followUpAt, null);
});

test('imported URLs and extra fields stay outside the trusted official facts', () => {
  const s = session();
  const handoff = s.call('create_handoff', { recipientLabel: 'Alex' }).handoff;
  handoff.sourceUrl = 'https://example.invalid/claim';
  handoff.privateAddress = 'PRIVATE';
  const accepted = s.call('accept_handoff', { owner: 'Alex', handoff });
  assert.equal(accepted.case.sourceUrl, recall.sourceUrl);
  assert.equal(JSON.stringify(s.state.product).includes('PRIVATE'), false);
});

 test('an owner can resume a request filed on the official website with an optional reference', () => {
  const s = session('Alex');
  identified(s);
  const reported = s.call('record_claim', { confirmationReceived: true });
  assert.equal(reported.ok, true);
  assert.equal(reported.case.stage, 'awaiting_replacement');
  assert.equal(reported.case.claimReference, null);
  assert.equal(s.state.claim.preparedAt, null);
  assert.equal(s.state.claim.acknowledged, true);
  assert.equal(reported.case.nextAction.args.step, 'pressure_use_stopped');
});
