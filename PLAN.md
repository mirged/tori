# Tori implementation plan

Build a free, open-source live quiz app for classrooms, clubs, and game nights. Keep the quick PIN-to-play experience, then improve authoring, accessibility, reliability, and ownership. Use an original name, visual identity, interface, music, and assets.

## Product promise

- All application features are free. No ads, subscriptions, paid question types, or paid player tiers.
- Self-host the complete app with one Docker Compose command. Support a local network deployment without relying on an external service.
- Players join in a browser without accounts or installation. Hosts can create a quiz and play without creating an account.
- Export and import quizzes in a documented JSON format; export results as CSV. Users can move their content between instances.
- License the application under AGPL-3.0. Accept donations for maintenance and public hosting. Hosting still costs money: any public instance should state its measured capacity and apply transparent abuse controls, without presenting unlimited hosting as a promise.

Kahoot currently ties participant limits to account/subscription categories. Tori should distinguish itself through its free complete application and transparent hosting capacity, rather than promise a fixed comparison against every Kahoot plan. Source: https://support.kahoot.com/hc/en-us/articles/115003072287-How-many-participants-can-play-a-kahoot

## First release: one complete, dependable game loop

1. **Create:** a quiz editor with single-choice, true/false, and multiple-answer questions; optional images; explanations; per-question time limits; reorder, duplicate, autosave, and preview. Keep drafts in the browser and offer JSON backup. Explain that browser data can be cleared.
2. **Host:** choose a quiz, select accuracy or speed scoring, and open a lobby with a short PIN, QR code, and share link. Include player removal, room locking, optional nickname approval, and pause controls.
3. **Join:** enter a nickname or use a generated one. Show an explicit connected/reconnecting state. Give the player a private reconnect token so a page refresh preserves their place.
4. **Play:** show the question and answer text on every device, plus a projector view. Use large touch targets, text and shape labels alongside color, keyboard controls, and reduced-motion and sound settings.
5. **Reveal:** show correct answers, an explanation, and the response distribution after the question closes. Offer an optional leaderboard and a cooperative class score.
6. **Finish:** show results, review missed questions, download CSV, and replay. Retain player session results only as long as the host needs them; provide an explicit delete action and automatic expiry.

Accuracy scoring is the default. Classic speed scoring is an optional host choice. Publish the scoring rules, including partial credit for multiple-answer questions, before implementing them.

## Architecture

Use a TypeScript monorepo with a React/Vite browser app, a Node.js server, Socket.IO for live events, and SQLite for quizzes and session snapshots. Keep the deployment to one application service and one persistent data volume initially. Confirm supported runtime and library versions when implementation begins.

- Separate host, player, and projector routes, backed by one shared game protocol.
- Model each room as a server-owned state machine: lobby → question → reveal → standings → next question → finished. Persist transitions and accepted answers so restarts can recover state.
- Make the server authoritative for timing, answer validation, and scores. Send public question data while withholding correct answers until reveal. Never send a player's answer to other players before reveal.
- Attach room, question, event sequence, and request identifiers to live messages. Reject stale or duplicate actions; acknowledge accepted answers. On reconnect, send a fresh state snapshot.
- Close questions against a server deadline. Do not trust client timestamps. Make accuracy mode independent of answer speed; document that speed mode is affected by network latency.
- Keep host control tokens separate from room PINs and player reconnect tokens. Authenticate every host action. Use unpredictable credentials, room PIN expiry, rate limits, and upload limits.
- Validate question data and escape user text. Restrict image formats and sizes. Serve uploaded media safely. Avoid user-supplied executable HTML.
- Store anonymous aggregate operational metrics by default. Do not require student emails, advertising identifiers, or third-party trackers.

Do not introduce microservices, Redis, or horizontal room distribution until measured load requires them. A single server keeps room ownership and recovery easier to reason about.

## Build sequence and completion checks

| Milestone | Deliverable | Done when |
| --- | --- | --- |
| 1. Rules and foundation | Scoring spec, room state machine, shared protocol, basic host/player screens, sample quiz | Two browsers can finish a complete game with server-calculated results |
| 2. Authoring | Editor, autosave, preview, image handling, JSON import/export | A host can create and run a quiz without editing code; export/import preserves content |
| 3. Reliable live play | Reconnect, answer acknowledgements, duplicate protection, host recovery, pause/resume | Refreshes, short disconnects, duplicate submissions, and a server restart preserve consistent state |
| 4. Classroom usability | Projector view, QR join, moderation, accessible controls, explanations, CSV results | A host can run a session from a laptop while players use phones; the core flow works with keyboard and screen reader |
| 5. Release | Container deployment, backup/restore, retention settings, load tests, setup guide, license | A fresh machine can deploy from the guide; backup restores successfully; stated capacity is supported by tests |

Build milestones 1–3 before spending time on elaborate animation, branding polish, or extra game modes. Give the playable prototype to a small real group before expanding the editor.

## Validation and release targets

- Unit-test scoring, partial credit, state transitions, deadlines, and authorization rules.
- Exercise the full host/player flow with multiple browser contexts, including refresh, disconnect, reconnect, host refresh, and server recovery.
- Test hostile and malformed clients: early answer requests, forged host commands, duplicate answers, expired tokens, invalid imports, oversized uploads, and nickname spam.
- Load-test 100 players in one room and 10 concurrent rooms of 30 players on a documented reference machine. Initial target: p95 answer acknowledgement under 300 ms on the test network, with no lost acknowledged answers or inconsistent scores. Test 500-player rooms as a later capacity goal before advertising support.
- Verify touch layouts on narrow phones and projector layouts on wide screens. Check contrast, keyboard order, focus states, screen-reader announcements, and reduced motion.
- Run at least three observed sessions with different hosts. Target a first-time player joining in under 15 seconds and a new host creating a basic five-question quiz in under five minutes; use observations to revise the interface.

## After the first release

1. Add short text and numeric answers, ordering, polls, teams, and self-paced practice. Define grading and accessibility behavior for each before shipping.
2. Add optional host accounts, cloud draft sync, private folders, share links, remixing, and quiz revision history. Keep anonymous play available.
3. Add CSV/spreadsheet import and reusable question banks. Only support other vendors' formats through permitted exports and documented interfaces.
4. Add opt-in public discovery after reporting, moderation, attribution, and content licensing are ready.
5. Consider AI-assisted drafting only if there is a sustainable free or local model path and mandatory author review. AI must never be required to create or play a quiz.

Defer a public marketplace, social feed, native mobile apps, and plugin system. The first success criterion is a group completing a smooth, fair game and the host wanting to use Tori again.
