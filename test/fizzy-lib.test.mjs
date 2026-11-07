import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { MOD_DIR, modFile } from "./helpers.mjs";
import { state } from "./mocks/herdr.mjs";
import { makeAccount } from "./fizzy-fixtures.mjs";
import { SAMPLE_BOARDS, isTeamBoard } from "./sample-boards.mjs";
import {
  BOARD_LIST, SHOW_BARE, SHOW_CLOSED, OPEN, DONE_PAGE, DONE_LAST, DONE_PAST, TRAY, CONFIG, CONFIG_SHOWN, WRITE, NOT_FOUND, USAGE, NO_TOKEN,
} from "./fizzy-samples.mjs";

const {
  ICON, POLL_VIEW, POLL_INBOX, CONCURRENCY, ROW, LABEL, SEP, PAD, FRAME, CARD_PAGE, AGENTS, START_WAIT, READY_WAIT,
  FizzyError, parseResult, execFailure, explain, explainSearch, SEARCH_CAP, cmd, withJson, JQ, laneOf, laneName, columnOf, fullCard, noteCard, moveTo, lanes, sections, filterCards, colorOf, meFrom,
  ref, refs, tabName, textToHtml, htmlToText, htmlForView, textLines, formatted, initials, hue, ago,
  YAML_SCRIPT, parseYaml, chooseBoard, targetAgent, agentLabel, agentHint, findNode, fizzyVisible, menuRows, menuHeight,
  TOASTS, SEEN_CAP, PENDING_FOR, TOAST_FOR, unreadNotes, oldestFirst, noteToast, noteAction, noteReady,
  defaultGroups, groupsConfig, choiceOf, groupOf, ruleGroupOf, ownHidden, boardGroups, addGroup, renameGroup, setMatch, setGroupHidden, removeGroup, moveBoard, placeBoard, moveGroup, setBoardHidden,
} = await import(modFile("lib.js"));

// Builders in the shapes the fizzy CLI prints.
const card = (number, extra = {}) => ({
  number, title: `Card ${number}`, closed: false, postponed: false, golden: false, column: null, tags: [], assignees: [],
  board: { id: "b1", name: "Roadmap" }, url: `https://app.fizzy.do/111/cards/${number}`, ...extra,
});
const col = (id, name, color) => ({ id, name, color: { name: color, value: "var(--color-card-5)" } });
const NOT_NOW = { id: "not-now", kind: "not_now", pseudo: true, name: "Not Now" };
const MAYBE = { id: "maybe", kind: "triage", pseudo: true, name: "Maybe?" };
const DONE = { id: "done", kind: "closed", pseudo: true, name: "Done" };
const C1 = col("c1", "In progress", "Aqua"), C2 = col("c2", "Review", "Blue");
const COLUMNS = [NOT_NOW, MAYBE, C1, C2, DONE];
const user = (id, name, extra = {}) => ({ id, name, role: "member", active: true, ...extra });
const agent = (address, extra = {}) => ({
  address, pane: `pane-${address}`, space: "s1", space_name: "work", tab: "t1", tab_index: 0, tab_name: "fix login", status: "working",
  app: "claude-code", program: { key: "claude", name: "Claude Code", icon: "icons/claude.svg", tint: false }, seq: 1, ...extra,
});

test("cmd builders produce the exact argv; numbers become strings", () => {
  assert.deepEqual(cmd.boards(), ["board", "list", "--all"]);
  assert.deepEqual(cmd.columns("b1"), ["column", "list", "--board", "b1"]);
  assert.deepEqual(cmd.open("b1"), ["card", "list", "--board", "b1", "--all", "--jq", JQ.cards]);
  assert.deepEqual(cmd.notNow("b1"), ["card", "list", "--board", "b1", "--indexed-by", "not_now", "--all", "--jq", JQ.cards]);
  assert.deepEqual(cmd.done("b1"), ["card", "list", "--board", "b1", "--indexed-by", "closed", "--page", "1", "--jq", JQ.page]);
  assert.deepEqual(cmd.done("b1", 3), ["card", "list", "--board", "b1", "--indexed-by", "closed", "--page", "3", "--jq", JQ.page]);
  assert.deepEqual(cmd.mine("b1", "u1"), ["card", "list", "--board", "b1", "--assignee", "u1", "--all", "--jq", JQ.cards]);
  assert.deepEqual(cmd.mineAll("u1"), ["card", "list", "--assignee", "u1", "--all", "--jq", JQ.cards], "no --board: every board");
  assert.deepEqual(cmd.search("login bug"), ["search", "--jq", JQ.cards, "--", "login bug"]);
  assert.deepEqual(cmd.card(4242), ["card", "show", "4242"]);
  assert.deepEqual(cmd.comments(4242), ["comment", "list", "--card", "4242", "--all"]);
  assert.deepEqual(cmd.users(), ["user", "list", "--all"]);
  assert.deepEqual(cmd.tags(), ["tag", "list", "--all"]);
  assert.deepEqual(cmd.pins(), ["pin", "list", "--jq", JQ.cards]);
  assert.deepEqual(cmd.inbox(), ["notification", "tray", "--jq", JQ.notes], "the unread tray: never --include-read");
  assert.deepEqual(cmd.me(), ["identity", "show"]);
  assert.deepEqual(cmd.config(), ["config", "show", "--jq", JQ.config], "the CLI's own account and board, nothing else of its settings");
  assert.deepEqual(cmd.create("b1", "Fix it"), ["card", "create", "--board", "b1", "--title", "Fix it"]);
  assert.deepEqual(cmd.create("b1", "Fix it", ""), ["card", "create", "--board", "b1", "--title", "Fix it"]);
  assert.deepEqual(cmd.create("b1", "Fix it", "<p>why</p>"), ["card", "create", "--board", "b1", "--title", "Fix it", "--description", "<p>why</p>"]);
  assert.deepEqual(cmd.update(7, { title: "New" }), ["card", "update", "7", "--title", "New"]);
  assert.deepEqual(cmd.update(7, { html: "<p>x</p>" }), ["card", "update", "7", "--description", "<p>x</p>"]);
  assert.deepEqual(cmd.update(7, { title: "New", html: "<p>x</p>" }), ["card", "update", "7", "--title", "New", "--description", "<p>x</p>"]);
  // An emptied description is a real change (html ""), only an absent one is skipped.
  assert.deepEqual(cmd.update(7, { html: "" }), ["card", "update", "7", "--description", ""]);
  assert.deepEqual(cmd.update(7), ["card", "update", "7"]);
  assert.deepEqual(cmd.column(7, "c1"), ["card", "column", "7", "--column", "c1"]);
  assert.deepEqual(cmd.postpone(7), ["card", "postpone", "7"]);
  assert.deepEqual(cmd.untriage(7), ["card", "untriage", "7"]);
  assert.deepEqual(cmd.close(7), ["card", "close", "7"]);
  assert.deepEqual(cmd.reopen(7), ["card", "reopen", "7"]);
  assert.deepEqual(cmd.golden(7, true), ["card", "golden", "7"]);
  assert.deepEqual(cmd.golden(7, false), ["card", "ungolden", "7"]);
  assert.deepEqual(cmd.pin(7, true), ["card", "pin", "7"]);
  assert.deepEqual(cmd.pin(7, false), ["card", "unpin", "7"]);
  assert.deepEqual(cmd.watch(7, true), ["card", "watch", "7"]);
  assert.deepEqual(cmd.watch(7, false), ["card", "unwatch", "7"]);
  assert.deepEqual(cmd.selfAssign(7), ["card", "self-assign", "7"]);
  assert.deepEqual(cmd.assign(7, "u1"), ["card", "assign", "7", "--user", "u1"]);
  assert.deepEqual(cmd.tag(7, "bug"), ["card", "tag", "7", "--tag", "bug"]);
  assert.deepEqual(cmd.moveBoard(7, "b2"), ["card", "move", "7", "--to", "b2"]);
  assert.deepEqual(cmd.remove(7), ["card", "delete", "7"]);
  assert.deepEqual(cmd.addStep(7, "Write it"), ["step", "create", "--card", "7", "--content", "Write it"]);
  assert.deepEqual(cmd.step(7, "s1", true), ["step", "update", "s1", "--card", "7", "--completed"]);
  assert.deepEqual(cmd.step(7, "s1", false), ["step", "update", "s1", "--card", "7", "--not_completed"]);
  assert.deepEqual(cmd.editStep(7, "s1", "Rewrite"), ["step", "update", "s1", "--card", "7", "--content", "Rewrite"]);
  assert.deepEqual(cmd.dropStep(7, "s1"), ["step", "delete", "s1", "--card", "7"]);
  assert.deepEqual(cmd.comment(7, "<p>hi</p>"), ["comment", "create", "--card", "7", "--body", "<p>hi</p>"]);
  assert.deepEqual(cmd.editComment(7, "c9", "<p>hi</p>"), ["comment", "update", "c9", "--card", "7", "--body", "<p>hi</p>"]);
  assert.deepEqual(cmd.dropComment(7, "c9"), ["comment", "delete", "c9", "--card", "7"]);
  assert.deepEqual(cmd.read("n1"), ["notification", "read", "n1"]);
  assert.deepEqual(cmd.readAll(), ["notification", "read-all"]);
});

test("every argv a builder makes is all strings, and the fake fizzy CLI the panel's tests run on answers each one", async () => {
  const argvs = [
    cmd.boards(), cmd.columns("b1"), cmd.open("b1"), cmd.notNow("b1"), cmd.done("b1", 2), cmd.mine("b1", "u-me"), cmd.mineAll("u-me"), cmd.search("login"), cmd.card(101),
    cmd.comments(101), cmd.users(), cmd.tags(), cmd.pins(), cmd.inbox(), cmd.me(), cmd.config(), cmd.create("b1", "t", "<p>d</p>"),
    cmd.update(101, { title: "t", html: "<p>d</p>" }), cmd.column(101, "c1"), cmd.postpone(101), cmd.untriage(101), cmd.close(101), cmd.reopen(101),
    cmd.golden(101, true), cmd.golden(101, false), cmd.pin(101, true), cmd.pin(101, false), cmd.watch(101, true), cmd.watch(101, false),
    cmd.selfAssign(101), cmd.assign(101, "u-bob"), cmd.tag(101, "bug"), cmd.moveBoard(101, "b2"), cmd.remove(101), cmd.addStep(101, "s"),
    cmd.step(101, "s1", true), cmd.step(101, "s1", false), cmd.editStep(101, "s1", "t"), cmd.dropStep(101, "s1"), cmd.comment(101, "<p>c</p>"),
    cmd.editComment(101, "cm1", "<p>c</p>"), cmd.dropComment(101, "cm1"), cmd.read("n1"), cmd.readAll(),
  ];
  assert.equal(argvs.length, Object.keys(cmd).length + 4, "every builder, and both sides of golden, pin, watch and step, is covered");
  for (const argv of argvs) {
    assert.ok(argv.every(a => typeof a === "string"), `${argv.join(" ")}: all strings`);
    const answer = await makeAccount().exec("fizzy", withJson(argv), { cwd: state.home });
    assert.doesNotThrow(() => parseResult(answer), argv.join(" "));
  }
});

test("withJson: what runs is a builder's argv with --json last, reads and writes alike", () => {
  assert.deepEqual(withJson(cmd.card(4242)), ["card", "show", "4242", "--json"]);
  assert.deepEqual(withJson(cmd.addStep(7, "--json")), ["step", "create", "--card", "7", "--content", "--json", "--json"], "a step typed as --json stays");
  assert.deepEqual(withJson(cmd.close(7)), ["card", "close", "7", "--json"]);
  const argv = cmd.close(7);
  withJson(argv);
  assert.deepEqual(argv, ["card", "close", "7"], "the builder's own list is left as it was");
});

test("withJson puts --json before the `--` a search's query follows, so the query stays the last word", () => {
  assert.deepEqual(withJson(cmd.search("login")), ["search", "--jq", JQ.cards, "--json", "--", "login"]);
  assert.deepEqual(withJson(cmd.search("--json")), ["search", "--jq", JQ.cards, "--json", "--", "--json"], "a query that looks like a flag is still only the query");
  assert.deepEqual(withJson(cmd.search("--")), ["search", "--jq", JQ.cards, "--json", "--", "--"]);
});

test("a `--` that is a flag's value is not a separator: a title or a step typed as -- keeps --json last", () => {
  assert.deepEqual(withJson(cmd.create("b1", "--")), ["card", "create", "--board", "b1", "--title", "--", "--json"]);
  assert.deepEqual(withJson(cmd.addStep(7, "--")), ["step", "create", "--card", "7", "--content", "--", "--json"]);
});

test("search: the query loses its surrounding white space and one leading #, and is the one word after `--`", () => {
  const sent = q => cmd.search(q).slice(4);
  assert.deepEqual(sent("#12"), ["12"], "a card number is searched as the number");
  assert.deepEqual(sent("  #12  "), ["12"]);
  assert.deepEqual(sent("# 12"), ["12"]);
  assert.deepEqual(sent("##12"), ["#12"], "only one #");
  assert.deepEqual(sent("  login bug \n"), ["login bug"]);
  assert.deepEqual(sent("-x --all"), ["-x --all"], "after --, a leading dash is part of the query");
  assert.deepEqual(sent("a#b & c+d % ü"), ["a#b & c+d % ü"], "the CLI encodes it: nothing is escaped here");
  assert.deepEqual(cmd.search("x").slice(0, 4), ["search", "--jq", JQ.cards, "--"]);
});

test("constants", () => {
  assert.equal(ICON("star"), "mods/fizzy/star.svg");
  assert.deepEqual([POLL_VIEW, POLL_INBOX, CONCURRENCY], [30000, 30000, 6]);
  assert.deepEqual([ROW, LABEL, SEP, PAD, FRAME, CARD_PAGE, AGENTS], [31, 28, 9, 10, 2, 50, 6]);
});

const fails = (fn, code, message) => assert.throws(fn, e => e instanceof FizzyError && e instanceof Error && e.code === code && (message === undefined || e.message === message), `FizzyError ${code}`);

test("parseResult returns the envelope's data", () => {
  assert.deepEqual(parseResult(BOARD_LIST).map(b => b.name), ["Roadmap"]);
  assert.deepEqual(parseResult(WRITE), {});
  assert.deepEqual(parseResult(CONFIG), { account: "111", board: "b1" });
  assert.deepEqual(parseResult({ code: 0, stdout: '{"data":[{"number":1}],"ok":true}', stderr: "" }), [{ number: 1 }], "one line, its keys in any order");
  assert.deepEqual(parseResult({ code: 0, stdout: '  {"ok":true,"data":{"id":"x"}}\n', stderr: "" }), { id: "x" });
  // A write that answers without data.
  assert.equal(parseResult({ code: 0, stdout: '{"ok":true}', stderr: "" }), null);
  assert.equal(parseResult({ code: 0, stdout: '{"ok":true,"data":null}', stderr: "" }), null);
  // A warning ahead of the JSON does not hide it.
  assert.deepEqual(parseResult({ code: 0, stdout: 'warning: x\n{"ok":true,"data":[1]}', stderr: "" }), [1]);
});

test("parseResult reads the failure envelope, whatever the exit code", () => {
  fails(() => parseResult(NO_TOKEN), "auth_required", "No API token configured. Run 'fizzy auth login TOKEN' or set FIZZY_TOKEN");
  fails(() => parseResult(NOT_FOUND), "not_found", "Resource not found: https://app.fizzy.do/111/cards/4210");
  fails(() => parseResult(USAGE), "usage", "unknown flag: --nope");
  fails(() => parseResult({ code: 6, stdout: '{"ok":false,"error":"Network error","code":"network"}', stderr: "" }), "network", "Network error");
  fails(() => parseResult({ code: 4, stdout: '{"ok":false,"error":"Forbidden","code":"forbidden"}', stderr: "" }), "forbidden", "Forbidden");
  fails(() => parseResult({ code: 5, stdout: '{"ok":false,"error":"Rate limited","code":"rate_limit"}', stderr: "" }), "rate_limit", "Rate limited");
  fails(() => parseResult({ code: 7, stdout: '{"ok":false,"error":"Validation failed: Title can\'t be blank","code":"api_error"}', stderr: "" }), "api_error", "Validation failed: Title can't be blank");
  // A code not met before is kept; no code at all is a plain ERROR; no message still fails.
  fails(() => parseResult({ code: 8, stdout: '{"ok":false,"error":"Which one?","code":"ambiguous"}', stderr: "" }), "ambiguous", "Which one?");
  fails(() => parseResult({ code: 1, stdout: '{"ok":false,"error":"odd"}', stderr: "" }), "ERROR", "odd");
  fails(() => parseResult({ code: 1, stdout: '{"ok":false}', stderr: "" }), "ERROR", "Fizzy reported an error");
  // The envelope wins over the exit code in the other direction too: exit 0 with ok:false is still a failure.
  fails(() => parseResult({ code: 0, stdout: '{"ok":false,"error":"nope","code":"api_error"}', stderr: "" }), "api_error", "nope");
});

// An answer as the CLI's --jq gives it, here by the jq on PATH (the suite needs jq anyway).
function throughJq(filter, answer) {
  const run = spawnSync("jq", ["-c", filter], { input: answer.stdout, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  return { ...answer, stdout: run.stdout };
}

test("the --jq projections keep what the panel reads, with the envelope's ok, and leave the rest out", () => {
  const [listed, triaged] = parseResult(throughJq(JQ.cards, OPEN));
  assert.deepEqual(listed, {
    number: 4242, title: "Write the changelog", url: "https://app.fizzy.do/111/cards/4242", closed: false, postponed: false, golden: true,
    column: { id: "c2", name: "Review", color: { name: "Purple", value: "var(--color-card-7)" } }, board: { id: "b1", name: "Roadmap" },
    tags: ["release"], assignees: [{ id: "u-me", name: "Ada", avatar_url: "https://app.fizzy.do/111/users/u-me/avatar" }],
    last_active_at: "2025-01-14T12:00:00.000Z", description: "Newest on top",
  });
  assert.deepEqual([triaged.column, triaged.assignees, triaged.tags, triaged.description.length], [null, [], [], 300], "Maybe?: no column; the description cut to 300");
  const page = parseResult(throughJq(JQ.page, DONE_PAGE));
  assert.deepEqual(page.cards.map(c => [c.number, columnOf(c.column), c.tags, c.assignees]), [[4210, null, [], []]], "a typed card: no lists, an empty column");
  assert.deepEqual([page.more, parseResult(throughJq(JQ.page, DONE_LAST)).more], [true, false], "the last page says none follows");
  assert.deepEqual(parseResult(throughJq(JQ.page, DONE_PAST)), { cards: [], more: true }, "a page past the end says one does");
  const [about, none] = parseResult(throughJq(JQ.notes, TRAY));
  assert.deepEqual(about, {
    id: "n1", title: "Write the changelog", body: "Assigned to you", read: false, created_at: "2025-01-15T10:00:00.000Z",
    creator: { id: "u-me", name: "Ada", avatar_url: "https://app.fizzy.do/111/users/u-me/avatar" },
    card: {
      number: 4242, title: "Write the changelog", url: "https://app.fizzy.do/111/cards/4242", closed: false, postponed: false, board_name: "Roadmap",
      column: { id: "c2", name: "Review", color: { name: "Purple", value: "var(--color-card-7)" } },
    },
  });
  assert.equal(noteCard(none), null, "a note about no card");
  assert.deepEqual(parseResult(throughJq(JQ.config, CONFIG_SHOWN)), { account: "111", board: "b1" });
  assert.doesNotMatch(throughJq(JQ.config, CONFIG_SHOWN).stdout, /token|test-vault/, "nothing of the token");
});

test("parseResult: stdout that is not the envelope is a PARSE error carrying stderr when there is some", () => {
  fails(() => parseResult({ code: 1, stdout: "", stderr: "  fizzy: boom\n" }), "PARSE", "fizzy: boom");
  fails(() => parseResult({ code: 0, stdout: "not json", stderr: "" }), "PARSE", "Fizzy returned something unreadable");
  fails(() => parseResult({ code: 0, stdout: "", stderr: "" }), "PARSE", "Fizzy returned something unreadable");
  fails(() => parseResult({ code: 0, stdout: "<html>502</html>", stderr: "bad gateway" }), "PARSE", "bad gateway");
  fails(() => parseResult({ code: 0, stdout: "{broken", stderr: "" }), "PARSE");
  fails(() => parseResult({ code: 0, stdout: "null", stderr: "" }), "PARSE");
  fails(() => parseResult({ code: 0, stdout: "42", stderr: "" }), "PARSE");
  fails(() => parseResult({ code: 0, stdout: "[1,2]", stderr: "" }), "PARSE");
  fails(() => parseResult({ code: 0, stdout: '{"data":[]}', stderr: "" }), "PARSE");
  fails(() => parseResult({ code: 0, stdout: undefined, stderr: undefined }), "PARSE");
});

test("FizzyError is an Error with a code, defaulting to ERROR", () => {
  const e = new FizzyError("x");
  assert.ok(e instanceof Error);
  assert.equal(e.name, "FizzyError");
  assert.equal(e.code, "ERROR");
  assert.equal(new FizzyError("m", "MISSING").code, "MISSING");
  assert.equal(new FizzyError("m", "MISSING").message, "m");
});

test("execFailure: Herdr's stop at its time limit is TIMEOUT, any other rejection MISSING; the message is kept", () => {
  const stopped = execFailure(new Error("fizzy took longer than 30 s and was stopped"));
  assert.ok(stopped instanceof FizzyError);
  assert.deepEqual([stopped.code, stopped.message], ["TIMEOUT", "fizzy took longer than 30 s and was stopped"]);
  const missing = execFailure(new Error("cannot start fizzy: program not found"));
  assert.deepEqual([missing.code, missing.message], ["MISSING", "cannot start fizzy: program not found"]);
  assert.equal(execFailure("no such folder").code, "MISSING");
});

test("explain says what to do about each kind of error", () => {
  const said = result => { try { parseResult(result); } catch (e) { return explain(e); } return null; };
  assert.equal(said(NO_TOKEN), "Not signed in to Fizzy: run `fizzy setup` in a terminal");
  assert.doesNotMatch(said(NO_TOKEN), /auth login/, "a token typed on a command line stays in shell history");
  assert.equal(said(NOT_FOUND), "Not found in Fizzy: it was deleted, or you can't see it");
  assert.equal(said(USAGE), "unknown flag: --nope");
  assert.equal(explain(new FizzyError("Network error", "network")), "Can't reach Fizzy");
  assert.equal(explain(new FizzyError("Forbidden", "forbidden")), "Fizzy doesn't let you do that");
  assert.equal(explain(new FizzyError("Rate limited", "rate_limit")), "Fizzy is busy: try again in a minute");
  assert.equal(explain(new FizzyError("Validation failed: Title can't be blank", "api_error")), "Validation failed: Title can't be blank");
  assert.equal(explain(execFailure(new Error("cannot start fizzy: program not found"))), "The fizzy CLI isn't installed (or not on PATH)");
  assert.equal(explain(execFailure(new Error("fizzy took longer than 30 s and was stopped"))), "Fizzy took too long to answer");
  assert.equal(explain(new FizzyError("Fizzy returned something unreadable", "PARSE")), "Fizzy returned something unreadable");
  assert.equal(explain(new Error("plain")), "plain");
  assert.equal(explain("text"), "text");
  assert.equal(explain(null), "Something went wrong with Fizzy");
  assert.equal(explain({}), "Something went wrong with Fizzy");
});

test("explainSearch: a search Fizzy did not answer (TIMEOUT, rate_limit) points at the search limit; any other error is explained as usual", () => {
  const LIMIT = "Fizzy didn't answer the search. Its search limit (300 an hour, shared with your agents) may be used up. Try again later.";
  assert.equal(explainSearch(execFailure(new Error("fizzy took longer than 30 s and was stopped"))), LIMIT);
  assert.equal(explainSearch(new FizzyError("Rate limited", "rate_limit")), LIMIT);
  assert.equal(explainSearch(new FizzyError("Network error", "network")), "Can't reach Fizzy");
  assert.equal(explainSearch(new FizzyError("x", "auth_required")), "Not signed in to Fizzy: run `fizzy setup` in a terminal");
  assert.equal(explainSearch(execFailure(new Error("cannot start fizzy"))), "The fizzy CLI isn't installed (or not on PATH)");
  assert.equal(explainSearch(null), "Something went wrong with Fizzy");
  assert.equal(SEARCH_CAP, 15);
});

test("laneOf: closed is Done, postponed is Not Now, no column is Maybe?, else the column", () => {
  assert.equal(laneOf(card(1)), "maybe");
  assert.equal(laneOf(card(1, { column: C1 })), "c1");
  assert.equal(laneOf(card(1, { postponed: true })), "not-now");
  assert.equal(laneOf(card(1, { closed: true })), "done");
  // Closed wins over a column and over postponed; postponed wins over a column.
  assert.equal(laneOf(card(1, { closed: true, column: C1 })), "done");
  assert.equal(laneOf(card(1, { closed: true, postponed: true })), "done");
  assert.equal(laneOf(card(1, { postponed: true, column: C1 })), "not-now");
  // A column kept as just its id (a trimmed cache) works too.
  assert.equal(laneOf(card(1, { column: "c2" })), "c2");
  assert.equal(laneOf({}), "maybe");
});

test("laneName: the column's name, or Maybe? / Not Now / Done", () => {
  assert.equal(laneName(card(1)), "Maybe?");
  assert.equal(laneName(card(1, { column: C1 })), "In progress");
  assert.equal(laneName(card(1, { postponed: true })), "Not Now");
  assert.equal(laneName(card(1, { closed: true, column: C1 })), "Done");
});

test("laneOf and laneName take an empty column for none, and a lane's own id as that lane", () => {
  const EMPTY = { created_at: "", id: "", name: "" };
  assert.equal(laneOf(card(1, { column: EMPTY })), "maybe");
  assert.equal(laneName(card(1, { column: EMPTY })), "Maybe?");
  assert.equal(laneOf(card(1, { closed: true, column: EMPTY })), "done");
  assert.equal(laneOf(card(1, { column: { id: "maybe", name: "Maybe?" } })), "maybe");
  assert.equal(laneOf(card(1, { postponed: true, column: { id: "not-now", name: "Not Now" } })), "not-now");
  assert.equal(laneOf(card(1, { closed: true, column: { id: "done", name: "Done" } })), "done");
  assert.equal(laneName(card(1, { closed: true, column: { id: "done", name: "Done" } })), "Done");
});

test("columnOf: the column's id, name and color; none for null, a missing one or an empty one; a lane's own id is kept", () => {
  assert.equal(columnOf(null), null);
  assert.equal(columnOf(undefined), null);
  assert.equal(columnOf({ created_at: "", id: "", name: "" }), null);
  assert.equal(columnOf("c2"), null, "an id alone is no column object");
  const review = { cards_url: "https://app.fizzy.do/111/boards/b1/columns/c2/cards", color: { name: "Purple", value: "var(--color-card-7)" }, created_at: "2025-01-02T10:00:00.000Z", id: "c2", name: "Review" };
  assert.deepEqual(columnOf(review), { id: "c2", name: "Review", color: { name: "Purple", value: "var(--color-card-7)" } });
  assert.deepEqual(columnOf({ id: "done", name: "Done" }), { id: "done", name: "Done", color: undefined });
});

test("fullCard puts back what a typed `card show` leaves out, and keeps everything it has", () => {
  const bare = fullCard(parseResult(SHOW_BARE));
  assert.deepEqual([bare.assignees, bare.tags, bare.steps, bare.description, bare.description_html, bare.column], [[], [], [], "", "", null]);
  assert.deepEqual([bare.number, bare.title, bare.board.id, laneOf(bare)], [4243, "Order the stickers", "b1", "maybe"]);
  const closed = fullCard(parseResult(SHOW_CLOSED));
  assert.deepEqual([closed.assignees.map(u => u.id), closed.tags, closed.steps.map(s => s.id)], [["u-me"], ["release"], ["s1"]]);
  assert.deepEqual(closed.column, { id: "c2", name: "Review", color: { name: "Purple", value: "var(--color-card-7)" } });
  assert.equal(laneOf(closed), "done");
  assert.match(closed.description_html, /Newest on top/);
  assert.equal(fullCard(null), null);
});

test("moveTo gives the argv lists for every from -> to pair, from Done included", () => {
  const N = 7;
  const from = {
    maybe: card(N),
    "not-now": card(N, { postponed: true }),
    c1: card(N, { column: C1 }),
    "done (last column c1)": card(N, { closed: true, column: C1 }),
    "done (no column)": card(N, { closed: true }),
  };
  const want = {
    maybe: { maybe: [], "not-now": [cmd.postpone(N)], done: [cmd.close(N)], c1: [cmd.column(N, "c1")], c2: [cmd.column(N, "c2")] },
    "not-now": { maybe: [cmd.untriage(N)], "not-now": [], done: [cmd.close(N)], c1: [cmd.column(N, "c1")], c2: [cmd.column(N, "c2")] },
    c1: { maybe: [cmd.untriage(N)], "not-now": [cmd.postpone(N)], done: [cmd.close(N)], c1: [], c2: [cmd.column(N, "c2")] },
    // A reopened card goes back to its last column: no second move when that is the target.
    "done (last column c1)": { maybe: [cmd.reopen(N), cmd.untriage(N)], "not-now": [cmd.reopen(N), cmd.postpone(N)], done: [], c1: [cmd.reopen(N)], c2: [cmd.reopen(N), cmd.column(N, "c2")] },
    // With no column it comes back to Maybe?.
    "done (no column)": { maybe: [cmd.reopen(N)], "not-now": [cmd.reopen(N), cmd.postpone(N)], done: [], c1: [cmd.reopen(N), cmd.column(N, "c1")], c2: [cmd.reopen(N), cmd.column(N, "c2")] },
  };
  for (const [name, c] of Object.entries(from)) {
    for (const target of ["maybe", "not-now", "done", "c1", "c2"]) {
      assert.deepEqual(moveTo(c, target), want[name][target], `${name} -> ${target}`);
    }
  }
  // The argv are fresh arrays: the caller may edit them.
  const first = moveTo(from.maybe, "done"), again = moveTo(from.maybe, "done");
  assert.notEqual(first[0], again[0]);
});

test("moveTo: a closed card whose column is Done's own id has no known last column, so a reopen is always followed by the move", () => {
  const N = 7, done = card(N, { closed: true, column: { id: "done", name: "Done" } });
  assert.deepEqual(moveTo(done, "maybe"), [cmd.reopen(N), cmd.untriage(N)]);
  assert.deepEqual(moveTo(done, "c1"), [cmd.reopen(N), cmd.column(N, "c1")]);
  assert.deepEqual(moveTo(done, "not-now"), [cmd.reopen(N), cmd.postpone(N)]);
  assert.deepEqual(moveTo(done, "done"), []);
});

test("lanes: the column list's own order, pseudo lanes added where missing", () => {
  const all = lanes(COLUMNS);
  assert.deepEqual(all.map(l => [l.key, l.id, l.kind, l.name]), [
    ["not-now", "not-now", "not-now", "Not Now"], ["maybe", "maybe", "maybe", "Maybe?"], ["c1", "c1", "column", "In progress"],
    ["c2", "c2", "column", "Review"], ["done", "done", "done", "Done"],
  ]);
  assert.deepEqual(all.map(l => l.color), [null, null, colorOf(C1), colorOf(C2), null]);
  assert.deepEqual(all.every(l => Array.isArray(l.cards) && !l.cards.length), true);
  // Nothing but real columns: Maybe? first, Not Now and Done last.
  assert.deepEqual(lanes([C1, C2]).map(l => l.key), ["maybe", "c1", "c2", "not-now", "done"]);
  // Only some pseudo lanes: the missing ones are added.
  assert.deepEqual(lanes([C1, DONE]).map(l => l.key), ["maybe", "c1", "done", "not-now"]);
  assert.deepEqual(lanes([MAYBE, C1]).map(l => l.key), ["maybe", "c1", "not-now", "done"]);
  assert.deepEqual(lanes(undefined).map(l => l.key), ["maybe", "not-now", "done"]);
  assert.deepEqual(lanes([]).map(l => l.name), ["Maybe?", "Not Now", "Done"]);
  // A repeated id is one lane.
  assert.deepEqual(lanes([C1, C1, MAYBE, MAYBE]).map(l => l.key), ["c1", "maybe", "not-now", "done"]);
});

test("sections: lanes in column-list order, each card in exactly one, by laneOf", () => {
  const open = [
    card(1), card(2, { column: C1 }), card(3, { column: C2 }), card(4, { column: C1 }), card(5), card(6, { postponed: true }), card(7, { closed: true, column: C1 }),
  ];
  const out = sections(COLUMNS, open);
  assert.deepEqual(out.map(s => [s.key, s.kind, s.name, s.cards.map(c => c.number)]), [
    ["not-now", "not-now", "Not Now", [6]],
    ["maybe", "maybe", "Maybe?", [1, 5]],
    ["c1", "column", "In progress", [2, 4]],
    ["c2", "column", "Review", [3]],
    ["done", "done", "Done", [7]],
  ]);
  assert.deepEqual(out.map(s => s.id), ["not-now", "maybe", "c1", "c2", "done"]);
  assert.equal(out[2].color, colorOf(C1));
  assert.equal(out[0].color, null);
  assert.equal(out.reduce((n, s) => n + s.cards.length, 0), open.length);
  assert.equal(out[2].cards[0], open[1], "the card objects are the caller's own");
});

test("sections keeps a lane's cards in the order the list gave them, and shows empty lanes", () => {
  const out = sections(COLUMNS, [card(30, { column: C1 }), card(10, { column: C1 }), card(20, { column: C1 })]);
  assert.deepEqual(out.find(s => s.key === "c1").cards.map(c => c.number), [30, 10, 20]);
  assert.deepEqual(out.filter(s => !s.cards.length).map(s => s.key), ["not-now", "maybe", "c2", "done"]);
  assert.deepEqual(sections(COLUMNS, []).map(s => s.cards.length), [0, 0, 0, 0, 0]);
  assert.deepEqual(sections(COLUMNS, undefined).map(s => s.cards.length), [0, 0, 0, 0, 0]);
});

test("sections: a pseudo lane missing from the columns is added (Maybe? first, Not Now and Done last)", () => {
  const out = sections([C1, C2], [card(1), card(2, { column: C1 }), card(3, { postponed: true }), card(4, { closed: true })]);
  assert.deepEqual(out.map(s => [s.key, s.cards.map(c => c.number)]), [["maybe", [1]], ["c1", [2]], ["c2", []], ["not-now", [3]], ["done", [4]]]);
  assert.deepEqual(sections(undefined, [card(1, { column: C1 })]).map(s => [s.key, s.cards.length]), [["maybe", 1], ["not-now", 0], ["done", 0]], "unknown column -> Maybe?");
});

test("sections: a card whose column is not in the list goes to Maybe?", () => {
  const out = sections(COLUMNS, [card(1, { column: col("gone", "Deleted", "Red") }), card(2, { column: C1 })]);
  assert.deepEqual(out.find(s => s.key === "maybe").cards.map(c => c.number), [1]);
  assert.deepEqual(out.find(s => s.key === "c1").cards.map(c => c.number), [2]);
});

test("sections: lazily loaded lanes win over the open list's copy of a card, and each number shows once", () => {
  const staleOpen = card(5, { title: "Old title", column: C1 });
  const freshNotNow = card(5, { title: "New title", postponed: true });
  const done = [card(8, { closed: true }), card(9, { closed: true, column: C2 })];
  const out = sections(COLUMNS, [staleOpen, card(6, { column: C1 }), card(8, { column: C2 })], { notNow: [freshNotNow], done });
  assert.deepEqual(out.map(s => [s.key, s.cards.map(c => c.number)]), [["not-now", [5]], ["maybe", []], ["c1", [6]], ["c2", []], ["done", [8, 9]]]);
  assert.equal(out[0].cards[0].title, "New title");
  assert.equal(out.reduce((n, s) => n + s.cards.length, 0), 4);
  // The same card in both lazy lists (pages that overlap, a card moved meanwhile) is still one.
  const twice = sections(COLUMNS, [], { notNow: [card(1, { postponed: true })], done: [card(1, { closed: true }), card(1, { closed: true })] });
  assert.equal(twice.reduce((n, s) => n + s.cards.length, 0), 1);
  // Only one of the lazy lanes loaded.
  assert.deepEqual(sections(COLUMNS, [], { done: [card(2, { closed: true })] }).map(s => s.cards.length), [0, 0, 0, 0, 1]);
});

test("filterCards: every word must match, any case, over title, #number, tags, assignees, column and description", () => {
  const cards = [
    card(4242, { title: "Fix the Login redirect", tags: ["bug", "auth"], assignees: [user("u1", "Ada"), user("u2", "Grace Brewster Hopper")], column: C1, description: "Sessions drop at /settings over VPN" }),
    card(4243, { title: "Write docs", tags: ["docs"], assignees: [], column: C2, description: "" }),
    card(88, { title: "Login page colors", tags: [], assignees: [user("u3", "Bob")], description: "Night theme is Faded" }),
  ];
  const nums = (q, o) => filterCards(cards, q, o).map(c => c.number);
  assert.deepEqual(nums(""), [4242, 4243, 88]);
  assert.deepEqual(nums("   "), [4242, 4243, 88]);
  assert.deepEqual(nums(undefined), [4242, 4243, 88]);
  assert.deepEqual(nums("login"), [4242, 88]);
  assert.deepEqual(nums("LOGIN redirect"), [4242]);
  assert.deepEqual(nums("redirect login"), [4242], "word order does not matter");
  assert.deepEqual(nums("login docs"), [], "all words, not any");
  assert.deepEqual(nums("#4242"), [4242]);
  assert.deepEqual(nums("#88"), [88]);
  assert.deepEqual(nums("4243"), [4243], "a bare number finds the card too");
  assert.deepEqual(nums("auth"), [4242], "tags");
  assert.deepEqual(nums("DOCS"), [4243]);
  assert.deepEqual(nums("hopper"), [4242], "assignee names");
  assert.deepEqual(nums("bob login"), [88]);
  assert.deepEqual(nums("review"), [4243], "column name");
  assert.deepEqual(nums("vpn"), [4242], "description");
  assert.deepEqual(nums("faded night"), [88]);
  assert.deepEqual(nums("nothing-like-this"), []);
  assert.deepEqual(nums("  login\t\n redirect "), [4242], "any whitespace separates words");
  // Cards the caller did not give are never invented, and the input is left alone.
  assert.equal(cards.length, 3);
  assert.deepEqual(filterCards(undefined, "x"), []);
});

test("filterCards: `mine` keeps only cards assigned to me, and works together with the words", () => {
  const cards = [
    card(1, { title: "alpha", assignees: [user("me", "Ada"), user("u2", "Grace")] }),
    card(2, { title: "alpha", assignees: [user("u2", "Grace")] }),
    card(3, { title: "beta", assignees: [user("me", "Ada")] }),
    card(4, { title: "gamma", assignees: [] }),
  ];
  const nums = (q, o) => filterCards(cards, q, o).map(c => c.number);
  assert.deepEqual(nums("", { mine: true, me: "me" }), [1, 3]);
  assert.deepEqual(nums("alpha", { mine: true, me: "me" }), [1]);
  assert.deepEqual(nums("alpha", { mine: false, me: "me" }), [1, 2]);
  assert.deepEqual(nums("", { me: "me" }), [1, 2, 3, 4], "me alone filters nothing");
  assert.deepEqual(nums("", { mine: true, me: { id: "me" } }), [1, 3], "a user object works as me");
  // Me not known yet: nothing is known to be mine.
  assert.deepEqual(nums("", { mine: true, me: null }), []);
  assert.deepEqual(nums("", { mine: true }), []);
});

test("colorOf: Fizzy's named colors as hex, null for none or unknown", () => {
  for (const name of ["Blue", "Gray", "Tan", "Yellow", "Lime", "Aqua", "Violet", "Purple", "Pink", "Red", "Orange", "Green"]) {
    assert.match(colorOf({ color: { name, value: "x" } }), /^#[0-9a-f]{6}$/, name);
  }
  const hexes = ["Blue", "Gray", "Tan", "Yellow", "Lime", "Aqua", "Violet", "Purple", "Pink", "Red", "Orange", "Green"].map(name => colorOf({ color: { name } }));
  assert.equal(new Set(hexes).size, hexes.length, "each color differs");
  assert.equal(colorOf(C1), colorOf({ color: { name: "aqua" } }), "case does not matter");
  assert.equal(colorOf({ color: { name: " AQUA " } }), colorOf(C1));
  assert.equal(colorOf("Pink"), colorOf({ color: { name: "Pink" } }), "a bare name works");
  assert.equal(colorOf({ color: { name: "Chartreuse" } }), null);
  assert.equal(colorOf({ color: null }), null);
  assert.equal(colorOf(MAYBE), null);
  assert.equal(colorOf(null), null);
  assert.equal(colorOf(undefined), null);
  // An unknown name falls back on the css variable's slot, which gives one of the named colors; an unknown slot gives none.
  const palette = new Set(hexes);
  for (const value of ["var(--color-card-default)", "var(--color-card-1)"]) {
    assert.ok(palette.has(colorOf({ color: { value } })), value);
    assert.equal(colorOf({ color: { name: "Mystery", value } }), colorOf({ color: { value } }), `an unknown name with ${value}`);
  }
  assert.equal(colorOf({ color: { value: "var(--color-card-99)" } }), null);
});

test("meFrom: the account user's id, not the login's", () => {
  const identity = { id: "login-id", accounts: [
    { id: "a1", slug: "/111", user: { id: "user-111" } },
    { id: "a2", slug: "/222", user: { id: "user-222" } },
  ] };
  assert.equal(meFrom(identity, "222"), "user-222");
  assert.equal(meFrom(identity, "/222"), "user-222");
  assert.equal(meFrom(identity, "111"), "user-111");
  assert.equal(meFrom(identity, "nope"), "user-111", "an unknown account falls back on the first");
  assert.equal(meFrom(identity), "user-111");
  assert.equal(meFrom({ id: "x", accounts: [] }, "1"), null);
  assert.equal(meFrom(null), null);
  assert.equal(meFrom({ id: "x" }), null);
});

test("ref is one line: number, title, url", () => {
  assert.equal(ref(card(4242, { title: "Fix the login redirect" })), 'Fizzy #4242 "Fix the login redirect" (https://app.fizzy.do/111/cards/4242)');
  assert.equal(ref(card(5, { title: "  padded  " })), 'Fizzy #5 "padded" (https://app.fizzy.do/111/cards/5)');
  assert.equal(ref(card(6, { title: "two\nlines\tand\r\n\r\n  tabs" })), 'Fizzy #6 "two lines and tabs" (https://app.fizzy.do/111/cards/6)');
  assert.equal(ref(card(7, { title: 'He said "stop"' })), 'Fizzy #7 "He said "stop"" (https://app.fizzy.do/111/cards/7)', "inner quotes stay");
  assert.equal(ref(card(8, { title: "No link", url: undefined })), 'Fizzy #8 "No link"');
  assert.ok(!ref(card(9, { title: "a\nb" })).includes("\n"));
});

test("refs puts one ref per line", () => {
  const out = refs([card(1, { title: "a\nb" }), card(2, { title: "c" })]);
  assert.equal(out, 'Fizzy #1 "a b" (https://app.fizzy.do/111/cards/1)\nFizzy #2 "c" (https://app.fizzy.do/111/cards/2)');
  assert.equal(out.split("\n").length, 2);
  assert.equal(refs([]), "");
  assert.equal(refs(undefined), "");
});

test("tabName: #number and the title, at most 32 characters, with an ellipsis when cut", () => {
  assert.equal(tabName(card(4242, { title: "Fix login" })), "#4242 Fix login");
  assert.equal(tabName(card(5, { title: "multi\nline\ttitle" })), "#5 multi line title");
  const long = tabName(card(4242, { title: "Fix the login redirect that loops forever on Safari" }));
  assert.equal([...long].length, 32);
  assert.ok(long.startsWith("#4242 Fix the login redirect"));
  assert.ok(long.endsWith("…"));
  // Exactly 32 stays whole; 33 is cut.
  assert.equal(tabName(card(1, { title: "x".repeat(29) })), `#1 ${"x".repeat(29)}`);
  assert.equal([...tabName(card(1, { title: "x".repeat(30) }))].length, 32);
  assert.ok(tabName(card(1, { title: "x".repeat(30) })).endsWith("…"));
  assert.equal(tabName(card(1, { title: "x".repeat(29) })).length, 32);
  // A space where the cut falls does not sit before the ellipsis, and characters beyond the BMP are not split.
  assert.equal(tabName(card(1, { title: "a".repeat(27) + " bcdefgh" })), `#1 ${"a".repeat(27)}…`);
  const emoji = tabName(card(1, { title: "🙂".repeat(40) }));
  assert.equal([...emoji].length, 32);
  assert.ok(!/[\ud800-\udbff]$|^[\udc00-\udfff]/.test(emoji));
});

test("textToHtml escapes, turns blank lines into paragraphs and single line breaks into <br>", () => {
  assert.equal(textToHtml(""), "");
  assert.equal(textToHtml(null), "");
  assert.equal(textToHtml(undefined), "");
  assert.equal(textToHtml("  \n \n "), "");
  assert.equal(textToHtml("hello"), "<p>hello</p>");
  assert.equal(textToHtml("  hello  "), "<p>hello</p>");
  assert.equal(textToHtml("a\nb"), "<p>a<br>b</p>");
  assert.equal(textToHtml("a\n\nb"), "<p>a</p><p>b</p>");
  assert.equal(textToHtml("a\n\n\n\nb"), "<p>a</p><p>b</p>");
  assert.equal(textToHtml("a\n   \nb"), "<p>a</p><p>b</p>", "a line of spaces is a blank line");
  assert.equal(textToHtml("one\ntwo\n\nthree"), "<p>one<br>two</p><p>three</p>");
  assert.equal(textToHtml("a\r\nb\r\n\r\nc"), "<p>a<br>b</p><p>c</p>");
  assert.equal(textToHtml("\n\nlead and trail\n\n"), "<p>lead and trail</p>");
  assert.equal(textToHtml(`Tom & Jerry <b>"hi"</b> it's`), "<p>Tom &amp; Jerry &lt;b&gt;&quot;hi&quot;&lt;/b&gt; it&#39;s</p>");
  const hostile = textToHtml('<script>alert("x")</script>\n\n<img src=x onerror=alert(1)>');
  assert.doesNotMatch(hostile, /<script|<img/);
  assert.equal(hostile, "<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p><p>&lt;img src=x onerror=alert(1)&gt;</p>");
  assert.equal(textToHtml("100% & more"), "<p>100% &amp; more</p>");
  assert.equal(textToHtml("ünï çödé 中文 🙂"), "<p>ünï çödé 中文 🙂</p>");
});

test("textToHtml turns a run of lines starting with a bullet, a dash or a star into a list", () => {
  assert.equal(textToHtml("• one\n• two"), "<ul><li>one</li><li>two</li></ul>");
  assert.equal(textToHtml("- one\n- two"), "<ul><li>one</li><li>two</li></ul>");
  assert.equal(textToHtml("* one\n* two"), "<ul><li>one</li><li>two</li></ul>");
  assert.equal(textToHtml("• one\n- two\n* three"), "<ul><li>one</li><li>two</li><li>three</li></ul>", "the markers can mix");
  assert.equal(textToHtml("• only"), "<ul><li>only</li></ul>");
  assert.equal(textToHtml("  - indented\n\t- tabbed"), "<ul><li>indented</li><li>tabbed</li></ul>");
  assert.equal(textToHtml("-  spaced  \n-\tab"), "<ul><li>spaced</li><li>ab</li></ul>");
});

test("textToHtml splits a paragraph around its list, and keeps lists apart from other paragraphs", () => {
  assert.equal(textToHtml("intro\n• a\n• b\noutro"), "<p>intro</p><ul><li>a</li><li>b</li></ul><p>outro</p>");
  assert.equal(textToHtml("intro\nmore\n- a\nafter\nmore after"), "<p>intro<br>more</p><ul><li>a</li></ul><p>after<br>more after</p>");
  assert.equal(textToHtml("Heading\n\n• a\n• b\n\nTail"), "<p>Heading</p><ul><li>a</li><li>b</li></ul><p>Tail</p>");
  assert.equal(textToHtml("• a\n\n• b"), "<ul><li>a</li></ul><ul><li>b</li></ul>", "a blank line ends the list");
  assert.equal(textToHtml("- a\ntext\n- b"), "<ul><li>a</li></ul><p>text</p><ul><li>b</li></ul>");
  assert.equal(textToHtml("• a\r\n• b\r\n\r\nc"), "<ul><li>a</li><li>b</li></ul><p>c</p>");
});

test("textToHtml leaves what is not a bullet line alone, and escapes list items", () => {
  assert.equal(textToHtml("-5 degrees"), "<p>-5 degrees</p>");
  assert.equal(textToHtml("*bold*"), "<p>*bold*</p>");
  assert.equal(textToHtml("a - b"), "<p>a - b</p>");
  assert.equal(textToHtml("-"), "<p>-</p>");
  assert.equal(textToHtml("•\n• x"), "<p>•</p><ul><li>x</li></ul>", "a bullet with nothing after it is not an item");
  assert.equal(textToHtml(`- Tom & Jerry <b>"hi"</b>\n- it's`), "<ul><li>Tom &amp; Jerry &lt;b&gt;&quot;hi&quot;&lt;/b&gt;</li><li>it&#39;s</li></ul>");
  assert.doesNotMatch(textToHtml("- <script>alert(1)</script>"), /<script/);
});

test("htmlForView on a multi-line note puts each line in its own paragraph", () => {
  const html = '<div class="action-text-content"><p>Heading<br>Line two</p><p>• a<br>• b<br>• c</p><p>Done.</p></div>';
  assert.equal(htmlForView(html),
    '<div class="action-text-content"><p>Heading</p><p>Line two</p><p>• a</p><p>• b</p><p>• c</p><p>Done.</p></div>');
});

test("htmlForView closes and reopens the block a <br> sits in", () => {
  assert.equal(htmlForView("<p>a<br>b</p>"), "<p>a</p><p>b</p>");
  assert.equal(htmlForView('<p class="x" id="y">a<br>b</p>'), '<p class="x" id="y">a</p><p class="x" id="y">b</p>');
  assert.equal(htmlForView("<div>a<br>b</div>"), "<div>a</div><div>b</div>");
  assert.equal(htmlForView('<div class="action-text-content">a<br>b</div>'), '<div class="action-text-content">a</div><div class="action-text-content">b</div>');
  for (const h of ["h1", "h2", "h3", "h4", "h5", "h6"]) assert.equal(htmlForView(`<${h}>a<br>b</${h}>`), `<${h}>a</${h}><${h}>b</${h}>`, h);
  assert.equal(htmlForView("<p>a<br>b<br>c</p><p>d</p>"), "<p>a</p><p>b</p><p>c</p><p>d</p>");
  assert.equal(htmlForView("<div><p>a<br>b</p></div>"), "<div><p>a</p><p>b</p></div>", "the nearest block");
});

test("htmlForView puts p's inside a blockquote and a list item, with no extra bullet", () => {
  assert.equal(htmlForView("<blockquote>a<br>b</blockquote>"), "<blockquote><p>a</p><p>b</p></blockquote>");
  assert.equal(htmlForView("<blockquote><p>a<br>b</p></blockquote>"), "<blockquote><p>a</p><p>b</p></blockquote>");
  assert.equal(htmlForView("<ul><li>a<br>b</li></ul>"), "<ul><li><p>a</p><p>b</p></li></ul>");
  assert.equal(htmlForView("<ol><li>a<br>b<br>c</li><li>d</li></ol>"), "<ol><li><p>a</p><p>b</p><p>c</p></li><li>d</li></ol>");
  assert.equal(htmlForView("<ul><li>a<br>b<ul><li>c<br>d</li></ul></li></ul>"), "<ul><li><p>a</p><p>b</p><ul><li><p>c</p><p>d</p></li></ul></li></ul>");
  assert.equal(htmlForView("<ul><li>a<br></li><li>b</li></ul>"), "<ul><li>a</li><li>b</li></ul>", "an item without a break keeps its text bare");
});

test("htmlForView wraps loose text around a <br> in paragraphs", () => {
  assert.equal(htmlForView("a<br>b"), "<p>a</p><p>b</p>");
  assert.equal(htmlForView("a<br>b<br>c"), "<p>a</p><p>b</p><p>c</p>");
  assert.equal(htmlForView("<b>a</b><br>c"), "<p><b>a</b></p><p>c</p>");
  assert.equal(htmlForView("<p>x</p>a<br>b<p>y</p>"), "<p>x</p><p>a</p><p>b</p><p>y</p>");
  assert.equal(htmlForView("<p>x</p>loose<p>y</p>a<br>b"), "<p>x</p>loose<p>y</p><p>a</p><p>b</p>", "only the runs around a break are wrapped");
});

test("htmlForView takes every spelling of <br>", () => {
  assert.equal(htmlForView("<p>a<br>b<br/>c<br />d<BR>e<Br/>f<br  />g<br class=\"x\">h</p>"), "<p>a</p><p>b</p><p>c</p><p>d</p><p>e</p><p>f</p><p>g</p><p>h</p>");
});

test("htmlForView makes several <br> in a row one boundary, and never an empty block", () => {
  assert.equal(htmlForView("<p>a<br><br><br>b</p>"), "<p>a</p><p>b</p>");
  assert.equal(htmlForView("<p>a<br>\n  <br/> <br>b</p>"), "<p>a</p><p>\n   b</p>", "the white space between them is kept, in the new block");
  assert.equal(htmlForView("<p><br>a</p>"), "<p>a</p>", "at the start");
  assert.equal(htmlForView("<p><br><br>a</p>"), "<p>a</p>");
  assert.equal(htmlForView("<p>a<br></p>"), "<p>a</p>", "at the end");
  assert.equal(htmlForView("<p>a<br><br></p><p>b</p>"), "<p>a</p><p>b</p>");
  assert.equal(htmlForView("<div>a<br></div>"), "<div>a</div>");
  assert.equal(htmlForView("<ul><li><br>a<br></li></ul>"), "<ul><li>a</li></ul>");
  assert.equal(htmlForView("<br>a"), "a");
  assert.equal(htmlForView("<br>"), "");
  assert.equal(htmlForView("<p>a</p><br><p>b</p>"), "<p>a</p><p>b</p>", "between blocks");
  assert.equal(htmlForView("<div>a<br><p>b</p></div>"), "<div>a<p>b</p></div>", "before a block");
  assert.equal(htmlForView("<div><p>a</p><br>b</div>"), "<div><p>a</p>b</div>", "after a block");
  const tidy = htmlForView("<div class=\"c\"><p>a<br></p><p><br>b<br><br>c<br></p></div>");
  assert.doesNotMatch(tidy, /<p><\/p>|<div[^>]*><\/div>/);
  assert.equal(tidy, '<div class="c"><p>a</p><p>b</p><p>c</p></div>');
});

test("htmlForView moves inline tags with their text into the new block", () => {
  assert.equal(htmlForView("<p>a <b>x<br>y</b> z</p>"), "<p>a <b>x</b></p><p><b>y</b> z</p>");
  assert.equal(htmlForView('<p><a href="https://x.y">one<br>two</a></p>'), '<p><a href="https://x.y">one</a></p><p><a href="https://x.y">two</a></p>');
  assert.equal(htmlForView("<p>a<br><b>x</b></p>"), "<p>a</p><p><b>x</b></p>");
  assert.equal(htmlForView("<p><b>a<br></b>c</p>"), "<p><b>a</b></p><p>c</p>");
  assert.equal(htmlForView("<p><b><i>a<br>b</i></b></p>"), "<p><b><i>a</i></b></p><p><b><i>b</i></b></p>");
  assert.equal(htmlForView("<p>a<br><img src=\"x.png\">b</p>"), '<p>a</p><p><img src="x.png">b</p>');
  assert.equal(htmlForView("<p><b><br>a</b></p>"), "<p><b>a</b></p>", "a leading break inside a tag");
});

test("htmlForView turns a <br> in a pre into a newline, one for each", () => {
  assert.equal(htmlForView("<pre>a<br>b</pre>"), "<pre>a\nb</pre>");
  assert.equal(htmlForView("<pre>a<br><br>b<BR/>c<br />d</pre>"), "<pre>a\n\nb\nc\nd</pre>", "a blank line in code stays a blank line");
  assert.equal(htmlForView('<pre data-language="plain"><code>a<br>b</code></pre>'), '<pre data-language="plain"><code>a\nb</code></pre>');
  assert.equal(htmlForView("<pre>a\nb<br>c</pre>"), "<pre>a\nb\nc</pre>", "real newlines stay");
  assert.equal(htmlForView("<p>a<br>b</p><pre>c<br>d</pre><p>e<br>f</p>"), "<p>a</p><p>b</p><pre>c\nd</pre><p>e</p><p>f</p>");
  assert.equal(htmlForView("<ul><li>x<br>y<pre>c<br>d</pre></li></ul>"), "<ul><li><p>x</p><p>y</p><pre>c\nd</pre></li></ul>");
});

test("htmlForView gives a flow container p's inside, like a blockquote", () => {
  for (const name of ["section", "article", "aside", "header", "footer", "nav", "main", "figcaption", "dd", "address"]) {
    assert.equal(htmlForView(`<${name}>a<br>b</${name}>`), `<${name}><p>a</p><p>b</p></${name}>`, name);
  }
  assert.equal(htmlForView('<section class="s"><p>x</p>a<br>b<br><p>y<br>z</p></section>'), '<section class="s"><p>x</p><p>a</p><p>b</p><p>y</p><p>z</p></section>');
  assert.equal(htmlForView("<dl><dt>t</dt><dd>a<br>b</dd></dl>"), "<dl><dt>t</dt><dd><p>a</p><p>b</p></dd></dl>");
  assert.equal(htmlForView("<figure><img src=\"x.png\"><figcaption>a<br>b</figcaption></figure>"), '<figure><img src="x.png"><figcaption><p>a</p><p>b</p></figcaption></figure>');
});

test("htmlForView carries comments, white space and empty tags after a <br> into the new block", () => {
  assert.equal(htmlForView("<p>a<br><!-- c -->b</p>"), "<p>a</p><p><!-- c -->b</p>");
  assert.equal(htmlForView("<p>a<br> \n <!-- c --> b</p>"), "<p>a</p><p> \n <!-- c --> b</p>");
  assert.equal(htmlForView("<p>a<br> <wbr>b</p>"), "<p>a</p><p> <wbr>b</p>");
  assert.equal(htmlForView('<p>a<br><a id="x"></a>b</p>'), '<p>a</p><p><a id="x"></a>b</p>');
  assert.equal(htmlForView("<p>a<br><?x y?>b</p>"), "<p>a</p><p><?x y?>b</p>");
  assert.equal(htmlForView("<p>a<br><b><i></i>x</b>y</p>"), "<p>a</p><p><b><i></i>x</b>y</p>", "an empty tag inside one that stays open");
  assert.equal(htmlForView("<p><b>a<br></b><!-- c -->c</p>"), "<p><b>a</b></p><p><!-- c -->c</p>", "after a close of the tag the break was in");
  assert.equal(htmlForView("<p><b>a<br><i></i></b>c</p>"), "<p><b>a</b></p><p><i></i>c</p>");
  assert.equal(htmlForView("<p><b>a<br> <i> </i> </b>c</p>"), "<p><b>a</b></p><p> <i> </i> c</p>");
  assert.equal(htmlForView("<p>a<br><!-- c --><br>b</p>"), "<p>a</p><p><!-- c -->b</p>", "a second break adds nothing");
  assert.equal(htmlForView("<p>a<br><!-- c --></p><p>b</p>"), "<p>a<!-- c --></p><p>b</p>", "nothing follows: it stays where it was");
  assert.equal(htmlForView("a<br><!-- c -->b"), "<p>a</p><p><!-- c -->b</p>");
  assert.equal(htmlForView("<ul><li>a<br><!-- c --> <a id=\"x\"></a>b</li></ul>"), '<ul><li><p>a</p><p><!-- c --> <a id="x"></a>b</p></li></ul>');
  assert.equal(htmlForView("<p><b>a<br><i></b>c</p>"), "<p><b>a</b></p><p>c</p>", "a tag left unclosed by bad nesting is not carried");
  assert.equal(htmlForView("<p><b>a<br><i>c</b></p>"), "<p><b>a</b></p><p><b><i>c</b></p>", "bad nesting after the content is as it was");
});

test("htmlForView leaves a <br> where it cannot split safely, and every other byte alone", () => {
  assert.equal(htmlForView("<table><tr><td>a<br>b</td></tr></table>"), "<table><tr><td>a<br>b</td></tr></table>");
  assert.equal(htmlForView("<dl><dt>a<br>b</dt></dl>"), "<dl><dt>a<br>b</dt></dl>");
  assert.equal(htmlForView("<details><summary>a<br>b</summary></details>"), "<details><summary>a<br>b</summary></details>");
  assert.equal(htmlForView("<ul>a<br>b</ul>"), "<ul>a<br>b</ul>");
  assert.equal(htmlForView("<p>a<br>b</p><table><tr><td>c<br>d</td></tr></table>"), "<p>a</p><p>b</p><table><tr><td>c<br>d</td></tr></table>");
  assert.equal(htmlForView('<p>a&nbsp;&amp; &lt;br&gt;<br>\n  b</p>\n<!-- c -->\n<p>d</p>'), '<p>a&nbsp;&amp; &lt;br&gt;</p><p>\n  b</p>\n<!-- c -->\n<p>d</p>');
  assert.equal(htmlForView("<p>1 < 2<br>3 > 2</p>"), "<p>1 < 2</p><p>3 > 2</p>");
  assert.equal(htmlForView("<p>a<br>b"), "<p>a</p><p>b", "a block left open stays open");
});

test("htmlForView returns HTML without a <br> unchanged, and text for nothing", () => {
  for (const html of ["", "plain", "<p>a</p><p>b</p>", '<div class="action-text-content">\n  <h3>T</h3>\n  <ul>\n    <li>a</li>\n  </ul>\n</div>', "<p>&lt;br&gt;</p>", "<p>a &lt;br&gt; b</p>"]) {
    assert.equal(htmlForView(html), html, html);
  }
  assert.equal(htmlForView(null), "");
  assert.equal(htmlForView(undefined), "");
});

test("htmlForView -> htmlToText keeps the line breaks the text has", () => {
  const html = '<div class="action-text-content"><p>Heading<br>Line two</p><p>• a<br>• b</p></div>';
  assert.equal(htmlToText(htmlForView(html)), "Heading\n\nLine two\n\n• a\n\n• b");
  assert.equal(htmlToText(html), "Heading\nLine two\n\n• a\n• b");
});

test("textLines: one entry per line, none for no text", () => {
  assert.deepEqual(textLines("a\nb"), ["a", "b"]);
  assert.deepEqual(textLines("a\n\nb"), ["a", "", "b"]);
  assert.deepEqual(textLines("a\r\nb\rc"), ["a", "b", "c"]);
  assert.deepEqual(textLines("\n  a\nb  \n\n"), ["a", "b"], "the ends are trimmed");
  assert.deepEqual(textLines("one"), ["one"]);
  for (const nothing of ["", "  \n ", null, undefined]) assert.deepEqual(textLines(nothing), []);
});

test("htmlToText turns line, paragraph, item and heading ends into line breaks and drops the tags", () => {
  assert.equal(htmlToText(""), "");
  assert.equal(htmlToText(null), "");
  assert.equal(htmlToText(undefined), "");
  assert.equal(htmlToText("plain"), "plain");
  assert.equal(htmlToText("a<br>b"), "a\nb");
  assert.equal(htmlToText("a<br/>b<br />c<BR>d"), "a\nb\nc\nd");
  assert.equal(htmlToText("<p>a</p><p>b</p>"), "a\n\nb");
  assert.equal(htmlToText("<p>a<br>b</p>"), "a\nb");
  assert.equal(htmlToText("<div>a</div><div>b</div>"), "a\nb");
  assert.equal(htmlToText("<h1>T</h1><h3>U</h3>text"), "T\nU\ntext");
  assert.equal(htmlToText("<ul><li>one</li><li>two <b>bold</b></li></ul>"), "• one\n• two bold");
  assert.equal(htmlToText('<ol><li class="x">first</li></ol>'), "• first");
  assert.equal(htmlToText("<p>a</p><ul><li>b</li></ul><p>c</p>"), "a\n\n• b\n\nc", "a list ends in a blank line, as a paragraph does");
  assert.equal(htmlToText('a <a href="https://x.y/z?a=1&amp;b=2">link</a> b'), "a link b");
  assert.equal(htmlToText("  <p>  spaced  </p>  "), "spaced");
  assert.equal(htmlToText("<p>a</p>\n\n\n\n<p>b</p>"), "a\n\nb", "three or more breaks become one blank line");
  assert.equal(htmlToText("a<br><br><br><br>b"), "a\n\nb");
  assert.equal(htmlToText("a\r\n  b"), "a b", "a newline in the source is white space, as in a browser");
});

test("htmlToText on Fizzy's indented HTML: indentation and source newlines tidy up", () => {
  const html = '<div class="action-text-content">\n  <h3>Title</h3>\n  <p>Line</p>\n  <ul>\n    <li>Topic: a</li>\n    <li>b</li>\n  </ul>\n</div>';
  assert.equal(htmlToText(html), "Title\nLine\n\n• Topic: a\n• b");
});

test("htmlToText decodes the entities Fizzy writes, once, after the tags are gone", () => {
  assert.equal(htmlToText("Tom &amp; Jerry"), "Tom & Jerry");
  assert.equal(htmlToText("&lt;b&gt;not bold&lt;/b&gt;"), "<b>not bold</b>", "escaped tags stay text");
  assert.equal(htmlToText("&quot;q&quot; &#39;s&#39; &apos;t&apos;"), `"q" 's' 't'`);
  assert.equal(htmlToText("a&nbsp;b&nbsp;&nbsp;c"), "a b  c");
  assert.equal(htmlToText("&#65;&#x42;&#X43;"), "ABC");
  assert.equal(htmlToText("caf&#233; &#8212; &#128578;"), "café — 🙂");
  assert.equal(htmlToText("&amp;lt;"), "&lt;", "not decoded twice");
  assert.equal(htmlToText("&amp;amp;"), "&amp;");
  assert.equal(htmlToText("&bogus; &#0; &#99999999; &#xD800; & alone"), "&bogus; &#0; &#99999999; &#xD800; & alone");
});

test("textToHtml -> htmlToText gives the text back (paragraphs, breaks, escapes, entities typed as text)", () => {
  for (const text of [
    "plain",
    "Tom & Jerry",
    `<b>bold</b> & "double" & 'single'`,
    "line one\nline two",
    "p1\n\np2\n\np3",
    "p1 line a\np1 line b\n\np2",
    "typed &amp; and &lt; and &#39; stay as typed",
    "&lt;script&gt;",
    "ünï çödé 中文 🙂",
    "100% sure",
    "• one",
    "• one\n• two\n• three",
    "Heading\n\n• one\n• two <b> & more\n\nTail line a\nTail line b",
    "• a\n\n• b",
  ]) {
    assert.equal(htmlToText(textToHtml(text)), text, JSON.stringify(text));
  }
  const html = '<p>Intro</p><ul><li>one</li><li>two</li></ul><p>Outro</p>';
  assert.equal(textToHtml(htmlToText(html)), html, "list HTML -> text -> HTML");
  assert.equal(textToHtml(htmlToText('<ul><li>a</li><li>b</li></ul>')), "<ul><li>a</li><li>b</li></ul>");
  assert.equal(htmlToText(textToHtml("- a\n* b")), "• a\n• b", "the other markers become bullets");
  // What the round trip normalizes: surrounding space, CRLF, runs of blank lines.
  assert.equal(htmlToText(textToHtml("  a\r\nb\n\n\n\nc  ")), "a\nb\n\nc");
});

test("initials: first and last word, uppercase, ? for nobody", () => {
  assert.equal(initials("Ada"), "A");
  assert.equal(initials("ada"), "A");
  assert.equal(initials("Grace Brewster Hopper"), "GH");
  assert.equal(initials("Mary Ann"), "MA");
  assert.equal(initials("  Ann   Lee  "), "AL");
  assert.equal(initials("élan über"), "ÉÜ");
  assert.equal(initials("Jean-Luc Picard"), "JP");
  assert.equal(initials("Helper (Bot)"), "H", "a bot's tag is not a name");
  assert.equal(initials("🙂 Smile"), "S");
  assert.equal(initials(""), "?");
  assert.equal(initials("   "), "?");
  assert.equal(initials(null), "?");
  assert.equal(initials(undefined), "?");
  assert.equal(initials("(Bot)"), "?");
  assert.equal(initials("🙂"), "?");
});

test("hue is a stable index 0..7", () => {
  assert.equal(hue("0000000000000000000000001"), hue("0000000000000000000000001"));
  assert.equal(hue("0000000000000000000000001"), 1, "pinned: avatars must not change color between releases");
  assert.equal(hue("0000000000000000000000002"), 2);
  assert.equal(hue(""), 0);
  assert.equal(hue(null), 0);
  const seen = new Set();
  for (let i = 0; i < 400; i++) {
    const h = hue(`00000000000000000000${i.toString(36).padStart(5, "0")}`);
    assert.ok(Number.isInteger(h) && h >= 0 && h <= 7, `${i} -> ${h}`);
    seen.add(h);
  }
  assert.equal(seen.size, 8, "all eight colors get used");
  assert.ok(Number.isInteger(hue("🙂 non-ascii ünï")) && hue("🙂 non-ascii ünï") < 8);
});

test("ago: now, minutes, hours, days (under two weeks), then the date", () => {
  const now = new Date(2030, 5, 15, 12, 0, 0).getTime();
  const before = ms => new Date(now - ms).toISOString();
  const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
  assert.equal(ago(before(0), now), "now");
  assert.equal(ago(before(59999), now), "now");
  assert.equal(ago(before(MIN), now), "1m");
  assert.equal(ago(before(5 * MIN), now), "5m");
  assert.equal(ago(before(59 * MIN + 59999), now), "59m");
  assert.equal(ago(before(HOUR), now), "1h");
  assert.equal(ago(before(3 * HOUR + 30 * MIN), now), "3h");
  assert.equal(ago(before(DAY - 1), now), "23h");
  assert.equal(ago(before(DAY), now), "1d");
  assert.equal(ago(before(2 * DAY + 5 * HOUR), now), "2d");
  assert.equal(ago(before(14 * DAY - 1), now), "13d");
  assert.equal(ago(before(14 * DAY), now), "Jun 1");
  assert.equal(ago(new Date(2030, 2, 4, 12).toISOString(), now), "Mar 4", "this year: no year");
  assert.equal(ago(new Date(2030, 0, 1, 12).toISOString(), now), "Jan 1");
  assert.equal(ago(new Date(2029, 2, 4, 12).toISOString(), now), "Mar 4, 2029", "another year: with it");
  // The year is compared with `now`'s, not with the system clock (past years, so the clock never shares one).
  assert.equal(ago(new Date(2024, 11, 31, 12).toISOString(), new Date(2025, 0, 20, 12).getTime()), "Dec 31, 2024");
  assert.equal(ago(new Date(2024, 2, 4, 12).toISOString(), new Date(2024, 8, 15, 12).getTime()), "Mar 4", "the same year as now");
  assert.equal(ago(new Date(2024, 11, 31, 12).toISOString(), new Date(2025, 0, 2, 12).getTime()), "2d", "across New Year but recent");
});

test("ago accepts now as a Date, a number or a timestamp, copes with the future, and gives nothing for rubbish", () => {
  const now = new Date(2030, 5, 15, 12, 0, 0);
  const iso = new Date(now.getTime() - 5 * 60000).toISOString();
  assert.equal(ago(iso, now), "5m");
  assert.equal(ago(iso, now.getTime()), "5m");
  assert.equal(ago(iso, now.toISOString()), "5m");
  assert.equal(ago(new Date(now.getTime() + 5 * 60000).toISOString(), now), "now", "a slightly fast clock is not a negative age");
  assert.equal(ago(new Date().toISOString()), "now", "now defaults to the clock");
  assert.equal(ago(new Date(Date.now() - 2 * 3600000).toISOString()), "2h");
  for (const bad of ["", "garbage", null, undefined, "2026-13-45"]) assert.equal(ago(bad, now), "", String(bad));
  assert.equal(ago(iso, "garbage"), "");
});

test("parseYaml reads the top-level board and account, nothing else", () => {
  assert.deepEqual(parseYaml("account: 111\nboard: 00000000000000000000000b1\n"), { account: "111", board: "00000000000000000000000b1" });
  assert.deepEqual(parseYaml(""), {});
  assert.deepEqual(parseYaml(undefined), {});
  assert.deepEqual(parseYaml("board:"), {});
  assert.deepEqual(parseYaml("board:   \n"), {});
  assert.deepEqual(parseYaml("board: abc"), { board: "abc" });
  assert.deepEqual(parseYaml("board:\tabc"), { board: "abc" });
  assert.deepEqual(parseYaml("board:abc"), {}, "no space after the colon: not a mapping in YAML");
  assert.deepEqual(parseYaml("boards: abc\nboardx: 1\nmyboard: 2"), {}, "other keys, however alike");
  assert.deepEqual(parseYaml("board: ~"), {});
  assert.deepEqual(parseYaml("board: null"), {});
});

test("parseYaml strips comments, quotes and whitespace", () => {
  assert.deepEqual(parseYaml("# the header\n# board: not-this\nboard: abc # trailing\naccount: 123   \n"), { board: "abc", account: "123" });
  assert.deepEqual(parseYaml('board: "abc"\naccount: \'123\''), { board: "abc", account: "123" });
  assert.deepEqual(parseYaml('board: "abc" # why\n'), { board: "abc" });
  assert.deepEqual(parseYaml("board: 'abc' # why\n"), { board: "abc" });
  assert.deepEqual(parseYaml('board: "a # b"'), { board: "a # b" }, "a # inside quotes is text");
  assert.deepEqual(parseYaml("board: a#b"), { board: "a#b" }, "# only starts a comment after a space");
  assert.deepEqual(parseYaml("board: # nothing here"), {});
  assert.deepEqual(parseYaml('board: "a \\"b\\" c"'), { board: 'a "b" c' });
  assert.deepEqual(parseYaml("board: 'it''s'"), { board: "it's" });
  assert.deepEqual(parseYaml('board: "unterminated'), { board: "unterminated" });
  assert.deepEqual(parseYaml("board: abc\r\naccount: 1\r\n"), { board: "abc", account: "1" }, "CRLF");
  assert.deepEqual(parseYaml("\uFEFFboard: abc"), { board: "abc" }, "a byte-order mark");
  assert.deepEqual(parseYaml("---\nboard: abc\n..."), { board: "abc" });
});

test("parseYaml ignores nested keys and never returns the token", () => {
  assert.deepEqual(parseYaml("defaults:\n  board: nested\n  account: nested\nboard: top"), { board: "top" });
  assert.deepEqual(parseYaml("\tboard: tabbed"), {});
  assert.deepEqual(parseYaml("token: secret\nboard: b\napi_url: https://x"), { board: "b" });
  assert.deepEqual(parseYaml("board: first\nboard: second"), { board: "second" });
  const typical = "# Fizzy board for this folder — read by `fizzy`.\n# Note: keep it local.\naccount: 111\nboard: b1\n";
  assert.deepEqual(parseYaml(typical), { account: "111", board: "b1" });
});

test("chooseBoard: the space's board when following, else the picked one, else the CLI's default, else the first", () => {
  const boards = [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }];
  assert.equal(chooseBoard({ boards, follow: true, spaceBoard: "b", picked: "c", fallback: "a" }), "b", "follow wins");
  assert.equal(chooseBoard({ boards, follow: false, spaceBoard: "b", picked: "c", fallback: "a" }), "c", "not following: picked");
  assert.equal(chooseBoard({ boards, follow: true, spaceBoard: null, picked: "c", fallback: "a" }), "c", "no .fizzy.yaml: picked");
  assert.equal(chooseBoard({ boards, follow: true, spaceBoard: "gone", picked: "c", fallback: "a" }), "c", "a board we cannot see does not count");
  assert.equal(chooseBoard({ boards, follow: true, spaceBoard: "gone", picked: "gone", fallback: "b" }), "b", "then the default");
  assert.equal(chooseBoard({ boards, follow: false, spaceBoard: "b", picked: null, fallback: "c" }), "c");
  assert.equal(chooseBoard({ boards, follow: true, spaceBoard: null, picked: null, fallback: null }), "a", "then the first");
  assert.equal(chooseBoard({ boards, follow: true, spaceBoard: "x", picked: "y", fallback: "z" }), "a");
  assert.equal(chooseBoard({ boards, follow: false, spaceBoard: "b" }), "a", "missing fields are fine");
  assert.equal(chooseBoard({ boards: [], follow: true, spaceBoard: "b", picked: "c", fallback: "a" }), null);
  assert.equal(chooseBoard({ boards: undefined }), null);
});

// Whatever of these the machine has: macOS's sh is bash, Linux's is often dash.
const SHELLS = [["sh"], ["dash"], ["bash", "--posix"], ["ksh"], ["zsh", "--emulate", "sh"]].filter(([bin, ...flags]) => spawnSync(bin, [...flags, "-c", "exit 0"]).status === 0);
const walk = ([bin, ...flags], dir, options = {}) => spawnSync(bin, [...flags, "-c", YAML_SCRIPT, "fizzy", dir], { encoding: "utf8", ...options });
// What a recursive listing says about a folder: names, sizes, modification times.
const snapshot = dir => readdirSync(dir, { recursive: true }).sort().map(name => { const s = statSync(join(dir, name)); return `${name}|${s.isDirectory() ? "d" : s.size}|${s.mtimeMs}`; });
const hasFileAbove = dir => { for (let d = dir; ; d = dirname(d)) { if (existsSync(join(d, ".fizzy.yaml"))) return true; if (d === dirname(d)) return false; } };

test("YAML_SCRIPT is plain POSIX sh that only reads", () => {
  assert.ok(SHELLS.length >= 1, "at least sh is there");
  assert.doesNotMatch(YAML_SCRIPT, /[>]|\btee\b|\brm\b|\bmv\b|\bcp\b|\btouch\b|\bmkdir\b|\bsed\b|\bcurl\b|\bwget\b|\bnc\b/, "no writes, no network");
  assert.doesNotMatch(YAML_SCRIPT, /\[\[|\bfunction\b|<\(|\$'|\bsource\b|\bpushd\b/, "no bashisms");
  assert.match(YAML_SCRIPT, /\.fizzy\.yaml/);
  assert.match(YAML_SCRIPT, /grep -E "\^\(\$bom\)\?board/, "it prints the board line only");
  assert.doesNotMatch(YAML_SCRIPT, /\bcat\b/, "never the whole file");
});

test("YAML_SCRIPT prints the board line of the nearest .fizzy.yaml walking up, never the rest of the file, and handles odd folder names", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fizzy-yaml-"));
  try {
    const top = join(dir, "top project"), mid = join(top, "with space", "deeper folder"), odd = join(mid, `$weird 'q' "d" \`x\`;*&`), leaf = join(odd, "leaf");
    const trap = join(top, "trap"), other = join(top, "other", "x y");
    await mkdir(leaf, { recursive: true });
    await mkdir(join(trap, ".fizzy.yaml"), { recursive: true });
    await mkdir(join(trap, "inner"), { recursive: true });
    await mkdir(other, { recursive: true });
    const topText = "# top\ntoken: TOP-SECRET\naccount: 111\nboard: TOP\n";
    const midText = "token: MID-SECRET\nboard: MID\nboards: no\nboardx: no\n  board: nested\nnote: ünï çödé 中文\r\nnoeol: yes";
    await writeFile(join(top, ".fizzy.yaml"), topText);
    await writeFile(join(mid, ".fizzy.yaml"), midText);

    for (const shell of SHELLS) {
      const name = shell.join(" ");
      const before = snapshot(dir);
      const found = (from, want, why) => {
        const r = walk(shell, from);
        assert.equal(r.status, 0, `${name}: ${why}: ${r.stderr}`);
        assert.equal(r.stdout, want, `${name}: ${why}`);
        assert.equal(r.stderr, "", `${name}: ${why}: quiet`);
      };
      const topLine = "board: TOP\n", midLine = "board: MID\n";
      found(mid, midLine, "the folder that has it: its board line, and no token, other key or indented board");
      found(leaf, midLine, "from below, the nearest one wins");
      found(odd, midLine, "a folder named with quotes, $, backticks, ; * & and spaces");
      found(top, topLine, "the outer one from its own folder");
      found(other, topLine, "from a sibling branch with spaces: the outer one");
      found(`${leaf}/`, midLine, "a trailing slash");
      found(`${leaf}///`, midLine, "several trailing slashes");
      found(join(trap, "inner"), topLine, "a folder named .fizzy.yaml is not the file");
      found(trap, topLine, "nor is it the file one level up");
      assert.deepEqual(parseYaml(walk(shell, leaf).stdout), { board: "MID" });
      assert.deepEqual(snapshot(dir), before, `${name}: nothing was written, touched or removed`);
      assert.equal(readFileSync(join(mid, ".fizzy.yaml"), "utf8"), midText);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("YAML_SCRIPT never prints a token: a file with no board line gives exit 1 and no output; a tab, CRLF or leading byte-order mark still parses", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fizzy-yaml-"));
  try {
    const none = join(dir, "none"), tabbed = join(dir, "tabbed"), crlf = join(dir, "crlf"), marked = join(dir, "marked");
    for (const folder of [none, tabbed, crlf, marked]) await mkdir(folder, { recursive: true });
    await writeFile(join(none, ".fizzy.yaml"), "token: NONE-SECRET\naccount: 111\n");
    await writeFile(join(tabbed, ".fizzy.yaml"), "token: TAB-SECRET\nboard\t:\tTAB\n");
    await writeFile(join(crlf, ".fizzy.yaml"), "token: CRLF-SECRET\r\nboard: CRLF\r\n");
    await writeFile(join(marked, ".fizzy.yaml"), "\uFEFFboard: MARKED\ntoken: MARKED-SECRET\n");
    for (const shell of SHELLS) {
      const name = shell.join(" ");
      const noBoard = walk(shell, none);
      assert.deepEqual([noBoard.status, noBoard.stdout], [1, ""], `${name}: only a token and an account`);
      for (const [folder, board] of [[tabbed, "TAB"], [crlf, "CRLF"], [marked, "MARKED"]]) {
        const r = walk(shell, folder);
        assert.equal(r.status, 0, name);
        assert.doesNotMatch(r.stdout, /SECRET/, name);
        assert.deepEqual(parseYaml(r.stdout), { board }, name);
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("YAML_SCRIPT exits 1 and prints nothing when there is no .fizzy.yaml, or the path is not absolute", async t => {
  const dir = await mkdtemp(join(tmpdir(), "fizzy-yaml-"));
  const away = await mkdtemp(join(tmpdir(), "fizzy-yaml-"));
  try {
    const deep = join(dir, "a b", "c d");
    await mkdir(deep, { recursive: true });
    await writeFile(join(dir, "a b", "unrelated.yaml"), "board: no\n");
    await writeFile(join(deep, ".fizzy.yml"), "board: wrong-extension\n");
    const shadowed = hasFileAbove(deep) || hasFileAbove(away);
    await t.test("no .fizzy.yaml in the folder or above it", { skip: shadowed && "a .fizzy.yaml sits above the temp folders" }, () => {
      for (const shell of SHELLS) {
        const name = shell.join(" ");
        for (const from of [deep, `${deep}/`, dir, away, "/", "//", "/nonexistent/folder"]) {
          const r = walk(shell, from);
          assert.equal(r.status, 1, `${name}: ${from}`);
          assert.equal(r.stdout, "", `${name}: ${from}`);
        }
      }
    });
    await t.test("a path that is not absolute, even with a .fizzy.yaml right there, or no path at all", async () => {
      for (const shell of SHELLS) {
        const name = shell.join(" ");
        await writeFile(join(deep, ".fizzy.yaml"), "board: here\n");
        for (const from of [".", "", "relative/path", "~"]) {
          const r = walk(shell, from, { cwd: deep });
          assert.equal(r.status, 1, `${name}: "${from}"`);
          assert.equal(r.stdout, "", `${name}: "${from}"`);
        }
        assert.equal(walk(shell, deep).stdout, "board: here\n", `${name}: and the absolute one finds it`);
        await rm(join(deep, ".fizzy.yaml"));
        const none = spawnSync(shell[0], [...shell.slice(1), "-c", YAML_SCRIPT, "fizzy"], { encoding: "utf8" });
        assert.equal(none.status, 1, `${name}: no folder given`);
      }
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(away, { recursive: true, force: true });
  }
});

test("targetAgent: the focused terminal's agent, else the shown agent block's, else the tab's most recent, else nobody", () => {
  const a1 = agent("t-1", { tab: "tabA", seq: 3 }), a2 = agent("t-2", { tab: "tabA", seq: 9 }), a3 = agent("t-3", { tab: "tabB", seq: 20 }), a4 = agent("t-4", { tab: "tabA", seq: 5 });
  const agents = [a1, a2, a3, a4];
  // 1. The focused pane's terminal is an agent.
  assert.equal(targetAgent({ agents, focused: { terminal: "t-1", agent: "t-3", tab: "tabA" } }), a1);
  assert.equal(targetAgent({ agents, focused: { terminal: "t-3", agent: null, tab: "tabA" } }), a3, "even outside the focused tab's own order");
  // 2. A shell has focus but an agent block shows an agent.
  assert.equal(targetAgent({ agents, focused: { terminal: "shell-9", agent: "t-3", tab: "tabA" } }), a3);
  assert.equal(targetAgent({ agents, focused: { terminal: null, agent: "t-4", tab: "tabA" } }), a4);
  // 3. Otherwise the agent in the focused tab that changed most recently.
  assert.equal(targetAgent({ agents, focused: { terminal: "shell-9", agent: null, tab: "tabA" } }), a2);
  assert.equal(targetAgent({ agents, focused: { terminal: null, agent: "gone", tab: "tabB" } }), a3, "an agent address nobody lists does not stop the search");
  assert.equal(targetAgent({ agents, focused: { tab: "tabA" } }), a2);
  // 4. Nobody.
  assert.equal(targetAgent({ agents, focused: { terminal: "shell-9", agent: null, tab: "tabC" } }), null);
  assert.equal(targetAgent({ agents: [], focused: { terminal: "t-1", agent: "t-1", tab: "tabA" } }), null);
  assert.equal(targetAgent({ agents, focused: null }), null);
  assert.equal(targetAgent({ agents, focused: undefined }), null);
  assert.equal(targetAgent({ agents: undefined, focused: { tab: "tabA" } }), null);
  assert.equal(targetAgent({ agents }), null);
  // Equal recency: the first listed. A missing seq counts as 0.
  const x = agent("x", { tab: "t", seq: 4 }), y = agent("y", { tab: "t", seq: 4 }), z = agent("z", { tab: "t", seq: undefined });
  assert.equal(targetAgent({ agents: [x, y], focused: { tab: "t" } }), x);
  assert.equal(targetAgent({ agents: [z, y], focused: { tab: "t" } }), y);
  assert.equal(targetAgent({ agents: [z], focused: { tab: "t" } }), z);
});

test("agentLabel: program, else app, else Agent, then the tab's name", () => {
  assert.equal(agentLabel(agent("a")), "Claude Code · fix login");
  assert.equal(agentLabel(agent("a", { program: { name: "" }, app: "codex" })), "codex · fix login");
  assert.equal(agentLabel(agent("a", { program: undefined, app: "pi" })), "pi · fix login");
  assert.equal(agentLabel(agent("a", { program: undefined, app: null })), "Agent · fix login");
  assert.equal(agentLabel(agent("a", { tab_name: "" })), "Claude Code");
  assert.equal(agentLabel(agent("a", { tab_name: undefined })), "Claude Code");
  assert.equal(agentLabel(agent("a", { tab_name: "claude code" })), "Claude Code", "a tab named after the program says it once");
  assert.equal(agentLabel({}), "Agent");
  assert.equal(agentLabel(null), "Agent");
});

const layoutOf = ({ hidden = false, active = "fizzy", children = ["files", "changes", "fizzy"] } = {}) => ({
  id: "root", type: "row", children: [
    { id: "main", type: "block" },
    { id: "panel", type: "column", hidden, children: [{ id: "panel-body", type: "stack", active, children: children.map(id => ({ id, type: "block" })) }] },
  ],
});

test("findNode finds a node by id anywhere in the layout", () => {
  const root = layoutOf();
  assert.equal(findNode(root, "panel-body").type, "stack");
  assert.equal(findNode(root, "fizzy").type, "block");
  assert.equal(findNode(root, "root"), root);
  assert.equal(findNode(root, "nope"), null);
  assert.equal(findNode(null, "x"), null);
  assert.equal(findNode(undefined, "x"), null);
});

test("fizzyVisible: out of sight until the panel is open and Fizzy is the stack's child", () => {
  assert.equal(fizzyVisible(layoutOf()), true);
  assert.equal(fizzyVisible(layoutOf({ hidden: true })), false);
  assert.equal(fizzyVisible(layoutOf({ active: "files" })), false);
  assert.equal(fizzyVisible(layoutOf({ active: "changes" })), false);
  assert.equal(fizzyVisible(layoutOf({ active: "changes", hidden: true })), false);
  // No Fizzy child in the stack (another layout), no layout at all, or no stack: always visible.
  assert.equal(fizzyVisible(layoutOf({ children: ["files", "changes"], active: "files" })), true);
  assert.equal(fizzyVisible(layoutOf({ children: ["files", "changes"], hidden: true })), true);
  assert.equal(fizzyVisible(null), true);
  assert.equal(fizzyVisible(undefined), true);
  assert.equal(fizzyVisible({ id: "root", children: [] }), true);
});

const note = (id, more = {}) => ({ id, title: `T ${id}`, body: "", read: false, created_at: "2025-01-14T10:00:00Z", card: { number: 5, board_name: "Roadmap" }, ...more });

test("unreadNotes: only the unread, newest first; a note without a date is the oldest; the list is not changed", () => {
  const list = [
    note("r-old", { read: true, created_at: "2024-12-01T00:00:00Z" }), note("u-old", { created_at: "2025-01-12T00:00:00Z" }),
    note("r-new", { read: true, created_at: "2025-01-13T00:00:00Z" }), note("u-new", { created_at: "2025-01-14T00:00:00Z" }),
    note("u-none", { created_at: undefined }), note("r-none", { read: true, created_at: "nonsense" }),
  ];
  const copy = list.map(n => n.id);
  assert.deepEqual(unreadNotes(list).map(n => n.id), ["u-new", "u-old", "u-none"], "no read note, whatever it is called");
  assert.deepEqual(list.map(n => n.id), copy);
  assert.deepEqual(oldestFirst(list.filter(n => !n.read)).map(n => n.id), ["u-none", "u-old", "u-new"]);
  assert.deepEqual(unreadNotes(null), []);
  assert.deepEqual(unreadNotes([note("r", { read: true })]), []);
});

test("noteToast: the title (80 at most), the body's first line (140 at most), then #number and the board; missing parts are left out", () => {
  assert.deepEqual(noteToast(note("a", { title: "Helper (bot) @mentioned you", body: "Look at this\nsecond line" })), { title: "Helper (bot) @mentioned you", body: "Look at this · #5 · Roadmap" });
  assert.deepEqual(noteToast(note("b", { body: "\n  \nfirst text line  \nnext" })), { title: "T b", body: "first text line · #5 · Roadmap" });
  assert.equal(noteToast(note("c", { title: "t".repeat(81) })).title, `${"t".repeat(79)}…`);
  assert.equal(noteToast(note("c", { title: "t".repeat(80) })).title, "t".repeat(80));
  assert.equal(noteToast(note("d", { body: "x".repeat(141) })).body, `${"x".repeat(139)}… · #5 · Roadmap`);
  assert.equal(noteToast(note("d", { body: "x".repeat(140) })).body, `${"x".repeat(140)} · #5 · Roadmap`);
  assert.deepEqual(noteToast(note("e", { body: "hi", card: { number: 5 } })), { title: "T e", body: "hi · #5" });
  assert.deepEqual(noteToast(note("f", { body: "hi", card: null })), { title: "T f", body: "hi" });
  assert.deepEqual(noteToast(note("g", { card: { board_name: "Roadmap" } })), { title: "T g", body: "Roadmap" });
  assert.deepEqual(noteToast(note("h", { card: null })), { title: "T h" }, "no body at all");
  assert.equal(noteToast(note("i", { title: "", card: { title: "The card" } })).title, "The card");
  assert.equal(noteToast({ id: "j" }).title, "Fizzy");
  assert.deepEqual(noteToast(note("k", { body: "hi", card: { number: 0, board_name: "" } })), { title: "T k", body: "hi" }, "a card numbered 0 is no card");
});

test("noteCard: the notification's card when it has a number above 0, else null", () => {
  assert.equal(noteCard(note("a")).number, 5);
  assert.equal(noteCard(note("b", { card: { number: 0, title: "" } })), null);
  assert.equal(noteCard(note("c", { card: { number: -1 } })), null);
  assert.equal(noteCard(note("d", { card: { number: "5" } })), null);
  assert.equal(noteCard(note("e", { card: null })), null);
  assert.equal(noteCard(note("f", { card: undefined })), null);
  assert.equal(noteCard(null), null);
});

test("noteAction: open when Fizzy shows; else show the panel or select the page, and say what the layout was", () => {
  const n = note("n9", { card: { number: 12 } });
  assert.deepEqual(noteAction(layoutOf(), n), { action: { name: "fizzy.open:12:n9" }, before: null });
  assert.deepEqual(noteAction(layoutOf({ hidden: true }), n), { action: { name: "layout.show", args: { id: "panel" } }, before: { active: "fizzy", hidden: true } });
  assert.deepEqual(noteAction(layoutOf({ active: "files" }), n), { action: { name: "layout.select", args: { stack: "panel-body", child: "fizzy" } }, before: { active: "files", hidden: false } });
  assert.deepEqual(noteAction(layoutOf({ active: "changes", hidden: true }), n).before, { active: "changes", hidden: true });
  // A layout that does not offer Fizzy on that stack shows it wherever it was put.
  assert.deepEqual(noteAction(layoutOf({ children: ["files", "changes"], active: "files" }), n).action, { name: "fizzy.open:12:n9" });
  assert.deepEqual(noteAction(null, n).action, { name: "fizzy.open:12:n9" });
  // No card (or no id) to open: no action.
  assert.deepEqual(noteAction(layoutOf(), note("x", { card: null })), { action: undefined, before: null });
  assert.deepEqual(noteAction(layoutOf({ active: "files" }), note("x", { card: { number: undefined } })), { action: undefined, before: null });
  assert.deepEqual(noteAction(layoutOf(), { card: { number: 3 } }), { action: undefined, before: null });
  assert.deepEqual(noteAction(layoutOf(), note("z", { card: { number: 0 } })), { action: undefined, before: null }, "a card numbered 0 is no card");
});

test("noteReady: only a layout that changed since the toast and now has the Fizzy page in front counts", () => {
  const away = { active: "files", hidden: false }, awayHidden = { active: "files", hidden: true }, hiddenFizzy = { active: "fizzy", hidden: true };
  assert.equal(noteReady(layoutOf({ active: "files" }), away), null, "unchanged");
  assert.equal(noteReady(layoutOf({ active: "changes" }), away), null, "another page is no answer");
  assert.equal(noteReady(layoutOf(), away), "open");
  assert.equal(noteReady(layoutOf({ hidden: true }), away), "show", "the page came, the panel is still hidden");
  assert.equal(noteReady(layoutOf({ hidden: true }), awayHidden), "show");
  assert.equal(noteReady(layoutOf(), awayHidden), "open");
  assert.equal(noteReady(layoutOf({ hidden: true }), hiddenFizzy), null, "still hidden: unchanged");
  assert.equal(noteReady(layoutOf({ active: "files", hidden: true }), hiddenFizzy), null);
  assert.equal(noteReady(layoutOf(), hiddenFizzy), "open", "the panel was shown");
  assert.equal(noteReady(null, away), null);
});

test("notification constants", () => {
  assert.deepEqual([TOASTS, SEEN_CAP, PENDING_FOR, TOAST_FOR], [3, 300, 60000, 8000]);
});

const claude = agent("term-claude", { pane: "pane-1", tab: "t1", seq: 7, tab_name: "fix login" });
const codex = agent("term-codex", {
  pane: "pane-2", space: "s2", space_name: "other", tab: "t2", tab_name: "tests", status: "blocked", app: "codex", seq: 3,
  program: { key: "codex", name: "Codex", icon: "icons/codex.svg", tint: true },
});
const BOARDS = [{ id: "b1", name: "Roadmap" }, { id: "b2", name: "Personal" }, { id: "b3", name: "Acme" }];
const ids = rows => rows.map(r => r.id);
const byId = (rows, id) => rows.find(r => r.id === id);
const selectable = rows => rows.filter(r => r.type === "row");
const unique = rows => assert.equal(new Set(ids(rows)).size, rows.length, `ids are unique: ${ids(rows)}`);
const ICONS = readdirSync(MOD_DIR).filter(f => f.endsWith(".svg")).map(f => `mods/fizzy/${f}`);

test("boards menu: follow row with the space's board as its hint, then one row per board", () => {
  const rows = menuRows({ kind: "boards", current: "b2", follow: true, spaceBoard: "b3" }, { boards: BOARDS });
  assert.deepEqual(ids(rows), ["follow", "sep-follow", "board-b1", "board-b2", "board-b3"]);
  assert.deepEqual(rows.map(r => r.type), ["row", "sep", "row", "row", "row"]);
  assert.equal(rows[0].label, "Follow current space");
  assert.equal(rows[0].hint, "Acme");
  assert.equal(rows[0].checked, true);
  assert.deepEqual(rows[0].act, { choose: { follow: true, board: null } });
  assert.deepEqual(rows.slice(2, 5).map(r => r.label), ["Roadmap", "Personal", "Acme"]);
  assert.deepEqual(rows.slice(2, 5).map(r => r.checked), [false, false, false], "following: no board is checked");
  assert.deepEqual(byId(rows, "board-b1").act, { choose: { follow: false, board: "b1" } });
  unique(rows);

  const picked = menuRows({ kind: "boards", current: "b2", follow: false, spaceBoard: "b3" }, { boards: BOARDS });
  assert.equal(picked[0].checked, false);
  assert.deepEqual(picked.slice(2, 5).map(r => r.checked), [false, true, false], "not following: the current board is");

  assert.equal(menuRows({ kind: "boards", current: "b1", follow: true, spaceBoard: null }, { boards: BOARDS })[0].hint, "no .fizzy.yaml");
  assert.equal(menuRows({ kind: "boards", current: "b1", follow: true, spaceBoard: "zzz" }, { boards: BOARDS })[0].hint, "unknown board");
  assert.deepEqual(ids(menuRows({ kind: "boards", current: null, follow: true, spaceBoard: null }, { boards: [] })), ["follow", "sep-follow", "boards-note"]);
  assert.equal(menuRows({ kind: "boards", current: null, follow: true, spaceBoard: null }, {})[2].label, "No boards");
});

const SAMPLE = SAMPLE_BOARDS.map((name, i) => ({ id: `l${i + 1}`, name }));
const TEAM = SAMPLE.filter(b => isTeamBoard(b.name)), OTHERS = SAMPLE.filter(b => !isTeamBoard(b.name));
const CFG = () => ({ groups: [{ id: "team", name: "Team", match: "[team]", hidden: false }], boards: {} });
const names = list => list.map(b => b.name);

test("the default groups: none, so every board is in no group; nothing saved and nothing usable give it; a saved config is never replaced by it", () => {
  assert.deepEqual(defaultGroups(), { groups: [], boards: {} });
  assert.notEqual(defaultGroups(), defaultGroups(), "a fresh one each time");
  for (const raw of [undefined, null, 0, "x", [], {}, { groups: "no" }, { boards: {} }]) assert.deepEqual(groupsConfig(raw), defaultGroups(), JSON.stringify(raw));
  assert.deepEqual(boardGroups(SAMPLE, groupsConfig(undefined)), { ungrouped: SAMPLE, groups: [] }, "nothing saved: every board, in the list's order, in no group");
  assert.deepEqual(groupsConfig({ groups: [], boards: {} }), { groups: [], boards: {} }, "no groups saved is kept");
  const saved = { groups: [{ id: "team", name: "Team", match: "[team]", hidden: false }], boards: { [OTHERS[0].id]: { group: null }, [OTHERS[1].id]: { hidden: true } } };
  assert.deepEqual(groupsConfig(saved), saved, "a saved config is used as it is");
  assert.deepEqual(names(boardGroups(SAMPLE, groupsConfig(saved)).groups[0].boards), names(TEAM));
});

test("groupsConfig keeps what is usable and drops what is not: groups without an id or a name, repeated ids, boards entries that say nothing", () => {
  const saved = {
    groups: [
      { id: "a", name: " Alpha ", match: "  x  ", hidden: true }, { id: "a", name: "Again" }, { id: "", name: "No id" }, { name: "Nameless id" }, { id: "b", name: "  " },
      { id: "c", name: "Charlie", match: 5, hidden: "yes" }, null, 7,
    ],
    boards: { b1: { group: "a", hidden: true }, b2: { group: null }, b3: {}, b4: { hidden: false }, b5: { group: 7 }, b6: "x", b7: { hidden: true, other: 1 } },
  };
  assert.deepEqual(groupsConfig(saved), {
    groups: [{ id: "a", name: "Alpha", match: "x", hidden: true }, { id: "c", name: "Charlie", match: "", hidden: false }],
    boards: { b1: { group: "a", hidden: true }, b2: { group: null }, b7: { hidden: true } },
  });
  assert.deepEqual(groupsConfig({ groups: [], boards: [1, 2] }), { groups: [], boards: {} });
  assert.deepEqual(groupsConfig({ groups: [] }), { groups: [], boards: {} }, "no boards key");
});

test("groupOf: a group chosen for the board wins, null is no group, a group that is gone is Automatic; Automatic is the first group whose rule the name has, any case", () => {
  const cfg = { groups: [
    { id: "g1", name: "One", match: "[team]", hidden: false }, { id: "g2", name: "Two", match: "borealis", hidden: false }, { id: "g3", name: "Three", match: "", hidden: false },
  ], boards: {} };
  const board = (id, name) => ({ id, name });
  const tagged = board("a", "Support rota [team]"), doubleSpaced = board("k", "Borealis  survey [team]"), plain = board("p", "Roadmap");
  assert.equal(groupOf(tagged, cfg).id, "g1", "the rule");
  assert.equal(groupOf(doubleSpaced, cfg).id, "g1", "two rules fit: the first group in order");
  assert.equal(groupOf(board("k2", "BOREALIS notes"), cfg).id, "g2", "case does not matter, in the name or in the rule");
  assert.equal(groupOf(board("c", "field notes [TEAM]"), cfg).id, "g1");
  assert.equal(groupOf(plain, cfg), null, "no rule fits: no group");
  assert.equal(groupOf(board("e", ""), cfg), null);
  assert.equal(groupOf(board("u", undefined), cfg), null);
  assert.equal(groupOf(plain, { ...cfg, groups: [cfg.groups[2]] }), null, "a group with no rule takes nobody by itself");
  // Chosen:
  const chosen = { ...cfg, boards: { p: { group: "g3" }, a: { group: null }, k: { group: "gone" }, z: { group: "g2" } } };
  assert.equal(groupOf(plain, chosen).id, "g3", "put in a group that has no rule");
  assert.equal(groupOf(tagged, chosen), null, "No group on purpose, though the rule fits");
  assert.equal(groupOf(doubleSpaced, chosen).id, "g1", "the group chosen is gone: Automatic again");
  assert.equal(groupOf(board("z", "Roadmap"), chosen).id, "g2");
  assert.deepEqual(["p", "a", "k", "q"].map(id => choiceOf(id, chosen)), ["g3", null, "auto", "auto"]);
  assert.equal(choiceOf("p", { groups: [], boards: { p: { group: "g3" } } }), "auto");
  assert.equal(choiceOf("constructor", cfg), "auto", "an id that is a property of every object is no entry");
});

test("ruleGroupOf: the first group, in order, whose rule the name has, any case; a group with no rule takes nobody; no name, no group", () => {
  const cfg = { groups: [
    { id: "g1", name: "One", match: "[team]", hidden: false }, { id: "g2", name: "Two", match: "borealis", hidden: true }, { id: "g3", name: "Three", match: "", hidden: false },
  ], boards: { k: { group: null } } };
  assert.equal(ruleGroupOf({ id: "a", name: "Field notes [TEAM]" }, cfg).id, "g1");
  assert.equal(ruleGroupOf({ id: "k", name: "Borealis  survey [team]" }, cfg).id, "g1", "two rules fit: the first group in order, and a choice of No group is not looked at");
  assert.equal(ruleGroupOf({ id: "k2", name: "BOREALIS notes" }, cfg).id, "g2", "a hidden group still has its rule");
  assert.equal(ruleGroupOf({ id: "p", name: "Roadmap" }, cfg), null);
  assert.equal(ruleGroupOf({ id: "e", name: "" }, cfg), null);
  assert.equal(ruleGroupOf({ id: "u" }, cfg), null);
  assert.equal(ruleGroupOf(undefined, cfg), null);
  assert.equal(ruleGroupOf({ id: "a", name: "[team]" }, { groups: [], boards: {} }), null);
});

test("the sample boards: every [team] board is in Team by its rule, the double space and every letter case included", () => {
  assert.ok(TEAM.length > 1 && OTHERS.length > 1, "both kinds are in the sample");
  const { ungrouped, groups } = boardGroups(SAMPLE, CFG());
  assert.equal(groups.length, 1);
  assert.equal(groups[0].group.id, "team");
  assert.deepEqual(names(groups[0].boards), names(TEAM), "in the list's order");
  for (const name of ["Borealis  survey [team]", "Field notes [TEAM]", "Onboarding [Team]", "Acme billing [team]"]) assert.ok(names(groups[0].boards).includes(name), name);
  assert.deepEqual(names(ungrouped), names(OTHERS));
  for (const name of ["Roadmap", "Personal", "Kites + Gliders ", "Acme blog", "Website for Acme"]) assert.ok(names(ungrouped).includes(name), name);
});

test("boardGroups: the boards in the list's order, in their groups (which are in their own order); hidden boards and hidden groups are left out, withHidden leaves nothing out", () => {
  const boards = [{ id: "1", name: "Alpha" }, { id: "2", name: "[x] Beta" }, { id: "3", name: "[y] Gamma" }, { id: "4", name: "[x] Delta" }, { id: "5", name: "Epsilon" }];
  const cfg = { groups: [{ id: "gy", name: "Y", match: "[y]", hidden: false }, { id: "gx", name: "X", match: "[x]", hidden: false }], boards: {} };
  const ids = r => ({ u: r.ungrouped.map(b => b.id), g: r.groups.map(g => [g.group.id, g.boards.map(b => b.id)]) });
  assert.deepEqual(ids(boardGroups(boards, cfg)), { u: ["1", "5"], g: [["gy", ["3"]], ["gx", ["2", "4"]]] });
  // A board hidden by its own flag, wherever it is:
  const hideBeta = { ...cfg, boards: { 2: { hidden: true }, 5: { hidden: true } } };
  assert.deepEqual(ids(boardGroups(boards, hideBeta)), { u: ["1"], g: [["gy", ["3"]], ["gx", ["4"]]] });
  assert.deepEqual(ids(boardGroups(boards, hideBeta, { withHidden: true })), { u: ["1", "5"], g: [["gy", ["3"]], ["gx", ["2", "4"]]] });
  assert.deepEqual(boardGroups(boards, hideBeta, true), boardGroups(boards, hideBeta, { withHidden: true }), "a plain true is the flag too");
  assert.deepEqual(boardGroups(boards, hideBeta, false), boardGroups(boards, hideBeta));
  // A hidden group takes its boards with it, and is not listed:
  const hideX = { ...cfg, groups: [cfg.groups[0], { ...cfg.groups[1], hidden: true }] };
  assert.deepEqual(ids(boardGroups(boards, hideX)), { u: ["1", "5"], g: [["gy", ["3"]]] });
  assert.deepEqual(ids(boardGroups(boards, hideX, { withHidden: true })), { u: ["1", "5"], g: [["gy", ["3"]], ["gx", ["2", "4"]]] });
  // A board put in a hidden group by hand is hidden with it; one put out of it is not:
  const moved = { ...hideX, boards: { 1: { group: "gx" }, 2: { group: null } } };
  assert.deepEqual(ids(boardGroups(boards, moved)), { u: ["2", "5"], g: [["gy", ["3"]]] });
  // The board that is kept is never left out, and brings its group:
  assert.deepEqual(ids(boardGroups(boards, hideX, { keep: "4" })), { u: ["1", "5"], g: [["gy", ["3"]], ["gx", ["4"]]] }, "a hidden group, with only that board");
  assert.deepEqual(ids(boardGroups(boards, hideBeta, { keep: "2" })), { u: ["1"], g: [["gy", ["3"]], ["gx", ["2", "4"]]] }, "a hidden board");
  assert.deepEqual(ids(boardGroups(boards, hideBeta, { keep: "nope" })), ids(boardGroups(boards, hideBeta)));
  // Nothing: no boards, no groups.
  assert.deepEqual(boardGroups([], cfg), { ungrouped: [], groups: [{ group: cfg.groups[0], boards: [] }, { group: cfg.groups[1], boards: [] }] });
  assert.deepEqual(boardGroups(undefined, { groups: [], boards: {} }), { ungrouped: [], groups: [] });
  assert.deepEqual(ids(boardGroups(boards, { groups: [], boards: {} })), { u: ["1", "2", "3", "4", "5"], g: [] }, "no groups: every board is in none");
});

// A group added at the end, to set a config up in the order the tests read it (addGroup puts the new one first).
const append = (config, name) => {
  const added = addGroup(config, name);
  return { ...added, groups: [...added.groups.slice(1), added.groups[0]] };
};

test("addGroup: first, no rule, shown, with a trimmed name and an id no group has; an empty name is not taken", () => {
  const start = CFG(), once = addGroup(start, "  Work  ");
  assert.deepEqual(once.groups[0], { id: "g-2", name: "Work", match: "", hidden: false });
  assert.deepEqual(once.groups[1], start.groups[0]);
  assert.equal(start.groups.length, 1, "the config given is not changed");
  assert.notEqual(once, start);
  const twice = addGroup(once, "Later");
  assert.deepEqual(twice.groups.map(g => g.id), ["g-3", "g-2", "team"]);
  // An id in use is skipped, whatever the count.
  const odd = addGroup({ groups: [{ id: "g-2", name: "A", match: "", hidden: false }, { id: "g-3", name: "B", match: "", hidden: false }], boards: {} }, "C");
  assert.deepEqual(odd.groups.map(g => g.id), ["g-4", "g-2", "g-3"]);
  assert.equal(addGroup({ groups: [], boards: {} }, "First").groups[0].id, "g-1");
  const ids = new Set(); let cfg = CFG();
  for (let i = 0; i < 20; i++) cfg = addGroup(cfg, `G${i}`);
  for (const g of cfg.groups) ids.add(g.id);
  assert.equal(ids.size, 21, "ids stay unique");
  for (const name of ["", "   ", undefined, null, "\n\t"]) assert.equal(addGroup(start, name), start, JSON.stringify(name));
});

test("renameGroup and setMatch: trimmed; an empty name is refused (an empty rule is no rule); a group that is not there changes nothing", () => {
  const start = append(CFG(), "Work");
  const renamed = renameGroup(start, "g-2", "  Renamed ");
  assert.equal(renamed.groups[1].name, "Renamed");
  assert.equal(start.groups[1].name, "Work", "not changed in place");
  assert.equal(renameGroup(start, "g-2", "   "), start);
  assert.equal(renameGroup(start, "g-2", ""), start);
  assert.equal(renameGroup(start, "nope", "X"), start);
  const rule = setMatch(start, "g-2", "  [lab] ");
  assert.equal(rule.groups[1].match, "[lab]");
  assert.equal(start.groups[1].match, "");
  assert.equal(setMatch(rule, "g-2", "  ").groups[1].match, "", "empty: no rule");
  assert.equal(setMatch(rule, "g-2", undefined).groups[1].match, "");
  assert.equal(setMatch(start, "nope", "x"), start);
  assert.deepEqual(rule.groups[0], start.groups[0], "the other groups are as they were");
});

test("setGroupHidden and setBoardHidden: a flag on a group, a flag on a board (shown takes it away, and an entry with nothing left goes)", () => {
  const start = CFG();
  const hidden = setGroupHidden(start, "team", true);
  assert.equal(hidden.groups[0].hidden, true);
  assert.equal(start.groups[0].hidden, false);
  assert.equal(setGroupHidden(hidden, "team", false).groups[0].hidden, false);
  assert.equal(setGroupHidden(start, "nope", true), start);
  const b = setBoardHidden(start, "b1", true);
  assert.deepEqual(b.boards, { b1: { hidden: true } });
  assert.equal(ownHidden("b1", b), true);
  assert.equal(ownHidden("b2", b), false);
  assert.deepEqual(start.boards, {});
  assert.deepEqual(setBoardHidden(b, "b1", false).boards, {}, "nothing left of the entry");
  const both = setBoardHidden(moveBoard(start, "b1", null), "b1", true);
  assert.deepEqual(both.boards, { b1: { group: null, hidden: true } });
  assert.deepEqual(setBoardHidden(both, "b1", false).boards, { b1: { group: null } }, "the group choice stays");
  assert.deepEqual(setBoardHidden(start, "b1", false).boards, {}, "showing what is shown adds nothing");
});

test("moveBoard: to a group, to no group (null), or back to Automatic; a group that is not there changes nothing; hiding is kept", () => {
  const start = append(CFG(), "Work");
  const inGroup = moveBoard(start, "b1", "g-2");
  assert.deepEqual(inGroup.boards, { b1: { group: "g-2" } });
  assert.deepEqual(start.boards, {});
  assert.deepEqual(moveBoard(inGroup, "b1", null).boards, { b1: { group: null } });
  assert.deepEqual(moveBoard(inGroup, "b1", "team").boards, { b1: { group: "team" } });
  assert.deepEqual(moveBoard(inGroup, "b1", "auto").boards, {}, "auto takes the choice away");
  assert.deepEqual(moveBoard(setBoardHidden(inGroup, "b1", true), "b1", "auto").boards, { b1: { hidden: true } }, "and leaves the flag");
  assert.deepEqual(moveBoard(start, "b1", "auto").boards, {}, "auto on a board with no choice");
  for (const to of ["nope", undefined, 5, {}]) assert.equal(moveBoard(start, "b1", to), start, String(to));
});

test("placeBoard: Automatic exactly when the target is the group the board's name picks (none included); otherwise chosen; the hidden flag stays; a gone group changes nothing; nothing is mutated", () => {
  const start = append(CFG(), "By hand");
  const tagged = { id: "c", name: "Field notes [TEAM]" }, plain = { id: "p", name: "Roadmap" };
  const frozen = JSON.stringify(start);
  // Where the rule would put it anyway.
  assert.deepEqual(placeBoard(start, tagged, "team").boards, {}, "a [team] board into Team");
  assert.deepEqual(placeBoard(start, plain, null).boards, {}, "a board no rule picks, into no group");
  assert.deepEqual(placeBoard(moveBoard(start, "c", "g-2"), tagged, "team").boards, {}, "back where its name puts it: Automatic again");
  assert.deepEqual(placeBoard(moveBoard(start, "p", "g-2"), plain, null).boards, {});
  // Anywhere else it is chosen.
  assert.deepEqual(placeBoard(start, plain, "team").boards, { p: { group: "team" } });
  assert.deepEqual(placeBoard(start, plain, "g-2").boards, { p: { group: "g-2" } });
  assert.deepEqual(placeBoard(start, tagged, null).boards, { c: { group: null } }, "out of the group its name picks");
  assert.deepEqual(placeBoard(start, tagged, "g-2").boards, { c: { group: "g-2" } });
  // The hidden flag is kept, and an entry with nothing left goes.
  assert.deepEqual(placeBoard(setBoardHidden(start, "p", true), plain, "g-2").boards, { p: { hidden: true, group: "g-2" } });
  assert.deepEqual(placeBoard(setBoardHidden(moveBoard(start, "c", null), "c", true), tagged, "team").boards, { c: { hidden: true } });
  // The rule is the first group that fits, in order.
  const two = { ...start, groups: [{ id: "x", name: "X", match: "[team]", hidden: false }, ...start.groups] };
  assert.deepEqual(placeBoard(two, tagged, "x").boards, {});
  assert.deepEqual(placeBoard(two, tagged, "team").boards, { c: { group: "team" } }, "the second group that fits is a choice");
  // A group that is gone.
  assert.equal(placeBoard(start, plain, "nope"), start);
  assert.equal(placeBoard(start, tagged, "nope"), start);
  assert.equal(JSON.stringify(start), frozen, "the config given is never changed");
});

test("moveGroup: a group takes the target's place (before it when moving up, after it when moving down); unknown or the same id change nothing; nothing is mutated", () => {
  const start = append(append(append(CFG(), "B"), "C"), "D"), order = cfg => cfg.groups.map(g => g.id);
  assert.deepEqual(order(start), ["team", "g-2", "g-3", "g-4"]);
  const frozen = JSON.stringify(start);
  assert.deepEqual(order(moveGroup(start, "g-3", "g-2")), ["team", "g-3", "g-2", "g-4"], "up one");
  assert.deepEqual(order(moveGroup(start, "g-4", "team")), ["g-4", "team", "g-2", "g-3"], "up to the first");
  assert.deepEqual(order(moveGroup(start, "g-4", "g-2")), ["team", "g-4", "g-2", "g-3"], "up, over one more");
  assert.deepEqual(order(moveGroup(start, "g-2", "g-3")), ["team", "g-3", "g-2", "g-4"], "down one");
  assert.deepEqual(order(moveGroup(start, "team", "g-4")), ["g-2", "g-3", "g-4", "team"], "down to the last");
  assert.deepEqual(order(moveGroup(start, "team", "g-3")), ["g-2", "g-3", "team", "g-4"], "down, past one");
  assert.equal(moveGroup(start, "g-2", "g-2"), start, "the same id");
  assert.equal(moveGroup(start, "nope", "g-2"), start, "an unknown group");
  assert.equal(moveGroup(start, "g-2", "nope"), start, "an unknown target");
  assert.equal(moveGroup(start, "nope", "nope"), start);
  assert.equal(moveGroup(start, undefined, "g-2"), start);
  assert.equal(JSON.stringify(start), frozen, "the config given is never changed");
  const moved = moveGroup(start, "g-4", "team");
  assert.notEqual(moved, start);
  assert.notEqual(moved.groups, start.groups);
  assert.deepEqual(moved.groups.map(g => g.name), ["D", "Team", "B", "C"], "each group is as it was");
  assert.deepEqual(moved.boards, start.boards);
  const placed = moveBoard(start, "b1", "g-3");
  assert.deepEqual(moveGroup(placed, "g-3", "team").boards, { b1: { group: "g-3" } }, "boards put in it stay with it");
  assert.deepEqual(moveGroup({ groups: [], boards: {} }, "a", "b"), { groups: [], boards: {} });
});

test("removeGroup: the group goes, and the boards that were put in it by hand go back to Automatic (their other flags stay)", () => {
  let cfg = append(append(CFG(), "Work"), "Later");
  cfg = moveBoard(cfg, "b1", "g-2"); cfg = moveBoard(cfg, "b2", "g-2"); cfg = setBoardHidden(cfg, "b2", true);
  cfg = moveBoard(cfg, "b3", "g-3"); cfg = moveBoard(cfg, "b4", null);
  const next = removeGroup(cfg, "g-2");
  assert.deepEqual(next.groups.map(g => g.id), ["team", "g-3"]);
  assert.deepEqual(next.boards, { b2: { hidden: true }, b3: { group: "g-3" }, b4: { group: null } });
  assert.equal(cfg.groups.length, 3, "the config given is not changed");
  assert.deepEqual(cfg.boards.b1, { group: "g-2" });
  assert.equal(removeGroup(cfg, "nope"), cfg);
  assert.deepEqual(removeGroup(next, "team").groups.map(g => g.id), ["g-3"]);
  assert.deepEqual(removeGroup(removeGroup(removeGroup(cfg, "g-2"), "g-3"), "team"), { groups: [], boards: { b2: { hidden: true }, b4: { group: null } } });
  assert.deepEqual(boardGroups([{ id: "b1", name: "A [Team]" }], next), { ungrouped: [], groups: [{ group: next.groups[0], boards: [{ id: "b1", name: "A [Team]" }] }, { group: next.groups[1], boards: [] }] }, "b1 is where its name puts it");
});

test("boards menu with groups: the ungrouped boards first, then each group with a board as a label and its boards", () => {
  const current = OTHERS[0].id;
  const rows = menuRows({ kind: "boards", current, follow: false, spaceBoard: null }, { boards: SAMPLE, groups: CFG() });
  const board = rows.filter(r => r.id.startsWith("board-"));
  assert.equal(board.length, SAMPLE.length, "every board once");
  assert.deepEqual(ids(rows).slice(0, 2), ["follow", "sep-follow"]);
  const label = rows.findIndex(r => r.type === "label");
  assert.equal(rows[label].label, "Team");
  assert.equal(rows[label].id, "group-team");
  assert.deepEqual(rows.slice(2, label).map(r => r.label), names(OTHERS), "the ungrouped, in the list's order");
  assert.deepEqual(rows.slice(label + 1, label + 1 + TEAM.length).map(r => r.label), names(TEAM), "then the team boards");
  assert.equal(rows.at(-1).id, `board-${TEAM.at(-1).id}`, "the last team board ends the list");
  assert.equal(rows.filter(r => r.type === "label").length, 1);
  assert.equal(rows.length, 2 + OTHERS.length + 1 + TEAM.length);
  assert.deepEqual(rows[2].act, { choose: { follow: false, board: current } }, "a board still chooses it");
  assert.equal(rows[2].checked, true, "the tick is on the current board");
  unique(rows);
  for (const r of rows) for (const k of Object.keys(r)) assert.notEqual(r[k], undefined, `${r.id}: ${k}`);
});

test("boards menu with groups: several groups in their order, the ones with no visible board left out; hidden boards and groups are not listed, the current board always is", () => {
  const boards = [{ id: "1", name: "Alpha" }, { id: "2", name: "[x] Beta" }, { id: "3", name: "[y] Gamma" }, { id: "4", name: "[x] Delta" }];
  const groups = { groups: [{ id: "gy", name: "Y", match: "[y]", hidden: false }, { id: "gx", name: "X", match: "[x]", hidden: false }, { id: "gz", name: "Z", match: "[z]", hidden: false }], boards: {} };
  const rows = (cfg, current = null, more = {}) => menuRows({ kind: "boards", current, follow: true, spaceBoard: null, ...more }, { boards, groups: cfg });
  const shape = list => list.map(r => (r.type === "label" ? `# ${r.label}` : r.type === "row" ? r.label : r.type));
  assert.deepEqual(shape(rows(groups)), ["Follow current space", "sep", "Alpha", "# Y", "[y] Gamma", "# X", "[x] Beta", "[x] Delta"], "Z has no board: no label");
  const hiddenBoard = { ...groups, boards: { 1: { hidden: true }, 2: { hidden: true } } };
  assert.deepEqual(shape(rows(hiddenBoard)), ["Follow current space", "sep", "# Y", "[y] Gamma", "# X", "[x] Delta"]);
  const hiddenGroup = { ...groups, groups: [groups.groups[0], { ...groups.groups[1], hidden: true }, groups.groups[2]] };
  assert.deepEqual(shape(rows(hiddenGroup)), ["Follow current space", "sep", "Alpha", "# Y", "[y] Gamma"]);
  assert.deepEqual(shape(rows(hiddenGroup, "2")), ["Follow current space", "sep", "Alpha", "# Y", "[y] Gamma", "# X", "[x] Beta"], "the current board stays, with its group");
  assert.deepEqual(shape(rows(hiddenBoard, "1")), ["Follow current space", "sep", "Alpha", "# Y", "[y] Gamma", "# X", "[x] Delta"]);
  const current = rows(hiddenBoard, "1", { follow: false }).find(r => r.id === "board-1");
  assert.equal(current.checked, true, "and it is ticked");
  // Everything hidden: only the follow row.
  const none = { groups: groups.groups.map(g => ({ ...g, hidden: true })), boards: { 1: { hidden: true } } };
  assert.deepEqual(shape(rows(none)), ["Follow current space", "sep"]);
  assert.equal(rows(none).some(r => r.id === "boards-note"), false, "there are boards, only hidden");
  // Without saved groups there are no labels: the boards in the list's order. A saved group is used.
  const tagged = [{ id: "1", name: "A [Team]" }, { id: "2", name: "B" }];
  assert.deepEqual(shape(menuRows({ kind: "boards", current: null, follow: true }, { boards: tagged })), ["Follow current space", "sep", "A [Team]", "B"]);
  assert.deepEqual(shape(menuRows({ kind: "boards", current: null, follow: true }, { boards: tagged, groups: { groups: [], boards: {} } })), ["Follow current space", "sep", "A [Team]", "B"]);
  assert.deepEqual(shape(menuRows({ kind: "boards", current: null, follow: true }, { boards: tagged, groups: CFG() })), ["Follow current space", "sep", "B", "# Team", "A [Team]"]);
  // Anything saved that is not a config is the default.
  assert.deepEqual(ids(menuRows({ kind: "boards" }, { boards: tagged, groups: "junk" })), ["follow", "sep-follow", "board-1", "board-2"]);
});

test("new card menu: a label, then the boards as the boards menu groups them; no Follow row; each board row chooses it with the composer", () => {
  const rows = menuRows({ kind: "newCard", current: "b2" }, { boards: BOARDS });
  assert.deepEqual(ids(rows), ["new-label", "board-b1", "board-b2", "board-b3"]);
  assert.deepEqual(rows.map(r => r.type), ["label", "row", "row", "row"]);
  assert.equal(rows[0].label, "New card on");
  assert.deepEqual(rows.slice(1).map(r => r.label), ["Roadmap", "Personal", "Acme"]);
  assert.deepEqual(rows.slice(1).map(r => r.checked), [false, true, false], "the board shown is ticked");
  assert.deepEqual(byId(rows, "board-b1").act, { choose: { follow: false, board: "b1", compose: true } });
  assert.deepEqual(byId(rows, "board-b3").act, { choose: { follow: false, board: "b3", compose: true } });
  assert.equal(byId(rows, "follow"), undefined);
  unique(rows);
  assert.deepEqual(selectable(menuRows({ kind: "newCard", current: null }, { boards: BOARDS })).map(r => r.checked), [false, false, false], "no board shown: none ticked");

  assert.deepEqual(ids(menuRows({ kind: "newCard", current: null }, { boards: [] })), ["new-label", "boards-note"]);
  assert.equal(menuRows({ kind: "newCard", current: null }, {})[1].label, "No boards");
  assert.doesNotThrow(() => menuRows({ kind: "newCard" }));
});

test("new card menu with groups: the same grouping as the boards menu, hidden boards and groups left out, the board shown always listed", () => {
  const boards = [{ id: "1", name: "Alpha" }, { id: "2", name: "[x] Beta" }, { id: "3", name: "[y] Gamma" }, { id: "4", name: "[x] Delta" }];
  const groups = { groups: [{ id: "gy", name: "Y", match: "[y]", hidden: false }, { id: "gx", name: "X", match: "[x]", hidden: false }], boards: {} };
  const shape = list => list.map(r => (r.type === "label" ? `# ${r.label}` : r.type === "row" ? r.label : r.type));
  const newCard = (cfg, current = null) => menuRows({ kind: "newCard", current }, { boards, groups: cfg });
  const boardsMenu = (cfg, current = null) => menuRows({ kind: "boards", current, follow: true, spaceBoard: null }, { boards, groups: cfg });
  assert.deepEqual(shape(newCard(groups)), ["# New card on", "Alpha", "# Y", "[y] Gamma", "# X", "[x] Beta", "[x] Delta"]);
  const hiddenBoard = { ...groups, boards: { 1: { hidden: true }, 2: { hidden: true } } };
  assert.deepEqual(shape(newCard(hiddenBoard)), ["# New card on", "# Y", "[y] Gamma", "# X", "[x] Delta"]);
  assert.deepEqual(shape(newCard(hiddenBoard, "2")), ["# New card on", "# Y", "[y] Gamma", "# X", "[x] Beta", "[x] Delta"], "the board shown stays, with its group");
  assert.equal(newCard(hiddenBoard, "2").find(r => r.id === "board-2").checked, true);
  const hiddenGroup = { ...groups, groups: [groups.groups[0], { ...groups.groups[1], hidden: true }] };
  assert.deepEqual(shape(newCard(hiddenGroup)), ["# New card on", "Alpha", "# Y", "[y] Gamma"]);
  const all = { groups: groups.groups.map(g => ({ ...g, hidden: true })), boards: { 1: { hidden: true } } };
  assert.deepEqual(shape(newCard(all)), ["# New card on"], "everything hidden: the label alone, and no 'No boards' note");
  for (const cfg of [groups, hiddenBoard, hiddenGroup]) {
    assert.deepEqual(ids(newCard(cfg)).slice(1), ids(boardsMenu(cfg)).slice(2), "the boards menu's rows, without Follow and its separator");
  }
});

test("card menu: the hand-off rows first, then the lanes, then everything else", () => {
  const c = card(4242, { title: "Fix the login redirect", column: C1, assignees: [user("u2", "Grace")], tags: ["bug"] });
  const rows = menuRows({ kind: "card", card: c, columns: COLUMNS }, { agents: [claude, codex], focused: { terminal: "term-claude", tab: "t1" }, me: "me", boards: BOARDS });
  assert.deepEqual(ids(rows), [
    "insert", "send", "start", "copy-ref", "copy-link", "sep-hand", "move-label",
    "lane-not-now", "lane-maybe", "lane-c1", "lane-c2", "lane-done", "sep-move",
    "self-assign", "assign", "tags", "pin", "unpin", "watch", "unwatch", "golden", "move-board", "open", "sep-danger", "delete",
  ]);
  unique(rows);
  assert.deepEqual(rows.filter(r => r.type !== "row").map(r => [r.id, r.type]), [["sep-hand", "sep"], ["move-label", "label"], ["sep-move", "sep"], ["sep-danger", "sep"]]);
  assert.equal(byId(rows, "move-label").label, "Move to");

  const insert = byId(rows, "insert");
  assert.equal(insert.label, "Insert in chat");
  assert.equal(insert.hint, "Claude Code · fix login");
  assert.deepEqual(insert.act, { insert: 'Fizzy #4242 "Fix the login redirect" (https://app.fizzy.do/111/cards/4242)' });
  assert.deepEqual(byId(rows, "send").act, { menu: { kind: "agents", cards: [c] } });
  assert.equal(byId(rows, "send").label, "Send to session…");
  assert.deepEqual(byId(rows, "start").act, { menu: { kind: "start", cards: [c] } });
  assert.equal(byId(rows, "start").label, "Start new session…");
  assert.equal(byId(rows, "copy-ref").label, "Copy reference");
  assert.equal(byId(rows, "copy-link").label, "Copy link");
  assert.deepEqual(rows.slice(0, 5).map(r => Object.keys(r.act)[0]), ["insert", "menu", "menu", "copy", "copy"], "no hand-off row submits: they paste, open a menu or copy");
  assert.deepEqual(byId(rows, "copy-ref").act, { copy: ref(c) });
  assert.deepEqual(byId(rows, "copy-link").act, { copy: "https://app.fizzy.do/111/cards/4242" });
  assert.deepEqual(byId(rows, "assign").act, { menu: { kind: "users", card: c } });
  assert.deepEqual(byId(rows, "tags").act, { menu: { kind: "tags", card: c } });
  assert.deepEqual(byId(rows, "move-board").act, { menu: { kind: "moveBoard", card: c } });
  assert.deepEqual(byId(rows, "open").act, { open: "https://app.fizzy.do/111/cards/4242" });
  assert.deepEqual(byId(rows, "self-assign").act, { request: { kind: "selfAssign", number: 4242 } });
  assert.deepEqual(byId(rows, "pin").act, { request: { kind: "pin", number: 4242, on: true } });
  assert.deepEqual(byId(rows, "unpin").act, { request: { kind: "pin", number: 4242, on: false } });
  assert.deepEqual(byId(rows, "watch").act, { request: { kind: "watch", number: 4242, on: true } });
  assert.deepEqual(byId(rows, "unwatch").act, { request: { kind: "watch", number: 4242, on: false } });
  assert.deepEqual(byId(rows, "golden").act, { request: { kind: "golden", number: 4242, on: true } });
  assert.deepEqual(byId(rows, "delete").act, { arm: "delete" });
  assert.equal(byId(rows, "delete").label, "Delete card…");
  assert.ok(!("danger" in byId(rows, "delete")), "not armed: not shown as danger");
  assert.ok(!ids(rows).includes("reopen"), "an open card has nothing to reopen");
});

test("card menu: Pin and Unpin, Watch and Unwatch show one verb when the state is known and both when it is not", () => {
  const base = { kind: "card", columns: COLUMNS, card: card(1) };
  const shown = menu => ids(menuRows({ ...base, ...menu }, {})).filter(id => ["pin", "unpin", "watch", "unwatch"].includes(id));
  assert.deepEqual(shown({}), ["pin", "unpin", "watch", "unwatch"], "nothing known: both verbs of each");
  assert.deepEqual(shown({ pinned: true }), ["unpin", "watch", "unwatch"]);
  assert.deepEqual(shown({ pinned: false }), ["pin", "watch", "unwatch"]);
  assert.deepEqual(shown({ watching: true }), ["pin", "unpin", "unwatch"]);
  assert.deepEqual(shown({ watching: false }), ["pin", "unpin", "watch"]);
  assert.deepEqual(shown({ pinned: true, watching: false }), ["unpin", "watch"]);
  assert.deepEqual(shown({ card: card(1, { pinned: true }) }), ["pin", "unpin", "watch", "unwatch"], "the card's own pinned field is not read");
  const rows = menuRows({ ...base, pinned: true, watching: true }, {});
  assert.deepEqual([byId(rows, "unpin").label, byId(rows, "unpin").icon, byId(rows, "unpin").act], ["Unpin", "mods/fizzy/pin-off.svg", { request: { kind: "pin", number: 1, on: false } }]);
  assert.deepEqual([byId(rows, "unwatch").label, byId(rows, "unwatch").icon, byId(rows, "unwatch").act], ["Unwatch", "mods/fizzy/eye-off.svg", { request: { kind: "watch", number: 1, on: false } }]);
  const off = menuRows({ ...base, pinned: false, watching: false }, {});
  assert.deepEqual([byId(off, "pin").label, byId(off, "pin").icon, byId(off, "watch").label, byId(off, "watch").icon], ["Pin", "mods/fizzy/pin.svg", "Watch", "mods/fizzy/eye.svg"]);
});

test("card menu: Reopen is a row of a closed card only, right after the hand-off rows", () => {
  const closed = menuRows({ kind: "card", columns: COLUMNS, card: card(105, { closed: true, column: C1 }) }, {});
  assert.equal(ids(closed)[ids(closed).indexOf("sep-hand") + 1], "reopen");
  const reopen = byId(closed, "reopen");
  assert.deepEqual([reopen.label, reopen.icon, reopen.act], ["Reopen", "mods/fizzy/rotate-ccw.svg", { request: { kind: "reopen", number: 105 } }]);
  assert.ok(byId(closed, "lane-done").checked, "Move to › Done is checked");
  assert.ok(!ids(menuRows({ kind: "card", columns: COLUMNS, card: card(105, { postponed: true }) }, {})).includes("reopen"), "a postponed card is not closed");
  unique(closed);
});

test("formatted: whether saving as plain paragraphs would lose something", () => {
  for (const html of [
    '<div class="action-text-content"><p>The spinner <b>hangs</b>.</p></div>', '<a href="x">x</a>', "<pre>x</pre>", "<P>a <I>b</I></P>",
    "<h3>T</h3><ul><li>a</li></ul>", "<ul><li>a <b>b</b></li></ul>", '<ul><li><a href="x">x</a></li></ul>', "<ul><li><code>c</code></li></ul>",
    "<blockquote>q</blockquote>", "<ul><li>a<ul><li>b</li></ul></li></ul>", "<ol><li>a<ol><li>b</li></ol></li></ol>", "<li>a<br><ul><li>b</li></ul></li>",
  ]) assert.equal(formatted(html), true, html);
  for (const html of [
    "", null, undefined, "<p>a</p><p>b<br>c</p>", "<div>x</div>", "<div><p>plain &lt;b&gt;</p></div>", "<p>a<br/>b</p>",
    "<ul><li>a</li></ul>", "<ul><li>a</li><li>b</li></ul>", "<OL><LI>a</LI></OL>", '<div class="action-text-content"><p>Intro</p><ul><li>a<br>b</li><li>c</li></ul></div>',
    "<ul><li>a</li></ul><ul><li>b</li></ul>", "<ul><li><p>a</p><p>b</p></li></ul>",
  ]) assert.equal(formatted(html), false, String(html));
  assert.equal(formatted(textToHtml("one\n\ntwo\nthree <b>")), false, "what the panel writes itself never warns");
  assert.equal(formatted(textToHtml("intro\n- a\n- b <i>\n\nend")), false, "nor does its lists");
});

test("card menu: Move to lists every lane in the column list's order, checks the current one, and moves by request", () => {
  const c = card(4242, { column: C2 });
  const rows = menuRows({ kind: "card", card: c, columns: COLUMNS }, {});
  const lane = rows.filter(r => r.id.startsWith("lane-"));
  assert.deepEqual(lane.map(r => r.label), ["Not Now", "Maybe?", "In progress", "Review", "Done"]);
  assert.deepEqual(lane.map(r => r.checked), [false, false, false, true, false]);
  assert.deepEqual(lane.map(r => r.act), ["not-now", "maybe", "c1", "c2", "done"].map(target => ({ request: { kind: "move", number: 4242, target } })));
  assert.equal(byId(rows, "lane-c1").color, colorOf(C1));
  assert.ok(!("color" in byId(rows, "lane-maybe")), "no color: no key");
  // Each lane the card can be in is the one that is checked.
  for (const [extra, lane] of [[{ postponed: true }, "lane-not-now"], [{ closed: true, column: C1 }, "lane-done"], [{}, "lane-maybe"], [{ column: C1 }, "lane-c1"]]) {
    const r = menuRows({ kind: "card", card: card(1, extra), columns: COLUMNS }, {});
    assert.deepEqual(r.filter(x => x.checked).map(x => x.id), [lane], JSON.stringify(extra));
  }
  // Columns not loaded yet: the three pseudo lanes are still offered.
  assert.deepEqual(menuRows({ kind: "card", card: c }, {}).filter(r => r.id.startsWith("lane-")).map(r => r.id), ["lane-maybe", "lane-not-now", "lane-done"]);
});

test("card menu: labels follow what is known about the card", () => {
  const base = { kind: "card", columns: COLUMNS };
  // Assign: "Unassign me" only when I am among the assignees.
  assert.equal(byId(menuRows({ ...base, card: card(1, { assignees: [user("u2", "Grace")] }) }, { me: "me" }), "self-assign").label, "Assign to me");
  assert.equal(byId(menuRows({ ...base, card: card(1, { assignees: [user("me", "Ada")] }) }, { me: "me" }), "self-assign").label, "Unassign me");
  assert.equal(byId(menuRows({ ...base, card: card(1, { assignees: [user("me", "Ada")] }) }, { me: { id: "me" } }), "self-assign").label, "Unassign me");
  assert.equal(byId(menuRows({ ...base, card: card(1, { assignees: [user("me", "Ada")] }) }, {}), "self-assign").label, "Assign to me", "me unknown");
  assert.deepEqual(byId(menuRows({ ...base, card: card(1) }, {}), "self-assign").act, { request: { kind: "selfAssign", number: 1 } }, "either way it is the toggle");
  // Golden.
  const plain = byId(menuRows({ ...base, card: card(1) }, {}), "golden");
  assert.equal(plain.label, "Mark golden");
  assert.deepEqual(plain.act, { request: { kind: "golden", number: 1, on: true } });
  const gold = byId(menuRows({ ...base, card: card(1, { golden: true }) }, {}), "golden");
  assert.equal(gold.label, "Remove golden");
  assert.equal(gold.icon, "mods/fizzy/star-off.svg");
  assert.equal(plain.icon, "mods/fizzy/star.svg");
  assert.deepEqual(gold.act, { request: { kind: "golden", number: 1, on: false } });
  // Insert's hint: who gets it, or "copies".
  assert.equal(byId(menuRows({ ...base, card: card(1) }, { agents: [], focused: { terminal: "x", tab: "t1" } }), "insert").hint, "copies");
  assert.equal(byId(menuRows({ ...base, card: card(1) }, {}), "insert").hint, "copies");
  assert.equal(byId(menuRows({ ...base, card: card(1) }, { agents: [codex, claude], focused: { terminal: "shell", tab: "t2" } }), "insert").hint, "Codex · tests", "the tab's agent");
  // No link: the link rows are left out rather than doing nothing.
  const bare = ids(menuRows({ ...base, card: card(1, { url: undefined }) }, {}));
  assert.ok(!bare.includes("copy-link") && !bare.includes("open"));
  assert.ok(bare.includes("copy-ref"));
});

test("card menu: delete is two steps — the armed row says so, is danger, and removes", () => {
  const c = card(4242);
  const armed = menuRows({ kind: "card", card: c, columns: COLUMNS }, { armed: "delete" });
  const del = byId(armed, "delete");
  assert.equal(del.label, "Click again to delete #4242");
  assert.equal(del.danger, true);
  assert.deepEqual(del.act, { request: { kind: "remove", number: 4242 } });
  assert.equal(armed.at(-1), del, "still the last row");
  // Same rows otherwise; another armed id arms nothing.
  assert.deepEqual(ids(armed), ids(menuRows({ kind: "card", card: c, columns: COLUMNS }, {})));
  assert.equal(byId(menuRows({ kind: "card", card: c, columns: COLUMNS }, { armed: "something-else" }), "delete").label, "Delete card…");
  assert.equal(byId(menuRows({ kind: "card", card: c, columns: COLUMNS }, { armed: null }), "delete").act.arm, "delete");
  // The id an `arm` act names is the row that becomes armed.
  assert.equal(byId(menuRows({ kind: "card", card: c, columns: COLUMNS }, {}), "delete").act.arm, "delete");
});

test("lanes menu: just the lanes, as moves", () => {
  const c = card(77, { column: C1 });
  const rows = menuRows({ kind: "lanes", card: c, columns: COLUMNS }, {});
  assert.deepEqual(ids(rows), ["lane-not-now", "lane-maybe", "lane-c1", "lane-c2", "lane-done"]);
  assert.ok(rows.every(r => r.type === "row" && r.icon === null));
  assert.deepEqual(rows.map(r => r.checked), [false, false, true, false, false]);
  assert.deepEqual(byId(rows, "lane-c2").act, { request: { kind: "move", number: 77, target: "c2" } });
  assert.deepEqual(byId(rows, "lane-done").act, { request: { kind: "move", number: 77, target: "done" } });
  assert.equal(byId(rows, "lane-c1").color, colorOf(C1));
});

test("agents menu: one row per running session, the Insert target first, each pastes the reference (never submitted)", () => {
  const cards = [card(4242, { title: "Fix it", column: C1 })];
  const text = refs(cards);
  const third = agent("term-third", { tab: "t3", tab_name: "", program: undefined, app: null, status: "idle", seq: 1, space_name: "" });
  const rows = menuRows({ kind: "agents", cards }, { agents: [codex, claude, third], focused: { terminal: "term-claude", tab: "t1" } });
  assert.deepEqual(ids(rows), ["agent-term-claude", "agent-term-codex", "agent-term-third"], "the current target first, the rest as listed");
  assert.deepEqual(rows.map(r => r.label), ["Claude Code · fix login", "Codex · tests", "Agent"]);
  assert.deepEqual(rows.map(r => r.hint), ["work · working", "other · blocked", "idle"], "space name · status; just the status when the space has no name");
  assert.deepEqual(rows.map(r => r.icon), ["icons/claude.svg", "icons/codex.svg", null]);
  assert.equal(byId(rows, "agent-term-codex").agent, codex.program, "the program, so the caller can tint the icon");
  assert.ok(!("agent" in byId(rows, "agent-term-third")));
  assert.deepEqual(byId(rows, "agent-term-codex").act, { paste: { address: "term-codex", text } });
  assert.ok(rows.every(r => r.type === "row" && r.act.paste.text === text));
  assert.equal(text, 'Fizzy #4242 "Fix it" (https://app.fizzy.do/111/cards/4242)', "the one-line reference");
  unique(rows);
  // No target (a shell in another tab): the order as listed.
  assert.deepEqual(ids(menuRows({ kind: "agents", cards }, { agents: [codex, claude], focused: { terminal: "shell", tab: "tZ" } })), ["agent-term-codex", "agent-term-claude"]);
  assert.deepEqual(ids(menuRows({ kind: "agents", cards }, { agents: [codex, claude] })), ["agent-term-codex", "agent-term-claude"]);
  // Several cards: one reference per line.
  const many = [card(1), card(2)];
  assert.equal(menuRows({ kind: "agents", cards: many }, { agents: [claude] })[0].act.paste.text, refs(many));
  assert.equal(refs(many).split("\n").length, 2);
});

test("agentHint: the space's name, then the status; whichever is there", () => {
  assert.equal(agentHint(claude), "work · working");
  assert.equal(agentHint(codex), "other · blocked");
  assert.equal(agentHint({ status: "idle" }), "idle");
  assert.equal(agentHint({ space_name: "work" }), "work");
  assert.equal(agentHint({}), "");
  assert.equal(agentHint(undefined), "");
});

test("the start wait is 30 s and the ready wait 3 s", () => {
  assert.deepEqual([START_WAIT, READY_WAIT], [30000, 3000]);
});

test("the card menu's Insert row hints at the agent it goes to when the panel says (`to`), else at the agent in view", () => {
  const ctx = { agents: [claude, codex], focused: { terminal: "term-claude", tab: "t1" } };
  assert.equal(byId(menuRows({ kind: "card", card: card(1), columns: COLUMNS }, ctx), "insert").hint, "Claude Code · fix login");
  assert.equal(byId(menuRows({ kind: "card", card: card(1), columns: COLUMNS, to: "Codex · tests" }, ctx), "insert").hint, "Codex · tests", "what the panel said");
  assert.equal(byId(menuRows({ kind: "card", card: card(1), columns: COLUMNS, to: null }, ctx), "insert").hint, "copies", "no agent here: it copies");
});

test("agents menu with nobody running says so", () => {
  for (const ctx of [{ agents: [] }, {}]) {
    const rows = menuRows({ kind: "agents", cards: [card(1)] }, ctx);
    assert.deepEqual(rows.map(r => [r.type, r.id, r.label]), [["note", "agents-note", "No agents running"]]);
  }
});

test("start menu: the installed known agents (at most 6), each opens a tab named after the card and gets the reference pasted (no task)", () => {
  const cards = [card(4242, { title: "Fix the login redirect", column: C1 }), card(4243)];
  const known = [
    { key: "claude", name: "Claude Code", icon: "icons/claude.svg", tint: false, run: ["claude"], installed: true },
    { key: "codex", name: "Codex", icon: "icons/codex.svg", tint: true, run: ["codex", "--flag"], installed: true },
    { key: "pi", name: "Pi", icon: null, tint: true, run: ["pi"], installed: false },
    ...["a", "b", "c", "d", "e", "f"].map(n => ({ key: n, name: n.toUpperCase(), icon: `icons/${n}.svg`, tint: true, run: [n], installed: true })),
  ];
  const rows = menuRows({ kind: "start", cards }, { known });
  assert.equal(rows.length, 6, "at most six");
  assert.deepEqual(rows.map(r => r.label), ["Claude Code", "Codex", "A", "B", "C", "D"], "the not installed one is skipped, the order kept");
  assert.deepEqual(rows[1].act, { start: { name: tabName(cards[0]), argv: ["codex", "--flag"], text: refs(cards), agent: "Codex" } }, "the references to paste, the agent's name for the toast; no task");
  assert.equal(rows[1].act.start.name, "#4242 Fix the login redirect");
  assert.match(rows[1].act.start.text, /^Fizzy #4242 "Fix the login redirect" \(.*\)\nFizzy #4243 /);
  assert.ok(rows.every(r => !("task" in r.act.start)));
  assert.equal(rows[0].icon, "icons/claude.svg");
  assert.equal(rows[1].agent, known[1], "the known agent, for its icon's tint");
  assert.ok(rows.every(r => r.type === "row"));
  unique(rows);
  // Agents still being looked up: what is known shows without a note.
  assert.ok(menuRows({ kind: "start", cards }, { known, checking: true }).every(r => r.type === "row"));
});

test("start menu notes: checking, failed, none installed", () => {
  const cards = [card(1)];
  const note = ctx => menuRows({ kind: "start", cards }, ctx).map(r => [r.type, r.label]);
  assert.deepEqual(note({ known: [], checking: true }), [["note", "Checking installed agents…"]]);
  assert.deepEqual(note({ known: [], failed: true }), [["note", "Could not load agents"]]);
  assert.deepEqual(note({ known: [] }), [["note", "No agents found"]]);
  assert.deepEqual(note({}), [["note", "No agents found"]]);
  assert.deepEqual(note({ known: [{ name: "Pi", run: ["pi"], installed: false }] }), [["note", "No agents found"]]);
  assert.deepEqual(note({ known: [], checking: true, failed: true }), [["note", "Checking installed agents…"]]);
});

test("users menu: active people who are not the system, the assigned ones checked, each assigns by id", () => {
  const users = [user("me", "Ada", { role: "owner" }), user("u2", "Grace Brewster Hopper", { role: "admin" }), user("u3", "Helper (Bot)"), user("sys", "System", { role: "system" }), user("u5", "Gone", { active: false })];
  const c = card(4242, { assignees: [user("u2", "Grace Brewster Hopper")] });
  const rows = menuRows({ kind: "users", card: c }, { users, me: "me" });
  assert.deepEqual(ids(rows), ["user-me", "user-u2", "user-u3"]);
  assert.deepEqual(rows.map(r => r.label), ["Ada", "Grace Brewster Hopper", "Helper (Bot)"]);
  assert.deepEqual(rows.map(r => r.checked), [false, true, false]);
  assert.deepEqual(rows.map(r => r.hint), ["you", undefined, undefined]);
  assert.deepEqual(byId(rows, "user-u2").act, { request: { kind: "assign", number: 4242, user: "u2" } });
  unique(rows);
  assert.deepEqual(rows[1], byId(rows, "user-u2"));
  assert.ok(!("hint" in rows[1]));
  const later = [user("u2", "Grace Brewster Hopper", { role: "admin" }), user("u3", "Helper (Bot)"), user("me", "Ada", { role: "owner" })];
  const first = menuRows({ kind: "users", card: c }, { users: later, me: { id: "me" } });
  assert.deepEqual(first.map(r => [r.label, r.hint]), [["Ada", "you"], ["Grace Brewster Hopper", undefined], ["Helper (Bot)", undefined]]);
  assert.deepEqual(menuRows({ kind: "users", card: c }, { users: later }).map(r => r.label), ["Grace Brewster Hopper", "Helper (Bot)", "Ada"], "me unknown: as listed");
  // Not loaded yet, and nobody.
  assert.deepEqual(menuRows({ kind: "users", card: c }, {}).map(r => [r.type, r.label]), [["note", "Loading people…"]]);
  assert.deepEqual(menuRows({ kind: "users", card: c }, { users: null }).map(r => r.type), ["note"]);
  assert.deepEqual(menuRows({ kind: "users", card: c }, { users: [] }).map(r => [r.type, r.label]), [["note", "No people"]]);
  assert.deepEqual(menuRows({ kind: "users", card: c }, { users: [user("sys", "System", { role: "system" })] }).map(r => r.type), ["note"]);
});

test("tags menu: every tag, the card's own checked, each toggles by title", () => {
  const tags = [{ id: "t1", title: "bug" }, { id: "t2", title: "café-notes" }, { id: "t3", title: "docs" }];
  const c = card(4242, { tags: ["café-notes", "docs"] });
  const rows = menuRows({ kind: "tags", card: c }, { tags });
  assert.deepEqual(ids(rows), ["tag-t1", "tag-t2", "tag-t3"]);
  assert.deepEqual(rows.map(r => r.label), ["bug", "café-notes", "docs"]);
  assert.deepEqual(rows.map(r => r.checked), [false, true, true]);
  assert.deepEqual(byId(rows, "tag-t2").act, { request: { kind: "tag", number: 4242, name: "café-notes" } });
  assert.deepEqual(menuRows({ kind: "tags", card: card(1) }, { tags }).map(r => r.checked), [false, false, false]);
  assert.deepEqual(menuRows({ kind: "tags", card: card(1, { tags: [{ title: "bug" }] }) }, { tags }).map(r => r.checked), [true, false, false], "a tag object counts by its title");
  assert.deepEqual(menuRows({ kind: "tags", card: c }, {}).map(r => [r.type, r.label]), [["note", "Loading tags…"]]);
  assert.deepEqual(menuRows({ kind: "tags", card: c }, { tags: [] }).map(r => [r.type, r.label]), [["note", "No tags yet"]]);
  unique(rows);
});

test("moveBoard menu: every board but the card's own, each moves by id", () => {
  const rows = menuRows({ kind: "moveBoard", card: card(4242, { board: { id: "b2", name: "Personal" } }) }, { boards: BOARDS });
  assert.deepEqual(ids(rows), ["board-b1", "board-b3"]);
  assert.deepEqual(rows.map(r => r.label), ["Roadmap", "Acme"]);
  assert.deepEqual(byId(rows, "board-b3").act, { request: { kind: "moveBoard", number: 4242, board: "b3" } });
  assert.deepEqual(ids(menuRows({ kind: "moveBoard", card: card(1, { board: undefined }) }, { boards: BOARDS })), ["board-b1", "board-b2", "board-b3"], "a card with no board known: all of them");
  assert.deepEqual(menuRows({ kind: "moveBoard", card: card(1) }, { boards: [{ id: "b1", name: "Only" }] }).map(r => [r.type, r.label]), [["note", "No other boards"]]);
  assert.deepEqual(menuRows({ kind: "moveBoard", card: card(1) }, {}).map(r => r.type), ["note"]);
});

test("menuRows: an unknown or empty menu has no rows, and no menu needs a ctx", () => {
  assert.deepEqual(menuRows({ kind: "nope" }, {}), []);
  assert.deepEqual(menuRows({}, {}), []);
  assert.deepEqual(menuRows(null, {}), []);
  assert.deepEqual(menuRows(undefined), []);
  for (const kind of ["card", "users", "tags", "moveBoard", "lanes"]) assert.deepEqual(menuRows({ kind }, {}), [], `${kind} without a card`);
  for (const m of [{ kind: "boards" }, { kind: "newCard" }, { kind: "agents", cards: [] }, { kind: "start", cards: [] }, { kind: "card", card: card(1) }, { kind: "lanes", card: card(1) }]) {
    assert.doesNotThrow(() => menuRows(m), JSON.stringify(m));
  }
});

test("every row is well formed, and every icon the menus use is in mods/fizzy", () => {
  const c = card(4242, { column: C1, tags: ["bug"], assignees: [user("me", "Ada")], golden: true });
  const ctx = {
    agents: [claude, codex], focused: { terminal: "term-claude", tab: "t1" }, boards: BOARDS, me: "me", armed: "delete",
    users: [user("me", "Ada")], tags: [{ id: "t1", title: "bug" }],
    known: [{ key: "claude", name: "Claude Code", icon: "icons/claude.svg", tint: false, run: ["claude"], installed: true }],
  };
  const menus = [
    { kind: "boards", current: "b1", follow: false, spaceBoard: "b1" }, { kind: "newCard", current: "b1" },
    { kind: "card", card: c, columns: COLUMNS, pinned: true }, { kind: "lanes", card: c, columns: COLUMNS },
    { kind: "agents", cards: [c] }, { kind: "start", cards: [c] },
    { kind: "users", card: c }, { kind: "tags", card: c }, { kind: "moveBoard", card: c },
  ];
  const used = new Set();
  for (const menu of menus) {
    const rows = menuRows(menu, ctx);
    assert.ok(rows.length, menu.kind);
    unique(rows);
    for (const r of rows) {
      assert.ok(["row", "label", "sep", "note"].includes(r.type), `${menu.kind}/${r.id}: type`);
      assert.equal(typeof r.id, "string");
      if (r.type === "sep") continue;
      assert.ok(r.label && typeof r.label === "string", `${menu.kind}/${r.id}: label`);
      if (r.type !== "row") continue;
      assert.ok("icon" in r && "act" in r, `${menu.kind}/${r.id}: icon and act`);
      assert.equal(Object.keys(r.act).length, 1, `${menu.kind}/${r.id}: one thing to do`);
      assert.ok(["request", "insert", "paste", "start", "copy", "open", "choose", "menu", "arm"].includes(Object.keys(r.act)[0]), `${menu.kind}/${r.id}: act`);
      if (r.icon?.startsWith("mods/fizzy/")) used.add(r.icon);
      for (const k of Object.keys(r)) assert.notEqual(r[k], undefined, `${menu.kind}/${r.id}: ${k} is not undefined`);
    }
  }
  assert.ok(used.size >= 10, "the menus draw icons");
  for (const icon of used) assert.ok(ICONS.includes(icon), `${icon} exists`);
});

test("menuHeight adds up rows, notes, labels, separators, the padding and the frame, plus spare rows", () => {
  const rows = [{ type: "row" }, { type: "label" }, { type: "note" }, { type: "sep" }];
  assert.equal(menuHeight(rows), 31 + 28 + 31 + 9 + 10 + 2);
  assert.equal(menuHeight(rows, 2), 31 + 28 + 31 + 9 + 12 + 62);
  assert.equal(menuHeight([]), 12);
  assert.equal(menuHeight([], 1), 12 + 31);
  const agentsMenu = menuRows({ kind: "agents", cards: [card(1)] }, { agents: [claude, codex] });
  assert.equal(menuHeight(agentsMenu), 12 + 2 * ROW);
  const menu = menuRows({ kind: "card", card: card(1), columns: COLUMNS }, {});
  assert.deepEqual(["row", "label", "sep"].map(t => menu.filter(r => r.type === t).length), [21, 1, 3]);
  assert.equal(menuHeight(menu), 12 + 21 * ROW + LABEL + 3 * SEP);
  const known = menuRows({ kind: "card", card: card(1), columns: COLUMNS, pinned: true, watching: false }, {});
  assert.equal(menuHeight(known), 12 + 19 * ROW + LABEL + 3 * SEP, "a known pin and watch state take two rows away");
});
