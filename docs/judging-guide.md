# Try Recall Relay

**One product, two owners, a remedy that survives an interruption.**

## Start with the complete story

- [Watch the 2:35 English demo on YouTube](https://www.youtube.com/watch?v=DJpOeX6mIPQ), or use the [direct player with captions](https://blucca.github.io/recall-relay/demo/).
- [Try the public browser companion](https://blucca.github.io/recall-relay/). It runs immediately and saves the sample case in that browser.
- [Read the project story](project-story.md) and [product feedback](product-feedback.md).

The public companion uses the same domain engine as the MCP service. The steps below exercise the actual protocol and persistent service locally.

## Run the MCP version

Prerequisites: **Node.js 22+**, npm, and a browser. Installation retrieves packages from npm; the running local experience uses the included recall dataset. Opening the manufacturer's form uses its public website. A model-driven trial uses your own MCP-capable assistant.

```sh
git clone https://github.com/blucca/recall-relay.git
cd recall-relay
npm ci
npm start
```

Open **http://127.0.0.1:4317/**. The page connects to the local service through the official MCP SDK. The service saves the household at `temp/recall-relay-runtime/state.json` inside a standalone checkout. Keep this browser tab open throughout the trial.

For Cursor, save this as **`.cursor/mcp.json` in the checkout**, enable the server, and start an **Agent-mode** conversation from that directory. Other MCP hosts can use the same server URL in their configuration.

```json
{
  "mcpServers": {
    "recall-relay": {
      "url": "http://127.0.0.1:4317/mcp"
    }
  }
}
```

## Reproduce the handoff and saved return

| Step | Action | Visible result |
|---|---|---|
| 1 | Start a fresh demo. Choose **I passed it on**, keep `OP301 I07`, enter Alex, and choose **Make a recall handoff**. | A Sam → Alex product/recall card. |
| 2 | Choose **Continue as Alex** for the labeled recipient preview. Confirm the sample physical-label statement and model. | Alex's separate owner journal and the source-linked remedy. |
| 3 | Switch to **Focus view**. Ask the connected assistant the preparation prompt below. | The same open screen advances with saved tool results to the official request. |
| 4 | Open the official form to inspect the request requirements. Return to Relay and choose **I have the confirmation email** to open the full view, then **Demo: use SAMPLE-ACK**. Report disposal of the original lid for this sample household. | The saved case waits for delivery. |
| 5 | Start a **fresh assistant conversation** and give it the arrival prompt below. | The same case resumes with fitting the replacement as the next action. |
| 6 | In the UI, report fitting the replacement for this sample household. | **Remedy completed · owner-reported**, with the journal retained. |

**Preparation prompt**

> In this sample household, I'm Alex. I stopped pressure cooking and my label photo is ready. Help me prepare the free-lid request.

**Fresh-conversation arrival prompt**

> In our scenario, the replacement lid arrived. Where were we? Record its arrival and leave fitting it as my next step.

The recorded run used `get_case` → two `record_step` calls → `prepare_claim`, followed in the fresh conversation by `get_case` → `record_step`. A host can choose its own valid call sequence. The important result is the saved current-holder case and correct next step. [Demo trace](demo-evidence.json).

### Choose the handoff mode for your trial

- **One local screen plus an MCP assistant:** use **Continue as Alex**. Both observe the local server's current case, as shown in the video.
- **A recipient on a separate device:** share the handoff link. It opens the public companion and creates the recipient's separate browser-local journal. Reopening that accepted link in the same browser resumes their progress.

Optional label photos use device-local previews. The current holder reads and confirms the model; the original photo and delivery information go to the manufacturer through its form. The walkthrough uses fictional statements and the explicitly labeled sample acknowledgement.

## Reproduce service recovery

```sh
npm run smoke:mcp
```

This small protocol check starts its own isolated service, negotiates MCP, exercises the remedy workflow, restarts the process, and resumes its saved case. Its output reports the negotiated protocol and completed checks. Temporary evidence stays under `temp/recall-relay-runtime/`.

For interactive process recovery, stop `npm start` with Ctrl+C and run it again. Reopen the same local page; the saved case supplies the next step. **Restart demo** replaces the sample household. Use `RECALL_RELAY_STATE_FILE` to select a separate saved household and `RECALL_RELAY_PORT` to select another local port.

## Evidence and scope

| Question | Inspect |
|---|---|
| Which official facts drive the workflow? | [Source notes](../data/source-notes.md), including the 12-model US list and manufacturer instructions. |
| Which calls happened in the video? | [Recorded demo evidence](demo-evidence.json). |
| How did the open screen follow an external assistant? | [Live continuity trial](live-case-continuity.json) and [development notes](friction-log.md). |
| How do state, handoff, and tool contracts work? | [Implementation contract](../CONTRACT.md), `src/engine.mjs`, and `src/server.mjs`. |

The current implementation is an Alexa+ concept with a custom conversation simulator and real, assistant-independent MCP service. The included data covers US CPSC recall **25-247**. Official form submission happens on the manufacturer's website; Relay records the holder's reported progress.
