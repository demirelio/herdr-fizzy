import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { state, calls, io, reset, agents, hc, notify, nextCommand, sendCommand, run, setShared, openOverlay, exec, readTextFile, knownAgents } from "./mocks/herdr.mjs";
import { InputState, Input, TextareaState, Textarea, TextView } from "./mocks/gpui-base.mjs";
import { makeElement, nodeOf, find, all, PANEL_STYLES } from "./mocks/element.mjs";
import { div } from "./mocks/gpui-kit.mjs";
import { makeCx, drawn } from "./helpers.mjs";

// The mocks the Fizzy panel's tests lean on: what they promise is checked here, once.

beforeEach(() => reset());

test("an input state keeps its text, its options and its handlers, and records focus", () => {
  const s = InputState.new({ placeholder: "Filter cards…", value: "abc" });
  assert.deepEqual(s.options, { placeholder: "Filter cards…", value: "abc" });
  assert.equal(s.value(), "abc");
  assert.equal(s.focused, false);
  s.focus();
  assert.equal(s.focused, true);
  s.set_value("x");
  assert.equal(s.value(), "x");
  s.replace("y");
  assert.equal(s.value(), "y");
  assert.equal(InputState.new().value(), "", "no value: empty");

  const seen = [];
  assert.equal(s.on("change", (e, cx) => seen.push(["change", s.value(), cx])), true);
  s.on("submit", () => seen.push(["submit", s.value()]));
  s.set_value("quiet");
  assert.deepEqual(seen, [], "set_value() does not fire change");
  s.edit("typed", "cx");
  s.submit();
  assert.deepEqual(seen, [["change", "typed", "cx"], ["submit", "typed"]]);
  assert.equal(typeof s.handlers.change, "function", "handlers sit under state.handlers[event]");
});

test("input and textarea elements carry their state and take the usual style builders", () => {
  const s = InputState.new({ value: "v" }), area = TextareaState.new({ rows: 8, value: "long" });
  const tree = div().child(Input.new(s).id("in").w_full().px(8)).child(Textarea.new(area).id("ta").h(90));
  assert.equal(find(tree, "in").kind, "input");
  assert.equal(find(tree, "in").state, s);
  assert.equal(find(tree, "ta").kind, "textarea");
  assert.equal(find(tree, "ta").state, area);
  assert.equal(area.value(), "long");
  assert.equal(area.options.rows, 8);
  assert.notEqual(TextareaState.new() instanceof InputState, true, "a textarea state is its own kind");
});

test("TextView.html makes an element with that id that carries the html and takes its own builders", () => {
  const h = TextView.html("desc", "<p>Hi</p>").selectable().scrollable(false).on_link_click(() => {}), n = nodeOf(h);
  assert.equal(n.id, "desc");
  assert.equal(n.kind, "textview");
  assert.equal(n.html, "<p>Hi</p>");
  assert.equal(n.style.selectable, true);
  assert.equal(n.style.scrollable, false);
  assert.equal(typeof n.handlers.on_link_click, "function");
  const tree = div().child(h).child(TextView.html("note", "<b>x</b>"));
  assert.equal(all(tree, n => n.kind === "textview").length, 2);
  assert.equal(find(tree, "note").html, "<b>x</b>");
  assert.throws(() => div().selectable(), /not a builder method/, "only a TextView takes these");
  assert.throws(() => div().on_link_click(() => {}), /not a builder method/);
});

test("the builders the Fizzy panel adds are accepted, and a made-up one still fails", () => {
  assert.ok(PANEL_STYLES.length > 0);
  for (const name of PANEL_STYLES) assert.equal(nodeOf(makeElement("div")[name]()).style[name], true, name);
  assert.throws(() => makeElement("div").wobble_sideways(2), /not a builder method/);
});

test("a cx has timer.after, the clipboard it wrote, and open_url", () => {
  const cx = makeCx();
  assert.equal(cx.read_from_clipboard(), undefined, "no text: undefined");
  cx.clipboardText = "old";
  assert.equal(cx.read_from_clipboard(), "old");
  cx.write_to_clipboard("new");
  assert.equal(cx.read_from_clipboard(), "new");
  assert.deepEqual(cx.clipboard, ["new"]);
  const fn = () => {};
  cx.timer.after(500, fn);
  cx.timer.every(30000, fn);
  assert.deepEqual(cx.timers, [{ ms: 500, fn, after: true }, { ms: 30000, fn }]);
  cx.open_url("https://app.fizzy.do/1");
  assert.deepEqual(cx.opened, ["https://app.fizzy.do/1"]);
});

test("agents(), hc(), notify() and nextCommand() answer from state and log into calls", async () => {
  assert.deepEqual(agents(), []);
  state.agents = [{ address: "t1" }];
  assert.deepEqual(agents(), [{ address: "t1" }]);

  assert.deepEqual(await hc(["send", "t1", "hello"]), { code: 0, stdout: "", stderr: "" });
  state.hc = async () => ({ code: 1, stdout: "", stderr: "blocked" });
  assert.equal((await hc(["send", "t2", "x"])).stderr, "blocked");
  assert.deepEqual(calls.hc, [["send", "t1", "hello"], ["send", "t2", "x"]]);

  const id = notify({ title: "Fizzy", body: "x", level: "error" });
  assert.equal(typeof id, "string");
  assert.deepEqual(calls.notify, [{ title: "Fizzy", body: "x", level: "error" }]);

  const pending = Symbol("pending");
  assert.equal(await Promise.race([nextCommand(), Promise.resolve(pending)]), pending, "never resolves");

  reset();
  assert.deepEqual([calls.hc, calls.notify, state.agents], [[], [], []], "reset clears them");
});

// The rules gpui-kit.d.ts gives, enforced in the mocks: what a draw may not do, what spawn returns, key commands.
test("spawn starts the body at once and returns a Task (cancel, is_done), not a promise", async () => {
  const cx = makeCx();
  let started = false;
  const task = cx.spawn(async () => { started = true; await null; });
  assert.equal(started, true, "the body runs at once, up to its first await");
  assert.equal(typeof task.cancel, "function");
  assert.equal(task.is_done(), false);
  assert.equal(typeof task.then, "undefined", "awaiting or chaining .then on a Task is a bug the mock must not hide");
  assert.throws(() => task.then(() => {}), TypeError);
  await cx.settle();
  assert.equal(task.is_done(), true);
  const failing = cx.spawn(async () => { throw new Error("boom"); });
  await assert.rejects(cx.settle(), /boom/);
  assert.equal(failing.is_done(), true);
});

test("drawn() fails a draw that notifies, writes the clipboard, or calls run / setShared / notify / overlays", () => {
  reset();
  const cx = makeCx();
  const view = body => ({ render: () => { body(cx); return "tree"; } });
  assert.equal(drawn(view(() => {}), cx), "tree", "a draw that only looks passes");
  assert.throws(() => drawn(view(c => c.notify()), cx), /cx\.notify during render/);
  assert.throws(() => drawn(view(c => c.write_to_clipboard("x")), cx), /write_to_clipboard during render/);
  // Even when the view swallows the error, the call is on record.
  assert.throws(() => drawn(view(c => { try { c.notify(); } catch { /* swallowed */ } }), cx), /the draw acted: cx\.notify/);
  assert.throws(() => drawn(view(() => run("pane.focus")), cx), /the draw acted: run\(pane\.focus\)/);
  assert.throws(() => drawn(view(() => setShared("k", 1)), cx), /the draw acted: setShared\(k\)/);
  assert.throws(() => drawn(view(() => notify({ title: "x" })), cx), /the draw acted: notify/);
  assert.throws(() => drawn(view(() => openOverlay({ mod: "m" })), cx), /the draw acted: openOverlay/);
  assert.equal(cx.rendering, false, "the flag is down again after a failed draw");
  assert.equal(state.rendering, false);
  cx.notify();
  setShared("k", 2);
  assert.equal(cx.notified, 1, "outside a draw they work");
  // A task a draw starts may act after its first await: that is after the draw.
  let tree;
  assert.doesNotThrow(() => { tree = drawn(view(c => c.spawn(async c2 => { await null; c2.notify(); })), cx); });
  assert.equal(tree, "tree");
  return cx.settle().then(() => assert.equal(cx.notified, 2));
});

test("drawn(…, { quiet: true }) also fails a notify that follows the draw at once with no I/O behind it", async () => {
  reset();
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const quiet = body => { const cx = makeCx(); return [cx, drawn({ render: () => { body(cx); return "tree"; } }, cx, { quiet: true })]; };

  assert.equal(io.inflight, 0, "no I/O is out when this starts");
  // A task that awaits nothing real ends in a microtask: its notify is the draw's own.
  let [cx, tree] = quiet(c => c.spawn(async c2 => { await Promise.all([]); c2.notify(); }));
  assert.equal(tree, "tree");
  await assert.rejects(cx.settle(), /cx\.notify right after a draw, with no I\/O behind it/);
  assert.deepEqual(cx.late, ["cx.notify"], "and it is on record");
  assert.equal(cx.notified, 0);
  // The error can be swallowed by the task: the record still fails settle().
  [cx] = quiet(c => c.spawn(async c2 => { await null; try { c2.notify(); } catch { /* swallowed */ } }));
  await assert.rejects(cx.settle(), /the draw was followed at once by cx\.notify, with no I\/O behind it/);
  // The plain drawn() does not watch past the draw.
  cx = makeCx();
  drawn({ render: () => { cx.spawn(async c2 => { await null; c2.notify(); }); return "tree"; } }, cx);
  await cx.settle();
  assert.equal(cx.notified, 1);

  // I/O behind it: started after the draw (any of the four calls), or still in flight when it was drawn.
  state.exec = async () => ({ code: 0, stdout: "", stderr: "" });
  [cx] = quiet(c => c.spawn(async c2 => { await exec("fizzy", []); c2.notify(); }));
  await cx.settle();
  assert.equal(cx.notified, 1, "a notify after an exec is fine");
  for (const call of [() => readTextFile("/x"), () => knownAgents(), () => hc(["send"])]) {
    [cx] = quiet(c => c.spawn(async c2 => { await call(); c2.notify(); }));
    await cx.settle();
    assert.equal(cx.notified, 1);
  }
  let release;
  state.exec = () => new Promise(resolve => { release = () => resolve({ code: 0 }); });
  const before = exec("fizzy", []);
  [cx] = quiet(c => c.spawn(async c2 => { await before; c2.notify(); }));
  release();
  await cx.settle();
  assert.equal(cx.notified, 1, "a read that was already out when the draw came ends after it: fine");

  // The window ends at the macrotask after the draw's own: a task that waits a couple of them, or a click a moment
  // later, notifies freely.
  [cx] = quiet(c => c.spawn(async c2 => { await tick(); await tick(); c2.notify(); }));
  await cx.settle();
  assert.equal(cx.notified, 1, "a task that waits for macrotasks is after the draw");
  [cx] = quiet(() => {});
  await tick();
  assert.doesNotThrow(() => cx.notify());
  assert.equal(cx.afterDraw, null);
  // A draw that notifies in itself fails here too.
  assert.throws(() => { const c = makeCx(); drawn({ render: () => c.notify() }, c, { quiet: true }); }, /cx\.notify during render/);
});

test("the herdr mock counts the I/O it is asked for and still answers as it was set up", async () => {
  reset();
  state.exec = async () => ({ code: 0, stdout: "out", stderr: "" });
  const started = io.started;
  const p = exec("fizzy", ["board", "list"]);
  assert.equal(io.started, started + 1);
  assert.ok(io.inflight >= 1);
  assert.equal((await p).stdout, "out", "the answer is the mock's own, untouched");
  await Promise.resolve();
  state.exec = async () => { throw new Error("no program"); };
  await assert.rejects(exec("fizzy", []), /no program/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(io.inflight, 0, "answered and failed reads are not in flight");
});

test("run() throws state.runError after logging the call, until reset() clears it", () => {
  reset();
  assert.equal(run("layout.show", { id: "panel" }), null, "quiet by default");
  state.runError = new Error("layout unavailable");
  assert.throws(() => run("layout.hide", { id: "panel" }), /layout unavailable/);
  assert.deepEqual(calls.run.at(-1), ["layout.hide", { id: "panel" }], "the call is on record");
  reset();
  assert.equal(state.runError, null);
  assert.doesNotThrow(() => run("layout.show", { id: "panel" }));
});

test("sendCommand answers the oldest nextCommand(), or waits for the next one; settle() does not wait for a command loop", async () => {
  reset();
  const first = nextCommand(), second = nextCommand();
  sendCommand("a");
  sendCommand("b");
  assert.deepEqual([await first, await second], ["a", "b"], "in order");
  sendCommand("early");
  assert.equal(await nextCommand(), "early", "a command sent before anyone waited is kept");
  assert.equal(calls.nextCommand.length, 3);

  const cx = makeCx(), got = [];
  const loop = cx.spawn(async () => { for (;;) got.push(await nextCommand()); });
  assert.equal(loop.is_done(), false);
  await cx.settle();
  sendCommand("x");
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(got, ["x"]);
  reset();
  sendCommand("stale");
  reset();
  assert.deepEqual(state.commands, [], "reset forgets unread commands");
});
