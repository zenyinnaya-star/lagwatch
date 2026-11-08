export type IpClass = "private" | "cgnat" | "loopback" | "linklocal" | "public" | "invalid";

/** Classifies an IPv4 address. 100.64.0.0/10 is the range ISPs use for carrier-grade NAT. */
export function classifyIp(ip: string): IpClass {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!m) return "invalid";
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some((n) => n > 255)) return "invalid";
  if (a === 127) return "loopback";
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return "private";
  if (a === 100 && b >= 64 && b <= 127) return "cgnat";
  if (a === 169 && b === 254) return "linklocal";
  if (a === 0 || a >= 224) return "invalid";
  return "public";
}

export type NatStatus = "direct" | "double-nat" | "upnp-off" | "unclear";

export interface NatResult {
  t: number;
  status: NatStatus;
  headline: string;
  detail: string;
  steps: string[];
  facts: string[];
}

/**
 * Works out why game consoles may report a strict NAT. Inputs are what the router says its outside
 * address is (via UPnP), and the public address the internet sees. Wording stays at "tests show".
 */
export function diagnoseNat(i: { upnpFound: boolean; externalIp?: string | null; publicIp?: string | null }, t = Date.now()): NatResult {
  const ext = i.externalIp ?? null;
  const pub = i.publicIp ?? null;
  const extClass = ext ? classifyIp(ext) : null;
  const facts: string[] = [i.upnpFound ? "Your router answered a UPnP request" : "No router answered a UPnP request"];
  if (ext) facts.push(`Router says its outside address is ${ext}`);
  if (pub) facts.push(`The internet sees your address as ${pub}`);

  if (!i.upnpFound) {
    return {
      t, status: "upnp-off", facts,
      headline: "UPnP did not respond",
      detail: "Tests show no router replied to a UPnP discovery request. That matches what your Xbox reports: it cannot open ports on its own, so the NAT type usually shows as strict.",
      steps: [
        "Open your router's settings and turn UPnP on, then restart the router.",
        "If you use an ISP modem and your own router, turn UPnP on in the router that your Xbox is plugged into.",
        "Run this check again. If UPnP now responds, restart the Xbox and re-test its network connection.",
      ],
    };
  }
  if (extClass === "private" || extClass === "cgnat") {
    return {
      t, status: "double-nat", facts,
      headline: extClass === "cgnat" ? "Your internet provider appears to share one public address between homes" : "There is another router in front of yours",
      detail: extClass === "cgnat"
        ? `Tests show your router's outside address (${ext}) is in the range providers use for carrier-grade NAT. UPnP on your own router cannot open ports to the internet from there, which is consistent with a strict NAT type.`
        : `Tests show your router's outside address (${ext}) is a private address, so another device, often the ISP modem, is doing NAT before your router. That is called double NAT, and it is consistent with a strict NAT type.`,
      steps: extClass === "cgnat"
        ? ["Ask your provider for a public IP address or to take you off carrier-grade NAT. Say the address your router shows and that it is in the 100.64.0.0/10 range.", "Until then, an Xbox on this connection will often stay Moderate or Strict whatever the router settings are."]
        : ["Put the ISP modem into bridge mode, or plug the Xbox into the ISP modem directly to test.", "Or turn UPnP on in the first device and put the Xbox on it, rather than behind two routers.", "Run this check again afterwards."],
    };
  }
  if (extClass === "public" && pub && ext === pub) {
    return {
      t, status: "direct", facts,
      headline: "UPnP works and your router has a public address",
      detail: "Tests show your router answers UPnP and its outside address matches the one the internet sees, so ports can be opened. If the Xbox still says strict, the cause is probably on the console or a firewall.",
      steps: ["On the Xbox, open Settings, Network, Network settings, and run Test NAT type.", "Restart the Xbox and the router, then test again.", "Check that no firewall or security setting on the router blocks UPnP requests."],
    };
  }
  if (extClass === "public" && pub && ext !== pub) {
    return {
      t, status: "double-nat", facts,
      headline: "Your router's address does not match the one the internet sees",
      detail: `Tests show your router says ${ext} but the internet sees ${pub}. That means more NAT sits between your router and the internet, which is consistent with a strict NAT type.`,
      steps: ["Ask your provider whether your connection uses carrier-grade NAT, and ask for a public IP address.", "Check for another router or modem in front of yours and put it in bridge mode."],
    };
  }
  return {
    t, status: "unclear", facts,
    headline: "UPnP works, but Lagwatch could not compare addresses",
    detail: ext ? "Tests show UPnP is on. Turn on speed tests so Lagwatch can look up your public address and compare it with your router's." : "Your router answered UPnP but did not give its outside address.",
    steps: ["Turn on speed tests on the dashboard, then run this check again."],
  };
}
