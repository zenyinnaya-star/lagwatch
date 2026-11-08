import { Storage, Monitor, defaultGateway } from "@lagwatch/monitor";
import { AppService } from "./service.js";
import { createServer } from "./server.js";
import { seedDemo } from "./seed.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const val = (n: string, d: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };

const storage = new Storage(val("db", "lagwatch.db"));
if (flag("demo")) seedDemo(storage);
const gw = defaultGateway();
const monitor = new Monitor({ storage, gateway: gw ? { host: gw, port: 80 } : null });
if (!flag("demo")) monitor.start();
const svc = new AppService(storage, monitor);

const ui = join(dirname(fileURLToPath(import.meta.url)), "..", "ui");
const port = Number(val("port", "4173"));
createServer(svc, ui).listen(port, "127.0.0.1", () => console.log(`Lagwatch dashboard: http://127.0.0.1:${port}${flag("demo") ? " (sample data)" : ""}`));
