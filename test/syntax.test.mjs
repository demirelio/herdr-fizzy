import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ROOT, MOD_DIR, modFile } from "./helpers.mjs";
import { calls, reset } from "./mocks/herdr.mjs";

function sources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === "node_modules") continue;
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.m?js$/.test(name)) out.push(path);
  }
  return out;
}
const mod = sources(MOD_DIR), tests = sources(join(ROOT, "test")), scripts = sources(join(ROOT, "scripts"));
const code = name => readFileSync(join(MOD_DIR, name), "utf8");
const INSTALL = join(ROOT, "install.sh");
const BASH = existsSync("/bin/bash") ? "/bin/bash" : "bash";
const shellcheck = spawnSync("sh", ["-c", "command -v shellcheck"], { encoding: "utf8" }).stdout.trim();

test("there are sources to check", () => {
  assert.ok(mod.length >= 2 && tests.length > 0 && scripts.length > 0);
});

for (const file of [...mod, ...tests, ...scripts]) {
  test(`node --check ${file.slice(ROOT.length)}`, () => {
    const r = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  });
}

test("bash -n install.sh, by /bin/bash where there is one", () => {
  const r = spawnSync(BASH, ["-n", INSTALL], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});

test("shellcheck install.sh", { skip: shellcheck ? false : "shellcheck is not installed" }, () => {
  const r = spawnSync(shellcheck, ["--shell=bash", INSTALL], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("install.sh is executable", () => {
  assert.ok(statSync(INSTALL).mode & 0o111);
});

// The mod guide's rules that a test can see in the source.
for (const file of ["main.js", "lib.js"]) {
  test(`fizzy/${file} follows the guide: no timers but cx.timer, no top-level await, no kept cx, no folder watching`, () => {
    const source = code(file).replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(source, /\bsetTimeout\b|\bsetInterval\b/, "use cx.timer");
    assert.doesNotMatch(source, /^await\b/m, "no top-level await");
    assert.doesNotMatch(source, /\bwatchFolder\b/, "a whole home folder is never watched");
    assert.doesNotMatch(source, /this\.\w*cx\b|\bglobalThis\./, "a cx is never kept, nothing hangs on globalThis");
  });
}

// Ctrl, Shift and Alt are on both platforms' keyboards; these are not.
const ONE_PLATFORM_KEY = /[⌘⌥⌃]|\b(?:Cmd|Command|Option|Opt|Win|Windows|Super)\b/;
const withoutComments = source => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");

test("outside comments the mod names no key that only one platform has (⌘ ⌥ ⌃, Cmd, Command, Option, Win, Super)", () => {
  for (const sample of ["Press ⌘V", "⌥-click", "Cmd-K", "Option-click", "Win+V"]) assert.match(sample, ONE_PLATFORM_KEY, sample);
  for (const sample of ["Ctrl-V", "Shift", "cmd.close(n)", "super(message)", "options", "Window"]) assert.doesNotMatch(sample, ONE_PLATFORM_KEY, sample);
  for (const file of ["main.js", "lib.js"]) {
    const hit = withoutComments(code(file)).match(ONE_PLATFORM_KEY);
    assert.equal(hit, null, `${file} names ${hit?.[0]}`);
  }
});

test("fizzy/lib.js imports nothing, so node can load it as it is", () => {
  assert.doesNotMatch(code("lib.js"), /^\s*import\b/m);
});

test("fizzy/main.js's top-level lines are only comments, imports, const declarations, functions and the exported class", () => {
  const odd = code("main.js").split("\n").filter(l => /^\S/.test(l) && !/^(\/\/|\}|import |export default class |const |async function |function )/.test(l));
  assert.deepEqual(odd, []);
});

test("loading fizzy/main.js asks Herdr for nothing, writes no storage and adds no globals", async () => {
  reset();
  const stored = [];
  for (const method of ["setItem", "removeItem", "clear"]) {
    const original = localStorage[method];
    localStorage[method] = (...args) => { stored.push(method); return original(...args); };
  }
  const globals = new Set(Object.keys(globalThis));
  await import(`${modFile("main.js")}?load-check`);
  assert.deepEqual(Object.entries(calls).filter(([, list]) => list.length).map(([name]) => name), [], "Herdr was asked");
  assert.deepEqual(stored, [], "storage was written");
  assert.deepEqual(Object.keys(globalThis).filter(key => !globals.has(key)), [], "globals were added");
});
