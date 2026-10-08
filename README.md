# Recall Relay

**Care should travel with the product.**

A voice-first recall handoff and remedy companion for the person who now owns a gifted or second-hand appliance. Built as an Alexa+ concept with a working, assistant-independent MCP service.

[Watch the 2:35 demo](https://blucca.github.io/recall-relay/demo/) · [Try the browser concept](https://blucca.github.io/recall-relay/) · [Official recall](https://www.cpsc.gov/Recalls/2025/SharkNinja-Recalls-1-8-Million-Foodi-Multi-Function-Pressure-Cookers-Due-to-Burn-Hazard-Serious-Burn-Injuries-Reported) · [Source evidence](data/source-notes.md)

The [first playable demo](docs/demo-walkthrough.md) follows one sample household through two actual MCP agent conversations, a phone-sized label check, the official form, and a saved return. It includes English narration and captions. [Recorded tool sequence](docs/demo-evidence.json).

## The missing handoff

SharkNinja's recall FAQ asks people who gave away or sold a cooker to forward the notice to its current holder. Recall Relay turns that instruction into a usable handoff:

1. **Pass the recall along.** Create a shareable product card for the new owner. It carries the model note and recall identity; private claim history stays with its owner.
2. **Check the actual cooker.** The current owner confirms the physical label. `OP301 I07` matches official model `OP301`; letters inside model names remain significant.
3. **Take the specific remedy.** Confirmed listed models receive source-linked, function-level guidance and the official free replacement-lid request.
4. **Keep the place.** Record the manufacturer's confirmation email, dispose of the original lid as instructed, save a calendar follow-up, and resume when the replacement arrives.
5. **Finish the remedy.** Record receipt and fitting of the replacement. Each progress event identifies its owner-reported provenance.

Initial scope: **US CPSC recall 25-247**, announced May 1, 2025, with 12 precisely listed models. Official sources were checked October 8, 2026. Household names, acknowledgements and walkthrough events are sample inputs.

## Run locally

Node.js 22 or newer:

```sh
npm ci
npm start
# Open http://127.0.0.1:4317/
```

The local page connects through the **official MCP SDK** using Streamable HTTP, protocol **2025-11-25**. State is saved atomically in `temp/recall-relay-runtime/state.json`. A fresh model conversation or restarted server can resume the same case.

Keep the page open while your MCP assistant works. **The screen follows committed tool results live.** Choose **Focus view** for a large current-holder card, one next step and optional on-device reading of that step. The browser's phrase shortcuts remain a labeled conversation simulator.

For an MCP-capable assistant, add this local server to its configuration:

```json
{
  "mcpServers": {
    "recall-relay": { "url": "http://127.0.0.1:4317/mcp" }
  }
}
```

The single-household development server binds to loopback. `RECALL_RELAY_PORT` and `RECALL_RELAY_STATE_FILE` select a different local port or state file. A production multi-household service would add account linking and authenticated, isolated household storage.

## What actually runs

| Layer | Behavior |
|---|---|
| Browser concept | Real state transitions, cross-browser handoff links, local persistence, a next-step Focus view, device-local label-photo preview, optional on-device read-aloud, calendar export. Typed phrase routing provides the Alexa+ interaction simulation. |
| Local MCP | Real initialize, tools/list and tools/call through the official SDK. Structured results, serialized mutations, atomic persistence, idempotency and revision checks. |
| Assistant integration | A connected MCP agent chooses tools. Fresh Cursor Agent conversations exercised preparation and stateful resumption, with the same open screen following each committed step; see [live continuity evidence](docs/live-case-continuity.json). |
| Case observation | The local screen subscribes to saved case snapshots. The static companion follows changes across tabs in the same browser. Reopening an accepted handoff resumes its owner journal. |
| Official facts | Curated CPSC and manufacturer source excerpts; precise model matching and source-bound remedy guidance. |
| Manufacturer request | The actual form opens on SharkNinja's recall-program site. Contact details, serial and photo are entered there. |
| Progress | The current owner reports completed steps and receipt of the confirmation email. `SAMPLE-ACK` is explicitly labeled in the walkthrough. |

The browser concept and local MCP server use **the same domain engine**. A portable handoff contains first names, the model note and recall identity. A recipient's label confirmation starts a separate journal.

## Walk through the concept

Choose **I passed it on**, keep sample label `OP301 I07`, and make a card for Alex. Open its link in a separate browser profile, or use the clearly labeled recipient preview. As Alex, read the physical label; optionally take or choose a photo and zoom in alongside the model field. Confirm the label, stop pressure cooking, prepare the label photo and open the official request handoff. Use **Demo: use SAMPLE-ACK** for the sample confirmation. Record disposal of the original lid, reopen the same handoff, and finish the replacement steps.

Photo previews use device-local blob URLs and last for the current tab. Use **Save photo for the official form** to keep a copy. The saved case holds the owner's readiness report. The owner supplies their original photo and delivery details directly to the manufacturer.

Development-server handoff links open the [public browser companion](https://blucca.github.io/recall-relay/) on the recipient's device, where their separate case is saved. A fork can set `PUBLIC_HANDOFF_URL` in `web/app.mjs` to its own published companion.

Use the source links to inspect the exact model list, the additional-code rule, function-level remedy and the manufacturer's instructions for a gifted cooker.

## Development

```sh
npm test                 # Domain contract and recovery checks
npm run smoke:mcp        # Real protocol, persistence and restart checks
npm run smoke:events     # External MCP mutation -> persisted, live screen snapshot
npm run build:static     # Browser-only bundle in temp/recall-relay-runtime/site/
npm run build:static -- --outdir /path/to/output
```

The static bundle works at a website subpath and stores its household in that browser. Handoff content travels in the link fragment. The local server supplies the real MCP variant.

Architecture and tool interfaces: [CONTRACT.md](CONTRACT.md). Third-party source scope and attribution: [data/source-notes.md](data/source-notes.md).

Observed interaction friction and tool feedback: [development field notes](docs/friction-log.md). The [first MCP probe](docs/live-mcp-probe.json) records the earlier preparation/resumption run.

## Authorship

Developed by Blucca, an autonomous AI engineering agent, under the account owner's authorization. Agent work includes product research, design, implementation and testing. The account owner handles platform identity and account actions. Alexa+ is the target concept platform; the UI is a custom simulator.

Source code and original interface assets: MIT. Official recall facts and attributed source excerpts retain their original source attribution.
