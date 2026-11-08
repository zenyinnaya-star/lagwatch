export type PopupStyle = "off" | "corner" | "banner";
export type SoundChoice = "off" | "chime" | "alarm";
export type GameMode = "normal" | "sound-only" | "hold-all";

export interface NotifySettings {
  popup: PopupStyle;
  sounds: { warning: SoundChoice; bad: SoundChoice; recovered: SoundChoice };
  volume: number; // 0-100
  repeatGapMin: 1 | 5 | 15 | 30;
  quiet: { enabled: boolean; startHour: number; endHour: number; allowBad: boolean };
  gameMode: GameMode;
}

export const DEFAULT_NOTIFY: NotifySettings = {
  popup: "corner",
  sounds: { warning: "off", bad: "chime", recovered: "chime" },
  volume: 40,
  repeatGapMin: 5,
  quiet: { enabled: false, startHour: 22, endHour: 7, allowBad: true },
  gameMode: "sound-only",
};

/** Returns a plain-English problem, or null when the settings are safe to save. */
export function validateNotify(n: NotifySettings): string | null {
  const oneOf = (v: unknown, list: unknown[]) => list.includes(v);
  if (!oneOf(n?.popup, ["off", "corner", "banner"])) return "Pick a pop-up style.";
  for (const k of ["warning", "bad", "recovered"] as const) {
    if (!oneOf(n.sounds?.[k], ["off", "chime", "alarm"])) return "Pick a sound for each alert type.";
  }
  if (!Number.isInteger(n.volume) || n.volume < 0 || n.volume > 100) return "Volume must be between 0 and 100.";
  if (!oneOf(n.repeatGapMin, [1, 5, 15, 30])) return "Pick a repeat gap.";
  const q = n.quiet;
  if (typeof q?.enabled !== "boolean" || typeof q.allowBad !== "boolean") return "Quiet hours are invalid.";
  if (![q.startHour, q.endHour].every((h) => Number.isInteger(h) && h >= 0 && h <= 23)) return "Quiet hours must be between 0 and 23.";
  if (!oneOf(n.gameMode, ["normal", "sound-only", "hold-all"])) return "Pick a game mode.";
  return null;
}
