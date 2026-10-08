# Open Source Mini contribution: Relay State

**Primary project:** Recall Relay / Alexa+.

| Submission field | Value |
| --- | --- |
| Contribution URL | https://github.com/blucca/relay-state/releases/tag/v0.1.1 |
| Open-source repository | https://github.com/blucca/relay-state |
| GitHub username | `blucca` |
| License | MIT |
| Independent example | https://github.com/blucca/relay-state/tree/main/examples/return-desk |
| Reuse evidence | https://github.com/blucca/relay-state/blob/main/docs/reuse-evidence.md |

## What we built

Relay State is an additional, independently installable Node.js library extracted from Recall Relay. It keeps a local MCP application's tools and companion screens on the same saved business object. It has zero runtime dependencies and includes TypeScript declarations.

## How it works

Each tool submits an isolated reducer to a serial queue. The library atomically replaces the application's JSON state file, then exposes the committed public projection and sends snapshots to connected screens over Server-Sent Events. Reconnecting screens receive the latest snapshot; a restarted server and a fresh MCP client resume the saved object. Applications retain their own schemas, domain transitions, revisions and request identifiers.

Recall Relay uses the library in its actual server. Its original household files and browser event shape remain compatible. Return Desk is a second consumer with a separate return domain, an official MCP SDK CLI and a live page. Its packaged installation completed an external tool write, an update in the existing browser tab, a server-process restart and a fresh-client resumption.

## Why it matters

During a real Recall Relay agent trial, the server advanced the case while the original companion screen stayed on an earlier instruction. Resolving that experience required a complete commit-and-observe path. Relay State makes that solution reusable through a small API and an explicit ordering contract.

Existing MCP protocol and application-state guidance provide the surrounding patterns. This contribution supplies a tested, installable server-side combination and two business-domain consumers, saving developers the repeated persistence, publication and reconnect integration work.

Development occurred during the hackathon build window. An autonomous Codex agent performed the implementation and verification under the account owner's authorization.
