// Shared test helpers: where the mod is, a fake cx, the side panel's layout, and small data builders.
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { find, ids } from "./mocks/element.mjs";
import { state, calls, io } from "./mocks/herdr.mjs";

// The repo root stands in for Herdr's app folder, where asset paths such as "mods/fizzy/x.svg" start.
export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const MOD_DIR = join(ROOT, "mods", "fizzy");
export const modFile = name => pathToFileURL(join(MOD_DIR, name)).href;

// A cx like the one Herdr hands a callback. spawn() starts the body at once (as Herdr does) and keeps its promise;
// what it returns is a Task (cancel, is_done), not a promise: awaiting it or chaining .then on it does not wait for
// the body, as in Herdr. settle() waits until every task (and the tasks they started) has finished. A task that
// waits for key commands (it calls nextCommand() first) never ends: settle() does not wait for it.
// While `rendering` is set (drawn() does that), notify() and write_to_clipboard() throw: a draw may only look.
// After a quiet draw (drawn(view, cx, { quiet: true })) `afterDraw` is set until the test's next macrotask: a notify()
// in that time that no I/O is behind (none started since the draw, none in flight when it ran) is the draw's own side
// effect, a notify in the microtask right after it. It throws, and is on record in `late` (settle() throws on it too).
export function makeCx() {
  const tasks = [], cx = {
    notified: 0, stopped: 0, clipboard: [], timers: [], handles: [], opened: [], clipboardText: undefined,
    rendering: false, violations: [], afterDraw: null, late: [],
    notify() {
      if (cx.rendering) { cx.violations.push("cx.notify"); throw new Error("cx.notify during render"); }
      const quiet = cx.afterDraw;
      if (quiet && io.started === quiet.started && !quiet.inflight) {
        cx.late.push("cx.notify");
        throw new Error("cx.notify right after a draw, with no I/O behind it");
      }
      cx.notified++;
    },
    stop_propagation() { cx.stopped++; },
    propagate() {},
    // `clipboard` logs every write; clipboardText is what the clipboard holds now (set it to start with something in it).
    write_to_clipboard(text) {
      if (cx.rendering) { cx.violations.push("cx.write_to_clipboard"); throw new Error("cx.write_to_clipboard during render"); }
      cx.clipboard.push(text); cx.clipboardText = text;
    },
    read_from_clipboard() { return cx.clipboardText; },
    open_url(url) { cx.opened.push(url); },
    focus_handle() { const h = { focused: false, focus() { h.focused = true; } }; cx.handles.push(h); return h; },
    spawn(body) {
      const asked = calls.nextCommand.length;
      let promise, done = false;
      try { promise = Promise.resolve(body(cx)); } catch (e) { promise = Promise.reject(e); }
      if (calls.nextCommand.length > asked) return { cancel() {}, is_done: () => false }; // a key-command loop
      promise.then(() => { done = true; }, () => { done = true; });
      tasks.push(promise);
      return { cancel() {}, is_done: () => done };
    },
    timer: { every(ms, fn) { cx.timers.push({ ms, fn }); }, after(ms, fn) { cx.timers.push({ ms, fn, after: true }); } },
    async settle() {
      while (tasks.length) await Promise.all(tasks.splice(0));
      if (cx.late.length) throw new Error(`the draw was followed at once by ${cx.late.splice(0).join(", ")}, with no I/O behind it`);
    },
  };
  return cx;
}

// view.render(cx) the way Herdr runs it: a draw may only look. While it runs cx.notify() and cx.write_to_clipboard()
// throw, and Herdr's run / setShared / notify / overlay calls are logged; any of them fails the test (even when the
// view caught the error). What a task starts and awaits before it acts is fine: that is after the draw.
// `quiet: true` also watches what follows the draw until the next macrotask, which is what a task that awaits nothing
// real does (`await Promise.all([])`): its notify comes in a microtask, at once after the draw. A task that awaits
// I/O (an exec, readTextFile, knownAgents or hc, which the herdr mock counts) is fine; one that awaits nothing is
// not, and that notify throws. The window ends at the first macrotask after the draw's own (a setImmediate). A test
// that clicks or runs a timer right after a quiet draw acts in that window by hand: let it close first (await a tick).
export function drawn(view, cx, { quiet = false } = {}) {
  const logged = calls.rendering.length;
  cx.rendering = true; state.rendering = true;
  let tree;
  try { tree = view.render(cx); }
  finally { cx.rendering = false; state.rendering = false; }
  const bad = [...cx.violations.splice(0), ...calls.rendering.slice(logged)];
  if (bad.length) throw new Error(`the draw acted: ${bad.join(", ")}`);
  if (quiet) {
    const mark = cx.afterDraw = { started: io.started, inflight: io.inflight };
    setImmediate(() => { if (cx.afterDraw === mark) cx.afterDraw = null; });
  }
  return tree;
}

// A layout with the side panel of Herdr's stock layouts/main.json: the panel-body stack of Files and Changes.
export function layoutWith({ hidden = false, active = "files", children = ["files", "changes"] } = {}) {
  return { id: "root", type: "row", children: [
    { id: "main", type: "block" },
    { id: "panel", type: "column", hidden, children: [{ id: "panel-body", type: "stack", active, children: children.map(id => ({ id, type: "block" })) }] },
  ] };
}

export const space = (id, name, more = {}) => ({
  id, name, folder: "", machine: null, branch: null, active: false, status: null,
  tabs: [{ id: `${id}-tab`, name: "Main", active: true, zoomed: false, status: null }], ...more,
});
export const pane = (id, tab, cwd, more = {}) => ({ pane: id, terminal: `t-${id}`, tab, cwd, focused: false, ...more });
export const agent = (key, name, more = {}) => ({ key, name, icon: `icons/${key}.svg`, tint: false, run: [key], installed: true, ...more });

// The element for an id, failing loudly (with the ids that do exist) when it is missing.
export function must(el, id) {
  const found = find(el, id);
  if (!found) throw new Error(`no element ${id}; have: ${ids(el).join(", ")}`);
  return found;
}
