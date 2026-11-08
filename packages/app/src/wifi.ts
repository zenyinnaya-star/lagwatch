export interface WifiInfo { current: string | null; nearby: string[]; wired: boolean | null }

/**
 * Finds the Wi-Fi network this computer is on, plus nearby names to pick from, and whether a cable is in use.
 * Read-only, local, and never sent anywhere. Returns empty results when the library or the radio is missing.
 */
export async function detectWifi(): Promise<WifiInfo> {
  try {
    const si: any = await import("systeminformation");
    const [conns, nets, ifaces] = await Promise.all([
      si.wifiConnections().catch(() => []),
      si.wifiNetworks().catch(() => []),
      si.networkInterfaces().catch(() => []),
    ]);
    const clean = (v: unknown) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 64);
    const current = clean(conns[0]?.ssid) || null;
    const nearby = [...new Set((nets as any[]).map((n) => clean(n.ssid)).filter(Boolean))].slice(0, 30) as string[];
    const list = Array.isArray(ifaces) ? ifaces : [ifaces];
    const defaultIf = list.find((i: any) => i.default) ?? null;
    const wired = defaultIf ? defaultIf.type === "wired" : null;
    return { current, nearby, wired };
  } catch {
    return { current: null, nearby: [], wired: null };
  }
}

/** Detail for the Wi-Fi doctor. Read-only and local. Returns nulls when the radio or library is missing. */
export async function detectWifiDetail(): Promise<import("@lagwatch/core").WifiDetail> {
  const empty = { ssid: null, signalDbm: null, channel: null, frequencyMhz: null, linkMbps: null, security: null, sameChannelNetworks: 0, strongerNeighbours: 0 };
  try {
    const si: any = await import("systeminformation");
    const [conns, nets] = await Promise.all([si.wifiConnections().catch(() => []), si.wifiNetworks().catch(() => [])]);
    const c = conns[0];
    if (!c) return empty;
    const num = (v: unknown) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : null);
    const mine = String(c.ssid ?? "");
    const others = (nets as any[]).filter((n) => String(n.ssid ?? "") !== mine);
    const dbm = num(c.signalLevel);
    return {
      ssid: mine || null, signalDbm: dbm, channel: num(c.channel), frequencyMhz: num(c.frequency), linkMbps: num(c.txRate), security: c.security ? String(c.security) : null,
      sameChannelNetworks: others.filter((n) => num(n.channel) !== null && num(n.channel) === num(c.channel)).length,
      strongerNeighbours: dbm === null ? 0 : others.filter((n) => num(n.signalLevel) !== null && (num(n.signalLevel) as number) > dbm).length,
    };
  } catch { return empty; }
}

/** Names of running programs, for game detection. Names only, never command lines or windows. */
export async function runningProcessNames(): Promise<string[]> {
  try {
    const si: any = await import("systeminformation");
    const p = await si.processes();
    return (p.list as any[]).map((x) => String(x.name ?? "")).filter(Boolean);
  } catch { return []; }
}
