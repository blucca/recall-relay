import recallData from '../data/recall.json' with { type: 'json' };

export const recall = Object.freeze(recallData);

const mutationFields = {
  requestId: { type: 'string', description: 'Stable identifier for this intent; retries reuse it.', maxLength: 120 },
  expectedRevision: { type: 'integer', minimum: 0, description: 'Revision read before this mutation.' },
};
const schema = (properties = {}, required = [], mutation = true) => ({
  type: 'object', properties: { ...properties, ...(mutation ? mutationFields : {}) }, required, additionalProperties: false,
});
export const toolDefinitions = [
  { name: 'get_case', description: 'Resume the current recall case with its next action, official facts, and owner-reported progress.', inputSchema: schema({}, [], false) },
  { name: 'check_model', description: 'Check the exact label against US recall 25-247. Inherited model information stays provisional until the current owner confirms the physical label.', inputSchema: schema({ model: { type: 'string', maxLength: 100 }, confirmedFromLabel: { type: 'boolean', description: 'True after the current owner has read the label on their unit.' } }, ['model', 'confirmedFromLabel']) },
  { name: 'create_handoff', description: 'Prepare a portable recall card for the person who now has this cooker. Shares product and recall context; private claim and photo records stay in this case.', inputSchema: schema({ recipientLabel: { type: 'string', maxLength: 80 } }, ['recipientLabel']) },
  { name: 'accept_handoff', description: 'Open a received recall card as its current owner. Start a separate journal and reconfirm the physical product label.', inputSchema: schema({ handoff: { type: 'object', additionalProperties: true }, owner: { type: 'string', maxLength: 80 } }, ['handoff', 'owner']) },
  { name: 'record_step', description: 'Record a step the owner explicitly reports completing. Remedy order and replacement prerequisites are enforced.', inputSchema: schema({ step: { type: 'string', enum: ['pressure_use_stopped', 'label_photo_ready', 'old_lid_disposed', 'replacement_received', 'replacement_installed'] } }, ['step']) },
  { name: 'prepare_claim', description: 'Prepare the verified model, photo checklist, and official free-lid request link. The owner completes the manufacturer form separately.', inputSchema: schema() },
  { name: 'record_claim', description: 'Record the owner’s report of receiving the manufacturer confirmation email, including an optional reference. Can resume a request already completed on the official website.', inputSchema: schema({ confirmationReceived: { type: 'boolean' }, reference: { type: 'string', maxLength: 160 } }) },
  { name: 'set_followup', description: 'Save a follow-up time and produce an importable calendar reminder for the current owner.', inputSchema: schema({ dueAt: { type: 'string', description: 'ISO 8601 date/time with timezone.' } }, ['dueAt']) },
];

const stepLabels = {
  pressure_use_stopped: 'Stopped using the pressure-cooking function',
  label_photo_ready: 'Prepared a legible photo of the model and serial label',
  old_lid_disposed: 'Disposed of the original pressure-cooking lid under local rules',
  replacement_received: 'Received the replacement lid',
  replacement_installed: 'Fitted the replacement lid following the manufacturer instructions',
};

class RelayError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const requireThat = (test, code, message) => { if (!test) throw new RelayError(code, message); };
const cleanText = (value, name, limit = 100) => {
  requireThat(typeof value === 'string', 'INPUT_REQUIRED', `Provide ${name} as text.`);
  const text = value.trim();
  requireThat(text.length > 0 && text.length <= limit, 'INPUT_REQUIRED', `Provide ${name} using 1–${limit} characters.`);
  requireThat(!/[\u0000-\u001f\u007f]/.test(text), 'INPUT_FORMAT', `Use ordinary text for ${name}.`);
  return text;
};
const newId = (prefix) => `${prefix}-${globalThis.crypto.randomUUID()}`;
const iso = (value) => {
  const date = new Date(value ?? Date.now());
  requireThat(Number.isFinite(date.getTime()), 'DATE_FORMAT', 'Provide a valid date and time.');
  return date.toISOString();
};

export function createState({ owner = 'Sam', now } = {}) {
  return {
    schemaVersion: 1, id: newId('rr'), revision: 0, owner: cleanText(owner, 'owner name', 80),
    createdAt: iso(now), recallId: recall.id,
    product: { name: recall.productName, brand: recall.brand, rawModel: '', model: null, candidate: null, labelConfirmed: false, assessment: 'needs_label' },
    priorOwner: null, steps: {}, claim: { preparedAt: null, acknowledged: false, reference: null, reportedAt: null },
    handoff: null, receivedHandoffId: null, followUpAt: null, events: [], archives: [], requests: {},
  };
}

/** Exact recall-list matching. A separated production code follows the model. */
export function assessModel(raw) {
  const text = cleanText(raw, 'the model from the label').toUpperCase().replace(/\s+/g, ' ');
  const parts = text.split(' ');
  const model = parts[0];
  const suffix = parts[1];
  const explicitModel = /^OP\d{3}[A-Z]*$/.test(model);
  const suffixFormat = parts.length === 1 || (parts.length === 2 && /^(?=.*\d)[A-Z0-9-]{2,10}$/.test(suffix));
  if (!explicitModel || !suffixFormat) return { raw: text, model: null, suffix: null, status: 'needs_clear_label' };
  if (!recall.models.includes(model)) return { raw: text, model, suffix: suffix ?? null, status: 'outside_curated_notice' };
  return { raw: text, model, suffix: suffix ?? null, status: 'listed' };
}

function stageOf(state) {
  if (state.handoff) return 'handoff_prepared';
  if (state.product.assessment === 'listed' && !state.product.labelConfirmed) return 'confirm_current_owner';
  if (!state.product.labelConfirmed || state.product.assessment !== 'listed') return 'identify_product';
  if (state.steps.replacement_installed && state.steps.old_lid_disposed && state.steps.replacement_received) return 'resolved';
  if (state.steps.replacement_received) return 'replacement_arrived';
  if (state.claim.acknowledged) return 'awaiting_replacement';
  if (state.steps.pressure_use_stopped && state.steps.label_photo_ready) return 'claim_ready';
  return 'remedy_required';
}

function nextAction(state) {
  const stage = stageOf(state);
  if (stage === 'handoff_prepared') return { tool: 'accept_handoff', label: 'Open as the current owner', args: { handoff: state.handoff, owner: state.handoff.recipientLabel } };
  if (stage === 'identify_product' || stage === 'confirm_current_owner') return { tool: 'check_model', label: stage === 'confirm_current_owner' ? 'Confirm the label on this cooker' : 'Read the exact model label', args: { model: state.product.rawModel, confirmedFromLabel: true } };
  if (stage === 'resolved') return { tool: 'get_case', label: 'View the completed remedy record', args: {} };
  if (!state.steps.pressure_use_stopped) return { tool: 'record_step', label: 'I stopped pressure cooking', args: { step: 'pressure_use_stopped' } };
  if (!state.claim.acknowledged) {
    if (!state.steps.label_photo_ready) return { tool: 'record_step', label: 'My label photo is ready', args: { step: 'label_photo_ready' } };
    if (!state.claim.preparedAt) return { tool: 'prepare_claim', label: 'Prepare my free-lid request', args: {} };
    return { tool: 'record_claim', label: 'I received the confirmation email', args: { confirmationReceived: true } };
  }
  if (!state.steps.old_lid_disposed) return { tool: 'record_step', label: 'I disposed of the original lid', args: { step: 'old_lid_disposed' } };
  if (!state.steps.replacement_received) return { tool: 'record_step', label: 'The replacement lid has arrived', args: { step: 'replacement_received' } };
  return { tool: 'record_step', label: 'I fitted the replacement lid', args: { step: 'replacement_installed' } };
}

function caseView(state) {
  const stage = stageOf(state);
  const labels = {
    identify_product: 'Read the label', confirm_current_owner: 'Confirm the cooker in your hands',
    remedy_required: 'Free lid replacement', claim_ready: 'Ready for the official request',
    awaiting_replacement: 'Waiting for your replacement', replacement_arrived: 'Finish the lid swap',
    resolved: 'Remedy completed — owner confirmed', handoff_prepared: 'Recall card ready to pass on',
  };
  let identityText = 'Read the model on the label. This case covers the US models listed in CPSC recall 25-247.';
  if (state.product.assessment === 'listed') identityText = state.product.labelConfirmed
    ? `${state.product.model} is listed in the official US notice. ${state.owner} confirmed the physical label.`
    : `${state.product.candidate} appears in the notice. The current owner’s label confirmation is the next step.`;
  if (state.product.assessment === 'outside_curated_notice') identityText = `${state.product.rawModel} requires a separate model check. This case uses the 12-model US list in recall 25-247; consult the manufacturer for this label.`;
  if (state.product.assessment === 'needs_clear_label') identityText = 'Read the label again, keeping the model and any following production code separate. Example: OP301 I07.';
  return {
    id: state.id, revision: state.revision, owner: state.owner, priorOwner: state.priorOwner,
    productName: state.product.name, rawModel: state.product.rawModel, model: state.product.model,
    stage, statusLabel: labels[stage], nextAction: nextAction(state),
    facts: [
      { label: 'Product identity', text: identityText, sourceUrl: recall.sourceUrl },
      ...(state.product.labelConfirmed && state.product.assessment === 'listed' ? [
        { label: 'Pressure-cooking function', text: recall.remedy.pressureFunction, sourceUrl: recall.sourceUrl },
        { label: 'Other functions', text: recall.remedy.otherFunctions, sourceUrl: recall.sourceUrl },
        { label: 'Free remedy', text: recall.remedy.replacement, sourceUrl: recall.manufacturerUrl },
      ] : [{ label: 'Official notice scope', text: 'CPSC recall 25-247 covers the 12 listed US OP300-series models. Confirm the exact label to open the applicable remedy steps.', sourceUrl: recall.sourceUrl }]),
    ],
    checklist: [
      ...['pressure_use_stopped', 'label_photo_ready'].map(id => ({ id, label: stepLabels[id], done: Boolean(state.steps[id]) || (id === 'label_photo_ready' && Boolean(state.claim.acknowledged)) })),
      { id: 'claim_prepared', label: 'Prepared the official request', done: Boolean(state.claim.preparedAt || state.claim.acknowledged) },
      { id: 'claim_submitted', label: 'Owner recorded manufacturer acknowledgement', done: Boolean(state.claim.acknowledged) },
      ...['old_lid_disposed', 'replacement_received', 'replacement_installed'].map(id => ({ id, label: stepLabels[id], done: Boolean(state.steps[id]) })),
    ],
    events: state.events.map(event => ({ ...event })), sourceUrl: recall.sourceUrl, claimUrl: recall.claimUrl,
    followUpAt: state.followUpAt, claimReference: state.claim.reference,
    sourceRetrievedAt: recall.retrievedAt, coverage: 'United States · CPSC 25-247 · curated official notice',
  };
}

function addEvent(state, at, label, provenance = 'owner-reported') {
  state.events.push({ id: `${state.id}:${state.revision + 1}:${state.events.length + 1}`, at, label, actor: state.owner, provenance });
}
function requireIdentity(state) {
  requireThat(!state.handoff, 'CURRENT_OWNER_REQUIRED', 'Open the recall card with the person who now holds the cooker.');
  requireThat(state.product.labelConfirmed && state.product.assessment === 'listed', 'LABEL_REQUIRED', 'Confirm the current unit’s model from its physical label first.');
}
function hasProgress(state) { return Object.keys(state.steps).length > 0 || Boolean(state.claim.preparedAt); }
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function intentKey(name, args) {
  const { requestId, expectedRevision, ...intent } = args;
  return stable({ name, args: intent });
}
const calendarEscape = (text) => String(text).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
const calendarTime = (text) => new Date(text).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

function mutate(state, name, args, at) {
  if (name === 'check_model') {
    requireThat(typeof args.confirmedFromLabel === 'boolean', 'LABEL_CONFIRMATION_REQUIRED', 'State whether the current owner read the physical label.');
    requireThat(!state.handoff, 'CURRENT_OWNER_REQUIRED', 'Open the handoff as its current owner to check that unit.');
    const assessment = assessModel(args.model);
    requireThat(!hasProgress(state) || (assessment.status === 'listed' && assessment.model === state.product.model), 'PRODUCT_LOCKED', 'Start a fresh case for a different model; this case retains the current remedy history.');
    const confirmed = assessment.status === 'listed' && (args.confirmedFromLabel || (hasProgress(state) && state.product.labelConfirmed));
    state.product = { ...state.product, rawModel: assessment.raw, candidate: assessment.model, model: confirmed ? assessment.model : null, labelConfirmed: confirmed, assessment: assessment.status };
    addEvent(state, at, confirmed ? `Confirmed label ${assessment.raw}; official model ${assessment.model}` : `Recorded model information: ${assessment.raw}`);
    return { assessment: { ...assessment, confirmedFromLabel: confirmed, sourceUrl: recall.sourceUrl } };
  }
  if (name === 'create_handoff') {
    const recipientLabel = cleanText(args.recipientLabel, 'recipient name', 80);
    requireThat(!state.claim.acknowledged && !Object.keys(state.steps).length, 'REMEDY_IN_PROGRESS', 'Finish or preserve this owner’s active remedy record before starting a transfer.');
    const handoff = {
      schemaVersion: 1, kind: 'recall-relay-handoff', id: newId('handoff'), recallId: recall.id,
      createdAt: at, senderLabel: state.owner, recipientLabel,
      product: { name: recall.productName, brand: recall.brand, reportedModel: state.product.rawModel || null },
    };
    state.handoff = handoff;
    addEvent(state, at, `Prepared a recall card for ${recipientLabel}`, 'local-tool');
    return { handoff, delivery: 'prepared', message: 'Share this card with the current owner. They confirm the product label and complete the official request.' };
  }
  if (name === 'accept_handoff') {
    const packet = args.handoff;
    requireThat(packet && typeof packet === 'object' && !Array.isArray(packet), 'HANDOFF_FORMAT', 'Import a Recall Relay product card.');
    requireThat(packet.schemaVersion === 1 && packet.kind === 'recall-relay-handoff' && packet.recallId === recall.id, 'HANDOFF_SCOPE', 'Use a version 1 card for US CPSC recall 25-247.');
    const handoffId = cleanText(packet.id, 'handoff identifier', 100);
    requireThat(state.receivedHandoffId !== handoffId, 'HANDOFF_ALREADY_OPEN', 'This product card is already open. Resume the current case.');
    const owner = cleanText(args.owner, 'current owner name', 80);
    const sender = cleanText(packet.senderLabel, 'previous owner name', 80);
    const reportedModel = packet.product?.reportedModel;
    requireThat(reportedModel === null || reportedModel === undefined || (typeof reportedModel === 'string' && reportedModel.length <= 100), 'HANDOFF_FORMAT', 'Use a product card with a concise label transcription.');
    const archived = { id: state.id, owner: state.owner, product: state.product, steps: state.steps, claim: state.claim, events: state.events, handoff: state.handoff };
    const fresh = createState({ owner, now: at });
    fresh.revision = state.revision;
    fresh.requests = state.requests;
    fresh.archives = [...state.archives, archived].slice(-10);
    fresh.receivedHandoffId = handoffId;
    fresh.priorOwner = sender;
    if (reportedModel) {
      const assessment = assessModel(reportedModel);
      fresh.product = { ...fresh.product, rawModel: assessment.raw, candidate: assessment.model, assessment: assessment.status };
    }
    Object.assign(state, fresh);
    addEvent(state, at, `Opened ${sender}’s recall card as ${owner}; physical-label confirmation is next`);
    return { acceptedHandoffId: handoffId, identityProvenance: 'previous-owner-report' };
  }
  if (name === 'record_step') {
    requireIdentity(state);
    const step = args.step;
    requireThat(Object.hasOwn(stepLabels, step), 'STEP_REQUIRED', 'Choose a documented remedy step.');
    requireThat(!state.steps[step], 'STEP_ALREADY_RECORDED', 'This step is already recorded. Resume the next action.');
    if (step !== 'pressure_use_stopped') requireThat(Boolean(state.steps.pressure_use_stopped), 'STOP_PRESSURE_USE_FIRST', 'Record that pressure cooking has stopped before continuing the remedy.');
    if (step === 'replacement_received') requireThat(Boolean(state.claim.acknowledged), 'ACKNOWLEDGEMENT_REQUIRED', 'Record the manufacturer acknowledgement before recording delivery.');
    if (step === 'replacement_installed') {
      requireThat(Boolean(state.steps.replacement_received), 'REPLACEMENT_REQUIRED', 'Record receipt of the replacement lid first.');
      requireThat(Boolean(state.steps.old_lid_disposed), 'ORIGINAL_LID_REQUIRED', 'Record disposal of the original pressure-cooking lid first.');
    }
    state.steps[step] = { at, provenance: 'owner-reported' };
    addEvent(state, at, stepLabels[step]);
    if (step === 'replacement_installed') state.followUpAt = null;
    return { recordedStep: step, provenance: 'owner-reported' };
  }
  if (name === 'prepare_claim') {
    requireIdentity(state);
    requireThat(Boolean(state.steps.pressure_use_stopped), 'STOP_PRESSURE_USE_FIRST', 'Record that pressure cooking has stopped before preparing the request.');
    requireThat(Boolean(state.steps.label_photo_ready), 'LABEL_PHOTO_REQUIRED', 'Prepare a clear photo showing the model and serial on the product label.');
    const claimPacket = {
      url: recall.claimUrl,
      fields: [
        { name: 'Model', value: state.product.model },
        { name: 'Serial number', value: 'Enter directly on the official manufacturer form' },
        { name: 'Label photo', value: 'Owner reports a legible model and serial photo is ready' },
        { name: 'Delivery details', value: 'Enter directly on the official manufacturer form' },
      ],
      instructions: recall.claimRequirements,
      submission: 'prepared', provenance: 'local-tool',
    };
    if (!state.claim.preparedAt) {
      state.claim.preparedAt = at;
      addEvent(state, at, 'Prepared the official replacement-lid request; manufacturer form is the next handoff', 'local-tool');
    }
    return { claimPacket };
  }
  if (name === 'record_claim') {
    requireIdentity(state);
    const reference = args.reference?.trim() ? cleanText(args.reference, 'the manufacturer acknowledgement', 160) : null;
    requireThat(args.confirmationReceived === true || (args.confirmationReceived === undefined && Boolean(reference)), 'ACKNOWLEDGEMENT_REQUIRED', 'Confirm that you received the manufacturer confirmation email. A reference is optional.');
    requireThat(!state.claim.reference || reference === null || state.claim.reference === reference, 'CLAIM_ALREADY_RECORDED', 'Keep the recorded acknowledgement with this case; use its reference for follow-up.');
    if (!state.claim.acknowledged) {
      state.claim = { ...state.claim, acknowledged: true, reference, reportedAt: at };
      addEvent(state, at, 'Owner reported receiving the manufacturer’s confirmation email');
    } else if (reference && !state.claim.reference) {
      state.claim.reference = reference;
      addEvent(state, at, 'Owner added the acknowledgement reference');
    }
    return { claimStatus: 'awaiting_replacement', provenance: 'owner-reported' };
  }
  if (name === 'set_followup') {
    requireIdentity(state);
    requireThat(stageOf(state) !== 'resolved', 'REMEDY_COMPLETE', 'The completed remedy record is ready to keep.');
    requireThat(typeof args.dueAt === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(args.dueAt), 'TIMEZONE_REQUIRED', 'Use an ISO date and time with a timezone.');
    const dueAt = iso(args.dueAt);
    requireThat(dueAt > at, 'FUTURE_DATE_REQUIRED', 'Choose a future follow-up time.');
    state.followUpAt = dueAt;
    addEvent(state, at, `Saved a follow-up for ${dueAt}`, 'local-tool');
    const calendar = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Recall Relay//Remedy follow-up//EN',
      'BEGIN:VEVENT', `UID:${state.id}-followup@recall-relay.local`, `DTSTAMP:${calendarTime(at)}`,
      `DTSTART:${calendarTime(dueAt)}`, 'SUMMARY:Check the replacement pressure-cooking lid',
      `DESCRIPTION:${calendarEscape(`Resume your owner-reported recall case. Official notice: ${recall.sourceUrl}`)}`,
      'END:VEVENT', 'END:VCALENDAR', '',
    ].join('\r\n');
    return { dueAt, calendar, calendarContent: calendar, delivery: 'calendar-file-prepared' };
  }
  throw new RelayError('TOOL_UNKNOWN', 'Choose a tool from the current tools list.');
}

export function executeTool(state, name, args = {}, { now } = {}) {
  try {
    requireThat(state?.schemaVersion === 1 && state.recallId === recall.id, 'STATE_VERSION', 'Start a current Recall Relay case.');
    requireThat(args && typeof args === 'object' && !Array.isArray(args), 'INPUT_FORMAT', 'Provide tool arguments as an object.');
    requireThat(toolDefinitions.some(tool => tool.name === name), 'TOOL_UNKNOWN', 'Choose a tool from the current tools list.');
    if (name === 'get_case') return { state, result: { ok: true, case: caseView(state) } };
    const at = iso(now);
    const requestId = args.requestId === undefined ? null : cleanText(args.requestId, 'request identifier', 120);
    const fingerprint = intentKey(name, args);
    if (requestId && Object.hasOwn(state.requests, requestId)) {
      const prior = state.requests[requestId];
      requireThat(prior.fingerprint === fingerprint, 'REQUEST_ID_REUSED', 'Use a new request identifier for a new intent.');
      return { state, result: { ...structuredClone(prior.payload), ok: true, case: caseView(state), replayed: true } };
    }
    if (args.expectedRevision !== undefined) requireThat(Number.isInteger(args.expectedRevision) && args.expectedRevision === state.revision, 'REVISION_CONFLICT', 'Read the current case and review its next action before retrying.');
    const next = structuredClone(state);
    const payload = mutate(next, name, args, at);
    next.revision = state.revision + 1;
    if (requestId) {
      // Use a data property so all caller-chosen identifiers stay ordinary keys.
      Object.defineProperty(next.requests, requestId, { value: { fingerprint, payload: structuredClone(payload) }, enumerable: true, configurable: true, writable: true });
      const keys = Object.keys(next.requests);
      for (const key of keys.slice(0, Math.max(0, keys.length - 128))) delete next.requests[key];
    }
    return { state: next, result: { ok: true, case: caseView(next), ...payload } };
  } catch (error) {
    return { state, result: { ok: false, case: state?.schemaVersion === 1 ? caseView(state) : null, error: { code: error.code ?? 'EXECUTION_FAILED', message: error instanceof RelayError ? error.message : 'Execution failed. Resume the saved case and retry the action.' } } };
  }
}
