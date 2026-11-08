import { tcpPing, type Target } from "@lagwatch/monitor";

export interface LoadedLatencyOptions {
  probe?: (t: Target) => Promise<number | null>;
  target?: Target;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  downBytes?: number;
  maxMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Pings a few times while idle, then keeps pinging while a size-capped download runs.
 * Returns both sets of readings and how many bytes the download used.
 */
export async function measureLoadedLatency(o: LoadedLatencyOptions = {}) {
  const probe = o.probe ?? tcpPing;
  const target = o.target ?? { host: "1.1.1.1", port: 443 };
  const f = o.fetchImpl ?? fetch;
  const bytes = o.downBytes ?? 10_000_000;
  const maxMs = o.maxMs ?? 20_000;

  const idle: number[] = [];
  for (let i = 0; i < 8; i++) {
    const ms = await probe(target);
    if (ms !== null) idle.push(ms);
    await sleep(100);
  }

  let done = false;
  let got = 0;
  const dl = f(`${o.baseUrl ?? "https://speed.cloudflare.com"}/__down?bytes=${bytes}`)
    .then(async (r) => { got = (await r.arrayBuffer()).byteLength; })
    .finally(() => { done = true; });

  const loaded: number[] = [];
  const began = Date.now();
  while (!done && Date.now() - began < maxMs) {
    const ms = await probe(target);
    if (ms !== null) loaded.push(ms);
    await sleep(120);
  }
  await dl;
  return { idle, loaded, bytesUsed: got };
}
