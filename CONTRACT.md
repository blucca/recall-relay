# Recall Relay — implementation contract

Purpose: help a recall reach the person who now owns a gifted/second-hand product, and help that owner finish the remedy. Initial case: US CPSC 25-247, SharkNinja OP300-series pressure-cooking lid. Official facts stay source-linked; household history and progress are explicitly owner-reported.

## Interfaces (2026-10-08)

`src/engine.mjs` exports:
- `createState({ owner = 'Sam', now } = {})`
- `executeTool(state, name, args = {}, { now } = {})` -> `{ state, result }` (synchronous; data errors returned structurally)
- `toolDefinitions` -> array `{ name, description, inputSchema }`
- `recall` -> curated official data

Every result: `{ ok: boolean, case: CaseView, ...payload, error?: { code, message } }`.
`CaseView`:
```
{ id, revision, owner, productName, rawModel, model, stage,
  statusLabel, nextAction: { tool, label, args },
  facts: [{ label, text, sourceUrl }],
  checklist: [{ id, label, done }],
  events: [{ id, at, label, actor, provenance }],
  sourceUrl, claimUrl, followUpAt }
```
Mutation inputs may include `requestId` (idempotency) and `expectedRevision` (compare-and-swap). Failure leaves state unchanged.

Tools:
- `get_case {}`: resume with all context.
- `check_model { model, confirmedFromLabel: boolean }`: apply precise US model-list/suffix rule. Shared/inherited identification asks the current owner to confirm the label. Ambiguous/unlisted labels keep identification open.
- `create_handoff { recipientLabel }`: returns `handoff` portable JSON containing product/recall identity and sender label; serial, photos, addresses, claim references and private journal stay local. Sender retains a handoff-prepared state.
- `accept_handoff { handoff, owner }`: starts recipient case; recipient re-confirms product identity from the physical label. Creates a separate journal.
- `record_step { step }`, step in `pressure_use_stopped`, `label_photo_ready`, `old_lid_disposed`, `replacement_received`, `replacement_installed`. Owner-reported, with ordering checks.
- `prepare_claim {}`: returns `claimPacket: { url, fields, instructions }`; opens the official manufacturer form. Actual filing happens there.
- `record_claim { confirmationReceived: true, reference?: string }`: owner reports receiving the manufacturer confirmation email; the reference is optional; stage becomes awaiting_replacement. Form preparation and manufacturer acknowledgement are separate events.
- `set_followup { dueAt }`: returns calendar content and stores date.

Stages: `identify_product`, `confirm_current_owner`, `remedy_required`, `claim_ready`, `awaiting_replacement`, `replacement_arrived`, `resolved`, `handoff_prepared`.

## Frontend

`web/index.html`, `web/styles.css`, `web/app.mjs`: polished voice-first Alexa+ concept simulator. Persistent sample household, real domain tools, official recall evidence. Local text/touch interaction works; optional browser speech synthesis/recognition. Label simulation clearly. No photo/voice cloud upload. Real official form opens in another tab.

Client module `web/client.mjs` exposes `createClient()` -> `{ callTool(name, args): Promise<result>, reset(): Promise<result>, mode }`. Protocol agent implements this. Browser with local server defaults live MCP; static host uses the same engine with localStorage. Successful current case shown from `result.case`.

Minimum meaningful interaction: identify label `OP301 I07`; distinguish prior-owner knowledge and recipient verification; prepare a portable handoff; recipient resumes and follows correct official remedy; prepare claim; record owner acknowledgement; return later and complete replacement steps. Clear source and operation provenance.

## MCP server

`src/server.mjs` exposes Streamable HTTP `/mcp` protocol >=2025-11-25 using official SDK. Persist one household state per server instance in `RECALL_RELAY_STATE_FILE`, default workspace temp path. Bind loopback by default. Serve frontend at `/`, engine at `/src/`, official data at `/data/`. Protocol client uses initialize/tools-list/tools-call; give tools structuredContent plus text content. Transport requests mutate shared domain state serially. Client fixture mode uses the identical engine.

## Ownership for current build
- Root: engine, tests, README, strategy, repository and publishing.
- Product/data agent: data/recall.json, data/source-notes.md only.
- Protocol agent: src/server.mjs, web/client.mjs, package.json, scripts/mcp-smoke.mjs only.
- UI agent: web/index.html, web/styles.css, web/app.mjs only.

Keep generated/runtime files under /home/ima/repos/gain/temp/. Source is original and separate from BidDelta.
