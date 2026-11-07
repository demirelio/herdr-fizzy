// Fizzy profile photos, the parts that need no panel: the fetch script (run for real, with a `curl` shim first on PATH so
// nothing touches the network), the file names, which users a CLI answer holds photos for, and a board's reference.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { modFile } from "./helpers.mjs";

const {
  AVATAR_SCRIPT, AVATAR_DIR, AVATAR_TTL, AVATAR_BACKOFF, AVATAR_PARALLEL, AVATAR_EVERY, avatarBase, isAvatarFile, photosIn,
  boardRef, ref, refs, tabName, menuRows,
} = await import(modFile("lib.js"));

// A curl that never touches the network: it logs its arguments, writes FAKE_CURL_BODY to the file after -o and prints
// FAKE_CURL_TYPE (what -w '%{content_type}' prints). FAKE_CURL_FAIL: the exit code it gives instead (after printing the type).
const SHIM = `#!/bin/sh
{ for a in "$@"; do printf '%s\\n' "$a"; done; echo --; } >> "$FAKE_CURL_LOG"
out=
while [ $# -gt 0 ]; do
  [ "$1" = -o ] && out=$2
  shift
done
if [ -n "$FAKE_CURL_FAIL" ]; then printf %s "$FAKE_CURL_TYPE"; exit "$FAKE_CURL_FAIL"; fi
[ -n "$out" ] && printf %s "$FAKE_CURL_BODY" > "$out"
printf %s "$FAKE_CURL_TYPE"
`;

// A scratch folder with the shim in bin/ and a target folder (two levels down, with a space in its path, not made yet).
async function sandbox() {
  const dir = await mkdtemp(join(tmpdir(), "fizzy-avatar-test-"));
  const bin = join(dir, "bin"), log = join(dir, "curl.log"), folder = join(dir, "with space", "avatars");
  await mkdir(bin);
  await writeFile(join(bin, "curl"), SHIM, { mode: 0o755 });
  return {
    dir, folder, log,
    run(url, base, env = {}, into = folder) {
      return spawnSync("sh", ["-c", AVATAR_SCRIPT, "fizzy", url, into, base], {
        cwd: dir, encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_CURL_LOG: log, ...env },
      });
    },
    files: () => (existsSync(folder) ? readdirSync(folder).sort() : null),
    // Every call curl got, as its list of arguments.
    curl: () => (existsSync(log) ? readFileSync(log, "utf8").split("\n--\n").filter(Boolean).map(call => call.replace(/\n--$/, "").split("\n")) : []),
    clean: () => rm(dir, { recursive: true, force: true }),
  };
}
const URL_A = "https://app.fizzy.do/111/users/0000000000000000000000001/avatar";

test("AVATAR_SCRIPT: the content type picks the extension (png, jpg for jpeg, webp, svg, gif), the file name is printed, nothing else is left behind", async () => {
  const s = await sandbox();
  try {
    const cases = [["image/png", "png"], ["image/jpeg", "jpg"], ["image/webp", "webp"], ["image/svg+xml", "svg"], ["image/gif", "gif"],
      ["image/svg+xml; charset=utf-8", "svg"], ["IMAGE/PNG", "png"], ["image/jpg", "jpg"]];
    for (const [i, [type, ext]] of cases.entries()) {
      const base = `user${i}-20250115`;
      const r = s.run(URL_A, base, { FAKE_CURL_TYPE: type, FAKE_CURL_BODY: `body of ${type}` });
      assert.equal(r.status, 0, `${type}: ${r.stderr}`);
      assert.equal(r.stdout, `${base}.${ext}\n`, `${type} -> ${ext}`);
      assert.equal(readFileSync(join(s.folder, `${base}.${ext}`), "utf8"), `body of ${type}`);
    }
    assert.equal(s.files().length, cases.length, "only the finished files: no .part is left");
    assert.ok(s.files().every(f => !f.startsWith(".")));
  } finally { await s.clean(); }
});

test("AVATAR_SCRIPT: it asks curl for a plain GET with redirects (never HEAD), a time limit and a size limit, writing to a .part file beside the target", async () => {
  const s = await sandbox();
  try {
    const r = s.run(URL_A, "abc-20250115", { FAKE_CURL_TYPE: "image/png", FAKE_CURL_BODY: "x" });
    assert.equal(r.status, 0, r.stderr);
    const [argv, ...more] = s.curl();
    assert.deepEqual(more, [], "one curl call");
    assert.ok(argv.includes("-sfL") && argv.includes("--max-time") && argv[argv.indexOf("--max-time") + 1] === "20");
    assert.ok(argv.includes("--max-filesize"));
    assert.ok(!argv.includes("-I") && !argv.includes("--head") && !argv.includes("-X"), "GET, never HEAD");
    assert.equal(argv[argv.indexOf("-o") + 1], `${s.folder}/.abc-20250115.part`, "it downloads into a part file in the target folder");
    assert.equal(argv.at(-1), URL_A);
    assert.ok(argv.includes("%{content_type}"));
  } finally { await s.clean(); }
});

test("AVATAR_SCRIPT: a page that is no image (html, json, octet-stream, no type), an empty body or a curl error fails with no file and no .part", async () => {
  const s = await sandbox();
  try {
    for (const type of ["text/html", "text/html; charset=utf-8", "application/json", "application/octet-stream", ""]) {
      const r = s.run(URL_A, "abc-20250115", { FAKE_CURL_TYPE: type, FAKE_CURL_BODY: "<html>login</html>" });
      assert.notEqual(r.status, 0, `${type || "(no type)"}: not an image`);
      assert.equal(r.stdout, "");
    }
    const empty = s.run(URL_A, "abc-20250115", { FAKE_CURL_TYPE: "image/png", FAKE_CURL_BODY: "" });
    assert.notEqual(empty.status, 0, "an empty image is none");
    const down = s.run(URL_A, "abc-20250115", { FAKE_CURL_TYPE: "text/html", FAKE_CURL_FAIL: "22" });
    assert.notEqual(down.status, 0, "curl -f's error (a 404, a 500)");
    const gone = s.run(URL_A, "abc-20250115", { FAKE_CURL_TYPE: "", FAKE_CURL_FAIL: "28" });
    assert.notEqual(gone.status, 0, "curl's timeout");
    assert.deepEqual(s.files(), [], "the folder is made, and nothing is in it");
  } finally { await s.clean(); }
});

test("AVATAR_SCRIPT: a failed fetch keeps the file the user already had", async () => {
  const s = await sandbox();
  try {
    assert.equal(s.run(URL_A, "abc-20250113", { FAKE_CURL_TYPE: "image/png", FAKE_CURL_BODY: "old" }).status, 0);
    const r = s.run(URL_A, "abc-20250115", { FAKE_CURL_TYPE: "text/html", FAKE_CURL_BODY: "nope" });
    assert.notEqual(r.status, 0);
    assert.deepEqual(s.files(), ["abc-20250113.png"]);
  } finally { await s.clean(); }
});

test("AVATAR_SCRIPT: a new base (another day, another format) deletes that user's older files, and no one else's", async () => {
  const s = await sandbox();
  try {
    const png = { FAKE_CURL_TYPE: "image/png", FAKE_CURL_BODY: "p" }, webp = { FAKE_CURL_TYPE: "image/webp", FAKE_CURL_BODY: "w" };
    assert.equal(s.run(URL_A, "abc-20250113", png).status, 0);
    assert.equal(s.run(URL_A, "abc-20250114", { FAKE_CURL_TYPE: "image/svg+xml", FAKE_CURL_BODY: "s" }).status, 0);
    assert.equal(s.run(URL_A, "abcd-20250113", png).status, 0, "another user whose id starts the same way");
    assert.equal(s.run(URL_A, "other-20250113", png).status, 0);
    // abc's own: the 01-14 svg replaced the 01-13 png.
    assert.deepEqual(s.files(), ["abc-20250114.svg", "abcd-20250113.png", "other-20250113.png"]);
    const r = s.run(URL_A, "abc-20250115", webp);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "abc-20250115.webp\n");
    assert.deepEqual(s.files(), ["abc-20250115.webp", "abcd-20250113.png", "other-20250113.png"], "abc's older files are gone; abcd's and the other user's stay");
    // The same base again in another format replaces that file.
    assert.equal(s.run(URL_A, "abc-20250115", png).status, 0);
    assert.deepEqual(s.files(), ["abc-20250115.png", "abcd-20250113.png", "other-20250113.png"]);
  } finally { await s.clean(); }
});

test("AVATAR_SCRIPT: only http(s) addresses and plain file names are taken; anything else fails before curl runs", async () => {
  const s = await sandbox();
  try {
    const ok = { FAKE_CURL_TYPE: "image/png", FAKE_CURL_BODY: "x" };
    for (const url of ["file:///etc/passwd", "-o/tmp/x", "ftp://example.com/a.png", "", "avatar"]) assert.notEqual(s.run(url, "abc-20250115", ok).status, 0, `url ${JSON.stringify(url)}`);
    for (const base of ["", "../abc-20250115", "a/b-20250115", "abc 20250115", "-x", "a;b-20250115", "ab$c-1"]) assert.notEqual(s.run(URL_A, base, ok).status, 0, `base ${JSON.stringify(base)}`);
    assert.deepEqual(s.curl(), [], "curl never ran");
    assert.equal(s.files(), null, "nothing was made either");
    assert.equal(s.run("http://localhost:3006/avatar", "abc-20250115", ok).status, 0, "http is fine (a local Fizzy)");
  } finally { await s.clean(); }
});

// Every folder and file under `dir` but those in `skip`, with each file's content.
function snapshot(dir, skip) {
  const out = {};
  const walk = at => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (skip.includes(path)) continue;
      if (entry.isDirectory()) { out[`${path}/`] = ""; walk(path); } else out[path] = readFileSync(path, "utf8");
    }
  };
  walk(dir);
  return out;
}

test("AVATAR_SCRIPT writes only in its own folder: fetches that work, fail or replace a file leave the home, temp, working and parent folders as they were", async () => {
  const s = await sandbox();
  try {
    const home = join(s.dir, "home"), temp = join(s.dir, "tmp"), parent = join(s.dir, "with space");
    for (const dir of [home, temp, parent]) {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "abc-20250101.png"), "someone else's file with the same user's name");
    }
    const before = snapshot(s.dir, [s.folder, s.log]);
    const env = { HOME: home, TMPDIR: temp, FAKE_CURL_BODY: "x" };
    const runs = [
      { base: "abc-20250114", type: "image/png" },
      { base: "abc-20250115", type: "image/webp" },
      { base: "abc-20250116", type: "text/html", fails: true },
      { base: "abc-20250116", type: "", curlExit: "22", fails: true },
    ];
    for (const { base, type, curlExit, fails = false } of runs) {
      const r = s.run(URL_A, base, { ...env, FAKE_CURL_TYPE: type, ...(curlExit && { FAKE_CURL_FAIL: curlExit }) });
      assert.equal(r.status !== 0, fails, `${base} ${type || "(no type)"}: ${r.stderr}`);
    }
    assert.deepEqual(s.files(), ["abc-20250115.webp"], "its own folder did change");
    assert.deepEqual(snapshot(s.dir, [s.folder, s.log]), before);
  } finally { await s.clean(); }
});

test("AVATAR_SCRIPT parses in sh (and dash where there is one) and is plain: no sudo, eval, chmod, cd or write to an absolute path, curl its only program besides the file tools, rm only on its part file or the user's own files", () => {
  for (const shell of ["sh", "dash"].filter(bin => spawnSync(bin, ["-c", "exit 0"]).status === 0)) {
    const r = spawnSync(shell, ["-n", "-c", AVATAR_SCRIPT], { encoding: "utf8" });
    assert.equal(r.status, 0, `${shell} -n: ${r.stderr}`);
  }
  assert.doesNotMatch(AVATAR_SCRIPT, /\bsudo\b|\beval\b|>\s*\/|\bchmod\b|\bcd\b/);
  const programs = new Set([...AVATAR_SCRIPT.matchAll(/(?:^|[;|&(]\s*|\$\(\s*|\|\|\s*|\{\s*)(curl|mkdir|mv|rm|tr|printf|echo)\b/gm)].map(m => m[1]));
  assert.deepEqual([...programs].sort(), ["curl", "echo", "mkdir", "mv", "printf", "rm", "tr"]);
  for (const m of AVATAR_SCRIPT.matchAll(/\brm -f ("[^"]*")/g)) assert.match(m[1], /^"\$(p|f)"$/, "rm only removes the part file or a file of the same user");
});

test("avatarBase: the user's id and the UTC day, with anything but letters, digits and _ in the id turned into _", () => {
  assert.equal(avatarBase("0000000000000000000000001", Date.UTC(2025, 0, 15, 23, 59)), "0000000000000000000000001-20250115");
  assert.equal(avatarBase("u-me", Date.UTC(2026, 0, 2)), "u_me-20260102");
  assert.equal(avatarBase("../x y", Date.UTC(2026, 0, 2)), "___x_y-20260102");
  assert.notEqual(avatarBase("a", Date.UTC(2026, 0, 2)), avatarBase("a", Date.UTC(2026, 0, 3)), "a new day is a new name");
  assert.match(avatarBase("a"), /^a-\d{8}$/);
});

test("isAvatarFile: only the names the script prints", () => {
  for (const ok of ["abc-20250115.png", "u_me-20250115.jpg", "A1-20250115.webp", "a-20250115.svg", "a-20250115.gif"]) assert.ok(isAvatarFile(ok), ok);
  for (const bad of ["", "abc.png", "abc-2025011.png", "abc-20250115.bmp", "../abc-20250115.png", "a/b-20250115.png", "abc-20250115.png.part", ".abc-20250115.png", "abc-20250115", null, undefined, 3]) assert.ok(!isAvatarFile(bad), String(bad));
});

test("photosIn: every user with a photo address in what the CLI answered, once each, wherever it sits (assignees, creators, authors, notifications)", () => {
  const user = (id, more = {}) => ({ id, name: id, avatar_url: `https://app.fizzy.do/1/users/${id}/avatar`, ...more });
  const data = [
    { number: 1, assignees: [user("a"), user("b")], creator: user("c"), board: { id: "b1", name: "Roadmap", creator: user("a") } },
    { number: 2, assignees: [user("b")], creator: user("d", { avatar_url: "javascript:alert(1)" }) },
    { id: "cm1", creator: user("e"), body: { html: "<p>x</p>" } },
    { id: "n1", creator: user("f"), card: { number: 3, assignees: [] } },
    { id: "g", name: "no photo" },
    { id: "h", name: "h", avatar_url: "" },
    { id: 7, avatar_url: "https://example.com/7.png" },
  ];
  assert.deepEqual(photosIn(data), [
    { id: "a", url: "https://app.fizzy.do/1/users/a/avatar" }, { id: "b", url: "https://app.fizzy.do/1/users/b/avatar" },
    { id: "c", url: "https://app.fizzy.do/1/users/c/avatar" }, { id: "e", url: "https://app.fizzy.do/1/users/e/avatar" },
    { id: "f", url: "https://app.fizzy.do/1/users/f/avatar" },
  ], "an address that is not http(s), no address, and an id that is no string are skipped");
  assert.deepEqual(photosIn(user("z")), [{ id: "z", url: "https://app.fizzy.do/1/users/z/avatar" }], "one user alone");
  assert.deepEqual(photosIn(null), []);
  assert.deepEqual(photosIn(undefined), []);
  assert.deepEqual(photosIn("text"), []);
  assert.deepEqual(photosIn([]), []);
});

test("the numbers: photos live under data/fizzy/avatars, are kept a week, retried after an hour, fetched four at a time, and the people are read daily", () => {
  assert.equal(AVATAR_DIR, "data/fizzy/avatars");
  assert.equal(AVATAR_TTL, 7 * 24 * 3600 * 1000);
  assert.equal(AVATAR_BACKOFF, 3600 * 1000);
  assert.equal(AVATAR_PARALLEL, 4);
  assert.equal(AVATAR_EVERY, 24 * 3600 * 1000);
});

test("boardRef: one line, Fizzy board \"<name>\" (<url>), whitespace and newlines in the name collapsed; without a link, no brackets", () => {
  const url = "https://app.fizzy.do/111/boards/00000000000000000000000b1";
  assert.equal(boardRef({ id: "b", name: "Roadmap", url }), `Fizzy board "Roadmap" (${url})`);
  assert.equal(boardRef({ name: "Two\nlines\t and   gaps ", url }), `Fizzy board "Two lines and gaps" (${url})`);
  assert.equal(boardRef({ name: "No link" }), 'Fizzy board "No link"');
  assert.ok(!boardRef({ name: "a\r\nb", url }).includes("\n"));
});

test("ref, refs and tabName take a board subject ({ kind: \"board\" }) as well as cards: same lines, and the tab is named after the board, 32 characters at most", () => {
  const url = "https://app.fizzy.do/1/boards/b1", board = { kind: "board", id: "b1", name: "Roadmap", url };
  const card = { number: 7, title: "Fix it", url: "https://app.fizzy.do/1/cards/7" };
  assert.equal(ref(board), boardRef(board));
  assert.equal(ref(card), 'Fizzy #7 "Fix it" (https://app.fizzy.do/1/cards/7)', "a card keeps its own line");
  assert.equal(refs([board]), `Fizzy board "Roadmap" (${url})`);
  assert.equal(refs([card, card]), `${ref(card)}\n${ref(card)}`);
  assert.equal(tabName(board), "Roadmap");
  assert.equal(tabName({ ...board, name: "Two\nlines" }), "Two lines");
  assert.equal(tabName({ ...board, name: "x".repeat(32) }), "x".repeat(32), "32 fit");
  const cut = tabName({ ...board, name: "A very long board name that goes past thirty-two characters" });
  assert.equal([...cut].length, 32);
  assert.ok(cut.endsWith("…"));
  assert.equal(cut, "A very long board name that goe…");
  assert.equal(tabName({ number: 4242, title: "Fix login" }), "#4242 Fix login", "a card's tab keeps its number");
});

test("the agents and start rows carry a board's reference and name like a card's: pasted or started, never submitted", () => {
  const board = { kind: "board", id: "b1", name: "Roadmap", url: "https://app.fizzy.do/1/boards/b1" };
  const claude = { address: "t1", pane: "p1", space: "s1", tab: "tab1", tab_name: "fix", program: { name: "Claude Code" }, status: "idle" };
  const [row] = menuRows({ kind: "agents", cards: [board] }, { agents: [claude] });
  assert.deepEqual(row.act, { paste: { address: "t1", text: 'Fizzy board "Roadmap" (https://app.fizzy.do/1/boards/b1)' } });
  const [start] = menuRows({ kind: "start", cards: [board] }, { known: [{ name: "Codex", run: ["codex"], installed: true, icon: "i.svg" }] });
  assert.deepEqual(start.act, { start: { name: "Roadmap", argv: ["codex"], text: 'Fizzy board "Roadmap" (https://app.fizzy.do/1/boards/b1)', agent: "Codex" } });
});

test("the people rows say who they are ({ id, name }) so the popup can draw their photo", () => {
  const card = { number: 1, title: "t", url: "u", assignees: [{ id: "u2", name: "Bob" }] };
  const rows = menuRows({ kind: "users", card }, { users: [{ id: "me", name: "Ada" }, { id: "u2", name: "Bob" }], me: "me" });
  assert.deepEqual(rows.map(r => r.user), [{ id: "me", name: "Ada" }, { id: "u2", name: "Bob" }]);
  assert.deepEqual(rows.map(r => r.checked), [false, true]);
});
