# Tori

**Good questions. Great company.** A free, open-source live quiz app for classrooms,
clubs, and game nights. No accounts, ads, subscriptions, or third-party trackers.

Tori includes a quiz library, an autosaving browser editor, three question types,
images, JSON import/export, PIN and QR joining, host moderation, projector view,
accuracy and speed scoring, cooperative results, individual review, and CSV
exports. Private credentials reconnect players and hosts after refresh. SQLite
retains accepted answers and room transitions across server restarts.

This is a working first-release prototype, not a certified public hosting service.
The release work and verification limits are tracked in [docs/STATUS.md](docs/STATUS.md).

## Run with Docker

```sh
docker compose up --build -d
```

Open **http://localhost:3000**. For phones on the same Wi-Fi, open
`http://YOUR-COMPUTER-LAN-IP:3000` on the host computer first, then share that
page’s join link or QR code. A QR code created on `localhost` points at the
player’s own device; it is unsuitable for other devices. No external service is
needed during play. Permit TCP port 3000 through your local firewall if needed.

One application service and one persistent volume (`tori-data`). Container data
survives rebuilds. `docker compose down -v` deletes that volume.

## Develop locally

Install **Node.js 24 LTS** and npm, then:

```sh
npm ci
npm run dev
```

Open **http://localhost:3000**. The server serves Vite and Socket.IO on the same
port; the frontend updates as you edit. Server source changes restart the process.
The local database is `data/tori.sqlite`.

```sh
npm test        # scoring, schemas, rooms, recovery, backups, HTTP and live sockets
npm run build  # strict TypeScript check and production frontend build
npm start      # serve the production build at port 3000
npm run test:load
```

`npm test` explicitly skips its live network test if the runtime prohibits local
socket binding. Such a skip does not verify actual network transport or browser
behavior. The complete Socket.IO flow also runs over in-memory HTTP polling,
including reconnect and server restart; API tests use real Node HTTP objects over
in-memory streams. Persistence tests use real SQLite databases.

The checked-in lockfile pins the resolved versions. This implementation uses
React 19, Vite 8, Express 5, Socket.IO 4, Zod 4, and Node’s built-in SQLite module.
The supported production runtime is Node 24. The system Node 20 found in the
implementation workspace does not support `node:sqlite`; development checks were
run with the available Node 24 runtime.

## A game in a minute

1. Open a starter quiz, or choose **Create a quiz**. Select the correct options;
   multiple-answer questions can have more than one. Add an explanation and time
   limit. Preview a question before hosting.
2. Choose **Host**. Accuracy scoring is the default. Optionally approve nicknames
   and show the leaderboard. The complete [scoring rules](docs/SCORING.md) are also
   available in the app.
3. Players enter the six-digit PIN at `/join`, or scan the QR code. Leave the
   nickname blank for a generated one. No email or account is needed.
4. Start, pause, reveal, and advance together. A projector tab is available from
   the lobby. Player screens include the full question and all answer text.
5. Finish, download CSV results, review missed questions, or replay into a fresh
   room. **Delete game data** removes the server’s session immediately.

An answer is final when accepted. A timed-out submission can retry the same
request safely. Refreshing the host or player screen reconnects with its private
browser credential; the PIN alone never grants host control. A restart consumes
time for a running question; an expired deadline reveals on recovery. Paused
questions stay paused.

## Data ownership and privacy

- Quiz drafts and private game credentials live in browser local storage. Drafts
  are saved as you edit. If saving fails, an explicit warning requests a backup.
  Clearing browser data removes drafts and access credentials. Export JSON first.
- JSON backups preserve images, types, options, explanations, and time limits.
  Drafts can be imported unfinished; hosting requires a valid, complete quiz.
  See [docs/FORMAT.md](docs/FORMAT.md) for the format and limits.
- Hosting stores a private snapshot of that quiz, player names, hashed
  credentials, accepted answers, and scores in SQLite. Results expire **24 hours
  after creation** by default, regardless of continued activity. No student email,
  analytics identifiers, or third-party connections are required.
- Expiry and deletion remove active SQLite rows. Backups and deleted disk pages
  can retain prior data; SQLite deletion is not forensic secure erasure. Give
  database volumes and backups appropriate filesystem access and retention.
- Projector access is public to anyone with the room PIN. It shows the public
  game and nicknames. Correct answers and explanations appear only after reveal.

## Instance configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP and Socket.IO port |
| `HOST` | `0.0.0.0` | Listen address |
| `DATABASE_PATH` | `data/tori.sqlite` | Persistent SQLite file |
| `RETENTION_HOURS` | `24` | Absolute room lifetime |
| `MAX_ROOMS` | `100` | Admission limit, **not measured capacity** |
| `MAX_PLAYERS` | `300` | Players per room, **not measured capacity** |
| `TRUST_PROXY_HOPS` | unset | Set only for a known proxy chain |

Only positive integers are accepted for limits. `/api/health` reports configured
limits and explicitly marks them unmeasured. Rate limits are transparent: 1,200
API requests/IP/minute, 15 room creations/IP/minute, 600 joins/IP/minute, 1,200
socket connection/auth attempts/IP/minute, and 120 commands/socket/minute. A room
permits at most three times its player limit in historical join records. These
are prototype abuse controls; tune and review them before public exposure.

For public hosting, place Tori behind HTTPS with WebSocket support. Forward the
original Host header and set proxy trust only for the actual trusted hop count.
Use a single process with one SQLite volume; multiple application replicas do
not coordinate room ownership. Expose only the application port and keep backups
private. See [docs/OPERATIONS.md](docs/OPERATIONS.md) for backup, restore, and load
verification.

## Accessibility

Answers carry text, distinct shapes, and color. All controls are native keyboard
controls, player answers support keys 1–6 and Enter, and connected/accepted states
are announced. Sound is off by default and optional; reduced motion follows the
OS and can also be selected with the leaf control. Per-question time limits and
host pause controls help pace play. Automated checks are not a substitute for
the pending real-device and assistive-technology review.

## License

AGPL-3.0-only, see [LICENSE](LICENSE). Application features are free. Public hosting
still has costs and finite capacity. This prototype does not include a donation
payment integration or advertise certified participant capacity.

Runtime references: [Node releases](https://nodejs.org/en/about/previous-releases),
[Vite setup](https://vite.dev/guide/), [Socket.IO documentation](https://socket.io/docs/v4/).
