# Tori!

**A free, open-source live quiz game** for classrooms, clubs, and game nights —
in the style of the classic colourful-shapes quiz show. No accounts, ads,
subscriptions, or trackers.

- Six question types: quiz, true/false, multi-select, poll, type-the-answer, and
  puzzle (put in order), with images, GIFs, reveal memes, and double/no points.
- Big-screen host view with music, a get-ready screen, live answer bars, a
  scoreboard, and an animated podium. Phones show big coloured buttons.
- Team mode, answer streaks, “120 points behind Ana” rival subtitles, auto-reveal
  when everyone has answered, shuffled answers, shapes-only phones.
- Nickname filter, host kick + lobby lock, reconnect after refresh or lost Wi-Fi.
- Quiz editor with drag-and-drop slides, CSV/spreadsheet import, JSON backups.

## Option A — play on your school or home Wi-Fi (from your laptop)

Needs **Node.js 24** ([download](https://nodejs.org/)).

```sh
npm ci
npm run build
npm start
```

Open **http://localhost:3000/home** on your laptop, pick a quiz, and press
**Host**. The lobby automatically shows your computer’s network address (for
example `http://192.168.1.20:3000/join`) and a QR code — phones on the same
Wi-Fi scan it and join. If phones can’t connect, allow TCP port 3000 through your
computer’s firewall. Some school networks block device-to-device traffic; use
option B there.

## Option B — deploy to a server (works on any network, including mobile data)

Any small Linux VPS (1 vCPU / 1 GB RAM is plenty for a class) with
[Docker](https://docs.docker.com/engine/install/) installed:

```sh
git clone <your repo> tori && cd tori
cp .env.example .env
# With a domain (recommended): point its DNS A record at the server, then
echo "DOMAIN=quiz.example.com" >> .env
sh scripts/deploy.sh
```

- With `DOMAIN` set, Caddy gets a free HTTPS certificate automatically and Tori is
  live at `https://quiz.example.com`. Open ports 80 and 443.
- Without a domain, Tori runs on the standard web port: `http://SERVER-IP`. Open
  port 80, and set `PUBLIC_URL=http://SERVER-IP` in `.env` so the QR code shows
  that address. (Set `PORT=8080` in `.env` to use another port.)
- Update later with `git pull && sh scripts/deploy.sh`. Game data lives in the
  `tori-data` Docker volume and survives rebuilds (`docker compose down -v` deletes it).
- Logs: `docker compose logs -f tori`. Health: `/api/health`.

Students open the site and land straight on the PIN screen; you go to `/home`
(or tap **Host or create a quiz** on the join screen).

## Option C — Render (no server to manage)

1. Push this repo to GitHub (or GitLab).
2. In [Render](https://dashboard.render.com): **New → Blueprint**, pick the repo.
   Render reads `render.yaml` and creates a Node web service (Frankfurt) with a
   1 GB disk for the game database. Click **Apply**.
3. When the deploy is green, open `https://<your-service>.onrender.com/home`.
   Students use the bare address — it opens the PIN screen.

Notes: the disk needs a paid instance (Starter). On the free plan, delete the
`disk:` block and set `plan: free` — it works, but games are lost on every
restart/redeploy and the service sleeps after 15 idle minutes (open it a few
minutes before class to wake it). Keep it at one instance. Pushing to the repo
redeploys automatically; don't redeploy during a lesson.

## Option D — Fly.io (always on, ~$3–4/month)

Install [flyctl](https://fly.io/docs/flyctl/install/) and sign in (`fly auth login`;
Fly needs a payment card). Then, from this folder:

```sh
# 1. Pick a unique name and put it in fly.toml (app = "...")
fly apps create my-class-tori
# 2. One small volume for the game database, in the same region as fly.toml
fly volumes create tori_data --region fra --size 1 --app my-class-tori
# 3. Build and deploy (uses Dockerfile.fly)
fly deploy
# 4. Make sure exactly one machine runs (rooms live in one process)
fly scale count 1 --app my-class-tori
```

Open `https://my-class-tori.fly.dev/home` to host; students open the bare address.
`fly.toml` keeps the machine always on (no cold starts) and raises the
connection limit so a whole class can stay connected. Logs: `fly logs`.
Redeploy with `fly deploy` — not during a lesson.

## Before your class — 2-minute checklist

1. Host a test game and join from your own phone on the class network.
2. Turn the volume up and click once on the host screen (browsers need one click
   before they play music). Fullscreen with **F**.
3. Keep the host tab visible; **Space** advances, the ✕ in the corner ends the game.
4. If someone joins with a bad name: click their name to kick, then lock the lobby.
5. Export your quiz as JSON (Export button in the editor) as a backup.

## Making quizzes

- **Editor:** `/home` → **Create**. Pick a type in the right panel, set time and
  points, drag slides to reorder. Photos are shrunk automatically; GIFs up to 1 MB.
- **Spreadsheet:** download the CSV template from the home page, fill it in
  Excel/Google Sheets, save as CSV, and **Import**. Columns: Question, Type
  (quiz, true/false, multi, poll, type answer, order), Answer 1–6, Correct
  (answer numbers like `2` or `1,3`), Time (seconds), Points (standard, double,
  none), Explanation. For type-answer, list accepted answers; for order, list
  items in the correct order.
- **Backups:** quizzes live in this browser (IndexedDB). Export JSON to move them
  between computers or keep a safe copy.

## Develop

```sh
npm ci
npm run dev          # http://localhost:3000, hot reload
npm test             # scoring, rules, persistence, HTTP and live sockets
npm run test:e2e     # real browser: host + 3 phones play every question type
npm run test:load    # 100 players at once + 10 rooms × 30, with images
npm run build        # strict TypeScript check and production build
```

`test:e2e` uses your installed Chrome (set `CHROME_PATH` if it isn’t found).
Set `E2E_SHOTS=some/folder` to save screenshots of every screen.

## Data ownership and privacy

- Quiz drafts live in the browser (IndexedDB); private game credentials live in
  local storage. Clearing browser data removes them — export JSON first.
- Hosting stores the quiz, player nicknames, hashed credentials, answers and
  scores in SQLite. Rooms expire **24 hours after creation** by default, or
  immediately with **Delete game data**. No email, analytics or third parties.
- Question images are only served once their question opens; reveal images,
  correct answers, typed-answer solutions and puzzle orders stay on the server
  until the reveal.
- The projector view is public to anyone with the PIN and shows nicknames.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP and Socket.IO port (Docker publishes it on host port 80) |
| `HOST` | `0.0.0.0` | Listen address |
| `PUBLIC_URL` | unset | Join address shown in the lobby/QR (auto from `DOMAIN` in Docker) |
| `DATABASE_PATH` | `data/tori.sqlite` | Persistent SQLite file |
| `RETENTION_HOURS` | `24` | Absolute room lifetime |
| `MAX_ROOMS` | `100` | Room admission limit |
| `MAX_PLAYERS` | `300` | Players per room |
| `TRUST_PROXY_HOPS` | unset | Set only for a known proxy chain |

Rate limits: 1,200 API requests/IP/minute, 15 room creations/IP/minute, 600
joins/IP/minute, 1,200 socket connections/IP/minute, 120 commands/socket/minute.
Run a single process with one SQLite volume; replicas do not share rooms. See
[docs/OPERATIONS.md](docs/OPERATIONS.md) for backup and restore, and
[docs/SCORING.md](docs/SCORING.md) for the scoring rules.

## Accessibility

Answers carry shapes as well as colours, controls are keyboard-accessible
(players: keys 1–6 and Enter; host: Space and F), reduced motion is available in
the game toolbar and follows the OS setting, and music, effects and volume are
adjustable separately.

## License

AGPL-3.0-only, see [LICENSE](LICENSE).
