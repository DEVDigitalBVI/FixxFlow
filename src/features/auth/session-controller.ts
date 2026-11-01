export type SessionState = {
  active: boolean;
  user_id?: string | null;
  server_now?: string;
  idle_deadline?: string;
};
export const SESSION_WARNING_MS = 120_000;
const HEARTBEAT_MS = 30_000;

/** Only trusted user input calls activity(); passive checks never renew a session. */
export function createSessionController(options: {
  userId: string;
  now: () => number;
  request: (active: boolean) => Promise<SessionState>;
  remaining: (milliseconds: number) => void;
  verified: () => void;
  hide: () => void;
  unavailable: () => void;
  expired: () => void;
  changed: () => void;
  renewed: () => void;
}) {
  let deadline = 0;
  let lastTouch = -Infinity;
  let lastCheck = -Infinity;
  let pending = false;
  let running = false;
  let stopped = false;
  let queuedTouch = false;
  async function check(active = false) {
    if (stopped) return;
    if (running) {
      queuedTouch ||= active;
      return;
    }
    running = true;
    lastCheck = options.now();
    try {
      const state = await options.request(active);
      if (stopped) return;
      if (state.user_id && state.user_id !== options.userId) {
        options.hide();
        options.changed();
        stop();
        return;
      }
      if (!state.active) {
        options.hide();
        options.expired();
        stop();
        return;
      }
      const duration = Date.parse(state.idle_deadline ?? '') - Date.parse(state.server_now ?? '');
      if (!Number.isFinite(duration)) throw Error('Missing session deadline');
      deadline = options.now() + Math.max(0, duration);
      if (active) {
        lastTouch = options.now();
        pending = false;
        options.renewed();
      }
      options.remaining(Math.max(0, deadline - options.now()));
      options.verified();
    } catch {
      if (!stopped) {
        options.hide();
        options.unavailable();
      }
    } finally {
      running = false;
      if (queuedTouch && !stopped) {
        queuedTouch = false;
        void check(true);
      }
    }
  }
  function activity() {
    if (!deadline || deadline - options.now() <= SESSION_WARNING_MS || stopped) return;
    pending = true;
    if (options.now() - lastTouch >= HEARTBEAT_MS) void check(true);
  }
  function tick() {
    if (stopped) return;
    const left = Math.max(0, deadline - options.now());
    if (deadline) options.remaining(left);
    if (deadline && !left) options.hide();
    if (pending && options.now() - lastTouch >= HEARTBEAT_MS) void check(true);
    else if (options.now() - lastCheck >= HEARTBEAT_MS) void check();
  }
  function stop() {
    stopped = true;
  }
  return { check, activity, tick, stop };
}
