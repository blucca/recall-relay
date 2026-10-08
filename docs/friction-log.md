# Following the case, across people and conversations

Observed October 9, 2026. These are development trials with fictional household statements, the real US CPSC recall 25-247, and an actual Cursor Agent connected through MCP. External user feedback is a separate milestone.

## 1. The assistant finished; the screen stayed behind

The browser created Sam's card, switched to Alex's recipient preview, and confirmed label `OP301 I07`. A fresh MCP assistant then recorded the reported pressure-use stop and photo readiness and prepared the official form. The server reached revision 7; the existing screen still offered **“I stopped pressure cooking.”**

**Change:** publish a case snapshot after each committed mutation. The browser follows that snapshot, presents the current holder beside its revision, and offers a large **Focus view**. Current-step audio is derived from the displayed case.

**Observed result:** a second assistant conversation resumed Alex's case, recorded the reported confirmation email and original-lid disposal, and left delivery pending. The same open page showed revisions **8 → 9**, changing from **“Retire the original pressure lid”** to **“Your next step can wait.”** The trace contains the actual tool inputs, outputs, and browser observations: [live-case-continuity.json](live-case-continuity.json).

## 2. A handoff should remain useful when opened again

The original link led back to the acceptance screen, followed by an already-open response. The saved owner journal already contained the useful next step.

**Change:** include the received handoff ID in the case view. Opening the same accepted card takes the current owner straight to their saved progress. Static tabs also follow that browser's case changes. Development-server links target the published companion, so the recipient can open the card on their own device.

## 3. “Photo ready” needs a practical bridge to the official form

The first UI offered a readiness statement. The physical label and image preparation were separate from that screen.

**Change:** add optional camera/file selection, local image zoom, and a download action beside the label transcription. The owner reads and confirms the model. The case saves their readiness report; the actual image and delivery details go to the manufacturer's form through the owner.

**Browser trial:** a 390 px recipient page opened a generated, explicitly marked demonstration label image. Image selection generated zero HTTP requests. The preview remained available through photo preparation. Reopening the accepted handoff resumed the same case; another tab followed the remaining owner-reported steps through completion.

## Tool and platform feedback

- **MCP SDK / state design:** a self-contained `get_case` result gave a fresh assistant the identity, source-bound facts and next action needed to continue. Keeping household persistence outside transport sessions made the second conversation straightforward.
- **Companion UI:** durable tool state and visible conversational continuity need a shared observation path. The local companion now uses read-only event snapshots alongside the real MCP mutation path.
- **Cursor host setup:** the initial Ask-mode attempt received client-side tool rejections. The successful trial used an enabled MCP server in Agent mode, started from the directory containing `.cursor/mcp.json`. This host setup belongs in the developer runbook.
- **Alexa+ concept boundary:** the browser offers typed phrase simulation and optional device speech. The connected assistant chooses real MCP tools. These paths are labeled in the interface and share the same saved case.
