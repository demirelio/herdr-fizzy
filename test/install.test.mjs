import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./helpers.mjs";
import { FITS_AT, apply } from "./mocks/patch.mjs";

const { chord, addKeys, removeKeys, describe } = await import("../scripts/merge-keys.mjs");

// install.sh runs against a scratch Herdr app home made of an invented tab bar and main layout, with stubs of
// herdr-app, uname and patch (test/mocks/patch.mjs) first on PATH. HOME, XDG_STATE_HOME, TMPDIR and the working folder
// are scratch folders too.
const SCRIPT = join(ROOT, "install.sh");
const FILTER = join(ROOT, "layout/add-fizzy.jq");
const MERGE = join(ROOT, "scripts/merge-keys.mjs");
const OUR_KEYS = join(ROOT, "tabs/keys.json");
const PATCH_TEXT = readFileSync(join(ROOT, "tabs/fizzy-button.patch"), "utf8");
const BASH = existsSync("/bin/bash") ? "/bin/bash" : "bash";
const ACTION = "fizzy-tabs.panel:fizzy", SEARCH_ACTION = "fizzy-tabs.search:fizzy";
const MADE = ["mods/fizzy", "mods/fizzy-tabs", "layouts/fizzy-core.json"];
const REPORTED = "1.2.3";

// For each system the uname stub can report: the keys install.sh suggests for the Fizzy button and its search, and the
// modifiers of the key its layout hints name.
const SYSTEMS = {
  Darwin: { key: "cmd-shift-j", search: "cmd-shift-k", layoutModifiers: "cmd-shift-" },
  Linux: { key: "ctrl-shift-j", search: "ctrl-shift-s", layoutModifiers: "ctrl-shift-" },
};
const SYSTEM = "Darwin";
const { key: KEY, search: SEARCH_KEY } = SYSTEMS[SYSTEM];

const quote = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Whether `lines` has `line`, where each `{key}` in it is a key with `system`'s layout modifiers other than the
// system's Fizzy key.
function hasHint(lines, line, system = SYSTEM) {
  const fizzyKey = SYSTEMS[system]?.key;
  const key = `${fizzyKey ? `(?!${quote(fizzyKey)}\\b)` : ""}${quote(SYSTEMS[system]?.layoutModifiers ?? "")}[^\\s()]+`;
  const pattern = new RegExp(`^${line.split("{key}").map(quote).join(key)}$`);
  return lines.some(l => pattern.test(l));
}

const tmp = mkdtempSync(join(tmpdir(), "install-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

// The parts of this repo install.sh reads; a run must leave them as they are.
const repoHash = () => treeHash(ROOT, name => ["install.sh", "mods", "tabs", "layout", "scripts"].includes(name));
const REPO_BEFORE = repoHash();

// A stock tab bar in the shape install.sh relies on: a main.js whose asset paths start with mods/tabs/, a mod.json, an
// icon, and the jsconfig.json Herdr writes into every mod folder. The stand-in patch fits it at its FITS_AT line.
const TAB_BAR = {
  "main.js": `import { View, div, svg } from "gpui-kit";

export default class Tabs extends View {
${FITS_AT}
    return div().id("tab-bar").child(svg("mods/tabs/new.svg").size(14));
  }
}
`,
  "mod.json": `{ "place": "none", "title": "Tabs" }\n`,
  "new.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M8 3v10M3 8h10"/></svg>\n`,
  "jsconfig.json": "{}\n",
};

const MAIN_LAYOUT = `${JSON.stringify({
  id: "root", type: "row", children: [
    { id: "sidebar", type: "block", size: { px: 240 }, content: { mod: "spaces" } },
    { id: "work", type: "column", children: [
      { id: "tabs", type: "block", size: { px: 42 }, content: { mod: "tabs" } },
      { id: "work-body", type: "row", children: [
        { id: "main", type: "block", content: { tab: "active" } },
        { id: "panel", type: "column", hidden: true, size: { px: 360 }, children: [
          { id: "panel-body", type: "stack", active: "files", children: [
            { id: "files", type: "block", content: { mod: "files" } },
            { id: "changes", type: "block", content: { mod: "changes" } },
          ] },
        ] },
      ] },
    ] },
  ],
}, null, 2)}\n`;

// Each line is one call. status answers only while STUB_RUNNING=1, with the layout in the STUB_SHOWN file, which
// `do layout.switch --name <x>` changes. check fails the mods named in STUB_CHECK_FAILS (in mods/, it also writes the
// main.js.error the app would), and with STUB_CHECK_MODS_ONLY=1 refuses every folder outside the app home's mods/.
// Builtins only, so it works on a PATH without the usual tools.
const HERDR_APP = `#!/bin/sh
printf '%s\\n' "$*" >> "$STUB_LOG"
case "$1" in
  --version) printf 'herdr-app %s\\n' "\${STUB_VERSION:-${REPORTED}}" ;;
  status)
    [ "\${STUB_RUNNING:-0}" = 1 ] || { printf 'herdr-app: no Herdr window is open\\n' >&2; exit 1; }
    read -r shown < "$STUB_SHOWN"
    printf '{"layout":"%s","errors":%s}\\n' "$shown" "\${STUB_ERRORS:-[]}" ;;
  check)
    case "$2" in
      "$HERDR_APP_HOME"/mods/*) placed=1 ;;
      *) placed=0
        if [ "\${STUB_CHECK_MODS_ONLY:-0}" = 1 ]; then printf 'herdr-app: %s: could not load the mod folder\\n' "$2" >&2; exit 1; fi ;;
    esac
    case " \${STUB_CHECK_FAILS:-} " in *" \${2##*/} "*)
      printf '%s/main.js:1: SyntaxError: Unexpected token\\n' "$2" >&2
      if [ "$placed" = 1 ]; then printf 'SyntaxError: Unexpected token\\n' > "$2/main.js.error"; fi
      exit 1 ;;
    esac ;;
  do)
    [ "\${STUB_DO_FAILS:-0}" = 0 ] || { printf '{ "error": "no window" }\\n'; exit 1; }
    if [ "$2" = layout.switch ] && [ "$3" = --name ]; then printf '%s\\n' "$4" > "$STUB_SHOWN"; fi
    printf '{}\\n' ;;
  *) exit 2 ;;
esac
`;
const UNAME = `#!/bin/sh\nprintf '%s\\n' "\${STUB_UNAME:-${SYSTEM}}"\n`;
const PATCH = `#!/bin/sh\nexec "${process.execPath}" "${join(ROOT, "test/mocks/patch.mjs")}" "$@"\n`;

// Herdr's list of what it ships: only its keys are read.
const INSTALLED = JSON.stringify(Object.fromEntries(["changes", "files", "spaces", "tabs", "layout:main"].map(name => [name, REPORTED])), null, 2);
const KEYS = `{
  "global": {
    "ctrl-shift-t": "tab.new",
    "ctrl-shift-l": "layout.switch"
  },
  "terminal": {
    "ctrl-shift-c": "terminal.copy"
  }
}
`;
// The keys.json --add-key leaves: both keys of a system at the end of "global" (`search` null: the Fizzy button's alone).
const withKey = (key, search = SEARCH_KEY) => KEYS.replace(`"layout.switch"\n`,
  `"layout.switch",\n    "${key}": "${ACTION}"${search ? `,\n    "${search}": "${SEARCH_ACTION}"` : ""}\n`);
const WITH_KEY = withKey(KEY);

function executable(file, text) {
  writeFileSync(file, text);
  chmodSync(file, 0o755);
}
function writeTree(dir, files) {
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
}
const which = tool => spawnSync("/bin/sh", ["-c", `command -v ${tool}`], { encoding: "utf8" }).stdout.trim();

// A scratch Herdr home as Herdr leaves it after its first start: its tab bar, its main layout, installed.json and keys.json.
function home(name, { running = false, shown = "main", keys = KEYS } = {}) {
  const dir = join(tmp, name);
  const w = { dir, app: join(dir, "app"), state: join(dir, "state"), bin: join(dir, "bin"), log: join(dir, "herdr-app.log"),
    patchLog: join(dir, "patch.log"), shown: join(dir, "shown"), cwd: join(dir, "cwd"), home: join(dir, "home"), tmpdir: join(dir, "tmp"),
    env: { STUB_RUNNING: running ? "1" : "0" } };
  for (const d of [w.app, w.bin, w.cwd, w.home, w.tmpdir, join(w.app, "layouts")]) mkdirSync(d, { recursive: true });
  writeTree(join(w.app, "mods/tabs"), TAB_BAR);
  writeFileSync(join(w.app, "layouts/main.json"), MAIN_LAYOUT);
  writeFileSync(join(w.app, "installed.json"), INSTALLED);
  if (keys !== null) writeFileSync(join(w.app, "keys.json"), keys);
  executable(join(w.bin, "herdr-app"), HERDR_APP);
  executable(join(w.bin, "uname"), UNAME);
  executable(join(w.bin, "patch"), PATCH);
  writeFileSync(w.shown, `${shown}\n`);
  return w;
}
const withoutPatch = w => rmSync(join(w.bin, "patch"));

function install(w, args = [], env = {}) {
  const r = spawnSync(BASH, [SCRIPT, ...args], {
    cwd: w.cwd, encoding: "utf8",
    env: { PATH: `${w.bin}:${process.env.PATH}`, PWD: w.cwd, HOME: w.home, TMPDIR: w.tmpdir, HERDR_APP_HOME: w.app, XDG_STATE_HOME: w.state,
      HERDR_APP: join(w.bin, "herdr-app"), STUB_LOG: w.log, STUB_SHOWN: w.shown, STUB_PATCH_LOG: w.patchLog, ...w.env, ...env },
  });
  assert.equal(r.error, undefined);
  for (const d of [w.cwd, w.home, w.tmpdir]) assert.deepEqual(readdirSync(d), [], `nothing is written in ${d}`);
  if (existsSync(w.state)) assert.deepEqual(readdirSync(w.state), ["herdr-fizzy"], "the state folder holds only the backups");
  for (const path of herdrCalls(w).join(" ").match(/\/\S+/g) ?? []) assert.ok(path.startsWith(tmp), `herdr-app was given ${path}`);
  return { status: r.status, out: r.stdout, err: r.stderr, lines: r.stdout.split("\n") };
}

const herdrCalls = w => (existsSync(w.log) ? readFileSync(w.log, "utf8").trim().split("\n").filter(Boolean) : []);
const patchCalls = w => (existsSync(w.patchLog) ? readFileSync(w.patchLog, "utf8").trim().split("\n").map(line => JSON.parse(line)) : []);
const switches = w => herdrCalls(w).filter(c => c.startsWith("do "));
const read = (w, path) => readFileSync(join(w.app, path), "utf8");
const json = (w, path) => JSON.parse(read(w, path));
const list = dir => readdirSync(dir).sort();
const backupsOf = w => join(w.state, "herdr-fizzy/backups");
const stamps = w => (existsSync(backupsOf(w)) ? list(backupsOf(w)) : []);
const hidden = w => readdirSync(w.app).filter(f => f.startsWith("."));

function treeHash(dir, keep = () => true) {
  const h = createHash("sha256");
  const visit = rel => {
    for (const name of readdirSync(join(dir, rel)).sort()) {
      const path = join(rel, name), full = join(dir, path), st = lstatSync(full);
      if (!rel && !keep(name)) continue;
      if (st.isDirectory()) { h.update(`d ${path}\n`); visit(path); }
      else if (st.isSymbolicLink()) h.update(`l ${path} ${readlinkSync(full)}\n`);
      else { h.update(`f ${path} ${st.mode & 0o777}\n`); h.update(readFileSync(full)); }
    }
  };
  visit("");
  return h.digest("hex");
}

// The stock tab bar as install.sh should leave it in mods/fizzy-tabs: without what Herdr wrote into it, with the
// clone's asset paths and cloned_from, and main.js patched by the patch rewritten to those paths.
const clonePaths = (text, name = "fizzy-tabs") => text.replaceAll("mods/tabs/", `mods/${name}/`);
const patchedMain = (name = "fizzy-tabs") => apply(clonePaths(TAB_BAR["main.js"], name), clonePaths(PATCH_TEXT, name));
function assertClone(w, version = REPORTED) {
  assert.deepEqual(list(join(w.app, "mods/fizzy-tabs")), ["main.js", "mod.json", "new.svg"], "no jsconfig.json, no main.js.orig");
  assert.equal(read(w, "mods/fizzy-tabs/main.js"), patchedMain());
  assert.equal(read(w, "mods/fizzy-tabs/new.svg"), TAB_BAR["new.svg"]);
  assert.deepEqual(json(w, "mods/fizzy-tabs/mod.json"), { ...JSON.parse(TAB_BAR["mod.json"]), cloned_from: { name: "tabs", ...(version ? { version } : {}) } });
}
const jq = (args, input) => spawnSync("jq", args, { input, encoding: "utf8" });
function assertLayout(w, version = REPORTED) {
  const page = JSON.parse(jq(["--arg", "tabs", "fizzy-tabs", "-f", FILTER], MAIN_LAYOUT).stdout);
  assert.deepEqual(json(w, "layouts/fizzy-core.json"), { ...page, cloned_from: { name: "main", version } });
}
function assertMod(w) {
  assert.deepEqual(list(join(w.app, "mods/fizzy")), list(join(ROOT, "mods/fizzy")));
  for (const f of list(join(ROOT, "mods/fizzy"))) assert.equal(read(w, `mods/fizzy/${f}`), readFileSync(join(ROOT, "mods/fizzy", f), "utf8"), f);
}
const STOCK_TABS = join(tmp, "stock-tabs");
writeTree(STOCK_TABS, TAB_BAR);
const assertStockUntouched = w => {
  assert.equal(treeHash(join(w.app, "mods/tabs")), treeHash(STOCK_TABS));
  assert.equal(read(w, "layouts/main.json"), MAIN_LAYOUT);
};

// A tab bar and a layout of the person's own: a clone of Herdr's tab bar, and main pointing at it.
function ownSetup(w) {
  const bar = join(w.app, "mods/desk-bar");
  writeTree(bar, { ...TAB_BAR, "main.js": clonePaths(TAB_BAR["main.js"], "desk-bar"),
    "mod.json": JSON.stringify({ ...JSON.parse(TAB_BAR["mod.json"]), cloned_from: { name: "tabs", version: REPORTED } }) });
  writeFileSync(join(w.app, "layouts/desk.json"), MAIN_LAYOUT.replace(`"mod": "tabs"`, `"mod": "desk-bar"`));
  return () => [treeHash(bar), read(w, "layouts/desk.json")];
}

// What a run without --add-key says about the keys (`search` null: the search's key is bound already).
const suggested = (w, key = KEY, search = SEARCH_KEY) => [
  `keys: none added. For keys that open Fizzy and its search, add these lines to the "global" section of ${w.app}/keys.json, or run ./install.sh --add-key:`,
  ...(key ? [`    "${key}": "${ACTION}"`] : []),
  ...(search ? [`    "${search}": "${SEARCH_ACTION}"`] : []),
  "keys: install.sh leaves keys.json alone unless asked: while nobody has edited it, Herdr adds its new default shortcuts to it when it updates, and any edit makes the whole file yours, which stops that",
];

test("on a stock setup install.sh makes mods/fizzy, the fizzy-tabs tab bar and the fizzy-core layout, and switches; it adds no key and prints the line to add", () => {
  const w = home("stock", { running: true }), r = install(w);
  assert.equal(r.status, 0, r.out + r.err);
  assert.deepEqual(list(join(w.app, "mods")), ["fizzy", "fizzy-tabs", "tabs"]);
  assert.deepEqual(list(join(w.app, "layouts")), ["fizzy-core.json", "main.json"]);
  assertMod(w);
  assertClone(w);
  assertLayout(w);
  assertStockUntouched(w);
  assert.equal(read(w, "keys.json"), KEYS);
  assert.deepEqual(switches(w), ["do layout.switch --name fizzy-core"]);
  assert.deepEqual(hidden(w), [], "no staging folder is left");
  assert.deepEqual(stamps(w), [], "nothing was replaced, so nothing was saved");
  for (const line of [
    `mod: installed fizzy in ${w.app}/mods/fizzy`,
    `tabs: made fizzy-tabs, Herdr's tab bar with the Fizzy button, in ${w.app}/mods/fizzy-tabs`,
    `layout: made fizzy-core, Herdr's main layout with the Fizzy page, in ${w.app}/layouts/fizzy-core.json`,
    ...suggested(w),
    "Herdr reloads mods, layouts and keys.json as their files change: nothing to restart.",
  ]) assert.ok(r.lines.includes(line), `${line}\n---\n${r.out}`);
  assert.ok(hasHint(r.lines, "layout: Herdr shows fizzy-core now ({key} switches layouts)"), r.out);
  assert.doesNotMatch(r.out, /To add Fizzy/, "no tab bar or layout of the person's own to port to");
  assert.doesNotMatch(r.out, /What was replaced/);
});

test("the tab bar is built by a dry run of the patch, then the patch, both at fuzz 0 and given the patch with the clone's asset paths", () => {
  const w = home("patch-calls"), r = install(w);
  assert.equal(r.status, 0, r.out);
  const calls = patchCalls(w), staged = `${w.app}/\\.herdr-fizzy\\.\\w+/mods/fizzy-tabs`;
  assert.equal(calls.length, 2, JSON.stringify(calls));
  assert.match(calls[0].args.join(" "), new RegExp(`^--dry-run -N -F 0 -p1 -d ${staged}$`));
  assert.match(calls[1].args.join(" "), new RegExp(`^-N -F 0 -p1 -d ${staged}$`));
  for (const call of calls) assert.equal(call.diff, clonePaths(PATCH_TEXT));
});

test("install.sh runs the same whatever version herdr-app reports: it says nothing of it, and the clones record it", () => {
  const runs = [["old", "0.0.1"], ["new", "99.0.0"]].map(([name, version]) => {
    const w = home(`version-${name}`), r = install(w, [], { STUB_VERSION: version }), out = r.out.replaceAll(w.app, "<app home>");
    assert.equal(r.status, 0, r.out);
    assert.equal(out.includes(version), false, r.out);
    assert.equal(patchCalls(w).length, 2);
    assertClone(w, version);
    assertLayout(w, version);
    return out;
  });
  assert.equal(runs[0], runs[1]);
});

test("each mod is checked with herdr-app check in the staging folder, before it goes in", () => {
  const w = home("checked"), r = install(w);
  assert.equal(r.status, 0, r.out);
  const checks = herdrCalls(w).filter(c => c.startsWith("check "));
  assert.equal(checks.length, 2);
  assert.match(checks[0], new RegExp(`^check ${w.app}/\\.herdr-fizzy\\.\\w+/mods/fizzy$`));
  assert.match(checks[1], new RegExp(`^check ${w.app}/\\.herdr-fizzy\\.\\w+/mods/fizzy-tabs$`));
});

test("a mod failing herdr-app check in the staging folder, where Herdr's own tab bar passes it, stops the run before anything changes", () => {
  const w = home("check-fails"), before = treeHash(w.app), r = install(w, ["--add-key"], { STUB_CHECK_FAILS: "fizzy" });
  assert.equal(r.status, 1, r.out + r.err);
  assert.equal(treeHash(w.app), before);
  assert.deepEqual(stamps(w), []);
  const checks = herdrCalls(w).filter(c => c.startsWith("check "));
  assert.ok(checks.some(c => new RegExp(`^check ${w.app}/\\.herdr-fizzy\\.\\w+/mods/tabs$`).test(c)), checks.join("\n"));
  assert.equal(checks.some(c => c.startsWith(`check ${w.app}/mods/`)), false, "nothing is checked in place");
  assert.ok(r.lines.includes("check: fizzy fails herdr-app check:"), r.out);
  assert.match(r.out, /^ {4}.*\/mods\/fizzy\/main\.js:1: SyntaxError: Unexpected token$/m);
  assert.ok(r.lines.includes("Nothing was changed."));
});

const inPlaceChecks = w => herdrCalls(w).filter(c => c.startsWith(`check ${w.app}/mods/`));
const CHECKED_IN_PLACE = "check: herdr-app check cannot load mods from the staging folder (Herdr's own tab bar fails there too), so each is checked once it is in place";

test("where herdr-app check cannot load a staged folder, each mod is checked once it is in mods/, before the layout and the key", () => {
  const w = home("check-in-place", { running: true }), r = install(w, ["--add-key"], { STUB_CHECK_MODS_ONLY: "1" });
  assert.equal(r.status, 0, r.out + r.err);
  assertMod(w);
  assertClone(w);
  assertLayout(w);
  assert.equal(read(w, "keys.json"), WITH_KEY);
  assert.ok(r.lines.includes(CHECKED_IN_PLACE), r.out);
  const calls = herdrCalls(w), placed = inPlaceChecks(w);
  assert.deepEqual(placed, [`check ${w.app}/mods/fizzy`, `check ${w.app}/mods/fizzy-tabs`]);
  assert.ok(calls.indexOf(placed[1]) < calls.indexOf("do layout.switch --name fizzy-core"), calls.join("\n"));
  assert.ok(r.lines.indexOf(`keys: added ${KEY}: ${ACTION}`) > r.lines.indexOf(`tabs: made fizzy-tabs, Herdr's tab bar with the Fizzy button, in ${w.app}/mods/fizzy-tabs`), r.out);
});

test("a new mod failing herdr-app check in place takes out every mod this run put in, before the layout and the key; exit 1", () => {
  const w = home("check-in-place-fails", { running: true }), before = treeHash(w.app);
  const r = install(w, ["--add-key"], { STUB_CHECK_MODS_ONLY: "1", STUB_CHECK_FAILS: "fizzy-tabs" });
  assert.equal(r.status, 1, r.out + r.err);
  assert.equal(treeHash(w.app), before);
  assert.deepEqual(stamps(w), []);
  assert.deepEqual(switches(w), []);
  assert.deepEqual(inPlaceChecks(w), [`check ${w.app}/mods/fizzy`, `check ${w.app}/mods/fizzy-tabs`]);
  for (const line of [CHECKED_IN_PLACE, "check: fizzy-tabs fails herdr-app check:", `mod: took fizzy out of ${w.app}/mods again`,
    `tabs: took fizzy-tabs out of ${w.app}/mods again`, "Nothing was changed."]) assert.ok(r.lines.includes(line), `${line}\n---\n${r.out}`);
  assert.doesNotMatch(r.out, /^(layout|keys): /m);
});

test("an updated mod failing herdr-app check in place is put back from its saved copy, byte for byte with what Herdr wrote into it; exit 1", () => {
  const w = home("check-in-place-update");
  install(w);
  const mod = join(w.app, "mods/fizzy");
  writeFileSync(join(mod, "main.js"), "// an older build\n");
  writeFileSync(join(mod, "old.js"), "x");
  for (const name of ["jsconfig.json", "herdr.d.ts"]) writeFileSync(join(mod, name), "by Herdr");
  const before = treeHash(w.app), r = install(w, [], { STUB_CHECK_MODS_ONLY: "1", STUB_CHECK_FAILS: "fizzy" });
  assert.equal(r.status, 1, r.out + r.err);
  assert.equal(treeHash(w.app), before);
  assert.deepEqual(inPlaceChecks(w), [`check ${w.app}/mods/fizzy`]);
  assert.deepEqual(readdirSync(join(w.app, "mods")).filter(f => f.startsWith(".")), [], "no hidden copy is left");
  for (const line of ["check: fizzy fails herdr-app check:", `mod: put the previous fizzy back in ${mod}`, "Nothing was changed."]) {
    assert.ok(r.lines.includes(line), `${line}\n---\n${r.out}`);
  }
});

// A bin folder first on PATH whose mv logs "from -> to" before it moves.
function loggingMv(w) {
  const log = join(w.dir, "mv.log");
  executable(join(w.bin, "mv"), `#!/bin/sh\nprintf '%s -> %s\\n' "$1" "$2" >> "${log}"\nexec "${which("mv")}" "$@"\n`);
  return () => readFileSync(log, "utf8").trim().split("\n");
}

test("a first install puts each new folder and the layout in place whole: built in a hidden staging folder, then renamed", () => {
  const w = home("staged"), moves = loggingMv(w), r = install(w);
  assert.equal(r.status, 0, r.out);
  const done = moves();
  assert.equal(done.length, 3, done.join("\n"));
  MADE.forEach((path, i) => {
    assert.match(done[i], new RegExp(`^${w.app}/\\.herdr-fizzy\\.\\w+/${path} -> ${w.app}/${path}$`));
  });
  assert.equal(json(w, "mods/fizzy/mod.json").place, "none");
  assert.equal(json(w, "mods/fizzy-tabs/mod.json").place, "none");
});

test("with mods/ and layouts/ on another filesystem than the staging folder, each new part is copied next to its place under a hidden name, then renamed there", () => {
  const w = home("other-disk"), moves = loggingMv(w);
  executable(join(w.bin, "stat"), `#!/bin/sh\nfor a; do last="$a"; done\ncase "$last" in */.herdr-fizzy.*) echo 1 ;; *) echo 2 ;; esac\n`);
  const r = install(w);
  assert.equal(r.status, 0, r.out + r.err);
  const done = moves();
  assert.equal(done.length, 3, done.join("\n"));
  MADE.forEach((path, i) => {
    const [dir, name] = [path.slice(0, path.lastIndexOf("/")), path.slice(path.lastIndexOf("/") + 1)];
    assert.match(done[i], new RegExp(`^${w.app}/${dir}/\\.${name.replace(".", "\\.")}\\.herdr-fizzy\\.\\w+ -> ${w.app}/${path}$`));
  });
  assertMod(w);
  assertClone(w);
  assertLayout(w);
  for (const dir of ["", "mods", "layouts"]) assert.deepEqual(readdirSync(join(w.app, dir)).filter(f => f.startsWith(".")), [], `nothing hidden is left in ${dir || "the app home"}`);
});

// A folder outside the app home, linked in as mods/<name>: a checkout of the person's own, with work in it.
function linkedMod(w, name) {
  const target = join(w.dir, "checkout", name);
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "main.js"), "// work in progress\n");
  writeFileSync(join(target, "notes.md"), "notes\n");
  writeFileSync(join(target, "mod.json"), JSON.stringify({ place: "none", ...(name === "fizzy-tabs" ? { cloned_from: { name: "tabs" } } : {}) }));
  symlinkSync(target, join(w.app, "mods", name));
  return target;
}
const linkLine = (label, w, path, target) => `${label}: ${w.app}/${path} is a link to ${target}, which install.sh does not make, so it and what it points at stay as they are`;

test("a mods/fizzy or mods/fizzy-tabs that is a link is left alone, and so is the folder it points at; the rest goes in; exit 2", () => {
  const w = home("linked"), [mod, tabs] = ["fizzy", "fizzy-tabs"].map(name => linkedMod(w, name));
  const checkout = join(w.dir, "checkout"), before = treeHash(checkout), r = install(w);
  assert.equal(r.status, 2, r.out + r.err);
  assert.equal(treeHash(checkout), before);
  for (const name of ["fizzy", "fizzy-tabs"]) assert.ok(lstatSync(join(w.app, "mods", name)).isSymbolicLink(), name);
  assertLayout(w);
  assert.deepEqual(stamps(w), [], "nothing behind a link is saved or changed");
  assert.deepEqual(herdrCalls(w).filter(c => c.startsWith("check ")), []);
  for (const line of [linkLine("mod", w, "mods/fizzy", mod), linkLine("tabs", w, "mods/fizzy-tabs", tabs)]) assert.ok(r.lines.includes(line), `${line}\n---\n${r.out}`);
});

test("hidden files in an installed mod folder (a rename an interrupted run left, an editor's swap file) do not make it differ", () => {
  const w = home("hidden-files");
  install(w);
  for (const name of [".main.js.new", "._main.js", ".main.js.swp"]) writeFileSync(join(w.app, "mods/fizzy", name), "x");
  writeFileSync(join(w.app, "mods/fizzy-tabs/.main.js.new"), "x");
  const backups = stamps(w), r = install(w);
  assert.equal(r.status, 0, r.out);
  for (const line of ["mod: fizzy is up to date", "tabs: fizzy-tabs is up to date"]) assert.ok(r.lines.includes(line), `${line}\n---\n${r.out}`);
  assert.deepEqual(stamps(w), backups, "no backup is made");
});

test("a mod folder that cannot be fully updated (a full disk) is named as maybe half updated, with where its old copy is; files the new build drops go last; the rest goes in; exit 2", () => {
  const w = home("disk-full");
  install(w);
  const mod = join(w.app, "mods/fizzy");
  writeFileSync(join(mod, "main.js"), "// older\n");
  writeFileSync(join(mod, "old.js"), "x");
  rmSync(join(w.app, "mods/fizzy-tabs"), { recursive: true });
  executable(join(w.bin, "cp"), `#!/bin/sh\ncase "$2" in */mods/fizzy/.main.js.new) printf 'cp: %s: No space left on device\\n' "$2" >&2; exit 1 ;; esac\nexec "${which("cp")}" "$@"\n`);
  const r = install(w);
  assert.equal(r.status, 2, r.out + r.err);
  assert.equal(read(w, "mods/fizzy/main.js"), "// older\n");
  assert.ok(existsSync(join(mod, "old.js")), "old.js is still there for the main.js that has not changed");
  assert.deepEqual(readdirSync(mod).filter(f => f.startsWith(".")), []);
  assertClone(w);
  const saved = join(backupsOf(w), stamps(w).at(-1));
  assert.equal(readFileSync(join(saved, "mods/fizzy/main.js"), "utf8"), "// older\n");
  const line = `mod: ${mod} may be half updated (the error is above): run ./install.sh again; the previous copy is in ${saved}/mods/fizzy`;
  assert.ok(r.lines.includes(line), `${line}\n---\n${r.out}`);
  assert.match(r.err, /No space left on device/);
});

test("a re-run changes nothing: every part is up to date, no backup is made, Herdr is not switched again, and the key is named", () => {
  const w = home("again", { running: true });
  install(w, ["--add-key"]);
  for (const mod of ["fizzy", "fizzy-tabs"]) for (const name of ["jsconfig.json", "herdr.d.ts"]) writeFileSync(join(w.app, "mods", mod, name), "by Herdr");
  const before = treeHash(w.app), calls = herdrCalls(w).length;
  for (const args of [[], ["--add-key"]]) {
    const r = install(w, args);
    assert.equal(r.status, 0, r.out);
    assert.equal(treeHash(w.app), before);
    assert.equal(stamps(w).length, 1, "only the first run's keys.json backup");
    for (const line of ["mod: fizzy is up to date", "tabs: fizzy-tabs is up to date",
      "layout: fizzy-core is up to date (it has the Fizzy page; your changes to it stay)", `keys: ${KEY} is already ${ACTION}`,
      "layout: Herdr shows fizzy-core"]) assert.ok(r.lines.includes(line), `${args}: ${line}\n---\n${r.out}`);
    assert.doesNotMatch(r.out, /none added|What was replaced/);
  }
  assert.deepEqual(herdrCalls(w).slice(calls).filter(c => !/^(--version|status)$/.test(c)), [], "no check, no switch");
});

test("a re-run after switching back to main leaves Herdr on main and says how to switch", () => {
  const w = home("back-to-main", { running: true });
  install(w);
  writeFileSync(w.shown, "main\n");
  const r = install(w);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(switches(w), ["do layout.switch --name fizzy-core"], "only the first run's");
  assert.ok(hasHint(r.lines, "layout: Herdr shows main and stays there: {key} switches layouts, or run herdr-app do layout.switch --name fizzy-core"), r.out);
});

test("an installed mods/fizzy that differs is saved, then updated file by file: gone files removed, Herdr's own files kept", () => {
  const w = home("update-mod");
  install(w);
  const mod = join(w.app, "mods/fizzy");
  writeFileSync(join(mod, "main.js"), "// an older build\n");
  writeFileSync(join(mod, "old.js"), "x");
  writeFileSync(join(mod, ".lib.js.new"), "from an interrupted run");
  for (const name of ["jsconfig.json", "herdr.d.ts", "main.js.error"]) writeFileSync(join(mod, name), "by Herdr");
  const r = install(w);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(list(mod), [...list(join(ROOT, "mods/fizzy")), "herdr.d.ts", "jsconfig.json", "main.js.error"].sort());
  assert.equal(read(w, "mods/fizzy/main.js"), readFileSync(join(ROOT, "mods/fizzy/main.js"), "utf8"));
  const saved = join(backupsOf(w), stamps(w).at(-1), "mods/fizzy");
  assert.equal(readFileSync(join(saved, "main.js"), "utf8"), "// an older build\n");
  assert.ok(existsSync(join(saved, "old.js")));
  assert.ok(r.lines.includes(`mod: updated fizzy; the previous copy is in ${join(backupsOf(w), stamps(w).at(-1))}/mods/fizzy`), r.out);
  assert.ok(r.lines.includes("tabs: fizzy-tabs is up to date"));
  assert.deepEqual(hidden(w), []);
  assert.deepEqual(readdirSync(mod).filter(f => f.startsWith(".")), [], "no hidden file is left from the renames");
});

test("an edited fizzy-tabs is saved and rebuilt from Herdr's tab bar", () => {
  const w = home("update-tabs");
  install(w);
  writeFileSync(join(w.app, "mods/fizzy-tabs/main.js"), "// edited\n");
  const r = install(w);
  assert.equal(r.status, 0, r.out);
  assertClone(w);
  assert.equal(readFileSync(join(backupsOf(w), stamps(w).at(-1), "mods/fizzy-tabs/main.js"), "utf8"), "// edited\n");
  assert.ok(r.lines.some(l => l.startsWith("tabs: rebuilt fizzy-tabs from this Herdr's tab bar; the previous copy is in ")), r.out);
});

// Herdr's tab bar changed where the patch goes in.
const changeStockTabs = w => writeFileSync(join(w.app, "mods/tabs/main.js"), read(w, "mods/tabs/main.js").replace(FITS_AT, "  draw() {"));

test("when Herdr's tab bar changed so the patch does not fit: the mod goes in; no half tab bar, no layout, no key; patch's own words are shown; exit 2", () => {
  const w = home("patch-fails", { running: true });
  changeStockTabs(w);
  const r = install(w, ["--add-key"]);
  assert.equal(r.status, 2, r.out);
  assertMod(w);
  assert.deepEqual(list(join(w.app, "mods")), ["fizzy", "tabs"]);
  assert.deepEqual(list(join(w.app, "layouts")), ["main.json"]);
  assert.equal(read(w, "keys.json"), KEYS, "no key for a tab bar that is not there");
  assert.deepEqual(switches(w), []);
  assert.deepEqual(hidden(w), []);
  assert.deepEqual(patchCalls(w).map(c => c.args[0]), ["--dry-run"], "nothing past the dry run");
  for (const line of ["tabs: the Fizzy button patch does not fit this Herdr's tab bar, so there is no fizzy-tabs and no fizzy-core (tabs/README.md):",
    "    Hunk #1 FAILED at 1.", "keys: none added, as there is no fizzy-tabs for the key to open"]) assert.ok(r.lines.includes(line), `${line}\n---\n${r.out}`);
});

test("when Herdr's tab bar changed after an install, the fizzy-tabs there is kept as it is, and the run exits 2", () => {
  const w = home("patch-fails-later");
  install(w);
  const clone = treeHash(join(w.app, "mods/fizzy-tabs"));
  changeStockTabs(w);
  const r = install(w);
  assert.equal(r.status, 2, r.out);
  assert.equal(treeHash(join(w.app, "mods/fizzy-tabs")), clone);
  assert.ok(r.lines.includes("tabs: the Fizzy button patch does not fit this Herdr's tab bar, so fizzy-tabs stays as it is (tabs/README.md):"), r.out);
  assert.ok(r.lines.includes("layout: fizzy-core is up to date (it has the Fizzy page; your changes to it stay)"));
});

test("with fizzy-core there but no fizzy-tabs, and a tab bar the patch does not fit: fizzy-core stays, the run says it has no tab bar, and offers no switch", () => {
  const w = home("no-tabs-left", { running: true });
  install(w);
  writeFileSync(w.shown, "main\n");
  rmSync(join(w.app, "mods/fizzy-tabs"), { recursive: true });
  changeStockTabs(w);
  const r = install(w);
  assert.equal(r.status, 2, r.out);
  assertLayout(w);
  for (const line of ["tabs: the Fizzy button patch does not fit this Herdr's tab bar, so there is no fizzy-tabs (tabs/README.md):",
    "layout: fizzy-core stays, but it has no tab bar until there is a fizzy-tabs (tabs/README.md)"]) assert.ok(r.lines.includes(line), `${line}\n---\n${r.out}`);
  assert.doesNotMatch(r.out, /no fizzy-core|is up to date \(it has|--name fizzy-core/);
  assert.deepEqual(switches(w), ["do layout.switch --name fizzy-core"], "only the first run's");
});

test("your own tab bar clone and layout are never touched; near its end the run prints the lines for them, with their names", () => {
  const w = home("own", { running: true, shown: "desk" }), snapshot = ownSetup(w), before = snapshot(), r = install(w);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(snapshot(), before);
  for (const path of MADE) assert.ok(existsSync(join(w.app, path)), path);
  assert.deepEqual(switches(w), [], "Herdr stays on the person's layout");
  assert.ok(hasHint(r.lines, "layout: Herdr shows desk and stays there: {key} switches layouts, or run herdr-app do layout.switch --name fizzy-core"), r.out);
  assert.ok(r.lines.includes("Your own layouts (desk) and tab bars (desk-bar) are as they were. To add Fizzy to them:"), r.out);
  assert.ok(r.lines.includes(`  sed "s#mods/tabs/#mods/desk-bar/#g" "${ROOT.replace(/\/$/, "")}/tabs/fizzy-button.patch" | patch -N -F 0 -p1 -d "${w.app}/mods/desk-bar"`), r.out);
  assert.ok(r.lines.some(l => l.startsWith(`  f="${w.app}/layouts/desk.json"; `) && l.includes(`jq --arg tabs "desk-bar" -f`)), r.out);
  assert.ok(r.lines.includes(`  and in keys.json, "global": "${KEY}": "desk-bar.panel:fizzy", "${SEARCH_KEY}": "desk-bar.search:fizzy"`), r.out);
});

test("the lines printed for your own tab bar and layout work as printed, the patch line refuses a second go, and a run after them has nothing more to say", () => {
  const w = home("own-ported");
  ownSetup(w);
  const r = install(w), printed = r.lines.filter(l => /^ {2}(sed|f=)/.test(l));
  assert.equal(printed.length, 2, r.out);
  const sh = line => spawnSync("/bin/sh", ["-c", line], { cwd: w.cwd, encoding: "utf8", env: { PATH: `${w.bin}:${process.env.PATH}`, TMPDIR: w.tmpdir, STUB_PATCH_LOG: w.patchLog } });
  for (const line of printed) {
    const ran = sh(line);
    assert.equal(ran.status, 0, `${line}\n${ran.stdout}${ran.stderr}`);
  }
  assert.equal(read(w, "mods/desk-bar/main.js"), patchedMain("desk-bar"));
  assert.equal(patchCalls(w).at(-1).diff, clonePaths(PATCH_TEXT, "desk-bar"));
  const again = sh(printed[0]);
  assert.equal(again.status, 1, again.stdout);
  assert.match(again.stdout, /previously applied/);
  assert.equal(read(w, "mods/desk-bar/main.js"), patchedMain("desk-bar"));
  const desk = json(w, "layouts/desk.json");
  assert.deepEqual(desk, JSON.parse(jq(["--arg", "tabs", "desk-bar", "-f", FILTER], read(w, "layouts/main.json")).stdout));
  assert.deepEqual(readdirSync(join(w.app, "layouts")).sort(), ["desk.json", "fizzy-core.json", "main.json"], "no temporary file is left");
  assert.doesNotMatch(install(w).out, /To add Fizzy/);
});

test("a fizzy-core.json install.sh did not make is refused and left byte for byte; the rest goes in; exit 2", () => {
  const w = home("foreign-layout", { running: true }), theirs = `{ "id": "root", "type": "row", "children": [] }\n`;
  writeFileSync(join(w.app, "layouts/fizzy-core.json"), theirs);
  const r = install(w);
  assert.equal(r.status, 2, r.out);
  assert.equal(read(w, "layouts/fizzy-core.json"), theirs);
  assertMod(w);
  assertClone(w);
  assert.deepEqual(switches(w), []);
  assert.ok(r.lines.includes(`layout: ${w.app}/layouts/fizzy-core.json was not made by install.sh (no Fizzy page, or a tab bar other than fizzy-tabs), so it stays as it is: move it aside and run ./install.sh again, or add the page by hand (layout/README.md)`), r.out);
});

test("a mods/fizzy-tabs that is not a copy of Herdr's tab bar is saved, then replaced, and the run says so", () => {
  const w = home("foreign-tabs"), theirs = join(w.app, "mods/fizzy-tabs");
  mkdirSync(theirs);
  writeFileSync(join(theirs, "main.js"), "export default class Other {}\n");
  writeFileSync(join(theirs, "mod.json"), `{ "place": "left" }\n`);
  const r = install(w);
  assert.equal(r.status, 0, r.out);
  assertClone(w);
  assert.equal(readFileSync(join(backupsOf(w), stamps(w)[0], "mods/fizzy-tabs/main.js"), "utf8"), "export default class Other {}\n");
  assert.ok(r.lines.includes(`tabs: ${w.app}/mods/fizzy-tabs is not a copy of Herdr's tab bar; it is saved before it is replaced`), r.out);
});

test("with Herdr not running: the files go in, nothing is switched, and the run says how to switch", () => {
  const w = home("closed"), r = install(w);
  assert.equal(r.status, 0, r.out);
  for (const path of MADE) assert.ok(existsSync(join(w.app, path)), path);
  assert.deepEqual(switches(w), []);
  assert.ok(herdrCalls(w).includes("status"));
  assert.ok(hasHint(r.lines, "layout: open Herdr, then switch to fizzy-core: {key} switches layouts, or run herdr-app do layout.switch --name fizzy-core"), r.out);
});

test("each layout hint names a key for switching layouts, cmd-shift-<key> on macOS and ctrl-shift-<key> on Linux; on another system only the herdr-app command", () => {
  for (const system of [...Object.keys(SYSTEMS), "FreeBSD"]) {
    const w = home(`layout-key-${system}`, { running: true }), env = { STUB_UNAME: system }, keyed = system in SYSTEMS;
    const how = `${keyed ? "{key} switches layouts, or " : ""}run herdr-app do layout.switch --name fizzy-core`;
    const expect = (r, line) => assert.ok(hasHint(r.lines, line, system), `${system}: ${line}\n---\n${r.out}`);
    expect(install(w, [], env), `layout: Herdr shows fizzy-core now${keyed ? " ({key} switches layouts)" : ""}`);
    writeFileSync(w.shown, "main\n");
    expect(install(w, [], env), `layout: Herdr shows main and stays there: ${how}`);
    expect(install(w, [], { ...env, STUB_RUNNING: "0" }), `layout: open Herdr, then switch to fizzy-core: ${how}`);
    writeFileSync(w.shown, "fizzy-core\n");
    expect(install(w, ["--uninstall"], { ...env, STUB_DO_FAILS: "1" }),
      `Herdr still shows fizzy-core, so nothing was removed: switch to another layout${keyed ? " ({key})" : ""} and run ./install.sh --uninstall again.`);
  }
});

test("after the switch, errors herdr-app status reports are shown", () => {
  const w = home("errors", { running: true }), r = install(w, [], { STUB_ERRORS: `["mods/fizzy: something went wrong"]` });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /^herdr: herdr-app status reports:\n {4}mods\/fizzy: something went wrong$/m);
});

test("a switch Herdr refuses is reported, and the run exits 2 with everything else in place", () => {
  const w = home("switch-fails", { running: true }), r = install(w, [], { STUB_DO_FAILS: "1" });
  assert.equal(r.status, 2, r.out);
  for (const path of MADE) assert.ok(existsSync(join(w.app, path)), path);
  assert.match(r.out, /^layout: Herdr did not switch to fizzy-core:\n {4}\{ "error": "no window" \}$/m);
});

test("without herdr-app (HERDR_APP empty) the files go in, with no check and no switch", () => {
  const w = home("no-herdr-app"), r = install(w, [], { HERDR_APP: "" });
  assert.equal(r.status, 0, r.out);
  for (const path of MADE) assert.ok(existsSync(join(w.app, path)), path);
  assert.deepEqual(herdrCalls(w), []);
  assert.ok(r.lines.includes("herdr: no herdr-app, so no herdr-app check and no layout switch"), r.out);
  assertClone(w, null);
});

test("--dry-run builds everything in the staging folder without herdr-app check, says what it would do, and changes nothing", () => {
  const w = home("dry", { running: true }), before = treeHash(w.app), r = install(w, ["--dry-run", "--add-key"]);
  assert.equal(r.status, 0, r.out);
  assert.equal(treeHash(w.app), before);
  assert.equal(existsSync(w.state), false);
  assert.deepEqual(herdrCalls(w), ["--version", "status"], "no check, no switch");
  assert.deepEqual(patchCalls(w).map(c => c.args[0]), ["--dry-run", "-N"], "the patch goes onto the staged copy");
  for (const line of [`mod: would install fizzy in ${w.app}/mods/fizzy`, "tabs: would make fizzy-tabs, Herdr's tab bar with the Fizzy button",
    "layout: would make fizzy-core, Herdr's main layout with the Fizzy page", `keys: would add ${KEY}: ${ACTION}`,
    "layout: would switch Herdr from main to fizzy-core", "Dry run: nothing was changed."]) assert.ok(r.lines.includes(line), `${line}\n---\n${r.out}`);
});

test("--dry-run over an install that differs says what it would update, and still changes nothing", () => {
  const w = home("dry-update");
  install(w);
  writeFileSync(join(w.app, "mods/fizzy/main.js"), "// older\n");
  const before = treeHash(w.app), backups = stamps(w), r = install(w, ["--dry-run"]);
  assert.equal(r.status, 0, r.out);
  assert.equal(treeHash(w.app), before);
  assert.deepEqual(stamps(w), backups);
  assert.ok(r.lines.includes(`mod: would update fizzy in ${w.app}/mods/fizzy, saving the installed copy first`), r.out);
});

test("--dry-run exits 2 when a part could not be made, and still changes nothing", () => {
  const w = home("dry-fails");
  changeStockTabs(w);
  const before = treeHash(w.app), r = install(w, ["--dry-run"]);
  assert.equal(r.status, 2, r.out);
  assert.equal(treeHash(w.app), before);
});

test("--mod-only installs mods/fizzy alone, without jq or patch, and prints the lines for your own tab bar and layout", () => {
  const w = home("mod-only", { running: true });
  withoutPatch(w);
  const r = install(w, ["--mod-only"], { PATH: `${w.bin}:${toolbox(w, ["jq"])}` });
  assert.equal(r.status, 0, r.out + r.err);
  assertMod(w);
  assert.deepEqual(list(join(w.app, "mods")), ["fizzy", "tabs"]);
  assert.deepEqual(list(join(w.app, "layouts")), ["main.json"]);
  assert.equal(read(w, "keys.json"), KEYS);
  assert.deepEqual(switches(w), []);
  assert.ok(r.lines.includes("To add Fizzy to your own tab bar and layout:"), r.out);
  assert.ok(r.lines.includes(`  herdr-app do mod.clone '{"name":"tabs","as":"<your tab bar>"}'`), r.out);
});

test("by default keys.json is left alone, byte for byte and not saved, and the run prints the lines to add for this system and why", () => {
  for (const [name, keys, env, { key, search }] of [["key-default", KEYS, {}, SYSTEMS.Darwin], ["key-default-linux", KEYS, { STUB_UNAME: "Linux" }, SYSTEMS.Linux],
    ["key-default-no-file", null, {}, SYSTEMS.Darwin]]) {
    const w = home(name, { keys }), r = install(w, [], env);
    assert.equal(r.status, 0, r.out);
    if (keys === null) assert.equal(existsSync(join(w.app, "keys.json")), false, name);
    else assert.equal(read(w, "keys.json"), KEYS, name);
    assert.equal(existsSync(w.state), false, name);
    const lines = suggested(w, key, search);
    for (const line of lines) assert.ok(r.lines.includes(line), `${name}: ${line}\n---\n${r.out}`);
    assert.deepEqual(JSON.parse(`{${lines[1]},${lines[2]}}`), { [key]: ACTION, [search]: SEARCH_ACTION }, "the lines go into keys.json as printed");
  }
  const w = home("key-default-bsd"), r = install(w, [], { STUB_UNAME: "FreeBSD" });
  assert.equal(r.status, 0, r.out);
  assert.equal(read(w, "keys.json"), KEYS);
  assert.ok(r.lines.includes(`keys: none added. For keys that open Fizzy and its search, bind keys to ${ACTION} ${SEARCH_ACTION} in the "global" section of ${w.app}/keys.json (tabs/README.md)`), r.out);
});

test("without --add-key, a key keys.json already binds to the Fizzy button or its search, in any section, is named instead", () => {
  const both = KEYS.replace(`"terminal.copy"`, `"terminal.copy",\n    "f5": "${ACTION}",\n    "f6": "${SEARCH_ACTION}"`), w = home("key-default-bound", { keys: both }), r = install(w);
  assert.equal(r.status, 0, r.out);
  assert.equal(read(w, "keys.json"), both);
  assert.ok(r.lines.includes(`keys: f5 is already ${ACTION}`) && r.lines.includes(`keys: f6 is already ${SEARCH_ACTION}`), r.out);
  assert.doesNotMatch(r.out, /none added/);
  const panelOnly = KEYS.replace(`"terminal.copy"`, `"terminal.copy",\n    "f5": "${ACTION}"`), v = home("key-default-panel-bound", { keys: panelOnly }), s = install(v);
  assert.ok(s.lines.includes(`keys: f5 is already ${ACTION}`), s.out);
  for (const line of suggested(v, null)) assert.ok(s.lines.includes(line), `${line}\n---\n${s.out}`);
  assert.ok(!s.lines.includes(`    "${KEY}": "${ACTION}"`), "the bound one is not suggested again");
});

const keysRun = (name, keys, env = {}) => {
  const w = home(name, { keys });
  return { w, r: install(w, ["--add-key"], env) };
};

test("--add-key adds the keys at the end of global, every other byte of keys.json stays, and the old file is saved", () => {
  const { w, r } = keysRun("key-add", KEYS);
  assert.equal(r.status, 0, r.out);
  assert.equal(read(w, "keys.json"), WITH_KEY);
  assert.ok(r.lines.includes(`keys: added ${KEY}: ${ACTION}`) && r.lines.includes(`keys: added ${SEARCH_KEY}: ${SEARCH_ACTION}`), r.out);
  assert.ok(r.lines.some(l => l.startsWith("keys: saved the previous keys.json as ")));
  assert.equal(readFileSync(join(backupsOf(w), stamps(w)[0], "keys.json"), "utf8"), KEYS);
  assert.doesNotMatch(r.out, /none added/);
});

test(`--add-key on Linux adds ${SYSTEMS.Linux.key} and ${SYSTEMS.Linux.search} (ctrl-shift-k is Herdr's own there)`, () => {
  const { w, r } = keysRun("key-linux", KEYS, { STUB_UNAME: "Linux" });
  assert.equal(r.status, 0, r.out);
  assert.equal(read(w, "keys.json"), withKey(SYSTEMS.Linux.key, SYSTEMS.Linux.search));
  assert.ok(r.lines.includes(`keys: added ${SYSTEMS.Linux.key}: ${ACTION}`) && r.lines.includes(`keys: added ${SYSTEMS.Linux.search}: ${SEARCH_ACTION}`), r.out);
});

test("--add-key keeps a key you bound to something else, in global or any other section, and names it, still adding the free one; the run still exits 0", () => {
  for (const [name, theirs, line] of [
    ["key-taken", KEYS.replace(`"tab.new",`, `"tab.new",\n    "shift-cmd-j": "my.thing",`), `keys: kept your shift-cmd-j: my.thing; to use ${ACTION}, bind another key to it in keys.json`],
    ["key-taken-terminal", KEYS.replace(`"terminal.copy"`, `"terminal.copy",\n    "${KEY}": "send:x"`), `keys: kept your ${KEY} in "terminal": send:x; to use ${ACTION}, bind another key to it in keys.json`],
  ]) {
    const { w, r } = keysRun(name, theirs);
    assert.equal(r.status, 0, r.out);
    assert.equal(read(w, "keys.json"), theirs.replace(`"layout.switch"\n`, `"layout.switch",\n    "${SEARCH_KEY}": "${SEARCH_ACTION}"\n`), `${name}: the search's key is added`);
    assert.ok(r.lines.includes(line), `${line}\n---\n${r.out}`);
  }
});

test("--add-key with no keys.json, no node, an unknown system or a keys.json that is not JSON: keys.json is left alone and the run says what to add", () => {
  const line = `"${KEY}": "${ACTION}", "${SEARCH_KEY}": "${SEARCH_ACTION}"`;
  let { w, r } = keysRun("key-no-file", null);
  assert.equal(r.status, 0, r.out);
  assert.equal(existsSync(join(w.app, "keys.json")), false);
  assert.ok(r.lines.includes(`keys: ${w.app} has no keys.json, so none was made: once Herdr has written one, add ${line} to its "global" section`), r.out);

  w = home("key-no-node");
  r = install(w, ["--add-key"], { PATH: `${w.bin}:${toolbox(w, ["node"])}` });
  assert.equal(r.status, 0, r.out + r.err);
  assert.equal(read(w, "keys.json"), KEYS);
  assert.ok(r.lines.includes(`keys: node not found, so keys.json was left alone: add ${line} to the "global" section of ${w.app}/keys.json`), r.out);

  ({ w, r } = keysRun("key-bsd", KEYS, { STUB_UNAME: "FreeBSD" }));
  assert.equal(r.status, 0, r.out);
  assert.equal(read(w, "keys.json"), KEYS);
  assert.ok(r.lines.includes(`keys: no key is suggested on this system: bind keys to ${ACTION} and ${SEARCH_ACTION} in keys.json (tabs/README.md)`), r.out);

  ({ w, r } = keysRun("key-bad-json", `{ "global": { "cmd-q": "app.quit", } }`));
  assert.equal(r.status, 0, r.out);
  assert.equal(read(w, "keys.json"), `{ "global": { "cmd-q": "app.quit", } }`);
  assert.match(r.out, new RegExp(`^keys: left .*keys\\.json alone: it is not valid JSON .*; once it is, add ${line} to its "global" section$`, "m"));
});

test("--add-key on a keys.json that cannot be written is reported and the run exits 2 with the rest in place", { skip: process.getuid?.() === 0 && "root writes into a read-only folder" }, () => {
  const w = home("key-locked"), keysDir = join(w.dir, "dotfiles");
  mkdirSync(keysDir);
  writeFileSync(join(keysDir, "keys.json"), KEYS);
  rmSync(join(w.app, "keys.json"));
  symlinkSync(join(keysDir, "keys.json"), join(w.app, "keys.json"));
  chmodSync(keysDir, 0o555);
  try {
    const r = install(w, ["--add-key"]);
    assert.equal(r.status, 2, r.out + r.err);
    assert.equal(readFileSync(join(keysDir, "keys.json"), "utf8"), KEYS);
    assert.match(r.err, /keys: could not write .*keys\.json/);
    for (const path of MADE) assert.ok(existsSync(join(w.app, path)), path);
  } finally {
    chmodSync(keysDir, 0o755);
  }
});

test("--add-key writes through a keys.json that is a link: the file it points at changes, the link stays, its mode is kept", () => {
  const w = home("key-link"), real = join(w.dir, "dotfiles/keys.json");
  mkdirSync(join(w.dir, "dotfiles"));
  writeFileSync(real, KEYS);
  chmodSync(real, 0o600);
  rmSync(join(w.app, "keys.json"));
  symlinkSync(real, join(w.app, "keys.json"));
  const r = install(w, ["--add-key"]);
  assert.equal(r.status, 0, r.out);
  assert.ok(lstatSync(join(w.app, "keys.json")).isSymbolicLink());
  assert.equal(readFileSync(real, "utf8"), WITH_KEY);
  assert.equal(statSync(real).mode & 0o777, 0o600);
  assert.deepEqual(list(join(w.dir, "dotfiles")), ["keys.json"], "no temporary file is left");
});

// An rm first on PATH that logs "rm <path>" into herdr-app's log, so one log holds both in the order they ran.
function loggingRm(w) {
  executable(join(w.bin, "rm"), `#!/bin/sh\nfor a; do last="$a"; done\nprintf 'rm %s\\n' "$last" >> "$STUB_LOG"\nexec "${which("rm")}" "$@"\n`);
}

test("--uninstall switches Herdr off fizzy-core before it removes anything, saves and removes what install.sh made, takes the key out, and keeps Herdr's records and the profile photos", () => {
  const w = home("uninstall", { running: true });
  install(w, ["--add-key"]);
  writeFileSync(join(w.app, "shared.json"), `{ "fizzy.unread": 2 }\n`);
  mkdirSync(join(w.app, "data/fizzy/avatars"), { recursive: true });
  writeFileSync(join(w.app, "data/fizzy/avatars/u-me.png"), "png");
  mkdirSync(join(w.app, "layouts/.state"));
  writeFileSync(join(w.app, "layouts/.state/fizzy-core.json"), "{}");
  loggingRm(w);
  const r = install(w, ["--uninstall"]);
  assert.equal(r.status, 0, r.out + r.err);
  assert.deepEqual(switches(w), ["do layout.switch --name fizzy-core", "do layout.switch --name main"]);
  const calls = herdrCalls(w), removed = calls.filter(c => c.startsWith("rm "));
  assert.deepEqual(removed.toSorted(), MADE.map(path => `rm ${w.app}/${path}`).toSorted());
  assert.ok(calls.indexOf("do layout.switch --name main") < calls.indexOf(removed[0]), calls.join("\n"));
  for (const path of MADE) assert.equal(existsSync(join(w.app, path)), false, path);
  assert.equal(read(w, "keys.json"), KEYS, "keys.json is byte for byte what it was before the install");
  assert.equal(read(w, "shared.json"), `{ "fizzy.unread": 2 }\n`);
  assert.ok(existsSync(join(w.app, "data/fizzy/avatars/u-me.png")));
  assert.ok(existsSync(join(w.app, "layouts/.state/fizzy-core.json")));
  assertStockUntouched(w);
  const saved = join(backupsOf(w), stamps(w).at(-1));
  assert.deepEqual(list(saved), ["keys.json", "layouts", "mods"]);
  assert.deepEqual(list(join(saved, "mods")), ["fizzy", "fizzy-tabs"]);
  assert.ok(existsSync(join(saved, "layouts/fizzy-core.json")));
  for (const line of ["layout: switched Herdr from fizzy-core to main", `keys: removed ${KEY}: ${ACTION}`,
    `Left in ${w.app}: Herdr's own records (the fizzy.* keys in shared.json, layouts/.state/fizzy-core.json) and the profile photos the panel fetched into data/fizzy; delete that folder yourself to remove them.`,
    `What was removed is saved in ${saved}.`]) assert.ok(r.lines.includes(line), `${line}\n---\n${r.out}`);
});

test("--uninstall keeps what is not install.sh's: a key bound to something else, a foreign fizzy-core and fizzy-tabs, your own layout", () => {
  const w = home("uninstall-theirs");
  ownSetup(w);
  writeFileSync(join(w.app, "keys.json"), KEYS.replace(`"tab.new",`, `"tab.new",\n    "${KEY}": "my.thing",`));
  writeFileSync(join(w.app, "layouts/fizzy-core.json"), `{ "id": "root" }\n`);
  mkdirSync(join(w.app, "mods/fizzy-tabs"));
  writeFileSync(join(w.app, "mods/fizzy-tabs/mod.json"), `{ "place": "left" }\n`);
  writeFileSync(join(w.app, "layouts/desk.json"), jq(["--arg", "tabs", "desk-bar", "-f", FILTER], read(w, "layouts/desk.json")).stdout);
  const before = treeHash(w.app), r = install(w, ["--uninstall"]);
  assert.equal(r.status, 0, r.out);
  assert.equal(treeHash(w.app), before);
  for (const line of [`layout: ${w.app}/layouts/fizzy-core.json was not made by install.sh, so it stays`,
    `tabs: ${w.app}/mods/fizzy-tabs is not a copy of Herdr's tab bar, so it stays`, `keys: ${KEY} is my.thing, not ${ACTION}: left as it is`,
    "layout: the Fizzy page shows nothing without the mod, and these layouts of yours still have it: desk (layout/README.md says how to take it out)"]) assert.ok(r.lines.includes(line), `${line}\n---\n${r.out}`);
});

test("--uninstall keeps fizzy-tabs while a layout of yours shows it, names the layout, and prints the line that points it back at Herdr's tab bar", () => {
  const w = home("uninstall-in-use", { running: true });
  install(w);
  writeFileSync(join(w.app, "layouts/desk.json"), jq(["--arg", "tabs", "fizzy-tabs", "-f", FILTER], MAIN_LAYOUT).stdout);
  writeFileSync(w.shown, "desk\n");
  const clone = treeHash(join(w.app, "mods/fizzy-tabs")), desk = read(w, "layouts/desk.json"), r = install(w, ["--uninstall"]);
  assert.equal(r.status, 2, r.out + r.err);
  assert.equal(treeHash(join(w.app, "mods/fizzy-tabs")), clone);
  assert.equal(read(w, "layouts/desk.json"), desk);
  for (const path of ["mods/fizzy", "layouts/fizzy-core.json"]) assert.equal(existsSync(join(w.app, path)), false, path);
  assert.deepEqual(switches(w), ["do layout.switch --name fizzy-core"], "Herdr stays on desk");
  const line = "tabs: fizzy-tabs stays, as these layouts of yours show it as their tab bar: desk. These lines point them back at Herdr's own tab bar; then ./install.sh --uninstall removes it:";
  assert.ok(r.lines.includes(line), `${line}\n---\n${r.out}`);
  const fixes = r.lines.filter(l => l.startsWith("  f="));
  assert.equal(fixes.length, 1, r.out);
  const ran = spawnSync("/bin/sh", ["-c", fixes[0]], { cwd: w.cwd, encoding: "utf8", env: { PATH: process.env.PATH, TMPDIR: w.tmpdir } });
  assert.equal(ran.status, 0, `${fixes[0]}\n${ran.stderr}`);
  assert.deepEqual(json(w, "layouts/desk.json"), JSON.parse(jq(["--arg", "tabs", "tabs", "-f", FILTER], MAIN_LAYOUT).stdout));
  const again = install(w, ["--uninstall"]);
  assert.equal(again.status, 0, again.out);
  assert.equal(existsSync(join(w.app, "mods/fizzy-tabs")), false);
});

test("--uninstall leaves a mods/fizzy, mods/fizzy-tabs or fizzy-core.json that is a link, and what it points at; exit 0", () => {
  const w = home("uninstall-linked"), [mod, tabs] = ["fizzy", "fizzy-tabs"].map(name => linkedMod(w, name));
  const layout = join(w.dir, "checkout/fizzy-core.json");
  writeFileSync(layout, JSON.stringify({ ...JSON.parse(jq(["--arg", "tabs", "fizzy-tabs", "-f", FILTER], MAIN_LAYOUT).stdout), cloned_from: { name: "main" } }));
  symlinkSync(layout, join(w.app, "layouts/fizzy-core.json"));
  const checkout = join(w.dir, "checkout"), before = [treeHash(w.app), treeHash(checkout)], r = install(w, ["--uninstall"]);
  assert.equal(r.status, 0, r.out + r.err);
  assert.deepEqual([treeHash(w.app), treeHash(checkout)], before);
  assert.deepEqual(stamps(w), []);
  for (const line of [linkLine("layout", w, "layouts/fizzy-core.json", layout), linkLine("tabs", w, "mods/fizzy-tabs", tabs), linkLine("mod", w, "mods/fizzy", mod)]) {
    assert.ok(r.lines.includes(line), `${line}\n---\n${r.out}`);
  }
});

test("--uninstall --dry-run says what it would remove and changes nothing", () => {
  const w = home("uninstall-dry", { running: true });
  install(w, ["--add-key"]);
  const before = treeHash(w.app), backups = stamps(w), r = install(w, ["--uninstall", "--dry-run"]);
  assert.equal(r.status, 0, r.out);
  assert.equal(treeHash(w.app), before);
  assert.deepEqual(stamps(w), backups);
  assert.deepEqual(switches(w), ["do layout.switch --name fizzy-core"]);
  for (const line of ["layout: would switch Herdr from fizzy-core to main first", "layout: would remove fizzy-core, saving it first",
    "tabs: would remove fizzy-tabs, saving it first", "mod: would remove fizzy, saving it first", `keys: would remove ${KEY}: ${ACTION}`,
    "Dry run: nothing was changed."]) assert.ok(r.lines.includes(line), `${line}\n---\n${r.out}`);
});

test("--uninstall with nothing installed says so and exits 0", () => {
  const w = home("uninstall-none"), before = treeHash(w.app), r = install(w, ["--uninstall"]);
  assert.equal(r.status, 0, r.out);
  assert.equal(treeHash(w.app), before);
  assert.ok(r.lines.includes(`Nothing install.sh makes is in ${w.app}.`), r.out);
  assert.ok(r.lines.includes(`keys: ${KEY} is not bound: nothing to remove`));
});

test("--uninstall leaves the key where it is bound only outside \"global\", and says it is not in \"global\"", () => {
  const keys = KEYS.replace(`"terminal.copy"\n`, `"terminal.copy",\n    "${KEY}": "${ACTION}"\n`);
  const w = home("uninstall-key-elsewhere", { keys }), r = install(w, ["--uninstall"]);
  assert.equal(r.status, 0, r.out);
  assert.equal(read(w, "keys.json"), keys);
  assert.ok(r.lines.includes(`keys: ${KEY} is not in "global": nothing to remove`), r.out);
});

test("--uninstall removes nothing while Herdr will not leave fizzy-core", () => {
  const w = home("uninstall-stuck", { running: true });
  install(w);
  const before = treeHash(w.app), r = install(w, ["--uninstall"], { STUB_DO_FAILS: "1" });
  assert.equal(r.status, 1, r.out);
  assert.equal(treeHash(w.app), before);
  assert.ok(hasHint(r.lines, "Herdr still shows fizzy-core, so nothing was removed: switch to another layout ({key}) and run ./install.sh --uninstall again."), r.out);
});

// A folder of links to the tools install.sh runs, without `missing`; patch is the stub in the bin folder.
function toolbox(w, missing) {
  const dir = join(w.dir, `tools-${missing.join("-")}`);
  mkdirSync(dir, { recursive: true });
  for (const tool of ["cat", "cmp", "cp", "date", "diff", "dirname", "grep", "jq", "mkdir", "mktemp", "mv", "node", "readlink", "rm", "sed", "stat"]) {
    if (missing.includes(tool)) continue;
    const at = tool === "node" ? process.execPath : which(tool);
    assert.ok(at, `${tool} is on this machine`);
    symlinkSync(at, join(dir, tool));
  }
  return dir;
}

test("a missing jq or patch stops the run before anything is written, and says how to get it", () => {
  for (const tool of ["jq", "patch"]) {
    const w = home(`no-${tool}`);
    if (tool === "patch") withoutPatch(w);
    const before = treeHash(w.app), r = install(w, [], { PATH: `${w.bin}:${toolbox(w, [tool])}` });
    assert.equal(r.status, 1, r.out + r.err);
    assert.equal(treeHash(w.app), before);
    assert.match(r.err, new RegExp(`^install\\.sh: ${tool} is missing: install it \\(.*\\), then run \\./install\\.sh again$`, "m"));
  }
});

test("an app home that is empty, /, a link to /, missing, or without Herdr's files is refused before anything is written", () => {
  const w = home("refusals");
  symlinkSync("/", join(w.dir, "root-link"));
  for (const [appHome, message] of [
    ["", /HERDR_APP_HOME is empty/],
    ["/", /refusing HERDR_APP_HOME=\/: it is \//],
    ["//", /refusing HERDR_APP_HOME=\/+: it is \//],
    [join(w.dir, "root-link"), /refusing HERDR_APP_HOME=.*root-link: it is \//],
    [join(w.dir, "nowhere"), /no Herdr app home at .*nowhere: start Herdr once so it writes its files, or set HERDR_APP_HOME/],
    [w.cwd, /has no mods\/tabs\/main\.js or layouts\/main\.json, which Herdr writes when it starts: start Herdr once, or set HERDR_APP_HOME/],
  ]) {
    const r = install(w, [], { HERDR_APP_HOME: appHome });
    assert.equal(r.status, 1, `${appHome}: ${r.out}`);
    assert.match(r.err, message, appHome);
    assert.equal(r.out.includes("installed"), false);
  }
  assert.equal(existsSync(join(w.dir, "nowhere")), false);
  for (const verb of ["--uninstall", "--mod-only"]) {
    const r = install(w, [verb], { HERDR_APP_HOME: "/" });
    assert.equal(r.status, 1, verb);
    assert.match(r.err, /refusing HERDR_APP_HOME=\//);
  }
});

test("a relative HERDR_APP_HOME is taken from the working folder", () => {
  const w = home("relative"), r = install(w, [], { HERDR_APP_HOME: "../app" });
  assert.equal(r.status, 0, r.out + r.err);
  for (const path of MADE) assert.ok(existsSync(join(w.app, path)), path);
});

test("--help prints the header with the options, the keys --add-key binds, the environment and the exit codes; a wrong option or pair of options exits 1", () => {
  const w = home("help"), help = install(w, ["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.out, /^install\.sh: /);
  for (const option of ["--add-key", "--mod-only", "--dry-run", "--uninstall", "--help"]) assert.match(help.out, new RegExp(`\\./install\\.sh ${option}( |$)`, "m"), option);
  for (const { key } of Object.values(SYSTEMS)) assert.ok(help.out.includes(key), key);
  for (const name of ["HERDR_APP_HOME", "XDG_STATE_HOME", "HERDR_APP"]) assert.match(help.out, new RegExp(`^ {2}${name} `, "m"), name);
  assert.match(help.out, /^Exit status:\n {2}0 .*\n( {5}.*\n)* {2}1 .*\n( {5}.*\n)* {2}2 /m);
  assert.doesNotMatch(help.out, /^#|set -euo/m);
  const bad = install(w, ["--bogus"]);
  assert.equal(bad.status, 1);
  assert.match(bad.err, /unknown option: --bogus/);
  assert.match(bad.err, /--mod-only/);
  for (const [args, message] of [
    [["--uninstall", "--mod-only"], /--uninstall removes everything install\.sh made: leave out --mod-only/],
    [["--uninstall", "--add-key"], /--uninstall takes the key out: leave out --add-key/],
    [["--mod-only", "--add-key"], /--add-key binds the key to fizzy-tabs, which --mod-only does not make: leave out one of them/],
  ]) {
    const both = install(w, args);
    assert.equal(both.status, 1, args.join(" "));
    assert.match(both.err, message);
  }
  assert.equal(existsSync(join(w.app, "mods/fizzy")), false);
  assert.equal(read(w, "keys.json"), KEYS);
  assert.deepEqual(herdrCalls(w), []);
});

const filter = (layout, tabs = "fizzy-tabs") => jq(["--arg", "tabs", tabs, "-f", FILTER], typeof layout === "string" ? layout : JSON.stringify(layout));
const byId = (tree, id) => {
  if (tree?.id === id) return tree;
  for (const child of tree?.children ?? []) { const found = byId(child, id); if (found) return found; }
  return null;
};

test("add-fizzy.jq puts the Fizzy page last in the panel-body stack and the tab bar on fizzy-tabs, and changes nothing else", () => {
  const r = filter(MAIN_LAYOUT);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout), stock = JSON.parse(MAIN_LAYOUT);
  const body = byId(out, "panel-body");
  assert.deepEqual(body.children.map(c => c.id), ["files", "changes", "fizzy"]);
  assert.deepEqual(body.children[2], { id: "fizzy", type: "block", content: { mod: "fizzy" } });
  assert.equal(body.active, "files");
  assert.equal(byId(out, "panel").hidden, true);
  assert.deepEqual(byId(out, "tabs").content, { mod: "fizzy-tabs" });
  body.children.pop();
  byId(out, "tabs").content.mod = "tabs";
  assert.deepEqual(out, stock);
  assert.equal(filter(r.stdout).stdout, r.stdout, "a second run changes nothing");
  assert.deepEqual(byId(JSON.parse(filter(MAIN_LAYOUT, "tabs").stdout), "tabs").content, { mod: "tabs" }, `--arg tabs tabs leaves the tab bar`);
});

test("add-fizzy.jq on a layout of your own: the page goes after your pages, your own tab bar stays", () => {
  const own = JSON.parse(MAIN_LAYOUT);
  byId(own, "panel-body").children.push({ id: "notes", type: "block", content: { mod: "notes" } });
  byId(own, "tabs").content.mod = "desk-bar";
  const out = JSON.parse(filter(own).stdout);
  assert.deepEqual(byId(out, "panel-body").children.map(c => c.id), ["files", "changes", "notes", "fizzy"]);
  assert.equal(byId(out, "tabs").content.mod, "desk-bar");
});

test("add-fizzy.jq refuses a layout without a single panel-body stack, or with another node called fizzy, and prints nothing", () => {
  const two = JSON.parse(MAIN_LAYOUT);
  two.children.push({ id: "panel-body", type: "stack", children: [] });
  const clash = JSON.parse(MAIN_LAYOUT);
  clash.children.push({ id: "fizzy", type: "block" });
  for (const [layout, message] of [[{ id: "root", type: "row", children: [] }, /no single panel-body stack/], [two, /no single panel-body stack/], [clash, /another node already has the id fizzy/]]) {
    const r = filter(layout);
    assert.equal(r.status, 5, r.stderr);
    assert.equal(r.stdout, "");
    assert.match(r.stderr, message);
  }
});

test("layout/README.md's undo filter takes the page out again", () => {
  const readme = readFileSync(join(ROOT, "layout/README.md"), "utf8");
  const undo = /jq '(del\([^']+\))'/.exec(readme)?.[1];
  assert.ok(undo, "layout/README.md has a jq 'del(…)' line");
  const r = jq([undo], filter(MAIN_LAYOUT, "tabs").stdout);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), JSON.parse(MAIN_LAYOUT));
});

const OURS = JSON.parse(readFileSync(OUR_KEYS, "utf8"));
const WANTED = { global: { [KEY]: ACTION } };
const outcomes = result => result.notes.map(n => [n.key, n.outcome]);

test("tabs/keys.json suggests, in its global section, the Fizzy button and the search of fizzy-tabs under each system's keys, none of them Herdr's own", () => {
  const systems = Object.values(SYSTEMS);
  assert.deepEqual(OURS, { global: Object.fromEntries([...systems.map(({ key }) => [key, ACTION]), ...systems.map(({ search }) => [search, SEARCH_ACTION])]) });
  // Herdr 0.1.16's own shift-letter keys (defaults/keys.macos.json, defaults/keys.json).
  const herdrs = {
    Darwin: ["cmd-shift-d", "cmd-shift-l", "cmd-shift-p", "cmd-shift-w"],
    Linux: ["b", "c", "e", "f", "k", "l", "n", "o", "p", "t", "v", "w", "x", "z"].map(letter => `ctrl-shift-${letter}`),
  };
  for (const [system, { key, search }] of Object.entries(SYSTEMS)) {
    for (const ours of [key, search]) assert.ok(!herdrs[system].includes(ours), `${system}: ${ours} is not one of Herdr's own keys`);
  }
});

test("chord: one key however its modifiers are ordered or cased; '-' can be the key itself", () => {
  assert.equal(chord("shift-cmd-j"), chord("cmd-shift-j"));
  assert.equal(chord("Cmd-SHIFT-j"), chord("cmd-shift-j"));
  assert.notEqual(chord("cmd-j"), chord("cmd-shift-j"));
  assert.notEqual(chord("cmd--"), chord("cmd-="));
  assert.equal(chord("ctrl-a shift-alt-b"), chord("ctrl-a alt-shift-b"));
});

test("chord: one key under any name of its modifiers and in any case of its key; secondary is cmd on macOS and ctrl elsewhere", () => {
  for (const alias of ["super-shift-j", "win-shift-j", "command-shift-j", "meta-shift-j", "cmd-shift-J", "Super-Shift-J"]) assert.equal(chord(alias), chord("cmd-shift-j"), alias);
  assert.equal(chord("control-shift-j"), chord("ctrl-shift-j"));
  for (const alias of ["option-j", "opt-j"]) assert.equal(chord(alias), chord("alt-j"), alias);
  assert.equal(chord("secondary-shift-j", "darwin"), chord("cmd-shift-j"));
  assert.equal(chord("secondary-shift-j", "linux"), chord("ctrl-shift-j"));
  assert.notEqual(chord("ctrl-shift-j"), chord("cmd-shift-j"));
});

test("addKeys adds a free key at the end of its section and leaves every other byte; a second time it is the same text", () => {
  const added = addKeys(KEYS, WANTED);
  assert.equal(added.text, withKey(KEY, null));
  assert.deepEqual(outcomes(added), [[KEY, "added"]]);
  assert.equal(added.bound, true);
  const again = addKeys(added.text, WANTED);
  assert.equal(again.text, added.text);
  assert.deepEqual(outcomes(again), [[KEY, "same"]]);
});

test("addKeys never replaces: a key bound in any section, however spelled, is kept and reported", () => {
  for (const theirs of [`{ "global": { "shift-cmd-j": "x.y" } }`, `{ "global": { "super-shift-J": "x.y" } }`, `{ "global": {}, "mod:notes": { "${KEY}": "notes.find" } }`,
    `{ "global": { "${KEY}": "${ACTION}" }, "terminal": { "${KEY}": "send:j" } }`]) {
    const kept = addKeys(theirs, WANTED);
    assert.equal(kept.text, theirs, theirs);
    assert.deepEqual(outcomes(kept), [[KEY, "kept"]], theirs);
    assert.equal(kept.bound, false);
  }
});

test("addKeys fills an empty section or file, adds a missing section, and keeps a one-line file on one line", () => {
  assert.equal(addKeys(`{\n  "global": {}\n}\n`, WANTED).text, `{\n  "global": {\n    "${KEY}": "${ACTION}"\n  }\n}\n`);
  assert.equal(addKeys("{}\n", WANTED).text, `{\n  "global": {\n    "${KEY}": "${ACTION}"\n  }\n}\n`);
  assert.equal(addKeys(`{\n  "terminal": {\n    "cmd-c": "terminal.copy"\n  }\n}\n`, WANTED).text,
    `{\n  "terminal": {\n    "cmd-c": "terminal.copy"\n  },\n  "global": {\n    "${KEY}": "${ACTION}"\n  }\n}\n`);
  assert.equal(addKeys(`{ "global": { "cmd-q": "app.quit" } }`, WANTED).text, `{ "global": { "cmd-q": "app.quit", "${KEY}": "${ACTION}" } }`);
});

test("removeKeys undoes addKeys byte for byte, wherever the key sat, and takes out only a key of its own section that still has our action", () => {
  for (const theirs of [KEYS, `{\n  "global": {}\n}\n`, `{ "global": { "cmd-q": "app.quit" } }`, '{\r\n\t"global": {\r\n\t\t"f2": "tab.rename"\r\n\t}\r\n}']) {
    assert.equal(removeKeys(addKeys(theirs, WANTED).text, WANTED).text, theirs, JSON.stringify(theirs));
  }
  assert.equal(removeKeys(addKeys("{}\n", WANTED).text, WANTED).text, `{\n  "global": {}\n}\n`, "a section it made stays, empty");
  const first = `{ "global": { "${KEY}": "${ACTION}", "cmd-q": "app.quit" } }`;
  assert.equal(removeKeys(first, WANTED).text, `{ "global": { "cmd-q": "app.quit" } }`);
  const theirs = `{ "global": { "${KEY}": "my.thing" } }`;
  assert.equal(removeKeys(theirs, WANTED).text, theirs);
  assert.deepEqual(outcomes(removeKeys(theirs, WANTED)), [[KEY, "theirs"]]);
  assert.deepEqual(outcomes(removeKeys(KEYS, WANTED)), [[KEY, "absent"]]);
  const otherSection = `{ "global": {}, "terminal": { "${KEY}": "${ACTION}" } }`;
  assert.equal(removeKeys(otherSection, WANTED).text, otherSection, "a key in another section stays");
  assert.deepEqual(outcomes(removeKeys(otherSection, WANTED)), [[KEY, "elsewhere"]]);
});

test("a file that is not JSON, not an object, or whose section is not an object is refused with the reason", () => {
  assert.throws(() => addKeys(`{ "global": { "cmd-q": "app.quit", } }`, WANTED), /not valid JSON/);
  assert.throws(() => addKeys("[]", WANTED), /not an object/);
  assert.throws(() => addKeys(`{ "global": ["cmd-q"] }`, WANTED), /"global" is not an object/);
  assert.throws(() => removeKeys("nope", WANTED), /not valid JSON/);
});

test("describe says what happened to the key", () => {
  const note = { section: "global", key: KEY, as: KEY, action: ACTION };
  assert.equal(describe({ ...note, outcome: "added" }), `keys: added ${KEY}: ${ACTION}`);
  assert.equal(describe({ ...note, outcome: "added" }, { dryRun: true }), `keys: would add ${KEY}: ${ACTION}`);
  assert.equal(describe({ ...note, outcome: "same" }), `keys: ${KEY} is already ${ACTION}`);
  assert.equal(describe({ ...note, section: "terminal", outcome: "kept", was: "send:j" }), `keys: kept your ${KEY} in "terminal": send:j; to use ${ACTION}, bind another key to it in keys.json`);
  assert.equal(describe({ ...note, outcome: "removed" }), `keys: removed ${KEY}: ${ACTION}`);
  assert.equal(describe({ ...note, outcome: "theirs", was: "x" }), `keys: ${KEY} is x, not ${ACTION}: left as it is`);
  assert.equal(describe({ ...note, outcome: "absent" }), `keys: ${KEY} is not bound: nothing to remove`);
  assert.equal(describe({ ...note, outcome: "elsewhere" }), `keys: ${KEY} is not in "global": nothing to remove`);
});

test("merge-keys.mjs exits 0 when the keys are ours afterwards, 2 when one is kept or the file refused, 1 when called wrongly; --only may be given again; --dry-run writes nothing", () => {
  const dir = join(tmp, "merge-script"), theirs = join(dir, "keys.json"), backup = join(dir, "backup");
  mkdirSync(dir);
  const merge = (text, ...args) => {
    writeFileSync(theirs, text);
    return spawnSync(process.execPath, [MERGE, ...args.map(a => a === "THEIRS" ? theirs : a === "BACKUP" ? backup : a === "OURS" ? OUR_KEYS : a)], { encoding: "utf8" });
  };
  assert.equal(merge(KEYS, "add", "OURS", "THEIRS", "BACKUP", "--only", KEY).status, 0);
  assert.equal(readFileSync(theirs, "utf8"), withKey(KEY, null), "one --only: that key alone");
  assert.equal(merge(KEYS, "add", "OURS", "THEIRS", "BACKUP", "--only", KEY, "--only", SEARCH_KEY).status, 0);
  assert.equal(readFileSync(theirs, "utf8"), WITH_KEY, "two: both");
  assert.equal(readFileSync(join(backup, "keys.json"), "utf8"), KEYS);
  assert.equal(merge(WITH_KEY, "remove", "OURS", "THEIRS", "BACKUP", "--only", KEY, "--only", SEARCH_KEY).status, 0);
  assert.equal(readFileSync(theirs, "utf8"), KEYS);
  assert.equal(merge(KEYS, "add", "OURS", "THEIRS", "BACKUP", "--only", KEY, "--only").status, 1, "an --only with no key");
  rmSync(backup, { recursive: true });
  const dry = merge(KEYS, "add", "OURS", "THEIRS", "BACKUP", "--only", KEY, "--dry-run");
  assert.equal(dry.status, 0);
  assert.equal(dry.stdout, `keys: would add ${KEY}: ${ACTION}\n`);
  assert.equal(readFileSync(theirs, "utf8"), KEYS);
  assert.equal(existsSync(backup), false, "no backup folder either");
  assert.equal(merge(KEYS.replace(`"tab.new"`, `"tab.new", "${KEY}": "x"`), "add", "OURS", "THEIRS", "BACKUP", "--only", KEY).status, 2);
  assert.equal(merge("{ nope", "add", "OURS", "THEIRS", "BACKUP").status, 2);
  assert.equal(merge(KEYS, "add", "OURS", "THEIRS", "BACKUP", "--only", "f13").status, 1);
  assert.equal(merge(KEYS, "replace", "OURS", "THEIRS", "BACKUP").status, 1);
  const both = merge(KEYS, "add", "OURS", "THEIRS", "BACKUP");
  assert.equal(both.status, 0, "without --only every key of ours");
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(theirs, "utf8")).global), ["ctrl-shift-t", "ctrl-shift-l", ...Object.keys(OURS.global)]);
});

test("install.sh changed nothing in this repo", () => {
  assert.equal(repoHash(), REPO_BEFORE);
});
