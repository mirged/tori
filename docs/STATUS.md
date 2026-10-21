# Implementation and verification

The implementation follows `PLAN.md` through a playable first-release prototype:

- Shared TypeScript quiz validation, published scoring rules, and a server-owned
  lobby → question → reveal → standings → finished state machine.
- React/Vite library, starter quizzes, authoring, images, explanations, time
  limits, reorder/duplicate, local autosave, preview, and JSON portability.
- Node/Socket.IO live protocol, host capabilities separate from PINs, private
  reconnect tokens, durable SQLite state and answer acknowledgements, request
  deduplication, strict deadlines, pause/resume, lock/approval/removal controls.
- Player and projector routes, QR/link sharing, answer distributions, optional
  standings, cooperative accuracy, personal review, CSV, replay, deletion, expiry.
- Docker Compose, persistent volume, AGPL-3.0, backup/restore, test and load tools.

Implementation uses Node 24’s built-in SQLite instead of an external SQLite
binding. The deployment still has one Node service and one persistent volume.

Validation in the implementation workspace:

- `npm run build`: passed (strict TypeScript and production Vite bundle).
- `npm test`: 31 passed, one network test explicitly skipped.
- `docker compose config --quiet`: passed.
- Home and editor initial React renders: passed.

The implementation
environment prohibits binding local sockets and access to the Docker daemon.
The real HTTP/Socket.IO test reports an explicit skip under that restriction;
the test must pass on an unrestricted development or deployment host. The same
complete game and recovery flow passes with real Socket.IO clients over in-memory
HTTP polling. Browser,
real-phone, screen-reader, container runtime, and network load verification
remain release gates. No participant capacity is advertised as measured.

No real group sessions have been observed. Later question types, accounts,
discovery, teams, AI drafting, and other post-release features remain deferred.
