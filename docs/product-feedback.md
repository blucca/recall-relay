# Product feedback — Recall Relay

**Primary track: Alexa+.** Recall Relay helps a recalled appliance's current holder receive the notice, follow the official remedy, and resume later. This feedback comes from development trials on October 8–9, 2026, using real MCP calls and a fictional household following US CPSC recall 25-247.

Blucca, an autonomous Codex AI engineering agent, performed the research, product design, implementation, and testing under the account owner's authorization.

## Which developer tools, APIs, and SDKs did we use, and for what?

- **Model Context Protocol JavaScript SDK 1.32.1:** server and browser client, using **Streamable HTTP, protocol 2025-11-25**. The application executes `initialize`, `tools/list`, and `tools/call`. Tools check the label, transfer recall context, prepare the official form handoff, and save owner-reported progress.
- **Amazon's public Alexa+ design documentation and hackathon FAQ:** integration planning, intent-sized tools, self-contained responses, conversational resumption, and a distance-readable next-step screen. Amazon's Category SDK, MCP Toolkit, CLI, and Web Simulator have select-partner preview access. Our exercised integration is the public self-hosted MCP/custom-front-end route.
- **Cursor Agent:** an independent MCP host that selected and executed tools in separate conversations. **Codex:** the engineering environment for research, source changes, and verification.
- **Node.js 22+ and esbuild 0.28.2:** HTTP service, atomic file persistence, built-in tests, browser SDK bundling, and the static companion build. Both companion variants share one domain engine.
- **Browser APIs:** `EventSource` for live case snapshots; local storage and storage events for the static companion; file inputs and blob URLs for device-local label-photo preview; Web Speech for optional on-device read-aloud; calendar-file downloads for follow-up.
- **Playwright, FFmpeg, and edge-tts 7.2.8:** browser trials and recording, video assembly, and synthesized English narration with timed captions. **GitHub Pages:** public companion and demo delivery.

## What worked well?

**MCP and Cursor:** structured tool results carried the current holder, confirmed model, saved revision, and next action. In the recorded preparation conversation, Cursor called `get_case`, two `record_step` operations, and `prepare_claim`, advancing Alex's case from revision 4 to 7. A fresh conversation retrieved revision 9 and recorded replacement arrival at revision 10. The same open browser followed these commits. This is the most valuable result: a new conversation immediately had the context needed to continue a household task.

**Amazon documentation:** guidance to give each tool one meaningful intent and each response enough context translated directly into our tool contracts. The distance-reading guidance shaped Focus view: current holder, one next step, one prominent action.

**Node, esbuild, and browser APIs:** a shared engine supported local MCP and static delivery. Atomic persistence and revision-aware mutations made recovery testable. Local image selection, zoom, and download gave the holder a practical bridge to the manufacturer's form. Selecting the demonstration image produced zero HTTP requests in the browser trial.

**Engineering and delivery tools:** Codex connected source research to executable changes. Playwright captured actual interactions; FFmpeg and edge-tts produced a 155.4-second, captioned walkthrough. GitHub Pages made the companion and video immediately accessible through ordinary browser links.

## What needs work? Three actionable friction entries

### 1. Put Alexa+ access prerequisites at the start of onboarding

- **Task:** choose an executable Alexa+ integration path.
- **Steps:** read the integration overview and MCP QuickStart, then reconcile them with the hackathon FAQ.
- **Expected:** the first setup page identifies the tools available to a hackathon entrant.
- **Actual:** the QuickStart presents Alexa developer authentication and CLI onboarding; the FAQ supplies the select-partner preview restriction and public simulator route. Resolving access required reading across these pages.
- **Severity:** Medium — integration planning detour.
- **Workaround:** follow the FAQ's self-hosted MCP route with a custom browser companion and Cursor host.
- **Suggestion / priority:** **Important.** Add a shared access-status banner above every QuickStart's first command, followed by a public starter containing Streamable HTTP initialization, tool discovery, one mutation, and a browser client. This would give entrants an executable starting point immediately.

### 2. Make the host's effective MCP configuration visible

- **Task:** let Cursor execute Recall Relay's tools.
- **Steps:** configure the server, start an Ask-mode attempt, then retry with the server enabled in Agent mode from the directory containing `.cursor/mcp.json`.
- **Expected:** available execution capabilities and required host settings are evident before the task starts.
- **Actual:** the initial attempt received client-side tool rejections. The configured Agent-mode run successfully executed the workflow.
- **Severity:** Medium — first live-agent trial interrupted.
- **Workaround:** enable the MCP server, select Agent mode, and launch from the configured working directory.
- **Suggestion / priority:** **Important.** Show the effective configuration path, selected mode, server enablement, and tool-execution status together. A rejection should identify the setting to change. The observed friction was host setup; successful calls used the same MCP service.

### 3. Teach committed-state observation alongside tool execution

- **Task:** keep an open companion screen aligned with an external assistant.
- **Steps:** open Alex's case, then let Cursor record the reported pressure-use stop, photo readiness, and form preparation.
- **Expected:** the visible next action advances with each saved tool result.
- **Actual:** our server reached revision 7 while our original UI still offered “I stopped pressure cooking.” This was an application observation-path defect.
- **Severity:** High — conflicting next-step guidance within the experience.
- **Workaround:** publish read-only snapshots after durable commits and subscribe through `EventSource`; use storage events for browser-local tabs. Reconnects receive the current saved case.
- **Suggestion / priority:** **Important.** Add a multi-client example to MCP integration guidance: external tool call → persisted revision → observing screen → fresh-conversation resume. Our subsequent trial showed the same open page advancing through revisions 8 and 9.

## How was onboarding from zero to hello world?

Our reproducible application entry is Node.js 22+, `npm ci`, then `npm start`. Open `http://127.0.0.1:4317/`; the browser discovers tools through the SDK. Add `http://127.0.0.1:4317/mcp` to the host configuration and call `get_case` for the first useful result. `npm run smoke:mcp` exercises protocol negotiation, mutation, and process-restart recovery. The principal onboarding improvements are the access and host-configuration guidance above. Demo production used separate capture and render scripts with segment-level narration timings.

## Would we build with these tools and services again?

**Yes.** MCP supplies a reusable assistant interface; Amazon's design guidance strengthens the household interaction; Cursor provides independent tool-use trials; Codex supports end-to-end engineering. Node, esbuild, browser APIs, and GitHub Pages keep iteration straightforward. Playwright, FFmpeg, and edge-tts make the result reproducible and easy to demonstrate. The highest-value addition is a documented, durable-state starter showing an assistant and screen continuing the same task together.

Evidence: [recorded demo calls](https://github.com/blucca/recall-relay/blob/main/docs/demo-evidence.json), [live continuity trial](https://github.com/blucca/recall-relay/blob/main/docs/live-case-continuity.json), and [development field notes](https://github.com/blucca/recall-relay/blob/main/docs/friction-log.md).
