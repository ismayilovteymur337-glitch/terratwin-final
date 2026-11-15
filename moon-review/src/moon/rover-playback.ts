/**
 * Rover drive animation state, shared between the route panel (play / pause / restart) and the
 * 3D viewport (which moves the rover). Kept outside React state on purpose: only the components
 * that subscribe re-render while the rover drives, not the whole application.
 */

export interface PlaybackState {
  playing: boolean;
  /** 0..1 along the selected route */
  progress: number;
  /** Duration of one full drive in milliseconds */
  durationMs: number;
}

const state: PlaybackState = { playing: false, progress: 0, durationMs: 14_000 };
const listeners = new Set<(s: PlaybackState) => void>();
let raf = 0;
let last = 0;

function emit() {
  const snapshot = { ...state };
  listeners.forEach((fn) => fn(snapshot));
}

function tick(t: number) {
  if (!state.playing) {
    raf = 0;
    return;
  }
  if (!last) last = t;
  const dt = Math.min(100, t - last); // a background tab must not make the rover jump
  last = t;
  state.progress = Math.min(1, state.progress + dt / state.durationMs);
  if (state.progress >= 1) state.playing = false;
  emit();
  raf = state.playing ? requestAnimationFrame(tick) : 0;
}

function startLoop() {
  if (raf || typeof requestAnimationFrame === 'undefined') return;
  last = 0;
  raf = requestAnimationFrame(tick);
}

export const roverPlayback = {
  get(): PlaybackState {
    return { ...state };
  },
  isPlaying(): boolean {
    return state.playing;
  },
  subscribe(fn: (s: PlaybackState) => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  play() {
    if (state.progress >= 1) state.progress = 0;
    state.playing = true;
    emit();
    startLoop();
  },
  pause() {
    state.playing = false;
    emit();
  },
  restart() {
    state.progress = 0;
    state.playing = true;
    emit();
    startLoop();
  },
  seek(progress: number) {
    state.progress = Math.max(0, Math.min(1, progress));
    emit();
  },
  setDurationMs(ms: number) {
    state.durationMs = Math.max(3000, Math.min(60_000, ms));
  },
};
