export interface ComplaintBody { name: string; url: string }

export interface CountryInfo {
  name: string;
  regionLabel: string;
  regions: string[];
  providers: string[];
  body: ComplaintBody;
}

const CA = ["Alberta", "British Columbia", "Manitoba", "New Brunswick", "Newfoundland and Labrador", "Northwest Territories", "Nova Scotia", "Nunavut", "Ontario", "Prince Edward Island", "Quebec", "Saskatchewan", "Yukon"];
const US = ["Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "District of Columbia", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming"];

export const COUNTRIES: Record<string, CountryInfo> = {
  Canada: {
    name: "Canada", regionLabel: "Province or territory", regions: CA,
    providers: ["Bell", "Cogeco", "Distributel", "Eastlink", "Primus", "Rogers", "Shaw", "Starlink", "TekSavvy", "Telus", "Videotron", "Xplore"],
    body: { name: "the Commission for Complaints for Telecom-television Services (CCTS)", url: "ccts-cprst.ca" },
  },
  "United States": {
    name: "United States", regionLabel: "State", regions: US,
    providers: ["AT&T", "Cox", "Frontier", "Google Fiber", "Lumen (CenturyLink)", "Spectrum", "Starlink", "T-Mobile Home Internet", "Verizon", "Xfinity"],
    body: { name: "the Federal Communications Commission (FCC) consumer complaint center", url: "consumercomplaints.fcc.gov" },
  },
  "United Kingdom": {
    name: "United Kingdom", regionLabel: "Nation", regions: ["England", "Northern Ireland", "Scotland", "Wales"],
    providers: ["BT", "EE", "Plusnet", "Sky", "Starlink", "TalkTalk", "Virgin Media", "Vodafone"],
    body: { name: "the free dispute resolution scheme your provider belongs to (Ofcom lists them)", url: "ofcom.org.uk" },
  },
  Australia: {
    name: "Australia", regionLabel: "State or territory", regions: ["Australian Capital Territory", "New South Wales", "Northern Territory", "Queensland", "South Australia", "Tasmania", "Victoria", "Western Australia"],
    providers: ["Aussie Broadband", "Optus", "Starlink", "Telstra", "TPG"],
    body: { name: "the Telecommunications Industry Ombudsman (TIO)", url: "tio.com.au" },
  },
  Other: {
    name: "Other", regionLabel: "Region", regions: [], providers: [],
    body: { name: "your country's telecom regulator or ombudsman", url: "" },
  },
};

export const TECHS: Record<string, string> = {
  fibre: "Fibre to the home", cable: "Cable", dsl: "DSL (phone line)", "fixed-wireless": "Fixed wireless", satellite: "Satellite", "mobile-home": "5G or LTE home internet", unknown: "Not sure",
};
export const CONNECTIONS: Record<string, string> = { wired: "Cable (Ethernet) to the router or modem", wifi: "Wi-Fi", unknown: "Not sure" };
export const SPEED_TIERS = [10, 25, 50, 75, 100, 150, 300, 500, 750, 1000, 1500, 2000, 3000, 5000];

export interface SetupSettings {
  country: string;
  region: string;
  provider: string; // a listed provider, or free text when country is Other or provider is "Other"
  tech: keyof typeof TECHS;
  connection: "wired" | "wifi" | "unknown";
  downMbps: number;
  upMbps: number | null;
  wifiName: string; // kept on this computer only, never put in reports
  done: boolean;
}

export const DEFAULT_SETUP: SetupSettings = {
  country: "Canada", region: "", provider: "", tech: "unknown", connection: "unknown", downMbps: 100, upMbps: null, wifiName: "", done: false,
};

export const cleanText = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** Returns a plain-English problem, or null when the setup is safe to save. */
export function validateSetup(s: SetupSettings): string | null {
  const c = COUNTRIES[s?.country];
  if (!c) return "Pick a country.";
  if (s.region && c.regions.length && !c.regions.includes(s.region)) return `That is not a valid ${c.regionLabel.toLowerCase()} for ${c.name}.`;
  if (cleanText(s.provider, 60) !== s.provider) return "The provider name has odd characters or is too long.";
  if (!(s.tech in TECHS)) return "Pick a connection type.";
  if (!(s.connection in CONNECTIONS)) return "Pick how this computer connects.";
  if (!Number.isFinite(s.downMbps) || s.downMbps < 1 || s.downMbps > 100_000) return "Plan download speed must be between 1 and 100000 Mbps.";
  if (s.upMbps !== null && (!Number.isFinite(s.upMbps) || s.upMbps < 0 || s.upMbps > 100_000)) return "Plan upload speed must be between 0 and 100000 Mbps.";
  if (cleanText(s.wifiName, 64) !== s.wifiName) return "The Wi-Fi name has odd characters or is too long.";
  if (typeof s.done !== "boolean") return "Invalid setup.";
  return null;
}

export function describeSetup(s: SetupSettings): string {
  const bits = [s.provider, s.tech !== "unknown" ? TECHS[s.tech].toLowerCase() : "", `${s.downMbps} Mbps plan`, s.connection === "wired" ? "wired" : s.connection === "wifi" ? "on Wi-Fi" : ""];
  return bits.filter(Boolean).join(", ");
}

/** The line-check request that fits the kind of connection, so the provider asks the right questions. */
export function lineCheckAsk(tech: string): string {
  switch (tech) {
    case "fibre": return "Check the optical signal level on my fibre terminal and run a line test.";
    case "cable": return "Check the downstream and upstream signal levels (power and signal-to-noise) on my modem and run a line test.";
    case "dsl": return "Check my line's sync speed and noise and run a line test.";
    case "fixed-wireless": return "Check my signal strength and whether my tower is congested.";
    case "satellite": return "Check my dish signal and whether my satellite beam is congested.";
    case "mobile-home": return "Check my signal strength and whether my cell tower is congested.";
    default: return "Run a line test and check the signal levels on my connection.";
  }
}
