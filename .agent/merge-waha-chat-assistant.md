# Add a !panduan Command Branch to the Main WAHA Workflow

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `.agent/PLANS.md` in this repository. It supersedes the earlier broad chat-assistant merge plan. The current scope is intentionally narrow: add only an explicit `!panduan` command branch to `WAHA - Chatting Template.json` so the bot does not respond to normal group conversation.

## Purpose / Big Picture

After this change, nelayan in the WhatsApp group can type `!panduan` and receive a concise guide explaining how to use Samudra Bot. The existing `!lapor` disaster-reporting flow must continue to work unchanged. The bot must stay silent for normal conversation, bare `panduan`, `!tanya`, and natural-language questions unless those commands are implemented in a later phase.

This matters because WhatsApp groups are noisy social spaces. Requiring a `!` command keeps the bot predictable and prevents accidental replies when people are chatting normally.

## Progress

- [x] (2026-07-09) Created and tested a standalone assistant workflow file at `WAHA - Chat Assistant (Option B).json` for proof-of-concept behavior.
- [x] (2026-07-09) Updated the test assistant workflow with expanded help copy and guardrails.
- [x] (2026-07-09) Ran `scout` against `WAHA - Chatting Template.json` and `WAHA - Chat Assistant (Option B).json` to identify integration points and risks.
- [x] (2026-07-09) Reviewed the broader plan with `oracle` after the user clarified that only `!panduan` should be added for now.
- [x] (2026-07-09) Narrowed this ExecPlan to a deterministic `!panduan`-only branch with no LLM, no `/reports/active`, and no natural-language triggers.
- [x] (2026-07-09) Implemented the `!panduan` branch in `WAHA - Chatting Template.json` using one route Code node, one IF node, typing nodes, a 1-second Wait, and a Send Text node.
- [x] (2026-07-09) Created `WAHA - Chatting Template.before-panduan-merge.json` as a rollback backup.
- [x] (2026-07-09) Validated JSON parsing, one WAHA Trigger, assistant node count, 1-second wait, no forbidden assistant LLM/query features, and route behavior for `!panduan`, bare `panduan`, bot messages, and empty messages.
- [ ] Present the diff and validation result for user review.

## Surprises & Discoveries

- Observation: The main workflow already routes WAHA message events through `WAHA Trigger` output index `1` into `Switch`, while output index `0` is unconnected.
  Evidence: `WAHA - Chatting Template.json` has `WAHA Trigger.main[1] -> Switch`. This means the new command branch must be grafted into the existing message path, not a new trigger.

- Observation: Non-`!lapor` messages currently die at an unconnected false branch.
  Evidence: The `check-message-and-user` IF node has output index `0` connected to `If4`, while output index `1` is not connected. This false branch is the ideal insertion point for `!panduan`.

- Observation: The false branch of `check-message-and-user` receives more than normal user chat. It also receives bot messages (`fromMe === true`), empty bodies, location-only messages, and every non-`!lapor` text.
  Evidence: The IF condition requires both `payload.fromMe === false` and `payload.body startsWith !lapor`. If either condition fails, the item flows to false. The `!panduan` router must therefore check `fromMe === false` and a non-empty text body that starts with `!panduan`.

- Observation: The broader assistant plan was too expansive for the clarified scope.
  Evidence: It included bare `panduan`, `!tanya`, `!bot`, natural `?` questions, `/reports/active`, and Gemini. The user now wants only `!panduan` so the bot does not trigger during normal conversation.

## Decision Log

- Decision: Add only `!panduan` in this iteration.
  Rationale: The user wants an explicit command to avoid normal group conversations triggering the bot. This minimizes risk and keeps the workflow deterministic.
  Date/Author: 2026-07-09 / Pi assistant

- Decision: Do not merge the standalone assistant workflow's WAHA Trigger.
  Rationale: The main workflow already has the correct WAHA message path. A second trigger would create duplicate or confusing behavior.
  Date/Author: 2026-07-09 / Pi assistant

- Decision: Do not add Gemini, `!tanya`, active-report lookup, or natural-language question handling in this iteration.
  Rationale: Those features were useful in the proof of concept but are out of scope for the current safe group-chat merge. They can be added later as separate explicit commands.
  Date/Author: 2026-07-09 / Pi assistant

- Decision: Use the incoming message fields for routing and replies.
  Rationale: The branch must be connected from the WAHA message webhook path and must reply to the triggering message. Use `payload.from` for `chatId`, `payload.id` for `reply_to`, and `session` from the same message item only because WAHA send nodes require it.
  Date/Author: 2026-07-09 / Pi assistant

- Decision: Use a 1-second wait for the `!panduan` response and leave existing 5-second report waits unchanged.
  Rationale: Help should feel quick. Existing report/alert timing is not part of this change.
  Date/Author: 2026-07-09 / Pi assistant

## Outcomes & Retrospective

Implementation has completed locally and awaits user review/import testing. The main workflow now has six `Assistant -` nodes connected from `check-message-and-user` false output. The existing `!lapor` true output still points to `If4`. Validation showed the edited workflow parses as JSON, contains exactly one WAHA Trigger, uses a 1-second assistant wait, and does not add Gemini, `/reports/active`, `!tanya`, or natural-language query routing. Manual n8n import and live WhatsApp tests remain pending.

## Context and Orientation

The repository root contains exported n8n workflow JSON files. The production-style main workflow is `WAHA - Chatting Template.json`. It receives WhatsApp events from WAHA, marks messages as seen, filters for `!lapor`, classifies reports, posts them to the backend, and broadcasts alerts.

The node named `check-message-and-user` is an n8n IF node. In n8n, an IF node's first output, index `0`, is the true branch; its second output, index `1`, is the false branch. `check-message-and-user` currently checks whether the incoming item is not from the bot and whether the message body starts with `!lapor`. The true branch is connected to the existing report flow. The false branch is currently unconnected and silently drops non-report messages.

The new `!panduan` branch must connect to that false branch. It must not change the existing `!lapor` true branch. It must not add a second `WAHA Trigger`. It must not copy over the proof-of-concept query/LLM branch.

A WAHA send-text node needs at least the WhatsApp session name, chat ID, optional reply target, and text. For this change, all of those values should come from the original incoming message item: `session`, `payload.from`, and `payload.id`.

## Plan of Work

First, make a backup copy of the main workflow export named `WAHA - Chatting Template.before-panduan-merge.json` if it does not already exist. This allows quick rollback if the edited JSON fails to import into n8n.

Then add five new nodes to `WAHA - Chatting Template.json`:

1. `Assistant - Route !panduan`, a Code node connected from `check-message-and-user` false output. It reads the raw message item and returns route metadata. It must emit `route: "panduan"` only when all of these are true: `payload.fromMe === false`, `payload.body` is non-empty, and the trimmed lowercase body starts with `!panduan`. Otherwise it emits `route: "ignore"`.
2. `Assistant - Is !panduan`, an IF node that checks `route === "panduan"`. Its false output is intentionally unconnected.
3. `Assistant - Start Typing`, a WAHA node that starts typing in `chatId` from the message.
4. `Assistant - Wait 1s`, a Wait node with amount `=1`.
5. `Assistant - Stop Typing`, a WAHA node that stops typing in the same chat.
6. `Assistant - Send Panduan`, a WAHA Send Text node with the help message.

The implementation may combine items 1 and 2 differently, for example by using a Switch instead of an IF, but the behavior must be identical: only `!panduan` reaches the typing/send path, everything else is silent.

The help text should explain these available commands and topics without enabling automatic chat replies:

- `!lapor <pengamatan>` to send a report.
- `!panduan` to show the guide again.
- Future/optional examples such as asking about active reports or signs should be phrased as future/help text only if not currently implemented. Do not claim `!tanya` works in the main workflow unless that branch is actually merged.
- Explain location sharing: if the bot asks for location after a report, send WhatsApp Share Location.
- Explain that the bot only handles sea/weather reports and safety-related guidance.

Important copy rule: the help text must say `!panduan`, not bare `panduan`.

Place the new nodes visually below the existing workflow to avoid overlap. Prefix all new node names with `Assistant -` so they are easy to identify and do not collide with existing nodes named `Switch`, `Wait`, `Start Typing`, or `Stop Typing`.

Reuse the existing WAHA credential reference already present in the workflow: credential ID `DVnL2b7Bf4ZnTmUb` with name `WAHA account`.

For the new Wait node, follow the existing workflow's pattern. The current main workflow has four Wait nodes sharing webhook ID `3d11609e-067b-43ad-a1a7-b95e35130990`. Reuse this same webhook ID for the new one unless n8n later requires regenerating it in the UI.

## Concrete Steps

Work from the repository root:

    cd /Users/scaf/code/disaster-backend

Create a backup before editing:

    test -f "WAHA - Chatting Template.before-panduan-merge.json" || cp "WAHA - Chatting Template.json" "WAHA - Chatting Template.before-panduan-merge.json"

Edit the workflow JSON programmatically using Bun or another JSON-safe tool. Avoid manual comma-level editing.

After editing, validate that the JSON parses and that there is still only one WAHA Trigger:

    bun -e 'const f=await Bun.file("WAHA - Chatting Template.json").json(); console.log("valid JSON", f.nodes.length, "nodes"); console.log("WAHA triggers", f.nodes.filter(n=>n.type?.includes("wahaTrigger")).length);'

Expected output:

    valid JSON <number> nodes
    WAHA triggers 1

Inspect the `check-message-and-user` connections:

    bun -e 'const f=await Bun.file("WAHA - Chatting Template.json").json(); console.log(JSON.stringify(f.connections["check-message-and-user"], null, 2));'

Expected result: output index `0` still points to `If4`, and output index `1` points to `Assistant - Route !panduan`.

Search for accidental broad assistant features:

    rg -n "!tanya|gemini-3.5-flash|reports/active|Assistant -" "WAHA - Chatting Template.json"

Expected result: `Assistant -` nodes appear. `!tanya`, `gemini-3.5-flash`, and `reports/active` should not appear unless they are only in old comments or unrelated text. The final merged branch should not add LLM or active-report nodes.

## Validation and Acceptance

The merged workflow is accepted only when these behaviors can be verified after importing/updating the n8n workflow.

First, send a normal report command:

    !lapor ada awan hitam berkumpul di laut

Expected behavior: the existing `!lapor` report pipeline still runs. The `!panduan` branch must not respond.

Second, send the guide command:

    !panduan

Expected behavior: the bot starts typing, waits about one second, stops typing, and sends the Samudra Bot guide.

Third, send bare text without the command prefix:

    panduan

Expected behavior: no reply. This proves the bot does not trigger on normal group conversation.

Fourth, send a normal group-chat sentence:

    ada yang sudah di laut?

Expected behavior: no reply.

Fifth, send a location message when no report is waiting for location.

Expected behavior: no assistant reply. The existing location path may run and silently fall through, but the new `!panduan` branch must ignore it because there is no text body starting with `!panduan`.

Sixth, if possible, inspect n8n execution logs for a `!panduan` message and confirm the route is:

    WAHA Trigger -> Switch -> check-message-and-user false -> Assistant - Route !panduan -> Assistant - Is !panduan true -> typing/wait/send

## Idempotence and Recovery

If the edit fails or the workflow does not import correctly, restore the backup:

    cp "WAHA - Chatting Template.before-panduan-merge.json" "WAHA - Chatting Template.json"

The change is additive and safe to retry because it only adds nodes and connects the previously unconnected false branch of `check-message-and-user`. The existing `!lapor` connection must not be changed.

If the bot replies to bare `panduan` or normal conversation, immediately disable the workflow or restore the backup, then fix the route condition to require `body.trim().toLowerCase().startsWith("!panduan")` and `payload.fromMe === false`.

## Artifacts and Notes

Scout output for the broader original plan is available at:

    /Users/scaf/code/disaster-backend/.pi-subagents/artifacts/outputs/d57e0a24/context.md

Oracle review concluded that the previous plan was too broad and recommended the current narrow scope:

    Add only !panduan -> help text.
    Do not add bare-word triggers.
    Do not add !tanya, !bot, natural question routing, Gemini, or /reports/active yet.
    Filter fromMe === false to avoid bot self-replies.
    Filter empty body/location-only messages.

## Interfaces and Dependencies

The new branch depends only on existing n8n core nodes and the existing WAHA credential:

    WAHA credential id: DVnL2b7Bf4ZnTmUb
    WAHA credential name: WAHA account

No backend API endpoint is required for this iteration. No Gemini model is required for this iteration. The user mentioned `models/gemini-3.5-flash` for a future LLM assistant branch, but this `!panduan`-only merge must not add an LLM node.

The new routing Code node should produce an object shaped like:

    {
      route: "panduan" or "ignore",
      chatId: payload.from,
      messageId: payload.id,
      session: incoming session,
      text: trimmed message body
    }

WAHA send/typing nodes should reference the route node output:

    session: $('Assistant - Route !panduan').item.json.session
    chatId: $('Assistant - Route !panduan').item.json.chatId
    reply_to: $('Assistant - Route !panduan').item.json.messageId

## Revision Note

This plan was revised after oracle review and the user's clarification. It intentionally removes the previous `!tanya`, natural-language, `/reports/active`, and Gemini assistant scope. The implementation should be small, deterministic, and quiet unless the exact `!panduan` command is used.

2026-07-09 update: A worker implemented the narrowed plan in `WAHA - Chatting Template.json` and created the backup file. A read-only reviewer found one low-risk issue where `startsWith('!panduan')` would also match `!panduan123`; the router was tightened to `^!panduan(\\s|$)` so only `!panduan` or `!panduan ...` matches. Local validation passed; manual n8n/WhatsApp testing is still required before considering the change accepted.
