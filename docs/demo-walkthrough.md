# Recall Relay — demo walkthrough

[Watch on YouTube](https://www.youtube.com/watch?v=DJpOeX6mIPQ) · [Direct player and captions](https://blucca.github.io/recall-relay/demo/) · [Try the browser concept](https://blucca.github.io/recall-relay/)

**A cooker changes hands. Its recall follows.** This draft follows Sam’s gifted Ninja Foodi to Alex, through a label check, the official replacement-lid program, and a later return to finish the remedy.

The video uses real screen recordings of the running Alexa+ concept UI, a phone-sized recipient preview, and two fresh Cursor Agent conversations connected to the local MCP service. Waiting intervals are edited for pace, and the narration is synthesized. Sam, Alex, the demonstration label, `SAMPLE-ACK`, and their reported actions are sample inputs. “A few days later” is a scenario time jump.

## Reproduce the seven-step story

[Run the local service](../README.md#run-locally) and connect an MCP-capable assistant to `http://127.0.0.1:4317/mcp`. Start a fresh demo and keep its browser tab open. The recorded sequence uses one local MCP case and the labeled recipient preview; the public companion saves its own browser-local case.

1. **Start with the previous owner.** Choose **I passed it on**, keep the sample model note `OP301 I07`, and enter Alex as the current holder. Sam’s remembered model begins the handoff.
2. **Pass along the recall.** Choose **Make a recall handoff**. Inspect the Sam → Alex card and shareable link, then use **Continue as Alex** for the recipient preview. Alex starts a separate owner journal.
3. **Check the cooker in Alex’s hands.** Use a phone-sized viewport, choose a clearly marked demonstration label image, read the model, and confirm the physical-label statement. The matched model brings up the official guidance: stop pressure cooking; air frying and other functions can continue under the recall notice.
4. **Let the connected agent prepare the request.** Tell it: “In this sample household, I’m Alex. I stopped pressure cooking and my label photo is ready. Help me prepare the free-lid request.” In the recording, the agent selects `get_case`, two `record_step` calls, and `prepare_claim`. The same open **Focus view** advances from revision **4 → 7** with the committed results.
5. **Visit the official program and save sample progress.** Open the manufacturer's form. Back in Relay's Focus view, choose **I have the confirmation email** to open the full view, then **Demo: use SAMPLE-ACK**. Report disposal of the original lid following the program's instructions. The case reaches revision **9**, waiting for delivery.
6. **Resume in a fresh conversation.** Tell a new connected-agent conversation: “In our scenario, the replacement lid arrived. Where were we? Record its arrival and leave fitting it as my next step.” The recorded agent retrieves the existing case with `get_case` and records `replacement_received`. The open screen advances to revision **10** and the fitting step.
7. **Finish the remedy.** Use the UI to report fitting the replacement according to the manufacturer’s instructions. Revision **11** shows **Remedy completed · owner-reported**, with the case history retained.

## Sources and evidence types

| Material | Source type |
|---|---|
| Recall identity, model list, function-specific guidance and remedy | Official US CPSC recall **25-247** and manufacturer excerpts, linked in [source notes](../data/source-notes.md). |
| Replacement request destination and required details | The [manufacturer’s recall form](https://www.rqa-inc.com/client/SharkNinja/SubForm/index.html), opened in the recording. The owner supplies their photo and delivery details there. |
| Tool selection, saved revisions and screen changes | Actual model-selected calls through the official MCP SDK, using Streamable HTTP **2025-11-25**, with live case updates. |
| Household identity, label image, acknowledgement and physical steps | Explicit demonstration inputs and **owner-reported** progress. The owner reads the model; the selected image is previewed on their device. |

The browser’s typed phrase shortcuts provide the labeled conversation simulation. Connected-agent segments use the real MCP tools. Both paths share the project’s domain engine.
