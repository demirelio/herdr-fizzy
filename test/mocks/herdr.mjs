// The `herdr` module for tests: reads one mutable `state` and logs what a mod asks Herdr to do in `calls`.
// reset() puts both back to a quiet default: no spaces, panes or layout, and nothing set up to answer exec.

const COLORS = `background surface canvas chrome popover raised hover selected border input foreground muted dim accent accent_foreground solid solid_foreground
  selection working blocked done idle unknown ${Array.from({ length: 16 }, (_, i) => `ansi${i}`).join(" ")}`.split(/\s+/);

const HOME = "/home/tester";

export const state = {};
const waiting = []; // the resolve functions of the nextCommand() promises that nobody has answered yet
// `order`: run / closeOverlay / setShared in the order they happened, for "closes first, then acts".
// `rendering`: what a mod did during a draw that it must not (see drawn() in helpers.mjs), as the name of the call.
// `nextCommand`: one entry per nextCommand() call (a task that waits on it is a key-command loop: see makeCx).
export const calls = { run: [], openOverlay: [], closeOverlay: [], setShared: [], exec: [], readTextFile: [], knownAgents: [], order: [], hc: [], notify: [], rendering: [], nextCommand: [] };

function makeStorage() {
  const data = new Map();
  return { getItem: k => (data.has(k) ? data.get(k) : null), setItem: (k, v) => void data.set(k, String(v)), removeItem: k => void data.delete(k), clear: () => data.clear() };
}

export function reset(overrides = {}) {
  Object.assign(state, {
    spaces: [], focused: null, panes: [], layout: null,
    shared: {}, props: undefined, home: HOME, appHome: `${HOME}/.config/herdr-app`, checking: false, // checking: under `herdr-app check`
    exec: async () => { throw new Error("exec: nothing set up for this call"); },
    readTextFile: async () => null,
    knownAgents: async () => [],
    agents: [], hc: async () => ({ code: 0, stdout: "", stderr: "" }), // what agents() lists; what `hc` answers
    rendering: false, // true while drawn() renders: Herdr's calls that act (run, setShared, notify, overlays) are then logged in calls.rendering
    runError: null, // set to an Error to make run() throw (after logging the call)
    commands: [], // key commands sent before anyone waited for one (see sendCommand)
    window: { platform: "macos", titlebar: "none", buttons: false, maximized: false, fullscreen: false },
    settings: { zoom: 1 },
  }, overrides);
  for (const list of Object.values(calls)) list.length = 0;
  waiting.length = 0; // the copies of earlier tests that wait for a command never get one
  globalThis.localStorage = makeStorage();
}
reset();

export const theme = () => Object.fromEntries(COLORS.map(c => [c, c]));
export const spaces = () => state.spaces;
export const panes = () => state.panes;
export const focused = () => state.focused;
export const layout = () => state.layout;
export const home = () => state.home;
export const appHome = () => state.appHome;
export const checking = () => state.checking;
export const props = () => state.props;
export const window = () => state.window;
export const settings = () => state.settings;
export const shared = key => state.shared[key];
// A draw may only look: a call that acts, made while drawn() renders, is logged in calls.rendering (the test fails on it).
const acting = name => { if (state.rendering) calls.rendering.push(name); };
export const setShared = (key, value) => { acting(`setShared(${key})`); calls.order.push("setShared"); calls.setShared.push([key, value]); state.shared[key] = value; return null; };
// `state.runError`: what run() throws, as Herdr's does for a structural command whose layout is not there (it is still logged).
export const run = (name, args) => { acting(`run(${name})`); calls.order.push("run"); calls.run.push([name, args]); if (state.runError) throw state.runError; return null; };
export const openOverlay = spec => { acting("openOverlay"); calls.openOverlay.push(spec); return `overlay-${calls.openOverlay.length}`; };
export const closeOverlay = id => { acting("closeOverlay"); calls.order.push("closeOverlay"); calls.closeOverlay.push(id); return null; };
// The calls that go outside (exec, readTextFile, knownAgents, hc) are real I/O in Herdr: `io.started` counts them, `io.inflight`
// the ones not answered yet. drawn(view, cx, { quiet: true }) in helpers.mjs uses them to tell a notify that follows
// I/O (fine) from one that follows nothing but microtasks (an await on nothing, right after the draw). The answer a mock
// gives is returned as it is: the count only watches it.
export const io = { started: 0, inflight: 0 };
const outside = answer => {
  io.started++; io.inflight++;
  Promise.resolve(answer).then(() => { io.inflight--; }, () => { io.inflight--; });
  return answer;
};
export const exec = (command, args, options) => { calls.exec.push({ command, args, options }); return outside(state.exec(command, args, options)); };
export const readTextFile = (path, options) => { calls.readTextFile.push({ path, options }); return outside(state.readTextFile(path, options)); };
export const knownAgents = options => { calls.knownAgents.push(options); return outside(state.knownAgents(options)); };
export const agents = () => state.agents;
// `hc` (herdr-core): what a mod passes is logged as an argv list; state.hc answers it (default: success, no output).
export const hc = args => { calls.hc.push(args); return outside(state.hc(args)); };
export const notify = n => { acting("notify"); calls.notify.push(n); return `notify-${calls.notify.length}`; };
// A key command for this mod, as Herdr delivers it: the next one in state.commands, else a promise that waits until
// sendCommand() is called (no key is pressed in a test unless it says so).
export const nextCommand = () => {
  calls.nextCommand.push(true);
  return state.commands.length ? Promise.resolve(state.commands.shift()) : new Promise(resolve => waiting.push(resolve));
};
// Presses a key: the oldest copy that waits gets the command; with none waiting it is kept for the next nextCommand().
export const sendCommand = text => (waiting.length ? waiting.shift()(text) : state.commands.push(text));
