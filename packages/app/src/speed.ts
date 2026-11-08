export interface SpeedOptions {
  baseUrl?: string;
  downBytes?: number;
  upBytes?: number;
  fetchImpl?: typeof fetch;
}

const mbps = (bytes: number, ms: number) => (bytes * 8) / 1e6 / (ms / 1000);

/**
 * Small download and upload test. Sizes are capped by the caller (default 10 MB down, 2 MB up)
 * so a run stays light on capped plans. Cloudflare's default test is around 250 MB.
 */
export async function runSpeedTest(o: SpeedOptions = {}) {
  const base = o.baseUrl ?? "https://speed.cloudflare.com";
  const f = o.fetchImpl ?? fetch;
  const downBytes = o.downBytes ?? 10_000_000;
  const upBytes = o.upBytes ?? 2_000_000;

  let t0 = performance.now();
  const d = await f(`${base}/__down?bytes=${downBytes}`);
  const got = (await d.arrayBuffer()).byteLength;
  const downMs = performance.now() - t0;

  t0 = performance.now();
  const u = await f(`${base}/__up`, { method: "POST", body: new Uint8Array(upBytes) });
  await u.arrayBuffer();
  const upMs = performance.now() - t0;

  return { downMbps: mbps(got, downMs), upMbps: mbps(upBytes, upMs), bytesUsed: got + upBytes };
}
