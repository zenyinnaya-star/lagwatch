import Database from "better-sqlite3-multiple-ciphers";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { makeEntry, verifyChain, type ChainEntry, type Sample, type SpeedResult, type VerifyResult } from "@lagwatch/core";

const digest = (rows: Sample[]) =>
  createHash("sha256").update(rows.map((r) => `${r.t}|${r.target}|${r.pingMs}|${r.vpn ? 1 : 0}`).join("\n")).digest("hex");

export class Storage {
  private db: Database.Database;
  private buffer: Sample[] = [];
  private last: ChainEntry | null = null;

  /**
   * `key` turns on whole-file encryption (SQLCipher-compatible, so the log cannot be read or edited without it).
   * A plain database is encrypted in place the first time it is opened with a key. A wrong key throws.
   */
  constructor(path: string, opts: { key?: string } = {}) {
    const existed = path !== ":memory:" && existsSync(path);
    this.db = new Database(path);
    if (opts.key) {
      if (!/^[0-9a-f]{64}$/i.test(opts.key)) throw new Error("Encryption key must be 64 hex characters.");
      const hasPlain = existed && this.isPlain();
      if (hasPlain) { this.db.pragma("journal_mode = DELETE"); this.db.pragma(`rekey = "x'${opts.key}'"`); }
      else this.db.pragma(`key = "x'${opts.key}'"`);
      try { this.db.prepare("SELECT count(*) FROM sqlite_master").get(); }
      catch { this.db.close(); throw new Error("Could not unlock the database. Wrong key or damaged file."); }
    }
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS samples (t INTEGER, target TEXT, ping_ms REAL, vpn INTEGER, batch INTEGER);
      CREATE INDEX IF NOT EXISTS samples_t ON samples(t);
      CREATE TABLE IF NOT EXISTS speeds (t INTEGER, down REAL, up REAL, source TEXT, vpn INTEGER);
      CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE IF NOT EXISTS chain (seq INTEGER PRIMARY KEY, t INTEGER, kind TEXT, payload TEXT, prev_hash TEXT, hash TEXT);
    `);
    const row = this.db.prepare("SELECT * FROM chain ORDER BY seq DESC LIMIT 1").get() as any;
    if (row) this.last = this.fromRow(row);
  }

  private isPlain(): boolean {
    try { this.db.prepare("SELECT count(*) FROM sqlite_master").get(); return true; } catch { return false; }
  }

  private fromRow(r: any): ChainEntry {
    return { seq: r.seq, t: r.t, kind: r.kind, payload: JSON.parse(r.payload), prevHash: r.prev_hash, hash: r.hash };
  }

  private appendChain(t: number, kind: string, payload: unknown): ChainEntry {
    const e = makeEntry(this.last, t, kind, payload);
    this.db.prepare("INSERT INTO chain VALUES (?,?,?,?,?,?)").run(e.seq, e.t, e.kind, JSON.stringify(e.payload), e.prevHash, e.hash);
    this.last = e;
    return e;
  }

  addSample(s: Sample) {
    this.buffer.push(s);
  }

  /** Writes buffered samples in one transaction and links them into the chain. Returns how many were saved. */
  flush(now = Date.now()): number {
    if (!this.buffer.length) return 0;
    const rows = this.buffer;
    this.buffer = [];
    const tx = this.db.transaction(() => {
      const e = this.appendChain(now, "samples", {
        n: rows.length, from: rows[0].t, to: rows[rows.length - 1].t, digest: digest(rows),
      });
      const ins = this.db.prepare("INSERT INTO samples VALUES (?,?,?,?,?)");
      for (const r of rows) ins.run(r.t, r.target, r.pingMs, r.vpn ? 1 : 0, e.seq);
    });
    tx();
    return rows.length;
  }

  addSpeed(s: SpeedResult) {
    this.db.prepare("INSERT INTO speeds VALUES (?,?,?,?,?)").run(s.t, s.downMbps, s.upMbps, s.source, s.vpn ? 1 : 0);
    this.appendChain(s.t, "speed", { down: s.downMbps, up: s.upMbps, source: s.source });
  }

  /** Records what a person or the app did (rule change, export, start, stop). It joins the same chain. */
  audit(kind: string, payload: unknown, now = Date.now()) {
    this.flush(now);
    return this.appendChain(now, `audit:${kind}`, payload);
  }

  samplesSince(t: number): Sample[] {
    return (this.db.prepare("SELECT * FROM samples WHERE t >= ? ORDER BY t").all(t) as any[]).map((r) => ({
      t: r.t, target: r.target, pingMs: r.ping_ms, vpn: !!r.vpn,
    }));
  }

  speedsSince(t: number): SpeedResult[] {
    return (this.db.prepare("SELECT * FROM speeds WHERE t >= ? ORDER BY t").all(t) as any[]).map((r) => ({
      t: r.t, downMbps: r.down, upMbps: r.up, source: r.source, vpn: !!r.vpn,
    }));
  }

  chain(): ChainEntry[] {
    return (this.db.prepare("SELECT * FROM chain ORDER BY seq").all() as any[]).map((r) => this.fromRow(r));
  }

  /** Checks the chain links and that every saved sample batch still matches the fingerprint written when it was saved. */
  verify(): VerifyResult {
    const chain = this.chain();
    const base = verifyChain(chain);
    if (!base.ok) return base;
    for (const e of chain) {
      if (e.kind !== "samples") continue;
      const rows = (this.db.prepare("SELECT * FROM samples WHERE batch = ? ORDER BY rowid").all(e.seq) as any[]).map((r) => ({
        t: r.t, target: r.target, pingMs: r.ping_ms, vpn: !!r.vpn,
      })) as Sample[];
      const p = e.payload as { n: number; digest: string };
      if (rows.length !== p.n || digest(rows) !== p.digest) {
        return { ok: false, checked: e.seq - 1, firstBrokenSeq: e.seq, reason: "saved samples do not match their fingerprint" };
      }
    }
    return base;
  }

  getSetting<T>(key: string, fallback: T): T {
    const r = this.db.prepare("SELECT v FROM kv WHERE k = ?").get(key) as { v: string } | undefined;
    return r ? (JSON.parse(r.v) as T) : fallback;
  }

  /** Saves a setting and records the change in the audit chain, so rule history can go in reports. */
  setSetting(key: string, value: unknown, now = Date.now()) {
    const before = this.getSetting<unknown>(key, null);
    this.db.prepare("INSERT INTO kv VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(key, JSON.stringify(value));
    this.audit("setting-changed", { key, from: before, to: value }, now);
  }

  /** Test helper and maintenance escape hatch: direct database handle. */
  raw(): Database.Database {
    return this.db;
  }

  close() {
    this.flush();
    this.db.close();
  }
}
