import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { state, calls, reset, sendCommand } from "./mocks/herdr.mjs";
import { find, ids, fire } from "./mocks/element.mjs";
import { ROOT, makeCx, drawn, layoutWith, space } from "./helpers.mjs";

// tabs/fizzy-button.patch, read hunk by hunk. Its code runs in a tab bar assembled from the patch's own lines: each
// hunk's old (or new) side at the line its header gives, and invented code in the lines the patch does not show. No
// copy of Herdr's tab bar is needed: the assembled bar follows the patch, not Herdr. GAPS and OTHER_LOOP are fitted to
// this patch's hunks and context lines, so a patch made again against another tab bar may need them fitted again.
const PATCH = join(ROOT, "tabs/fizzy-button.patch");
const KEYS = JSON.parse(readFileSync(join(ROOT, "tabs/keys.json"), "utf8"));
const patchText = readFileSync(PATCH, "utf8");

const [fileHeader, ...hunkTexts] = patchText.split(/^(?=@@ )/m);
const HUNKS = hunkTexts.map(text => {
  const [head, ...body] = text.split("\n");
  if (body.at(-1) === "") body.pop();
  const [, oldStart, oldCount = "1", newStart, newCount = "1"] = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(head) ?? [];
  return {
    head, body, oldStart: Number(oldStart), oldCount: Number(oldCount), newStart: Number(newStart), newCount: Number(newCount),
    old: body.filter(l => l[0] !== "+").map(l => l.slice(1)),
    new: body.filter(l => l[0] !== "-").map(l => l.slice(1)),
    added: body.filter(l => l[0] === "+").map(l => l.slice(1)),
  };
});

// Invented code for the lines between hunks, defining only the names the hunks use: GAPS[i] ends right before hunk i,
// after as many blank lines as the headers leave room for. The class ends after the last hunk.
const GAPS = [
  [],
  ["  return (node?.children ?? []).reduce((hit, kid) => hit ?? find(kid, id), null);"],
  ["  syncPanel(shown, _side, _stack, pages) {", "    this.synced = { space: shown?.id, enabled: pages };"],
  [
    "    const stop = (_event, context) => context.stop_propagation();",
    `    const button = (id, label, onPress) => div().id(id).child(label).on_click(onPress).on_mouse_down("left", stop);`,
    "    const w = window();",
    "    const root = layout();",
    `    const sidebar = find(root, "sidebar");`,
    "    const lightsPadding = root?.traffic_lights",
  ],
  [`      .child(div().id("tab-scroll"))`],
];
const END = ["  }", "}", ""];
assert.equal(HUNKS.length, GAPS.length, "GAPS has the invented code before each hunk of the patch");

function assemble(side) {
  const lines = [];
  HUNKS.forEach((hunk, i) => {
    const room = (side === "old" ? hunk.oldStart : hunk.newStart) - 1 - lines.length;
    assert.ok(room >= GAPS[i].length, `the code before hunk ${i + 1} has ${GAPS[i].length} lines and the patch leaves room for ${room}`);
    lines.push(...Array(room - GAPS[i].length).fill(""), ...GAPS[i], ...hunk[side]);
  });
  return [...lines, ...END].join("\n");
}
const STOCK = assemble("old"), PATCHED = assemble("new");

const tmp = mkdtempSync(join(tmpdir(), "tabs-patch-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

// What `sed "s#mods/tabs/#mods/<name>/#g"` does, the rewrite mod.clone gives a clone's own asset paths.
const clonePaths = (text, name) => text.replaceAll("mods/tabs/", `mods/${name}/`);
const patch = (dir, args, input = patchText) => spawnSync("patch", [...args, "-p1", "-d", dir], { input, encoding: "utf8" });

// A folder with the assembled stock tab bar; `as` names a clone, whose main.js has its own asset paths.
function stockCopy(name, as = null) {
  const dir = join(tmp, name);
  mkdirSync(dir);
  writeFileSync(join(dir, "main.js"), as ? clonePaths(STOCK, as) : STOCK);
  return dir;
}

async function load(name, source) {
  const file = join(tmp, `${name}.mjs`);
  writeFileSync(file, source);
  return (await import(pathToFileURL(file).href)).default;
}
const Tabs = await load("tabs", PATCHED);

test("the patch is well formed: one file, and hunks in order whose lines match their headers' counts, each shifted by what the hunks before it add", () => {
  assert.match(fileHeader, /^--- a\/main\.js\n\+\+\+ b\/main\.js\n$/);
  assert.ok(patchText.endsWith("\n"));
  assert.ok(HUNKS.length > 0);
  let shift = 0, end = 0;
  for (const hunk of HUNKS) {
    assert.ok(hunk.body.every(l => /^[ +-]/.test(l)), hunk.head);
    assert.equal(hunk.old.length, hunk.oldCount, hunk.head);
    assert.equal(hunk.new.length, hunk.newCount, hunk.head);
    assert.ok(hunk.oldStart > end, `${hunk.head} starts after the hunk before it`);
    assert.equal(hunk.newStart, hunk.oldStart + shift, hunk.head);
    shift += hunk.newCount - hunk.oldCount;
    end = hunk.oldStart + hunk.oldCount - 1;
  }
});

test("the patch applies at fuzz 0 to a tab bar with its old lines, each hunk at its header's line, leaves no .orig or .rej, and reverses byte for byte", () => {
  const dir = stockCopy("round-trip");
  assert.equal(patch(dir, ["--dry-run", "-N", "-F", "0"]).status, 0, "dry run");
  const r = patch(dir, ["-N", "-F", "0"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /offset|fuzz/i);
  assert.deepEqual(readdirSync(dir).filter(f => /\.(orig|rej)$/.test(f)), []);
  assert.equal(readFileSync(join(dir, "main.js"), "utf8"), PATCHED);
  assert.equal(patch(dir, ["-R", "-F", "0"]).status, 0, "reverse");
  assert.equal(readFileSync(join(dir, "main.js"), "utf8"), STOCK);
});

test("on a clone the patch goes in once rewritten like the clone's asset paths, and not before", () => {
  assert.ok(HUNKS.some(hunk => hunk.old.some(l => l.includes("mods/tabs/"))), "the patch's context names the tab bar's own assets");
  const dir = stockCopy("clone", "fizzy-tabs");
  assert.notEqual(patch(dir, ["--dry-run", "-N", "-F", "0"]).status, 0, "the stock paths in the patch's context do not match the clone");
  assert.equal(patch(dir, ["-N", "-F", "0"], clonePaths(patchText, "fizzy-tabs")).status, 0);
  const main = readFileSync(join(dir, "main.js"), "utf8");
  assert.equal(main, clonePaths(PATCHED, "fizzy-tabs"), "the stock result, with the clone's paths");
  assert.doesNotMatch(main, /mods\/tabs\//);
});

test("a second apply is refused and changes nothing; the reverse dry run tells it is in", () => {
  const dir = stockCopy("twice");
  patch(dir, ["-N", "-F", "0"]);
  assert.notEqual(patch(dir, ["--dry-run", "-N", "-F", "0"]).status, 0);
  assert.notEqual(patch(dir, ["-N", "-F", "0"]).status, 0);
  assert.equal(patch(dir, ["--dry-run", "-R", "-F", "0"]).status, 0);
  assert.equal(readFileSync(join(dir, "main.js"), "utf8"), PATCHED);
});

test("the patch names one asset, the kanban icon the fizzy mod ships, reads the shared fizzy.unread, and has one key-command loop", () => {
  const added = HUNKS.flatMap(hunk => hunk.added).join("\n");
  assert.deepEqual([...added.matchAll(/mods\/[\w-]+\/[\w.-]+/g)].map(m => m[0]), ["mods/fizzy/kanban.svg"]);
  assert.ok(existsSync(join(ROOT, "mods/fizzy/kanban.svg")));
  assert.deepEqual([...added.matchAll(/shared\("([^"]+)"\)/g)].map(m => m[1]).sort(), ["fizzy.unread", "workspace.panels"]);
  assert.equal((PATCHED.match(/await nextCommand\(\)/g) ?? []).length, 1, "one nextCommand() loop");
});

// A tab bar on a layout with the side panel, its key-command loop started.
const WITH_FIZZY = ["files", "changes", "fizzy"];
function bar(TabBar = Tabs, { hidden = true, active = "files", children = WITH_FIZZY, shared = {}, spaces = [space("s1", "one", { active: true })] } = {}) {
  reset({ layout: layoutWith({ hidden, active, children }), shared, spaces });
  const cx = makeCx(), view = new TabBar();
  view.init(undefined, cx);
  return { view, cx, tree: () => drawn(view, cx) };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const ran = () => calls.run.map(([name, args]) => [name, args]);
const OPEN_FIZZY = [["layout.select", { stack: "panel-body", child: "fizzy" }], ["layout.show", { id: "panel" }]];
const HIDE = [["layout.hide", { id: "panel" }]];

test("a layout without a Fizzy page: no Fizzy button, and panel:fizzy does nothing", async () => {
  const b = bar(Tabs, { children: ["files", "changes"] });
  assert.equal(find(b.tree(), "panel-fizzy"), null);
  sendCommand("panel:fizzy");
  await tick();
  assert.deepEqual(ran(), []);
});

test("with a Fizzy page the Fizzy button comes after Files and Changes, before the window buttons, with the kanban icon", () => {
  const b = bar();
  state.window = { ...state.window, platform: "linux", buttons: true };
  const tree = b.tree(), order = ids(tree).filter(id => /^panel-|^minimize$/.test(id));
  assert.deepEqual(order, ["panel-files", "panel-changes", "panel-fizzy", "minimize"]);
  const button = find(tree, "panel-fizzy");
  assert.equal(button.kids.find(k => k.kind === "svg").path, "mods/fizzy/kanban.svg");
  assert.ok(button.kids.some(k => k.kind === "text" && k.text === "Fizzy"));
});

test("Fizzy is offered even when the welcome's choice of panels left Files and Changes out", () => {
  const b = bar(Tabs, { shared: { "workspace.panels": [] } });
  assert.deepEqual(ids(b.tree()).filter(id => id.startsWith("panel-")), ["panel-fizzy"]);
});

test("the unread dot shows while the shared fizzy.unread is above zero, in the accent color", () => {
  for (const [unread, dot] of [[undefined, false], [0, false], ["0", false], [3, true], ["2", true]]) {
    const b = bar(Tabs, { shared: unread === undefined ? {} : { "fizzy.unread": unread } });
    const found = find(b.tree(), "panel-fizzy-dot");
    assert.equal(Boolean(found), dot, `fizzy.unread ${JSON.stringify(unread)}`);
    if (dot) assert.equal(found.style.bg, "accent");
  }
  const tree = bar(Tabs, { shared: { "fizzy.unread": 5 } }).tree();
  assert.equal(find(tree, "panel-files-dot"), null, "Files and Changes never get a dot");
  assert.equal(find(tree, "panel-changes-dot"), null);
});

test("the Fizzy button opens its page on a hidden panel or behind another page, and hides the panel when Fizzy is in front", () => {
  for (const [hidden, active, expected] of [[true, "files", OPEN_FIZZY], [true, "fizzy", OPEN_FIZZY], [false, "files", OPEN_FIZZY], [false, "fizzy", HIDE]]) {
    const b = bar(Tabs, { hidden, active });
    fire(find(b.tree(), "panel-fizzy"), "on_click", {}, b.cx);
    assert.deepEqual(ran(), expected, `hidden ${hidden}, ${active} in front`);
  }
});

test("Files and Changes toggle as the Fizzy button does", () => {
  for (const [hidden, active, id, expected] of [
    [true, "files", "files", [["layout.select", { stack: "panel-body", child: "files" }], ["layout.show", { id: "panel" }]]],
    [false, "files", "files", HIDE],
    [false, "fizzy", "changes", [["layout.select", { stack: "panel-body", child: "changes" }], ["layout.show", { id: "panel" }]]],
  ]) {
    const b = bar(Tabs, { hidden, active });
    fire(find(b.tree(), `panel-${id}`), "on_click", {}, b.cx);
    assert.deepEqual(ran(), expected, `${id}: hidden ${hidden}, ${active} in front`);
  }
});

test("the key command panel:fizzy does what the button does, reading the layout when the key comes", async () => {
  const b = bar();
  sendCommand("panel:fizzy");
  await tick();
  assert.deepEqual(ran(), OPEN_FIZZY);
  calls.run.length = 0;
  state.layout = layoutWith({ hidden: false, active: "fizzy", children: WITH_FIZZY });
  sendCommand("panel fizzy");
  await tick();
  assert.deepEqual(ran(), HIDE);
  assert.ok(b.cx.notified >= 2, "each command ends with cx.notify");
});

test("panel:<page> works for every offered page, in any case; anything else is ignored", async () => {
  bar();
  for (const command of ["panel:nowhere", "panel:", "panel", "other:tab", "open:42:n1", "panel:files", "PANEL:CHANGES", "Panel:Fizzy"]) sendCommand(command);
  await tick();
  assert.deepEqual(ran(), WITH_FIZZY.flatMap(page => [["layout.select", { stack: "panel-body", child: page }], ["layout.show", { id: "panel" }]]));
});

test("tabs/keys.json binds its keys to fizzy-tabs, and the command it sends opens the Fizzy page", async () => {
  const actions = Object.values(KEYS).flatMap(Object.values);
  assert.deepEqual([...new Set(actions)], ["fizzy-tabs.panel:fizzy"]);
  bar();
  sendCommand(actions[0].slice("fizzy-tabs.".length));
  await tick();
  assert.deepEqual(ran(), OPEN_FIZZY);
});

test("one loop: a command whose run() throws does not end it", async () => {
  bar();
  state.runError = new Error("no such stack");
  sendCommand("panel:fizzy");
  await tick();
  state.runError = null;
  calls.run.length = 0;
  sendCommand("panel:fizzy");
  await tick();
  assert.deepEqual(ran(), OPEN_FIZZY);
  assert.equal(calls.nextCommand.length, 3, "one waiter at a time");
});

test("syncPanel gets the pages the bar offers: Fizzy among them only when the layout has a Fizzy page", () => {
  for (const children of [WITH_FIZZY, ["files", "changes"]]) {
    const b = bar(Tabs, { children });
    b.tree();
    assert.deepEqual(b.view.synced, { space: "s1", enabled: children });
  }
});

// A clone that another patch already gave a nextCommand() loop: tabs/README.md's hand merge.
const OTHER_LOOP = `  init(_props, cx) {
    this.pressed = null;
    this.scroll = ScrollHandle.new();
    try { this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}"); } catch { this.panels = {}; }
    if (!this.panels || typeof this.panels !== "object" || Array.isArray(this.panels)) this.panels = {};
    this.swipe = { acc: 0, steps: 0, at: 0, last: 0 };
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        try { this.otherCommand(command); } catch {}
        cx.notify();
      }
    });
  }

  otherCommand(command) {
    if (command === "other") run("other.thing");
  }
`;

test("a clone with a loop of its own: only the import and loop hunks are refused, and one dispatch line merges them", async () => {
  const dir = join(tmp, "looped");
  mkdirSync(dir);
  const imports = HUNKS.find(hunk => hunk.added.some(l => /^import .*\bnextCommand\b.* from "herdr";$/.test(l)));
  assert.ok(imports, "a hunk adds nextCommand to the import from herdr");
  const looped = STOCK.replace(imports.body.find(l => l[0] === "-").slice(1), imports.added[0])
    .replace(/  init\(\) \{\n(?:    .*\n)*  \}\n/, OTHER_LOOP);
  assert.match(looped, /otherCommand\(command\) \{/);
  writeFileSync(join(dir, "main.js"), looped);
  assert.notEqual(patch(dir, ["--dry-run", "-N", "-F", "0"]).status, 0, "-N takes the import that is already there for an applied patch");
  assert.equal(readFileSync(join(dir, "main.js"), "utf8"), looped);
  const r = patch(dir, ["-f", "-F", "0"]);
  assert.notEqual(r.status, 0, "some hunks are refused");
  const rej = readFileSync(join(dir, "main.js.rej"), "utf8");
  // Each hunk as the lines it adds, trimmed: what a .rej holds of it in any reject format.
  const adds = HUNKS.map(hunk => hunk.added.map(l => l.trim()).filter(Boolean));
  const refused = adds.filter(added => added.every(line => rej.includes(line)));
  assert.deepEqual(refused, adds.filter(added => added.some(line => line.includes("nextCommand"))), "the refused hunks are the two that add nextCommand: the import and the loop");
  assert.equal(refused.length, 2);
  const merged = readFileSync(join(dir, "main.js"), "utf8")
    .replace("try { this.otherCommand(command); } catch {}", "try { this.otherCommand(command); } catch {}\n        try { this.panelCommand(command); } catch {}");
  assert.match(merged, /panelCommand\(command\) \{/);
  assert.equal((merged.match(/await nextCommand\(\)/g) ?? []).length, 1);

  bar(await load("merged", merged));
  sendCommand("other");
  sendCommand("panel:fizzy");
  await tick();
  assert.deepEqual(ran(), [["other.thing", undefined], ...OPEN_FIZZY], "both features answer their own commands");
});
