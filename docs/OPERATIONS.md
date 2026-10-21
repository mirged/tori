# Operating a Tori instance

## Backups and recovery

SQLite uses WAL journaling and FULL synchronous commits. The server writes the
room’s authoritative state before acknowledging an answer. A database write
failure restores the in-memory room to its last durable state. Room snapshots
include transition sequence numbers and deduplication IDs, as well as accepted
answers and hashed credentials.

For a native installation, take a consistent online backup:

```sh
npm run backup -- backups/tori-2026-10-21.sqlite
```

The helper uses SQLite’s backup API, checks source integrity, and refuses to
overwrite an existing backup. Do not copy a live `.sqlite` file without its WAL.

Restore **with the application stopped**:

```sh
# Stop the Tori process first (Ctrl+C, or stop its service).
npm run restore -- backups/tori-2026-10-21.sqlite
npm start
```

Restore verifies the source and atomically replaces the target. It refuses a
target with WAL/SHM files because they can indicate a live database. If a crash
left these files, start the existing application and stop it gracefully before
restoring. Do not delete active WAL files. Back up the current database before
overwriting it. An expired room stays expired after restoration.

For Compose:

```sh
docker compose exec tori npm run backup -- data/backup.sqlite
mkdir -p backups
docker compose cp tori:/app/data/backup.sqlite ./backups/tori.sqlite
docker compose stop tori
docker compose run --rm --no-deps --volume "$PWD/backups:/backups:ro" tori \
  npm run restore -- /backups/tori.sqlite
docker compose up -d
```

Use a fresh name for subsequent in-container backups. Protect backups: they
contain player names and results. Apply a separate backup retention policy;
deleting a room does not edit older backups.

## Load verification

```sh
npm run test:load
```

This starts an isolated server with a temporary on-disk SQLite database, creates
real HTTP/Socket.IO clients, and runs two scenarios: one room with 100 players,
then 10 rooms with 30 players each. Host and projector clients remain connected.
All players submit concurrently. The script checks that every acknowledged
answer appears in authoritative host state and every player sees the expected
score. It reports p95 acknowledgement time, CPU, RAM, Node version, and date,
then removes test data. A p95 of 300 ms or more fails the command.

This is a synthetic **loopback** test using the bundled quiz without images. It
does not establish Wi-Fi/WAN capacity, a capacity guarantee for arbitrary quizzes,
long-session reliability, or 500-player support. Run it on the intended host and
follow with real phones on the intended network. Publish the measured result
with its environment and limits, rather than the configured admission limits.

## Release acceptance still requires people

- Run the host/player flow on narrow touch screens and a wide projector.
- Check focus, keyboard order, contrast, screen-reader announcements, and motion.
- Exercise short disconnects, host refresh, player refresh, and server restart.
- Observe three groups with different hosts. Measure first-time join and basic
  five-question authoring time; revise the UI using those observations.
- Establish a measured capacity and operational monitoring appropriate to any
  public instance before inviting a broad audience.
