import dgram from "node:dgram";
import http from "node:http";
import { classifyIp } from "@lagwatch/core";

const ST = "urn:schemas-upnp-org:device:InternetGatewayDevice:1";

export function parseSsdp(msg: string): string | null {
  const m = /^location:\s*(\S+)/im.exec(msg);
  return m ? m[1] : null;
}

/** Finds the WAN connection service and its control URL in a UPnP device description. */
export function parseDescription(xml: string, base: string): { controlUrl: string; serviceType: string } | null {
  const re = /<service>([\s\S]*?)<\/service>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const type = /<serviceType>\s*([^<\s]+)\s*<\/serviceType>/.exec(m[1])?.[1];
    const ctl = /<controlURL>\s*([^<\s]+)\s*<\/controlURL>/.exec(m[1])?.[1];
    if (type && ctl && /:(WANIPConnection|WANPPPConnection):/.test(type)) {
      return { controlUrl: new URL(ctl, base).toString(), serviceType: type };
    }
  }
  return null;
}

export function parseExternalIp(xml: string): string | null {
  return /<NewExternalIPAddress>\s*([^<\s]+)\s*<\/NewExternalIPAddress>/.exec(xml)?.[1] ?? null;
}

/** Only talk to devices on the home network, never to an address on the internet. */
function assertLocal(url: string) {
  const u = new URL(url);
  const c = classifyIp(u.hostname);
  if (u.protocol !== "http:" || !["private", "loopback", "linklocal"].includes(c)) {
    throw new Error("Refusing to contact a device outside the local network");
  }
}

function request(url: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<string> {
  assertLocal(url);
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: opts.method ?? "GET", headers: opts.headers, timeout: 3000 }, (res) => {
      let size = 0;
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > 100_000) { req.destroy(new Error("Response too large")); return; }
        chunks.push(c);
      });
      res.on("end", () => resolve(Buffer.concat(chunks).toString()));
    });
    req.on("timeout", () => req.destroy(new Error("Timed out")));
    req.on("error", reject);
    req.end(opts.body);
  });
}

/** Asks the home network for a UPnP gateway. Resolves with its description URL, or null if nothing answers. */
export function ssdpDiscover(timeoutMs = 2500): Promise<string | null> {
  return new Promise((resolve) => {
    const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    let done = false;
    const finish = (v: string | null) => { if (!done) { done = true; clearTimeout(timer); try { sock.close(); } catch { /* already closed */ } resolve(v); } };
    const timer = setTimeout(() => finish(null), timeoutMs);
    sock.on("message", (m) => {
      const loc = parseSsdp(m.toString());
      if (loc) { try { assertLocal(loc); finish(loc); } catch { /* ignore replies pointing outside the LAN */ } }
    });
    sock.on("error", () => finish(null));
    const msg = Buffer.from(`M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${ST}\r\n\r\n`);
    sock.send(msg, 1900, "239.255.255.250", (e) => { if (e) finish(null); });
  });
}

/** Reads the router's own idea of its outside address through UPnP. No login is used. */
export async function getExternalIp(location: string): Promise<string | null> {
  const desc = parseDescription(await request(location), location);
  if (!desc) return null;
  const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:GetExternalIPAddress xmlns:u="${desc.serviceType}"/></s:Body></s:Envelope>`;
  const res = await request(desc.controlUrl, {
    method: "POST",
    headers: { "content-type": 'text/xml; charset="utf-8"', soapaction: `"${desc.serviceType}#GetExternalIPAddress"` },
    body,
  });
  return parseExternalIp(res);
}

/** The public address the internet sees, from Cloudflare's trace page. Only used when the user allowed network tests. */
export async function lookupPublicIp(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const r = await fetchImpl("https://speed.cloudflare.com/cdn-cgi/trace");
  return /^ip=(.+)$/m.exec(await r.text())?.[1]?.trim() ?? null;
}
