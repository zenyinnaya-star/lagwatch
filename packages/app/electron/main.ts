// Electron shell (not run in the cloud sandbox). Install on a desktop with: npm i -D electron
// The monitor and storage run here in the main process for now; phase 3b moves them to a utility process.
import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, Notification, safeStorage } from "electron";
import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { Storage, Monitor, defaultGateway } from "@lagwatch/monitor";
import { AppService } from "../src/service.js";

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let svc: AppService;

/** A random database key, sealed by the operating system (Keychain, DPAPI, libsecret). Never stored in plain text. */
function databaseKey(): string | undefined {
  if (!safeStorage.isEncryptionAvailable()) return undefined; // no OS keystore: stay unencrypted rather than keep a key in a file
  const f = join(app.getPath("userData"), "db.key");
  if (existsSync(f)) return safeStorage.decryptString(readFileSync(f));
  const key = randomBytes(32).toString("hex");
  writeFileSync(f, safeStorage.encryptString(key), { mode: 0o600 });
  return key;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 900, backgroundColor: "#0E1116", show: true,
    webPreferences: { preload: join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.removeMenu();
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.loadFile(join(__dirname, "..", "ui", "index.html"));
  // Only when the user allowed background watching. Otherwise closing the window quits, and monitoring stops.
  win.on("close", (e) => { if (!(app as any).quitting && svc.welcome.background) { e.preventDefault(); win?.hide(); } });
}

app.whenReady().then(() => {
  const storage = new Storage(join(app.getPath("userData"), "lagwatch.db"), { key: databaseKey() });
  const gw = defaultGateway();
  const monitor = new Monitor({ storage, gateway: gw ? { host: gw, port: 80 } : null });
  svc = new AppService(storage, monitor);
  monitor.start();
  const applyBackground = () => { const w = svc.welcome; app.setLoginItemSettings({ openAtLogin: w.background && w.startAtLogin, args: ["--hidden"] }); };
  applyBackground();

  // Validated IPC: only these channels exist, each takes plain data.
  ipcMain.handle("dashboard", () => svc.dashboard());
  ipcMain.handle("setPreset", (_e, name: unknown) => svc.setPreset(String(name)));
  ipcMain.handle("setSpeedTests", (_e, on: unknown) => svc.setSpeedTests(Boolean(on)));
  ipcMain.handle("speedTest", () => svc.speedTest());
  ipcMain.handle("settings", () => svc.settings());
  ipcMain.handle("setRules", (_e, rules: any) => svc.setCustomRules(rules));
  ipcMain.handle("setNotify", (_e, n: any) => svc.setNotify(n));
  ipcMain.handle("bufferbloat", () => svc.bufferbloat());
  ipcMain.handle("natCheck", () => svc.natCheck());
  ipcMain.handle("setup", (_e, v: any) => svc.setSetup(v));
  ipcMain.handle("setMlab", (_e, on: unknown) => svc.setMlab(Boolean(on)));
  ipcMain.handle("mlabTest", () => svc.mlabTest());
  ipcMain.handle("heatmap", (_e, tz: unknown) => svc.heatmap(14, Number(tz) || 0));
  ipcMain.handle("setGameTargets", (_e, t: any) => svc.setGameTargets(t));
  ipcMain.handle("gamePing", () => svc.gamePing());
  ipcMain.handle("wifiDoctor", () => svc.wifiDoctor());
  ipcMain.handle("credit", (_e, price: unknown) => svc.creditEstimate(Number(price)));
  ipcMain.handle("markRestart", () => svc.markRestart());
  ipcMain.handle("restartCheck", () => svc.restartCheck());
  ipcMain.handle("wifi", () => svc.wifi());
  ipcMain.handle("welcome", (_e, v: any) => { const r = svc.setWelcome(v); applyBackground(); return r; });
  ipcMain.handle("complaint", (_e, b: any) => svc.complaintPack(b, [24, 72, 168].includes(Number(b?.hours)) ? Number(b.hours) : 24));
  ipcMain.handle("report", () => { const r = svc.report(24); return { text: r.text, fingerprint: r.fingerprint, chainOk: r.chainOk }; });

  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip("Lagwatch");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Lagwatch", click: () => { win?.show(); } },
    { label: "Quit", click: () => { (app as any).quitting = true; monitor.stop(); storage.close(); app.quit(); } },
  ]));
  tray.on("click", () => win?.show());

  // Tray tooltip follows the verdict. Notices use the system notification so a game or call keeps focus.
  let busy = false;
  setInterval(async () => {
    if (busy) return; busy = true;
    try {
    tray?.setToolTip(`Lagwatch: ${svc.dashboard().verdict.headline}`);
    const game = await svc.gameActive();
    for (const n of svc.pendingNotifications(Date.now(), game !== null)) {
      if (n.popup !== "off") new Notification({ title: n.title, body: n.detail, silent: true }).show();
      win?.webContents.send("alert-sound", { sound: n.sound, volume: n.volume });
    }
    } finally { busy = false; }
  }, 5000);

  // --hidden is only honoured when the user allowed background watching.
  if (!(process.argv.includes("--hidden") && svc.welcome.background)) createWindow();
});

app.on("window-all-closed", () => { if (!svc?.welcome.background) app.quit(); });
