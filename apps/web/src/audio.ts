/**
 * Tiny synthesized sound effects (Web Audio API, no files). Browsers only allow audio after
 * a user gesture, so the context is created lazily on the first sound after a click or key.
 */

export type Sound =
  | "flip"
  | "pencil"
  | "pew"
  | "boom"
  | "clang"
  | "miss"
  | "chime"
  | "card"
  | "out"
  | "win"
  | "lose"
  | "pop";

const MUTE_KEY = "paper-duel:muted";

let ctx: AudioContext | null = null;
let unlocked = false;
let muted = (() => {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
})();

if (typeof window !== "undefined") {
  const unlock = () => {
    unlocked = true;
    void context()?.resume();
  };
  window.addEventListener("pointerdown", unlock, { once: true, capture: true });
  window.addEventListener("keydown", unlock, { once: true, capture: true });
}

function context(): AudioContext | null {
  if (!unlocked || typeof AudioContext === "undefined") return null;
  ctx ??= new AudioContext();
  return ctx;
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  try {
    localStorage.setItem(MUTE_KEY, value ? "1" : "0");
  } catch {
    // ignore
  }
}

/** Short haptic buzz on phones that support it. */
export function buzz(pattern: number | number[]): void {
  if (muted) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // ignore
  }
}

function noiseBuffer(c: AudioContext, seconds: number): AudioBuffer {
  const buf = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * seconds)), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

/** Filtered noise burst with an envelope. */
function noise(
  c: AudioContext,
  t: number,
  dur: number,
  freq: number,
  q: number,
  gain: number,
  type: BiquadFilterType = "bandpass",
) {
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, dur);
  const filter = c.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(g).connect(c.destination);
  src.start(t);
  src.stop(t + dur);
}

/** Oscillator note sliding from f0 to f1. */
function tone(
  c: AudioContext,
  t: number,
  dur: number,
  f0: number,
  f1: number,
  gain: number,
  type: OscillatorType = "sine",
) {
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export function play(sound: Sound): void {
  if (muted) return;
  const c = context();
  if (!c) return;
  const t = c.currentTime + 0.01;
  switch (sound) {
    case "flip": // a few quick paper rustles
      for (let i = 0; i < 4; i++) noise(c, t + i * 0.07, 0.06, 2500 + i * 400, 0.8, 0.12);
      return;
    case "pencil":
      noise(c, t, 0.12, 4500, 3, 0.05);
      noise(c, t + 0.1, 0.1, 5200, 3, 0.04);
      return;
    case "pew":
      tone(c, t, 0.22, 1400, 180, 0.12, "square");
      return;
    case "boom":
      tone(c, t, 0.45, 160, 40, 0.35);
      noise(c, t, 0.35, 900, 0.5, 0.25, "lowpass");
      return;
    case "clang":
      tone(c, t, 0.35, 1800, 1700, 0.08, "triangle");
      tone(c, t, 0.35, 2700, 2600, 0.05, "triangle");
      return;
    case "miss":
      tone(c, t, 0.18, 500, 300, 0.06, "triangle");
      return;
    case "chime":
      [880, 1175, 1568].forEach((f, i) => tone(c, t + i * 0.08, 0.3, f, f, 0.08, "triangle"));
      return;
    case "card":
      noise(c, t, 0.08, 3000, 1, 0.1);
      tone(c, t + 0.03, 0.12, 660, 990, 0.05, "triangle");
      return;
    case "out":
      [392, 330, 262].forEach((f, i) => tone(c, t + i * 0.16, 0.3, f, f * 0.98, 0.12, "sawtooth"));
      return;
    case "win":
      [523, 659, 784, 1047].forEach((f, i) => tone(c, t + i * 0.12, 0.35, f, f, 0.12, "triangle"));
      return;
    case "lose":
      [440, 415, 392].forEach((f, i) => tone(c, t + i * 0.2, 0.4, f, f, 0.08, "triangle"));
      return;
    case "pop":
      tone(c, t, 0.08, 600, 900, 0.07);
      return;
  }
}
