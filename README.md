# Lagwatch (version one, desktop)

Phases 1 and 2 are done (core logic, background monitor) and the dashboard is connected to them.

- `packages/core`: rules and presets, incidents, quiet hours, gap and VPN segments, hash chain, rollups, "who's to blame" verdict, report builder.
- `packages/app`: app service joining monitor and core, local-only API, dashboard UI, Electron shell (written, not yet run), 24-hour demo data.
- `packages/monitor`: SQLite storage with batched writes and tamper checks, TCP ping, monitor loop, command line tool.

```
npm install
npm test                                   # 84 tests
npm run dashboard -- --demo                # sample data at http://127.0.0.1:4173
npm run dashboard                          # real monitoring
npx tsx packages/monitor/src/cli.ts run --seconds 30
npx tsx packages/monitor/src/cli.ts verify
npx tsx packages/monitor/src/cli.ts report --hours 24
```

Next: run the Electron shell on a desktop, then the Alert rules, Evidence reports and Setup screens, database encryption, and the M-Lab 4-a-day test.

Design rules baked in: wording says "tests show", never assigns fault; VPN and sleep time is left out of evidence;
M-Lab tests are capped at 4 a day and opt-in (not built yet); nothing leaves the device.
