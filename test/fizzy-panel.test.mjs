// The Fizzy panel and its popups, driven with the mocks and a fake `fizzy` CLI (test/fizzy-fixtures.mjs): what
// it asks the CLI, what it draws, and what each click does. No real `fizzy` command runs here.
import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { state, calls, reset, sendCommand } from "./mocks/herdr.mjs";
import { find, all, ids, textOf, fire, nodeOf } from "./mocks/element.mjs";
import { makeCx as freshCx, drawn, space, pane, agent, layoutWith, must, MOD_DIR, modFile } from "./helpers.mjs";
import { makeAccount, failure, LAYOUT, ME, TEAMMATE, B1, B2, CLOSED_FROM } from "./fizzy-fixtures.mjs";
import { SAMPLE_BOARDS, isTeamBoard } from "./sample-boards.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const {
  POLL_VIEW, POLL_INBOX, REQUEST_EVERY, START_WAIT, READY_WAIT, CONCURRENCY, CARD_PAGE, ref, refs, tabName, menuRows, menuHeight, FRAME, YAML_SCRIPT, fizzyVisible,
  boardRef, AVATAR_SCRIPT, AVATAR_DIR, AVATAR_TTL, AVATAR_BACKOFF, AVATAR_PARALLEL, AVATAR_EVERY, avatarBase, colorOf, JQ,
  FILE_DIR, FILE_TIMEOUT, IMAGE_SCRIPT, OPEN_SCRIPT, FREE_NAME_SCRIPT, shortHash, cardFile, cardMarkdown, daysAgo, labelFile, labelSvg, LABEL_FONT, lighten,
} = await import(modFile("lib.js"));
// The options of each `fizzy <first>` exec so far.
const execOptions = first => calls.exec.filter(c => c.command === "fizzy" && c.args[0] === first).map(c => c.options);
const { default: Fizzy } = await import(modFile("main.js"));
const { textPx } = await import(modFile("text.js"));

let acct;
function setup(opts = {}, overrides = {}) {
  acct = makeAccount(opts);
  reset({
    layout: LAYOUT, exec: acct.exec,
    spaces: [space("s1", "work", { active: true, folder: "/work/roadmap" })],
    ...overrides,
  });
}
beforeEach(() => setup());

// Every cx a test made, so that what it started can finish when the test ends.
const made = [];
const makeCx = () => { const cx = freshCx(); made.push(cx); return cx; };
const SETTLE_AFTER = 1000;
// A test that ends with the CLI held (it failed, or never let go) lets it go here, and what waited on it finishes before the next
// test: the panel's copies share one read of the people, and a read left held would keep every later copy waiting on it.
afterEach(async () => {
  acct.unhold();
  let timer;
  const settled = Promise.all(made.splice(0).map(cx => cx.settle().catch(() => {})));
  await Promise.race([settled, new Promise(resolve => { timer = setTimeout(resolve, SETTLE_AFTER); })]);
  clearTimeout(timer);
});

const AGENT = (address, more = {}) => ({
  address, pane: `p-${address}`, space: "s1", space_name: "work", tab: "s1-tab", tab_index: 1, tab_name: "fix login", status: "idle", app: "claude-code",
  program: { key: "claude", name: "Claude Code", icon: "icons/claude.svg", tint: false, tile: null, color: null, shell: false, agent: true },
  title: "", seq: 1, pinned: false, focused: false, ...more,
});
const withAgent = (address = "t1") => {
  state.agents = [AGENT(address)];
  state.focused = { space: "s1", tab: "s1-tab", pane: `p-${address}`, terminal: address, shown: null, agent: null, cwd: null };
};
// The agents the Start popup can list (the popup asks for them itself when it opens).
const CLAUDE = agent("claude", "Claude Code"), CODEX = agent("codex", "Codex", { run: ["codex", "--flag"] });
const installed = (...list) => { state.knownAgents = async () => list; };
const REF_101 = 'Fizzy #101 "Fix the login redirect" (https://app.fizzy.do/111/cards/101)';

// The bar: one line of four buttons.
const ACTIONS = ["fizzy-bar-insert", "fizzy-bar-send", "fizzy-bar-start", "fizzy-bar-copy"];
// What Insert says when no agent is in view and the reference is only copied.
const COPIED_NO_AGENT = "Copied — no agent here";
const isOff = (tree, id) => must(tree, id).handlers.on_click === undefined;
const tipOf = (tree, id) => must(tree, id).style.tooltip;
const parentOf = (tree, id) => all(tree, n => n.kids.some(k => k.id === id))[0];

// The timers that are due a tick after a draw (a popup's request is only noted by the draw and done by a 1 ms
// timer, never in the draw itself), run now; then every task they start settles.
async function due(cx) {
  for (const t of cx.timers.filter(x => x.after && x.ms <= 1)) {
    cx.timers.splice(cx.timers.indexOf(t), 1);
    await t.fn(cx);
  }
  await cx.settle();
}

// A panel, started the way Herdr starts it (init, then its first draw). draw() renders until what the reads brought
// in is on screen (every render goes through drawn(): a draw that acts fails the test). `settle: false` leaves
// reads that a test holds back (acct.hold) pending.
async function mount({ settle = true } = {}) {
  const cx = makeCx(), view = new Fizzy();
  view.init(undefined, cx);
  if (settle) await cx.settle();
  const draw = async () => {
    for (let i = 0; i < 3; i++) { drawn(view, cx); await due(cx); }
    return drawn(view, cx);
  };
  return { view, cx, draw };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
// A key command, delivered as Herdr does, and everything it starts settled.
async function press(cx, text) {
  sendCommand(text);
  await tick();
  await cx.settle();
}

// The signed-in user as kept between runs ({ account, id }), and as shared with the popups.
const keptMe = () => JSON.parse(localStorage.getItem("me"));
const sharedMe = () => state.shared["fizzy.people"]?.me ?? null;

const rowIds = tree => all(tree, n => /^fizzy-card-\d+$/.test(n.id ?? "")).map(n => Number(n.id.slice("fizzy-card-".length)));
const sectionIds = tree => all(tree, n => n.id?.startsWith("fizzy-section-")).map(n => n.id.slice("fizzy-section-".length));
// The lane each card row sits under, read off the order of the list.
function lanesOf(tree) {
  const out = {};
  let lane = null;
  for (const id of ids(must(tree, "fizzy-list"))) {
    if (id.startsWith("fizzy-section-")) lane = id.slice("fizzy-section-".length);
    else if (/^fizzy-card-\d+$/.test(id)) out[Number(id.slice(11))] = lane;
  }
  return out;
}
const click = (tree, id, cx, event = {}) => fire(must(tree, id), "on_click", { click_count: 1, modifiers: {}, ...event }, cx);
// The input state an Input or Textarea inside the element holds.
const inputOf = (tree, id) => all(must(tree, id), n => n.kind === "input" || n.kind === "textarea")[0].state;
const header = (tree, key) => textOf(must(tree, `fizzy-section-${key}`)).trim();
const timer = (cx, ms) => cx.timers.find(t => t.ms === ms);
// The view's poll and the notifications' poll are both every 30 s (the view's is made first).
const inboxTimer = cx => cx.timers.filter(t => !t.after && t.ms === POLL_INBOX)[1];
const fizzyReads = (...prefix) => acct.asked(...prefix);
// What a popup was opened with, and a running copy of it.
const lastPopup = () => calls.openOverlay.at(-1);
async function mountPopup(spec = lastPopup(), extra = {}) {
  state.props = { menu: spec.props.menu, overlay: "ov-popup" };
  const cx = makeCx(), view = new Fizzy();
  view.init(undefined, cx);
  await cx.settle();
  Object.assign(cx, extra);
  return { view, cx, tree: () => drawn(view, cx) };
}
const menuClick = (popup, id) => fire(must(popup.tree(), `fizzy-menu-${id}`), "on_click", {}, popup.cx);
const requestOps = () => calls.setShared.filter(([k, v]) => k === "fizzy.request" && v).map(([, v]) => v.op);
// The board's name as the select shows it (its hint, when there is one, is not part of it).
const boardName = tree => textOf(must(tree, "fizzy-board-name"));
// New card as a person does it: the picker is open (its key), a row picks the board, and the draws that follow run the timer
// that makes the card there and open it.
async function chooseNewCard(m, boardId) {
  menuClick(await mountPopup(), `board-${boardId}`);
  return m.draw();
}
async function newCardOn(m, boardId) {
  await m.draw();
  await press(m.cx, "new");
  return chooseNewCard(m, boardId);
}
// A search of every board as a person runs it: the header's search icon (unless the field is open already), the words, Enter.
async function searchFor(m, words) {
  let tree = await m.draw();
  if (!find(tree, "fizzy-search")) {
    click(tree, "fizzy-search-open", m.cx);
    tree = await m.draw();
  }
  const field = inputOf(tree, "fizzy-search");
  field.edit(words, m.cx);
  field.submit(m.cx);
  return m.draw();
}

test("under herdr-app check the panel draws but asks nothing: no CLI, no file work, no timers", async () => {
  state.checking = true;
  const { view, cx } = await mount();
  drawn(view, cx);
  await cx.settle();
  assert.deepEqual(calls.exec.map(c => [c.command, ...c.args]), []);
  assert.deepEqual([cx.timers.length, calls.nextCommand.length], [0, 0]);
});

test("the board view lists the lanes in the board's order, Not Now and Done folded, the open cards under theirs", async () => {
  const { draw } = await mount();
  const tree = await draw();
  assert.deepEqual(sectionIds(tree), ["not-now", "maybe", "c1", "c2", "done"]);
  assert.deepEqual(lanesOf(tree), { 103: "maybe", 101: "c1", 102: "c2" });
  assert.equal(header(tree, "c1"), "In progress 1");
  assert.equal(header(tree, "not-now"), "Not Now", "a lane that is not read yet has no count");
  assert.equal(boardName(tree), "Roadmap");
  assert.deepEqual(acct.asked("card", "list"), [["card", "list", "--board", "b1", "--all"], ["card", "list", "--board", "b1", "--indexed-by", "stalled", "--all"]],
    "only the open cards, and which of them are stalled, always with an explicit board");
});

test("a card is drawn as Fizzy's: number | board, a bold title, its tags (three, then +N), who made it and when, when it changed and who it is assigned to; golden, a gold glow", async () => {
  const { draw } = await mount();
  const tree = await draw();
  const row = must(tree, "fizzy-card-102"), card = acct.card(102);
  assert.equal(textOf(must(tree, "fizzy-card-head-102")).replace(/\s+/g, " ").trim(), "102 ROADMAP");
  assert.deepEqual([textOf(must(tree, "fizzy-card-title-102")), must(tree, "fizzy-card-title-102").style.font_bold], ["Write the changelog", true]);
  const text = textOf(row);
  assert.deepEqual(["#docs", "#release", "#web", "#extra"].map(tag => text.includes(tag)), [true, true, true, false], "three chips; the fourth is only counted");
  assert.match(text, /\+1/, "four tags: three chips and +1");
  assert.equal(textOf(must(tree, "fizzy-card-added-102")).trim(), `ADDED ${daysAgo(card.created_at, Date.now()).toUpperCase()}`);
  assert.equal(textOf(must(tree, "fizzy-card-creator-102")).trim(), "BOB");
  assert.equal(textOf(must(tree, "fizzy-card-changed-102")).trim(), daysAgo(card.last_active_at, Date.now()).toUpperCase());
  assert.equal(textOf(must(tree, "fizzy-card-assigned-102")).trim(), "BOB");
  assert.deepEqual(iconsIn(tree, "fizzy-card-changed-102").concat(iconsIn(tree, "fizzy-card-assigned-102")), ["mods/fizzy/refresh.svg", "mods/fizzy/arrow-right.svg"]);
  assert.equal(all(must(tree, "fizzy-card-meta-102"), n => n.kind === "div" && n.style?.rounded_full && textOf(n) === "B").length, 2, "Bob made it and has it: his initials twice");
  assert.equal(find(tree, "fizzy-card-steps-102"), null, "no step progress or comment count until they are read");
  assert.ok(glowOf(row), "golden: a gold glow");
  assert.equal(glowOf(must(tree, "fizzy-card-101")), null, "not golden: none");
  assert.equal(textOf(must(tree, "fizzy-card-title-101")), "Fix the login redirect");
});

test("a card's step progress and comment count are read (card show, comment list) by the request timer for each card on the board, kept, and read again only once the card has changed", async () => {
  const { view, cx, draw } = await mount();
  await draw();
  const counts = () => acct.asked("comment", "list").length;
  await timer(cx, REQUEST_EVERY).fn(cx);
  await cx.settle();
  for (let i = 0; i < 5 && view.countWanted.size; i++) { await timer(cx, REQUEST_EVERY).fn(cx); await cx.settle(); }
  assert.equal(counts(), 3, "one comment count per open card on the board (101, 102, 103)");
  let tree = await draw();
  assert.equal(textOf(must(tree, "fizzy-card-steps-101")).trim(), "1/2");
  assert.equal(textOf(must(tree, "fizzy-card-comments-101")).trim(), "3");
  assert.equal(find(tree, "fizzy-card-comments-102"), null, "no comments: no count");
  assert.equal(find(tree, "fizzy-card-steps-103"), null, "no steps: no progress");
  assert.deepEqual(JSON.parse(localStorage.getItem("counts")).find(e => e[0] === 101).slice(2), [1, 2, 3], "kept between runs: done, total, comments");
  await press(cx, "refresh");
  await timer(cx, REQUEST_EVERY).fn(cx);
  await cx.settle();
  assert.equal(counts(), 3, "nothing changed: nothing read again");
  acct.card(101).last_active_at = new Date().toISOString();
  acct.card(101).steps[0].completed = true;
  await press(cx, "refresh");
  await timer(cx, REQUEST_EVERY).fn(cx);
  await cx.settle();
  assert.equal(counts(), 4, "the changed card alone");
  tree = await draw();
  assert.equal(textOf(must(tree, "fizzy-card-steps-101")).trim(), "2/2");
});

test("unfolding Not Now reads that lane, and each unfold reads it fresh", async () => {
  const { cx, draw } = await mount();
  let tree = await draw();
  assert.equal(fizzyReads("card", "list", "--board", "b1", "--indexed-by", "not_now").length, 0, "nothing is read before it is opened");
  click(tree, "fizzy-section-not-now", cx);
  tree = await draw();
  assert.deepEqual(fizzyReads("card", "list", "--board", "b1", "--indexed-by", "not_now"), [["card", "list", "--board", "b1", "--indexed-by", "not_now", "--all"]]);
  assert.equal(lanesOf(tree)[104], "not-now");
  assert.equal(header(tree, "not-now"), "Not Now 1");
  assert.equal(JSON.parse(localStorage.getItem("collapsed:b1"))["not-now"], false, "the choice is kept per board");
  click(tree, "fizzy-section-not-now", cx);
  assert.equal(lanesOf(await draw())[104], undefined, "folded: its cards are out of sight");
  acct.cards.find(c => c.number === 103).postponed = true;
  click(tree, "fizzy-section-not-now", cx);
  tree = await draw();
  assert.equal(lanesOf(tree)[104], "not-now");
  assert.equal(lanesOf(tree)[103], "not-now", "what changed while it was folded is read at the unfold");
  assert.equal(fizzyReads("card", "list", "--board", "b1", "--indexed-by", "not_now").length, 2);
});

const donePages = () => fizzyReads("card", "list", "--board", "b1", "--indexed-by", "closed").map(a => a.at(-1));

test("expanding Done reads closed pages until it has a page's worth, up to the page that says none follows; Show more reads on", async () => {
  setup({ closed: 120 });
  const { cx, draw } = await mount();
  let tree = await draw();
  click(tree, "fizzy-section-done", cx);
  tree = await draw();
  assert.deepEqual(donePages(), ["1", "2", "3", "4"], "15 a page, four pages make the 50");
  assert.equal(rowIds(tree).filter(n => n >= CLOSED_FROM || n === 105).length, CARD_PAGE, "only the first page-worth is shown");
  assert.ok(find(tree, "fizzy-more-done"));
  click(tree, "fizzy-more-done", cx);
  tree = await draw();
  assert.deepEqual(donePages(), ["1", "2", "3", "4", "5", "6", "7"]);
  assert.equal(rowIds(tree).filter(n => n >= CLOSED_FROM || n === 105).length, 100);
  click(tree, "fizzy-more-done", cx);
  tree = await draw();
  assert.deepEqual(donePages(), ["1", "2", "3", "4", "5", "6", "7", "8", "9"], "the ninth page says none follows: no empty page is asked for");
  assert.equal(rowIds(tree).filter(n => n >= CLOSED_FROM || n === 105).length, 121);
  assert.equal(find(tree, "fizzy-more-done"), null, "nothing more to show");
});

test("Done also ends at an empty page, when every page says another follows", async () => {
  setup({ closed: 120, morePages: true });
  const { cx, draw } = await mount();
  let tree = await draw();
  click(tree, "fizzy-section-done", cx);
  tree = await draw();
  click(tree, "fizzy-more-done", cx);
  tree = await draw();
  click(tree, "fizzy-more-done", cx);
  tree = await draw();
  assert.deepEqual(donePages(), ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
  assert.equal(rowIds(tree).filter(n => n >= CLOSED_FROM || n === 105).length, 121);
  assert.equal(find(tree, "fizzy-more-done"), null);
});

test("the reads polled most go out with their --jq projection: the board's lanes, Mine, the search of every board, Pins and the tray", async () => {
  const m = await mount(), { cx, draw } = m;
  let tree = await draw();
  click(tree, "fizzy-section-not-now", cx);
  click(tree, "fizzy-section-done", cx);
  await draw();
  click(await draw(), "fizzy-view-mine", cx);
  await draw();
  click(await searchFor(m, "login"), "fizzy-search-back", cx);
  click(await draw(), "fizzy-view-pins", cx);
  await draw();
  const sent = (...words) => calls.exec.filter(c => c.command === "fizzy" && words.every(w => c.args.includes(w)));
  const jqOf = c => c.args[c.args.indexOf("--jq") + 1];
  for (const c of sent("card", "list")) assert.equal(jqOf(c), c.args.includes("closed") ? JQ.page : c.args.includes("stalled") ? JQ.numbers : JQ.cards, c.args.slice(0, 7).join(" "));
  for (const words of [["--assignee"], ["not_now"], ["closed"], ["stalled"]]) assert.ok(sent("card", "list", ...words).length > 0, words[0]);
  assert.ok(sent("search").length > 0 && sent("search").every(c => jqOf(c) === JQ.cards), "the search");
  assert.ok(sent("pin", "list").length > 0 && sent("pin", "list").every(c => jqOf(c) === JQ.cards));
  assert.ok(sent("notification", "tray").length > 0 && sent("notification", "tray").every(c => jqOf(c) === JQ.notes));
  assert.ok(sent("card", "show").every(c => !c.args.includes("--jq")), "a card read whole is not cut");
});

test("the filter narrows the rows by words; Me keeps the cards assigned to the person, by their user id", async () => {
  const { cx, draw } = await mount();
  let tree = await draw();
  inputOf(tree, "fizzy-filter").edit("login", cx);
  tree = await draw();
  assert.deepEqual(rowIds(tree), [101]);
  inputOf(tree, "fizzy-filter").edit("docs release", cx);
  assert.deepEqual(rowIds(await draw()), [102], "words are ANDed, tags count");
  inputOf(tree, "fizzy-filter").edit("zzz", cx);
  assert.match(textOf(must(await draw(), "fizzy-list")), /No cards match/);
  inputOf(tree, "fizzy-filter").edit("", cx);
  click(tree, "fizzy-only-mine", cx);
  tree = await draw();
  assert.deepEqual(rowIds(tree), [101], "the login's own id would match nobody: the account user's id does");
  assert.deepEqual(keptMe(), { account: "111", id: "u-me" });
  click(tree, "fizzy-only-mine", cx);
  assert.deepEqual(rowIds(await draw()), [103, 101, 102]);
});

test("the filter field is an Input wrapped in the fizzy-filter box with a search icon, and typing does not read anything", async () => {
  const { cx, draw } = await mount();
  const tree = await draw();
  const before = acct.log.length;
  assert.deepEqual(must(tree, "fizzy-filter").kids.map(k => k.kind === "svg" ? k.path : k.kind), ["input", "mods/fizzy/search.svg"]);
  const input = inputOf(tree, "fizzy-filter");
  assert.equal(input.options.placeholder, "Filter this board…");
  input.edit("x", cx);
  assert.equal(acct.log.length, before);
  assert.ok(cx.notified > 0, "typing redraws");
});

test("the first draw shows the cached board before the CLI has answered", async () => {
  localStorage.setItem("config", JSON.stringify({ board: "b1", account: "111" }));
  localStorage.setItem("boards", JSON.stringify([B1, B2]));
  localStorage.setItem("data:b1", JSON.stringify({ columns: acct.columns.b1, open: [{ number: 7, title: "From the cache", column: null, tags: [], assignees: [] }] }));
  let release;
  acct.hold = new Promise(resolve => { release = resolve; });
  const { view, cx } = await mount({ settle: false });
  await tick();
  assert.deepEqual(rowIds(drawn(view, cx)), [7], "the space's own answer (no .fizzy.yaml) was asked at init, and has come");
  release();
  await cx.settle();
  acct.hold = null;
  assert.deepEqual(rowIds(drawn(view, cx)), [103, 101, 102], "then the real cards");
});

test("the board is the CLI's own default when nothing else says: `config show`, cut to its account and board, asked once and kept; no file of the CLI's is read", async () => {
  acct.config = { account: "111", board: "b2" };
  const { draw } = await mount();
  const tree = await draw();
  assert.equal(boardName(tree), "Personal", "the default, not the first board");
  assert.ok(acct.asked("card", "list").every(a => a.includes("b2")), "the first board is never read");
  assert.deepEqual(calls.exec.filter(c => c.command === "fizzy" && c.args[0] === "config").map(c => c.args), [["config", "show", "--jq", JQ.config, "--json"]]);
  assert.equal(calls.readTextFile.length, 0);
  assert.deepEqual(JSON.parse(localStorage.getItem("config")), { board: "b2", account: "111" });
});

test("a board shown from the cache reads its columns once more, and with them who can see it and its stalled cards: Who can see this board opens", async () => {
  localStorage.setItem("config", JSON.stringify({ board: "b1", account: "111" }));
  localStorage.setItem("boards", JSON.stringify([B1, B2]));
  localStorage.setItem("data:b1", JSON.stringify({ columns: [{ id: "c1", name: "Old name", color: null }], open: [] }));
  const { view, cx, draw } = await mount();
  const tree = await draw();
  assert.equal(header(tree, "c1"), "In progress 1", "the cached name is replaced");
  click(tree, "fizzy-board-access", cx);
  assert.equal(lastPopup().props.menu.kind, "access");
  view.loadBoard(cx);
  await cx.settle();
  const reads = () => ["column", "accesses", "stalled"].map(w => acct.log.filter(a => a.includes(w)).length);
  assert.deepEqual(reads(), [1, 1, 1], "once per session, not by every load");
});

test("the CLI's default board is kept: a first start waits for `config show` rather than read another board, a later start picks it at once", async () => {
  acct.config = { account: "111", board: "b2" };
  localStorage.setItem("boards", JSON.stringify([B1, B2]));
  let release;
  acct.hold = new Promise(resolve => { release = resolve; });
  const first = await mount({ settle: false });
  await tick();
  drawn(first.view, first.cx);
  const waiting = acct.asked("column", "list").length;
  release();
  await first.cx.settle();
  acct.hold = null;
  assert.equal(waiting, 0, "no board is read before the default is known");
  drawn(first.view, first.cx);
  await first.cx.settle();
  assert.deepEqual(acct.asked("column", "list").map(a => a[3]), ["b2"], "the default, not the first board of the list");
  acct.hold = new Promise(resolve => { release = resolve; });
  const next = await mount({ settle: false });
  await tick();
  drawn(next.view, next.cx);
  const atOnce = acct.asked("card", "list").filter(a => !a.includes("--indexed-by")).map(a => a[3]);
  release();
  await next.cx.settle();
  acct.hold = null;
  assert.deepEqual(atOnce, ["b2", "b2"], "known from the last start: read at once");
  assert.deepEqual(acct.asked("column", "list").map(a => a[3]), ["b2", "b2"], "its cached columns stand in until read once more");
});

test("when `config show` fails, the last start's default board and account stand", async () => {
  localStorage.setItem("config", JSON.stringify({ board: "b2", account: "111" }));
  localStorage.setItem("me", JSON.stringify({ account: "111", id: "u-me" }));
  acct.fail = args => (args[0] === "config" ? failure("network", "offline") : undefined);
  const { draw } = await mount();
  const tree = await draw();
  assert.equal(boardName(tree), "Personal");
  assert.equal(sharedMe(), "u-me", "the person kept for that account");
  assert.equal(acct.asked("identity").length, 0);
});

test("following the space: the .fizzy.yaml found above the terminal's folder, on its machine, asked once a minute", async () => {
  acct.yaml["/work/roadmap"] = "# scope\naccount: 111\nboard: b2   # the other one\n";
  state.panes = [pane("p1", "s1-tab", "/work/roadmap/deep/er")];
  const { draw } = await mount();
  let tree = await draw();
  assert.equal(boardName(tree), "Personal", "the space's board wins over the default");
  const scripts = () => calls.exec.filter(c => c.command === "sh");
  assert.deepEqual(scripts().map(c => [c.args, c.options]), [[["-c", YAML_SCRIPT, "fizzy", "/work/roadmap/deep/er"], { on: null }]]);
  tree = await draw();
  assert.equal(scripts().length, 1, "not asked again on every draw");
  assert.ok(acct.asked("card", "list").every(a => a.includes("b2")), "b1 was never read");
  const clock = clockAt();
  try {
    clock.advance(59_000);
    await draw();
    assert.equal(scripts().length, 1, "within the minute: not asked again");
    clock.advance(2_000);
    await draw();
    assert.equal(scripts().length, 2, "a minute on: asked again");
  } finally { clock.restore(); }
});

test("a space on another machine asks that machine for its .fizzy.yaml, from the space's folder", async () => {
  state.spaces = [space("s1", "remote", { active: true, folder: "/home/dev/work", machine: "devbox" })];
  const { draw } = await mount();
  await draw();
  const ask = calls.exec.find(c => c.command === "sh");
  assert.deepEqual([ask.args[3], ask.options], ["/home/dev/work", { on: "devbox" }]);
});

test("the board picker: Follow, or a board; the choice comes back through shared state and is kept", async () => {
  const { cx, draw } = await mount();
  let tree = await draw();
  click(tree, "fizzy-board", cx);
  const spec = lastPopup();
  assert.equal(spec.mod, "fizzy");
  assert.equal(spec.kind, "popup");
  assert.deepEqual(spec.props.menu, { kind: "boards", current: "b1", follow: true, spaceBoard: null });
  const popup = await mountPopup(spec);
  assert.deepEqual(ids(popup.tree()).filter(i => i.startsWith("fizzy-menu-") && i !== "fizzy-menu-list"), ["fizzy-menu-follow", "fizzy-menu-board-b1", "fizzy-menu-board-b2"]);
  menuClick(popup, "board-b2");
  assert.deepEqual(calls.order.slice(-2), ["closeOverlay", "setShared"], "closes first");
  const [key, value] = calls.setShared.find(([k]) => k === "fizzy.board");
  assert.deepEqual([key, value.follow, value.board], ["fizzy.board", false, "b2"]);
  tree = await draw();
  assert.equal(boardName(tree), "Personal");
  assert.deepEqual([localStorage.getItem("follow"), localStorage.getItem("board")], ["false", '"b2"']);
  assert.equal(acct.asked("column", "list", "--board", "b2").length, 1);
  assert.deepEqual(rowIds(tree), [201], "board b2's own card");
  // A new copy starts on the picked board, and the same choice is not taken twice.
  state.props = undefined;
  const again = await mount();
  assert.equal(boardName(await again.draw()), "Personal");
  localStorage.setItem("board", '"b1"');
  const later = await mount();
  assert.equal(boardName(await later.draw()), "Roadmap", "the kept b1, not the shared choice of b2 again");
});

test("picking Follow again turns following back on and keeps the picked board", async () => {
  localStorage.setItem("follow", "false");
  localStorage.setItem("board", '"b2"');
  acct.yaml["/work/roadmap"] = "board: b1\n";
  const { cx, draw } = await mount();
  let tree = await draw();
  assert.equal(boardName(tree), "Personal", "not following: the picked board");
  click(tree, "fizzy-board", cx);
  const popup = await mountPopup();
  menuClick(popup, "follow");
  tree = await draw();
  assert.equal(boardName(tree), "Roadmap", "following: the space's board");
  assert.equal(localStorage.getItem("board"), '"b2"');
});

async function openDetail(number = 101) {
  const m = await mount();
  let tree = await m.draw();
  click(tree, `fizzy-card-${number}`, m.cx);
  tree = await m.draw();
  return { ...m, tree };
}

// Rich text as the panel draws it: an element's words (its pieces keep their spaces as non-breaking ones), each line as [its
// list marker, its words, whether a gap sits above it], and the piece that draws one word.
const plain = el => all(el, n => n.kind === "text").map(n => n.text).join("").replace(/ /g, " ").trim();
const richLinesOf = el => el.kids.map(line => {
  const [marker, body] = line.kids.length > 1 ? line.kids : [null, line.kids[0]];
  return [marker ? textOf(marker) : "", plain(body), line.style.mt === 8];
});
const pieceOf = (el, word) => all(el, n => n.kind === "div" && n.kids.length === 1 && n.kids[0].kind === "text" && n.kids[0].text.replace(/ /g, " ").trim() === word)[0];

test("clicking a row opens the card: card show, comment list and pin list asked once each, steps and comments drawn", async () => {
  const { cx, draw } = await mount();
  let tree = await draw();
  const pinReads = acct.asked("pin", "list").length;
  click(tree, "fizzy-card-101", cx);
  const early = cx.notified;
  tree = await draw();
  assert.deepEqual(acct.asked("card", "show"), [["card", "show", "101"]]);
  assert.deepEqual(acct.asked("comment", "list"), [["comment", "list", "--card", "101", "--all"]]);
  assert.equal(acct.asked("pin", "list").length, pinReads + 1, "the pin state comes from the pin list, read again as the card opens");
  assert.ok(early > 0);
  assert.equal(textOf(must(tree, "fizzy-title")), "Fix the login redirect");
  assert.match(textOf(must(tree, "fizzy-lane")), /In progress/i);
  assert.deepEqual(ids(tree).filter(i => /^fizzy-step-s\d$/.test(i)), ["fizzy-step-s1", "fizzy-step-s2"]);
  assert.equal(textOf(must(tree, "fizzy-comments-count")), "2", "what people wrote: Fizzy's own line is not counted");
  assert.ok(find(tree, "fizzy-comment-cm1") && find(tree, "fizzy-comment-cm2"));
  assert.equal(find(tree, "fizzy-comment-cm3"), null, "the system's line is no comment");
  assert.match(textOf(must(tree, "fizzy-activity")), /Activity 1/);
  assert.equal(find(tree, "fizzy-list"), null, "the detail replaces the list");
  const head = ids(tree).slice(ids(tree).indexOf("fizzy-back"), ids(tree).indexOf("fizzy-detail"));
  assert.deepEqual(head, ["fizzy-back", "fizzy-golden", "fizzy-watch", "fizzy-pin", "fizzy-act-open", "fizzy-card-menu"], "Back, then the card's round toggles and actions");
  for (const id of head) assert.deepEqual([must(tree, id).style.size, must(tree, id).style.rounded_full, must(tree, id).style.border_1], [30, true, true], id);
  assert.equal(textOf(must(tree, "fizzy-detail-number")), "No. 101", "the number on the card's tab");
  assert.equal(textOf(must(tree, "fizzy-detail-board")), "ROADMAP");
  assert.equal(tipOf(tree, "fizzy-detail-board"), "Roadmap: move to another board");
  const icons = head.map(id => iconOf(tree, id));
  assert.deepEqual(icons, ["arrow-left.svg", "star.svg", "bell.svg", "pin.svg", "external-link.svg", "more.svg"]);
  assert.equal(find(tree, "fizzy-open-settings"), null);
});

test("the detail shows the summary at once, 'Loading…' for what is still coming, and Back returns to the list", async () => {
  const { view, cx, draw } = await mount();
  let tree = await draw();
  let release;
  acct.hold = new Promise(resolve => { release = resolve; });
  click(tree, "fizzy-card-101", cx);
  tree = drawn(view, cx);
  assert.equal(textOf(must(tree, "fizzy-title")), "Fix the login redirect", "from the list's own data");
  assert.match(textOf(must(tree, "fizzy-lane")), /In progress/i);
  assert.equal(textOf(must(tree, "fizzy-detail")).split("Loading…").length - 1, 1, "one line, not one per section");
  assert.ok(find(tree, "fizzy-detail-meta"), "People and Tags from the list's data");
  for (const id of ["fizzy-desc", "fizzy-steps", "fizzy-comments"]) assert.equal(find(tree, id), null, `${id} waits for the read`);
  release();
  await cx.settle();
  acct.hold = null;
  tree = drawn(view, cx);
  assert.doesNotMatch(textOf(must(tree, "fizzy-detail")), /Loading…/);
  click(tree, "fizzy-back", cx);
  tree = drawn(view, cx);
  assert.ok(find(tree, "fizzy-list"));
  assert.deepEqual(rowIds(tree), [103, 101, 102]);
});

test("the description is drawn by the panel from its HTML: bold stays bold, a link is underlined and opens in the browser; a comment's HTML is drawn the same way", async () => {
  acct.card(101).description_html = '<div class="action-text-content"><p>The spinner <b>hangs</b>, see <a href="https://example.com/a">the log</a>.</p></div>';
  const { tree } = await openDetail();
  const rich = must(tree, "fizzy-desc-html");
  assert.equal(rich.kind, "v_flex", "no TextView: it can't color a mention or a card");
  assert.deepEqual(richLinesOf(rich), [["", "The spinner hangs, see the log.", false]]);
  assert.equal(pieceOf(rich, "hangs").style.font_bold, true);
  assert.equal(pieceOf(rich, "spinner").style.font_bold, undefined);
  const link = pieceOf(rich, "log");
  assert.deepEqual([link.style.underline, link.style.text_color, link.style.cursor_pointer], [true, "accent", true]);
  const cx = makeCx();
  fire(link, "on_click", {}, cx);
  assert.deepEqual(cx.opened, ["https://example.com/a"]);
  const comment = must(tree, "fizzy-comment-html-cm1");
  assert.deepEqual(richLinesOf(comment), [["", "Tried twice", false]]);
  assert.equal(pieceOf(comment, "twice").style.font_bold, true);
});

test("the description's HTML, its plain text, its empty line and its editor sit straight in the card, the text at 14 px", async () => {
  const { cx, draw } = await mount();
  acct.card(102).description = "Only text";
  const open = async number => {
    click(await draw(), `fizzy-card-${number}`, cx);
    return draw();
  };
  let tree = await open(101);
  assert.deepEqual([parentOf(tree, "fizzy-desc-html").id, must(tree, "fizzy-desc-html").style.text_size], ["fizzy-desc", textPx(14)], "HTML");
  click(tree, "fizzy-desc-edit", cx);
  assert.equal(parentOf(await draw(), "fizzy-desc-editor").id, "fizzy-desc", "editor");
  click(await draw(), "fizzy-desc-cancel", cx);
  click(await draw(), "fizzy-back", cx);
  tree = await open(102);
  assert.deepEqual([parentOf(tree, "fizzy-desc-text").id, must(tree, "fizzy-desc-text").style.text_size], ["fizzy-desc", textPx(14)], "plain text");
  assert.equal(find(tree, "fizzy-desc-empty"), null);
  click(await draw(), "fizzy-back", cx);
  tree = await open(103);
  assert.equal(parentOf(tree, "fizzy-desc-empty").id, "fizzy-desc", "empty");
});

test("in the description and the comments a <br> breaks the line where it stands; a paragraph or a list starts a block, with a gap above it", async () => {
  acct.card(101).description_html = '<div class="action-text-content"><p>Heading<br>Line two</p><p>• a<br>• b<br><br>• c</p><ul><li>x<br>y</li></ul></div>';
  acct.comments[101][0].body.html = "<div><p>one<br>two</p></div>";
  const { tree } = await openDetail();
  assert.deepEqual(richLinesOf(must(tree, "fizzy-desc-html")), [
    ["", "Heading", false], ["", "Line two", false], ["", "• a", true], ["", "• b", false], ["", "• c", false], ["•", "x", true], ["", "y", false],
  ]);
  assert.deepEqual(richLinesOf(must(tree, "fizzy-comment-html-cm1")), [["", "one", false], ["", "two", false]]);
  assert.deepEqual(richLinesOf(must(tree, "fizzy-comment-html-cm2")), [["", "On it", false]], "HTML without a break is one line");
});

test("a description or comment with no HTML is plain text, one line to a div and an empty line a 6 px spacer", async () => {
  acct.card(102).description = "Line one\n\nLine three that is long\nLine four";
  acct.comments[101].push({ id: "cm9", body: { html: "", plain_text: "First\r\n\r\nSecond" }, creator: ME, created_at: "2026-02-01T00:00:00Z" });
  const { cx, draw, tree: open } = await openDetail();
  const comment = must(open, "fizzy-comment-text-cm9");
  assert.deepEqual(comment.kids.map(k => [textOf(k), k.style.h ?? null]), [["First", null], ["", 6], ["Second", null]]);
  click(open, "fizzy-back", cx);
  click(await draw(), "fizzy-card-102", cx);
  const tree = await draw();
  const text = must(tree, "fizzy-desc-text");
  assert.equal(text.style.text_size, textPx(14));
  assert.deepEqual(text.kids.map(k => [textOf(k), k.style.h ?? null]), [["Line one", null], ["", 6], ["Line three that is long", null], ["Line four", null]]);
  for (const line of text.kids.filter(k => !k.style.h)) {
    assert.equal(line.kind, "div");
    assert.equal(line.style.whitespace_normal, true, "a long line wraps");
  }
  assert.ok(text.kids.filter(k => k.style.h).every(k => k.style.flex_none && k.kids.length === 0), "a spacer is empty and keeps its height");
});

test("a one-line plain description is one div", async () => {
  acct.card(102).description = "Only text";
  const { cx, draw, tree: first } = await openDetail();
  click(first, "fizzy-back", cx);
  click(await draw(), "fizzy-card-102", cx);
  const text = must(await draw(), "fizzy-desc-text");
  assert.deepEqual(text.kids.map(textOf), ["Only text"]);
});

test("a description with a list is edited as bullet lines and saved as a list, with no formatting warning", async () => {
  acct.card(101).description_html = '<div class="action-text-content"><p>Intro</p><ul><li>one</li><li>two</li></ul></div>';
  const { cx, draw, tree } = await openDetail();
  click(tree, "fizzy-desc-edit", cx);
  const next = await draw();
  const box = inputOf(next, "fizzy-desc-input");
  assert.equal(box.value(), "Intro\n\n• one\n• two");
  assert.equal(find(next, "fizzy-desc-lossy"), null, "a plain list loses nothing");
  box.edit("Intro\n\n• one\n• two\n• three", cx);
  click(next, "fizzy-desc-save", cx);
  await cx.settle();
  assert.deepEqual(acct.writes(), [["card", "update", "101", "--description", "<p>Intro</p><ul><li>one</li><li>two</li><li>three</li></ul>"]]);
});

test("a description made of lines with <br> is edited as lines and warns of nothing", async () => {
  acct.card(101).description_html = "<p>Heading<br>Line two</p><p>• a<br>• b</p>";
  const { cx, draw, tree } = await openDetail();
  click(tree, "fizzy-desc-edit", cx);
  const next = await draw();
  assert.equal(inputOf(next, "fizzy-desc-input").value(), "Heading\nLine two\n\n• a\n• b");
  assert.equal(find(next, "fizzy-desc-lossy"), null);
});

test("a card without a description says so", async () => {
  const { tree } = await openDetail(102);
  assert.match(textOf(must(tree, "fizzy-detail")), /No description/);
  assert.equal(find(tree, "fizzy-desc-html"), null);
});

test("a card Fizzy answers without its empty lists and texts is read whole: People and Tags open their pickers, and a description written on it shows as HTML at once", async () => {
  const { view, cx, draw, tree } = await openDetail(103);
  for (const id of ["fizzy-people", "fizzy-tags"]) assert.equal(typeof must(tree, id).handlers.on_click, "function", id);
  assert.match(textOf(must(tree, "fizzy-detail-assigned")), /ASSIGNED TO NOBODY/);
  assert.equal(find(tree, "fizzy-tag-list"), null, "no tags, no line of them");
  click(tree, "fizzy-desc-edit", cx);
  const next = await draw();
  inputOf(next, "fizzy-desc-input").edit("Due before the beta", cx);
  let release;
  acct.hold = new Promise(resolve => { release = resolve; });
  click(next, "fizzy-desc-save", cx);
  const shown = find(drawn(view, cx), "fizzy-desc-html");
  release();
  await cx.settle();
  acct.hold = null;
  assert.equal(shown && plain(shown), "Due before the beta", "drawn from its HTML before Fizzy has answered");
  assert.deepEqual(acct.writes(), [["card", "update", "103", "--description", "<p>Due before the beta</p>"]]);
});

test("a description emptied and saved is cleared in Fizzy (sent as an empty paragraph, which the CLI does not drop) and reads back as No description", async () => {
  const { cx, draw, tree } = await openDetail(101);
  click(tree, "fizzy-desc-edit", cx);
  inputOf(await draw(), "fizzy-desc-input").edit("", cx);
  click(await draw(), "fizzy-desc-save", cx);
  await cx.settle();
  assert.deepEqual(acct.writes(), [["card", "update", "101", "--description", "<p></p>"]]);
  assert.match(textOf(must(await draw(), "fizzy-detail")), /No description/);
});

test("ticking a step shows at once and sends the exact argv; a failed write reads the truth back", async () => {
  const { view, cx, draw, tree } = await openDetail();
  const checked = t => all(must(t, "fizzy-step-s1"), n => n.style.line_through).length;
  assert.equal(checked(tree), 0);
  let release;
  acct.hold = new Promise(resolve => { release = resolve; });
  click(tree, "fizzy-step-check-s1", cx);
  assert.equal(checked(drawn(view, cx)), 1, "flipped before Fizzy has answered");
  assert.deepEqual(acct.writes(), [["step", "update", "s1", "--card", "101", "--completed"]]);
  release();
  await cx.settle();
  acct.hold = null;
  assert.equal(checked(await draw()), 1);
  click(await draw(), "fizzy-step-check-s2", cx);
  assert.deepEqual(acct.writes().at(-1), ["step", "update", "s2", "--card", "101", "--not_completed"]);
  await cx.settle();
  // A refusal: the step goes back.
  acct.fail = args => (args[0] === "step" ? failure("not_found", "Resource not found") : undefined);
  click(await draw(), "fizzy-step-check-s1", cx);
  assert.equal(checked(drawn(view, cx)), 0, "flipped back at once");
  await cx.settle();
  acct.fail = null;
  assert.equal(calls.notify.at(-1).level, "error");
  assert.equal(checked(await draw()), 1, "and after reading again, as Fizzy has it");
});

test("a step's bin shows only while the pointer is on the step; in its place meanwhile, an empty space of its size", async () => {
  const { cx, draw, tree } = await openDetail();
  const end = (tr, id) => must(tr, id).kids.at(-1);
  for (const id of ["fizzy-step-s1", "fizzy-step-s2"]) {
    assert.deepEqual([end(tree, id).id, end(tree, id).style.size, Object.keys(end(tree, id).handlers)], [null, 22, []], `${id}: no bin`);
  }
  fire(must(tree, "fizzy-step-s2"), "on_hover", true, cx);
  let next = await draw();
  assert.equal(end(next, "fizzy-step-s2").id, "fizzy-step-del-s2", "the step under the pointer shows it");
  assert.equal(find(next, "fizzy-step-del-s1"), null, "the others do not");
  fire(must(next, "fizzy-step-s1"), "on_hover", true, cx);
  fire(must(next, "fizzy-step-s2"), "on_hover", false, cx);
  next = await draw();
  assert.deepEqual([Boolean(find(next, "fizzy-step-del-s1")), Boolean(find(next, "fizzy-step-del-s2"))], [true, false], "it follows the pointer, whatever order enter and leave come in");
  fire(must(next, "fizzy-step-s1"), "on_hover", false, cx);
  assert.equal(find(await draw(), "fizzy-step-del-s1"), null, "gone once the pointer leaves");
});

test("a step is added from its field and removed by its bin; its box and its text take clicks, the row itself does not", async () => {
  const { cx, draw, tree } = await openDetail();
  assert.equal(must(tree, "fizzy-step-s1").handlers.on_click, undefined, "the row has no click of its own");
  assert.deepEqual(["fizzy-step-check-s1", "fizzy-step-text-s1"].map(id => typeof must(tree, id).handlers.on_click), ["function", "function"]);
  assert.equal(must(tree, "fizzy-step-s1").hover, false);
  assert.equal(tipOf(tree, "fizzy-step-text-s1"), undefined, "no hint text on the step");
  assert.equal(must(tree, "fizzy-step-text-s2").style.line_through, true);
  assert.equal(must(tree, "fizzy-step-text-s2").style.text_color, "dim", "theme() answers each color's own name in the tests");
  const row = must(tree, "fizzy-step-new-row");
  assert.deepEqual(row.kids.map(k => k.id ?? "box"), ["box", "fizzy-step-input"], "an empty box, as a step's, then the field");
  assert.equal(inputOf(tree, "fizzy-step-input").options.placeholder, "Add a step…");
  const input = inputOf(tree, "fizzy-step-input");
  input.edit("Ship it", cx);
  input.submit(cx);
  await cx.settle();
  assert.deepEqual(acct.writes(), [["step", "create", "--card", "101", "--content", "Ship it"]]);
  assert.equal(input.value(), "", "cleared");
  fire(must(await draw(), "fizzy-step-s2"), "on_hover", true, cx);
  const next = await draw();
  assert.match(textOf(must(next, "fizzy-detail")), /Ship it/);
  const bin = must(next, "fizzy-step-del-s2");
  assert.deepEqual([all(bin, n => n.kind === "svg")[0].path, tipOf(next, "fizzy-step-del-s2"), bin.style.size], ["mods/fizzy/trash.svg", "Delete", 22]);
  fire(bin, "on_click", {}, cx);
  assert.equal(cx.stopped, 1, "the row's own click does not also toggle it");
  await cx.settle();
  assert.deepEqual(acct.writes().at(-1), ["step", "delete", "s2", "--card", "101"]);
});

test("editing the title: the field starts with it, Enter sends the update, an unchanged or empty title sends nothing", async () => {
  const { cx, draw, tree } = await openDetail();
  const title = must(tree, "fizzy-title");
  assert.deepEqual([title.style.text_size, title.style.font_bold, title.style.text_color, title.hover, title.style.cursor_pointer], [textPx(17), true, lighten(must(tree, "fizzy-lane").style.bg, 0.55), true, true],
    "big and bold, in a light tint of the lane's color");
  assert.equal(tipOf(tree, "fizzy-title"), undefined, "the title has no tooltip");
  click(tree, "fizzy-title", cx);
  let next = await draw();
  assert.equal(find(next, "fizzy-title"), null, "the field replaces the title");
  assert.deepEqual(Object.keys(must(next, "fizzy-title-edit").handlers).sort(), ["on_key_down", "on_mouse_down:left"]);
  assert.deepEqual([all(must(next, "fizzy-title-cancel"), n => n.kind === "svg")[0].path, tipOf(next, "fizzy-title-cancel")], ["mods/fizzy/x.svg", "Cancel"]);
  const input = inputOf(next, "fizzy-title-input");
  assert.equal(input.value(), "Fix the login redirect");
  assert.equal(input.focused, true);
  input.edit("Fix the login loop", cx);
  input.submit(cx);
  await cx.settle();
  assert.deepEqual(acct.writes(), [["card", "update", "101", "--title", "Fix the login loop"]]);
  next = await draw();
  assert.equal(textOf(must(next, "fizzy-title")), "Fix the login loop");
  assert.equal(find(next, "fizzy-title-input"), null);
  click(next, "fizzy-title", cx);
  next = await draw();
  inputOf(next, "fizzy-title-input").submit(cx);
  await cx.settle();
  assert.equal(acct.writes().length, 1, "unchanged: nothing sent");
  click(await draw(), "fizzy-title", cx);
  next = await draw();
  inputOf(next, "fizzy-title-input").edit("  ", cx);
  inputOf(next, "fizzy-title-input").submit(cx);
  await cx.settle();
  assert.equal(acct.writes().length, 1, "empty: nothing sent");
  click(await draw(), "fizzy-title", cx);
  click(await draw(), "fizzy-title-cancel", cx);
  assert.equal(find(await draw(), "fizzy-title-input"), null, "the x leaves the edit");
  click(await draw(), "fizzy-title", cx);
  fire(must(await draw(), "fizzy-title-edit"), "on_key_down", { key: "escape" }, cx);
  assert.equal(find(await draw(), "fizzy-title-input"), null, "Escape on the row leaves it too");
  assert.equal(acct.writes().length, 1);
});

test("a comment is sent as HTML (escaped, paragraphs), then the box is emptied; the person's own can be deleted in two clicks", async () => {
  const { cx, draw, tree } = await openDetail();
  const area = inputOf(tree, "fizzy-comment-input");
  assert.equal(area.options.rows, 3);
  area.edit("a < b & \"c\"\n\nsecond\nline", cx);
  click(tree, "fizzy-comment-send", cx);
  await cx.settle();
  assert.deepEqual(acct.writes(), [["comment", "create", "--card", "101", "--body", "<p>a &lt; b &amp; &quot;c&quot;</p><p>second<br>line</p>"]]);
  assert.equal(area.value(), "");
  click(tree, "fizzy-comment-send", cx);
  await cx.settle();
  assert.equal(acct.writes().length, 1, "nothing to send, nothing sent");
  let next = await draw();
  assert.equal(find(next, "fizzy-comment-del-cm2"), null, "only one's own comments");
  assert.equal(find(next, "fizzy-comment-del-cm3"), null);
  assert.equal(find(next, "fizzy-comment-edit-cm2"), null);
  for (const [id, icon, tip] of [["fizzy-comment-edit-cm1", "pencil", "Edit"], ["fizzy-comment-del-cm1", "trash", "Delete"]]) {
    const button = must(next, id);
    assert.deepEqual([all(button, n => n.kind === "svg")[0].path, tipOf(next, id), button.style.size], [`mods/fizzy/${icon}.svg`, tip, 22]);
  }
  const bubble = must(next, "fizzy-comment-cm1").kids[1];
  assert.deepEqual([bubble.style.bg, bubble.style.rounded, bubble.style.px], ["raised", 8, 12], "the name, when and the text in one box beside the photo");
  assert.ok(find(bubble, "fizzy-comment-html-cm1"), "the text is in it");
  click(next, "fizzy-comment-del-cm1", cx);
  next = await draw();
  assert.match(textOf(must(next, "fizzy-comment-del-cm1")), /Delete\?/);
  assert.equal(must(next, "fizzy-comment-del-cm1").style.text_color, "blocked");
  assert.equal(tipOf(next, "fizzy-comment-del-cm1"), undefined, "no tooltip on the armed bin");
  assert.equal(typeof must(next, "fizzy-comment-del-cm1").handlers.on_mouse_down_out, "function");
  assert.equal(acct.writes().length, 1, "the first click only asks");
  fire(must(next, "fizzy-comment-del-cm1"), "on_mouse_down_out", {}, cx);
  next = await draw();
  assert.equal(all(must(next, "fizzy-comment-del-cm1"), n => n.kind === "svg")[0].path, "mods/fizzy/trash.svg", "any other press disarms it");
  assert.equal(acct.writes().length, 1);
  click(next, "fizzy-comment-del-cm1", cx);
  next = await draw();
  click(next, "fizzy-comment-del-cm1", cx);
  await cx.settle();
  assert.deepEqual(acct.writes().at(-1), ["comment", "delete", "cm1", "--card", "101"]);
  assert.equal(acct.writes().filter(a => a[0] === "comment" && a[1] === "delete").length, 1);
});

test("editing the description: Edit under the card, plain text in a box (8 rows), saved as HTML; Cancel leaves it alone", async () => {
  const { cx, draw, tree } = await openDetail();
  assert.deepEqual(must(tree, "fizzy-card-actions").kids.map(k => k.id), ["fizzy-desc-edit", "fizzy-done"]);
  assert.equal(textOf(must(tree, "fizzy-desc-edit")), "Edit");
  click(tree, "fizzy-desc-edit", cx);
  let next = await draw();
  const area = inputOf(next, "fizzy-desc-input");
  assert.equal(area.options.rows, 8);
  assert.equal(area.value(), "The spinner hangs.");
  assert.equal(find(next, "fizzy-desc-html"), null, "the box replaces the text while editing");
  assert.equal(find(next, "fizzy-desc-edit"), null, "no Edit while editing");
  const editor = must(next, "fizzy-desc-editor");
  assert.equal(all(must(next, "fizzy-desc-input"), n => n.kind === "textarea")[0].style.px, 8);
  assert.equal(textOf(must(next, "fizzy-desc-lossy")), "Saving keeps only the text: formatting is lost.", "this description has a <b>");
  const buttons = all(editor, n => n.style.justify_end)[0].kids.map(k => k.id);
  assert.deepEqual(buttons, ["fizzy-desc-cancel", "fizzy-desc-save"], "primary last, at the right");
  click(next, "fizzy-desc-cancel", cx);
  next = await draw();
  assert.equal(acct.writes().length, 0);
  assert.ok(find(next, "fizzy-desc-html"));
  click(next, "fizzy-desc-edit", cx);
  next = await draw();
  fire(must(next, "fizzy-desc-editor"), "on_key_down", { key: "escape" }, cx);
  assert.ok(find(await draw(), "fizzy-desc-html"), "Escape closes it too");
  click(await draw(), "fizzy-desc-edit", cx);
  next = await draw();
  const box = inputOf(next, "fizzy-desc-input");
  box.edit("New <text>\n\nSecond", cx);
  click(next, "fizzy-desc-save", cx);
  await cx.settle();
  assert.deepEqual(acct.writes(), [["card", "update", "101", "--description", "<p>New &lt;text&gt;</p><p>Second</p>"]]);
  assert.equal(find(await draw(), "fizzy-desc-input"), null);
});

test("the formatting warning shows only when saving would lose formatting", async () => {
  for (const [html, lossy] of [["<p>Plain</p>", false], ["<p>The spinner <b>hangs</b>.</p>", true]]) {
    setup();
    const { cx, draw } = await mount();
    let tree = await draw();
    acct.card(101).description_html = html;
    click(tree, "fizzy-card-101", cx);
    tree = await draw();
    click(tree, "fizzy-desc-edit", cx);
    tree = await draw();
    assert.ok(find(tree, "fizzy-desc-editor"), html);
    assert.equal(Boolean(find(tree, "fizzy-desc-lossy")), lossy, html);
  }
});

test("the polling skips a card while its title or description is being edited", async () => {
  for (const edit of ["fizzy-title", "fizzy-desc-edit"]) {
    setup();
    const { cx, draw, tree } = await openDetail();
    click(tree, edit, cx);
    await draw();
    const before = acct.log.length;
    timer(cx, POLL_VIEW).fn(cx);
    await cx.settle();
    assert.equal(acct.log.length, before, edit);
  }
});

const holdOn = () => { let release; acct.hold = new Promise(resolve => { release = resolve; }); return () => { release(); acct.hold = null; }; };
const iconOf = (tree, id) => all(must(tree, id), n => n.kind === "svg")[0].path.replace("mods/fizzy/", "");
const looks = (tree, id) => {
  const el = must(tree, id);
  return { icon: iconOf(tree, id), color: el.style.text_color, bg: el.style.bg, tip: el.style.tooltip, hover: el.hover, pointer: el.style.cursor_pointer, click: typeof el.handlers.on_click };
};
const watchedBy = () => JSON.parse(localStorage.getItem("watching") ?? "[]");
const errors = () => calls.notify.filter(n => n.level === "error");
// Settling would wait for the held CLI calls, so the panel's 1 ms timer for a popup's request is run by hand.
const heldRequest = async (view, cx, op) => {
  state.shared["fizzy.request"] = { id: `r${Math.random()}`, op };
  drawn(view, cx);
  for (const t of cx.timers.filter(x => x.after && x.ms <= 1)) { cx.timers.splice(cx.timers.indexOf(t), 1); t.fn(cx); }
  await tick();
};
async function cardMenuPopup(tree, cx) {
  click(tree, "fizzy-card-menu", cx);
  await cx.settle();
  return mountPopup();
}

test("the card view's ⋯ menu moves the card, reopens it and deletes it", async () => {
  const { cx, draw, tree } = await openDetail();
  let popup = await cardMenuPopup(tree, cx);
  assert.equal(find(popup.tree(), "fizzy-menu-reopen"), null, "an open card has nothing to reopen");
  menuClick(popup, "lane-not-now");
  await draw();
  assert.deepEqual(acct.writes(), [["card", "postpone", "101"]]);
  assert.match(textOf(must(await draw(), "fizzy-lane")), /Not Now/i);
  popup = await cardMenuPopup(await draw(), cx);
  menuClick(popup, "lane-done");
  await draw();
  assert.deepEqual(acct.writes().at(-1), ["card", "close", "101"]);
  assert.match(textOf(must(await draw(), "fizzy-lane")), /Done/i);
  popup = await cardMenuPopup(await draw(), cx);
  const order = menuRows(lastPopup().props.menu, { agents: [], focused: null, boards: [] }).map(r => r.id);
  assert.equal(order[order.indexOf("sep-hand") + 1], "reopen", "Reopen comes first after the hand-off rows");
  menuClick(popup, "reopen");
  assert.deepEqual(requestOps().at(-1), { kind: "reopen", number: 101 });
  await draw();
  assert.deepEqual(acct.writes().at(-1), ["card", "reopen", "101"]);
  assert.equal(acct.writes().filter(a => a[1] === "reopen").length, 1);
  assert.doesNotMatch(textOf(must(await draw(), "fizzy-lane")), /Done/i);
  popup = await cardMenuPopup(await draw(), cx);
  menuClick(popup, "delete");
  assert.equal(acct.writes().filter(a => a[1] === "delete").length, 0, "the first click only asks");
  menuClick(popup, "delete");
  await draw();
  assert.deepEqual(acct.writes().at(-1), ["card", "delete", "101"]);
  const after = await draw();
  assert.ok(find(after, "fizzy-list"), "back on the list");
  assert.equal(find(after, "fizzy-card-101"), null);
});

test("Reopen from the menu shows at once: the lane stops reading Done before Fizzy has answered", async () => {
  const { view, cx, draw } = await mount();
  await draw();
  await press(cx, "open:105");
  const tree = await draw();
  assert.match(textOf(must(tree, "fizzy-lane")), /Done/i);
  const popup = await cardMenuPopup(tree, cx);
  let release;
  acct.hold = new Promise(resolve => { release = resolve; });
  menuClick(popup, "reopen");
  assert.deepEqual(requestOps(), [{ kind: "reopen", number: 105 }]);
  await heldRequest(view, cx, { kind: "reopen", number: 105 });
  assert.doesNotMatch(textOf(must(drawn(view, cx), "fizzy-lane")), /Done/i, "changed before the answer");
  release();
  await cx.settle();
  acct.hold = null;
  assert.deepEqual(acct.writes(), [["card", "reopen", "105"]]);
});

test("the pin toggle is dim and inert until the pin list is read, then muted (not pinned) or lit (pinned); a click shows at once and reads the pin list once more", async () => {
  acct.fail = args => (args[0] === "pin" ? failure("network", "offline") : undefined);
  const { view, cx, draw } = await mount();
  let tree = await draw();
  acct.fail = null;
  const release = holdOn();
  click(tree, "fizzy-card-101", cx);
  assert.deepEqual(looks(drawn(view, cx), "fizzy-pin"), { icon: "pin.svg", color: "dim", bg: undefined, tip: undefined, hover: false, pointer: undefined, click: "undefined" },
    "the read at start failed, the card's is out");
  release();
  await cx.settle();
  assert.equal(acct.asked("pin", "list").length, 2, "the one at start, and the card's");
  tree = await draw();
  assert.deepEqual(looks(tree, "fizzy-pin"), { icon: "pin.svg", color: "muted", bg: undefined, tip: "Pin", hover: true, pointer: true, click: "function" });
  const again = holdOn();
  click(tree, "fizzy-pin", cx);
  assert.deepEqual(acct.writes(), [["card", "pin", "101"]]);
  assert.deepEqual(looks(drawn(view, cx), "fizzy-pin"), { icon: "pin.svg", color: "accent", bg: "selected", tip: "Unpin", hover: true, pointer: true, click: "function" }, "lit before Fizzy answers");
  again();
  await cx.settle();
  assert.equal(acct.asked("pin", "list").length, 3, "one more read of the pin list, not two");
  tree = await draw();
  assert.equal(looks(tree, "fizzy-pin").color, "accent");
  click(tree, "fizzy-pin", cx);
  await cx.settle();
  assert.deepEqual(acct.writes().at(-1), ["card", "unpin", "101"]);
  assert.equal(looks(await draw(), "fizzy-pin").color, "muted");
});

test("a pinned card opens with its pin lit; in the Pins view a write reads the pin list once", async () => {
  acct.pins.push(acct.card(101));
  const first = await openDetail();
  assert.equal(looks(first.tree, "fizzy-pin").color, "accent");
  setup();
  acct.pins.push(acct.card(101));
  localStorage.setItem("view", '"pins"');
  const { cx, draw } = await mount();
  let tree = await draw();
  click(tree, "fizzy-card-101", cx);
  tree = await draw();
  const reads = acct.asked("pin", "list").length;
  click(tree, "fizzy-pin", cx);
  await cx.settle();
  assert.deepEqual(acct.writes(), [["card", "unpin", "101"]]);
  assert.equal(acct.asked("pin", "list").length, reads + 1, "read once, not by the list and the card both");
  assert.equal(looks(await draw(), "fizzy-pin").color, "muted");
});

test("the golden toggle: muted when off, a lit star when on; a click shows at once and writes; a card from a list knows it", async () => {
  const { view, cx, draw, tree } = await openDetail();
  assert.deepEqual(looks(tree, "fizzy-golden"), { icon: "star.svg", color: "muted", bg: undefined, tip: "Mark golden", hover: true, pointer: true, click: "function" });
  click(tree, "fizzy-golden", cx);
  assert.deepEqual(looks(drawn(view, cx), "fizzy-golden"), { icon: "star.svg", color: "#e5b422", bg: "selected", tip: "Remove golden", hover: true, pointer: true, click: "function" });
  await cx.settle();
  assert.deepEqual(acct.writes(), [["card", "golden", "101"]]);
  click(await draw(), "fizzy-golden", cx);
  await cx.settle();
  assert.deepEqual(acct.writes().at(-1), ["card", "ungolden", "101"]);
  assert.equal(looks(await draw(), "fizzy-golden").color, "muted");
  const second = await openDetail(102);
  assert.deepEqual([looks(second.tree, "fizzy-golden").color, looks(second.tree, "fizzy-golden").bg], ["#e5b422", "selected"]);
});

test("the watch toggle shows only what was set here: a dim eye that watches when clicked, a lit eye, a crossed one; remembered between copies", async () => {
  const { view, cx, draw, tree } = await openDetail();
  assert.deepEqual(looks(tree, "fizzy-watch"), { icon: "bell.svg", color: "dim", bg: undefined, tip: "Watch", hover: true, pointer: true, click: "function" });
  const toasts = calls.notify.length;
  click(tree, "fizzy-watch", cx);
  await cx.settle();
  assert.deepEqual(acct.writes(), [["card", "watch", "101"]]);
  assert.equal(calls.notify.length, toasts, "the card view shows it: no toast");
  assert.deepEqual(looks(drawn(view, cx), "fizzy-watch"), { icon: "bell.svg", color: "accent", bg: "selected", tip: "Stop watching", hover: true, pointer: true, click: "function" });
  assert.deepEqual(watchedBy(), [[101, true]]);
  click(await draw(), "fizzy-watch", cx);
  await cx.settle();
  assert.deepEqual(acct.writes().at(-1), ["card", "unwatch", "101"]);
  assert.deepEqual(looks(drawn(view, cx), "fizzy-watch"), { icon: "bell-off.svg", color: "muted", bg: undefined, tip: "Watch", hover: true, pointer: true, click: "function" });
  assert.deepEqual(watchedBy(), [[101, false]]);
  const next = await openDetail();
  assert.equal(looks(next.tree, "fizzy-watch").icon, "bell-off.svg", "a new copy remembers it");
});

test("what is remembered about watching is kept newest last, at most 200 cards, and a damaged store is ignored", async () => {
  localStorage.setItem("watching", JSON.stringify([...Array.from({ length: 200 }, (_, i) => [i + 1, true]), "x", [1.5, true], [7, "yes"]]));
  const { view, cx, draw, tree } = await openDetail();
  assert.equal(view.watching.size, 200);
  click(tree, "fizzy-watch", cx);
  await cx.settle();
  assert.equal(watchedBy().length, 200);
  assert.deepEqual(watchedBy().at(-1), [101, false], "101 was already there: moved to the end");
  assert.equal(watchedBy().filter(([n]) => n === 101).length, 1);
  await draw();
  view.rememberWatch(4300, true);
  assert.equal(watchedBy().length, 200);
  assert.equal(watchedBy().some(([n]) => n === 1), false, "the oldest went");
  assert.deepEqual(watchedBy().at(-1), [4300, true]);
  setup();
  localStorage.setItem("watching", "not json{");
  const damaged = await openDetail();
  assert.equal(looks(damaged.tree, "fizzy-watch").color, "dim");
});

test("a refused watch puts back what was there and tells the person; a later opposite click wins", async () => {
  acct.fail = args => (args[0] === "card" && args[1] === "watch" ? failure("api_error", "No") : undefined);
  const { view, cx, draw, tree } = await openDetail();
  click(tree, "fizzy-watch", cx);
  await cx.settle();
  assert.equal(looks(await draw(), "fizzy-watch").icon, "bell.svg");
  assert.equal(looks(drawn(view, cx), "fizzy-watch").color, "dim");
  assert.equal(looks(drawn(view, cx), "fizzy-watch").bg, undefined);
  assert.deepEqual(watchedBy(), []);
  assert.equal(errors().length, 1);
  assert.equal(calls.notify.some(n => /Watching/.test(n.body)), false);
  const second = await openDetail();
  const release = holdOn();
  click(second.tree, "fizzy-watch", second.cx);
  click(drawn(second.view, second.cx), "fizzy-watch", second.cx);
  release();
  await second.cx.settle();
  assert.deepEqual(looks(drawn(second.view, second.cx), "fizzy-watch").icon, "bell-off.svg");
  assert.equal(looks(drawn(second.view, second.cx), "fizzy-watch").color, "muted");
  assert.deepEqual(watchedBy(), [[101, false]]);
  assert.equal(errors().length, 2, "one more error, for the first click only");
});

test("a remembered 'not watching' is forgotten when the person comments on the card or takes it; a remembered 'watching' is kept", async () => {
  for (const [on, how] of [[false, "comment"], [false, "selfAssign"], [false, "assign"], [true, "comment"], [true, "selfAssign"], [true, "assign"]]) {
    setup();
    localStorage.setItem("watching", JSON.stringify([[101, on]]));
    const { view, cx, draw, tree } = await openDetail();
    assert.equal(looks(tree, "fizzy-watch").icon, on ? "bell.svg" : "bell-off.svg", `${how}: starts as remembered`);
    if (how === "comment") {
      inputOf(tree, "fizzy-comment-input").edit("hello", cx);
      click(tree, "fizzy-comment-send", cx);
    } else {
      state.shared["fizzy.request"] = { id: `r-${how}`, op: how === "assign" ? { kind: "assign", number: 101, user: "u-me" } : { kind: "selfAssign", number: 101 } };
      drawn(view, cx);
      await due(cx);
    }
    await cx.settle();
    const next = await draw();
    if (on) assert.deepEqual([looks(next, "fizzy-watch").color, watchedBy()], ["accent", [[101, true]]], `${how}: kept`);
    else assert.deepEqual([looks(next, "fizzy-watch").icon, looks(next, "fizzy-watch").color, looks(next, "fizzy-watch").bg, watchedBy()], ["bell.svg", "dim", undefined, []], `${how}: forgotten`);
  }
});

test("a watch request from a list or a menu toasts once Fizzy has accepted it, and only while that card's view is not open", async () => {
  const { view, cx, draw } = await mount();
  await draw();
  const release = holdOn();
  await heldRequest(view, cx, { kind: "watch", number: 102, on: true });
  assert.equal(calls.notify.filter(n => /Watching/.test(n.body)).length, 0, "not before Fizzy answers");
  release();
  await cx.settle();
  assert.deepEqual(calls.notify.filter(n => /Watching/.test(n.body)).map(n => n.body), ["Watching #102"]);
  acct.fail = args => (args[1] === "watch" || args[1] === "unwatch" ? failure("api_error", "No") : undefined);
  await heldRequest(view, cx, { kind: "watch", number: 103, on: true });
  await cx.settle();
  assert.equal(calls.notify.filter(n => /Watching/.test(n.body)).length, 1, "a refusal does not say it");
  assert.equal(errors().length, 1);
  acct.fail = null;
  click(await draw(), "fizzy-card-102", cx);
  await heldRequest(view, cx, { kind: "watch", number: 102, on: false });
  await cx.settle();
  assert.equal(calls.notify.filter(n => /watching/i.test(n.body)).length, 1, "the open card shows it itself");
  let tree = await draw();
  assert.deepEqual([looks(tree, "fizzy-watch").icon, looks(tree, "fizzy-watch").color], ["bell-off.svg", "muted"]);
  await heldRequest(view, cx, { kind: "watch", number: 102, on: true });
  await cx.settle();
  assert.equal(calls.notify.filter(n => /watching/i.test(n.body)).length, 1, "watching the open card is not toasted either");
  tree = await draw();
  assert.deepEqual([looks(tree, "fizzy-watch").icon, looks(tree, "fizzy-watch").color, looks(tree, "fizzy-watch").bg], ["bell.svg", "accent", "selected"]);
});

test("the toggles are 30 px round in every state, and an on toggle is told apart from an off one under the pointer by its icon", async () => {
  const { view, cx, draw } = await mount();
  let tree = await draw();
  const release = holdOn();
  click(tree, "fizzy-card-101", cx);
  tree = drawn(view, cx);
  for (const id of ["fizzy-pin", "fizzy-watch", "fizzy-golden"]) assert.equal(must(tree, id).style.size, 30, `${id}: not known`);
  release();
  await cx.settle();
  tree = await draw();
  for (const id of ["fizzy-pin", "fizzy-watch", "fizzy-golden"]) {
    const off = must(tree, id);
    assert.deepEqual([off.style.size, off.hoverStyle.text_color, off.hoverStyle.bg], [30, "foreground", "hover"], `${id}: off`);
    click(tree, id, cx);
  }
  await cx.settle();
  tree = await draw();
  for (const [id, color] of [["fizzy-pin", "accent"], ["fizzy-watch", "accent"], ["fizzy-golden", "#e5b422"]]) {
    const on = must(tree, id);
    assert.deepEqual([on.style.size, on.style.text_color, on.style.bg, on.hoverStyle.bg, on.hoverStyle.text_color], [30, color, "selected", "hover", undefined], `${id}: on`);
    assert.notEqual(on.style.text_color, "foreground", `${id}: lit differs from the off hover colour`);
  }
});

test("a card opened by its number is only 'Loading…' until it is read: no title, lane, people or tags; the board is empty; golden and the link are inert", async () => {
  const { view, cx, draw } = await mount();
  await draw();
  const release = holdOn();
  sendCommand("open:105");
  await tick();
  const tree = drawn(view, cx);
  for (const id of ["fizzy-detail-top", "fizzy-detail-meta", "fizzy-desc", "fizzy-steps", "fizzy-comments", "fizzy-title", "fizzy-lane"]) assert.equal(find(tree, id), null, id);
  assert.equal(textOf(must(tree, "fizzy-detail")).split("Loading…").length - 1, 1);
  assert.equal(find(tree, "fizzy-card-frame"), null, "no card drawn before it is read, nor its board");
  assert.deepEqual([looks(tree, "fizzy-golden").color, looks(tree, "fizzy-golden").click], ["dim", "undefined"]);
  assert.equal(looks(tree, "fizzy-watch").click, "function", "the bell still watches");
  assert.equal(isOff(tree, "fizzy-act-open"), true);
  release();
  await cx.settle();
  const read = await draw();
  assert.equal(textOf(must(read, "fizzy-title")), "Shipped thing");
  assert.match(textOf(must(read, "fizzy-lane")), /Done/i);
  assert.deepEqual([looks(read, "fizzy-golden").color, looks(read, "fizzy-golden").click], ["muted", "function"]);
  assert.match(textOf(must(read, "fizzy-detail-board")), /^ROADMAP/);
});

test("a note's card that no list holds waits for the read: people and tags are inert, and its own board's lanes come once it is read", async () => {
  localStorage.setItem("follow", "false");
  localStorage.setItem("board", '"b2"');
  localStorage.setItem("view", '"inbox"');
  const { view, cx, draw } = await mount();
  let tree = await draw();
  const release = holdOn();
  click(tree, "fizzy-note-n1", cx);
  tree = drawn(view, cx);
  assert.match(textOf(must(tree, "fizzy-detail-board")), /^ROADMAP/, "the note's board");
  for (const id of ["fizzy-people", "fizzy-tags"]) assert.deepEqual([must(tree, id).handlers.on_click, must(tree, id).hover], [undefined, false], id);
  assert.equal(textOf(must(tree, "fizzy-detail-assigned")).trim(), "ASSIGNED TO", "not known: not 'nobody'");
  assert.deepEqual([looks(tree, "fizzy-golden").color, looks(tree, "fizzy-golden").click], ["dim", "undefined"]);
  assert.equal(find(tree, "fizzy-lane-c2"), null, "b1's lanes are not known yet");
  release();
  await cx.settle();
  tree = await draw();
  assert.match(textOf(must(tree, "fizzy-lane")), /In progress/i);
  assert.ok(["fizzy-lane-maybe", "fizzy-lane-c2", "fizzy-lane-done"].every(id => find(tree, id)), "b1's lanes, read for it, not b2's");
});

test("a note's card that a list holds opens with that copy: people known, golden clickable", async () => {
  const { view, cx, draw } = await mount();
  let tree = await draw();
  click(tree, "fizzy-view-inbox", cx);
  tree = await draw();
  const release = holdOn();
  click(tree, "fizzy-note-n1", cx);
  tree = drawn(view, cx);
  assert.match(textOf(must(tree, "fizzy-detail-assigned")), /ADA/);
  assert.equal(typeof must(tree, "fizzy-people").handlers.on_click, "function");
  assert.deepEqual([looks(tree, "fizzy-golden").color, looks(tree, "fizzy-golden").click], ["muted", "function"]);
  release();
  await cx.settle();
});

test("the ⋯ of a note's card reads the card first: the menu carries its golden state and its own board's lanes", async () => {
  localStorage.setItem("follow", "false");
  localStorage.setItem("board", '"b2"');
  localStorage.setItem("view", '"inbox"');
  const { view, cx, draw } = await mount();
  let tree = await draw();
  const release = holdOn();
  click(tree, "fizzy-note-n2", cx);
  tree = drawn(view, cx);
  const before = calls.openOverlay.length;
  click(tree, "fizzy-card-menu", cx);
  assert.equal(calls.openOverlay.length, before, "no popup while the card is unread");
  release();
  await cx.settle();
  assert.equal(calls.openOverlay.length, before + 1);
  assert.equal(lastPopup().props.menu.card.golden, true);
  const popup = await mountPopup();
  assert.match(textOf(must(popup.tree(), "fizzy-menu-golden")), /Remove golden/);
});

test("the card menu knows the pin and watch state: pinned when the pin list was read, watching when set here; a row's menu before any read has neither", async () => {
  acct.fail = args => (args[0] === "pin" ? failure("network", "offline") : undefined);
  const { cx, draw } = await mount();
  const tree = await draw();
  click(tree, "fizzy-more-101", cx);
  await cx.settle();
  assert.equal("pinned" in lastPopup().props.menu, false, "no pin list read yet");
  assert.equal("watching" in lastPopup().props.menu, false);
  acct.fail = null;
  const later = await mount();
  click(await later.draw(), "fizzy-more-101", later.cx);
  await later.cx.settle();
  assert.equal(lastPopup().props.menu.pinned, false, "the pin list read at start");
  acct.pins.push(acct.card(101));
  const open = await openDetail();
  click(open.tree, "fizzy-card-menu", open.cx);
  await open.cx.settle();
  assert.equal(lastPopup().props.menu.pinned, true);
  assert.equal("watching" in lastPopup().props.menu, false, "watching was not set here");
  const rows = menuRows(lastPopup().props.menu, { agents: [], focused: null, boards: [], me: "u-me" });
  assert.equal(lastPopup().height, Math.min(560, menuHeight(rows)));
  click(open.tree, "fizzy-watch", open.cx);
  await open.cx.settle();
  click(await open.draw(), "fizzy-card-menu", open.cx);
  await open.cx.settle();
  assert.equal(lastPopup().props.menu.watching, true);
  const rowsAfter = menuRows(lastPopup().props.menu, { agents: [], focused: null, boards: [], me: "u-me" });
  assert.equal(lastPopup().height, Math.min(560, menuHeight(rowsAfter)));
  assert.equal(rowsAfter.some(r => r.id === "watch"), false);
});

test("at 300 px the card's Open in Fizzy gives way and the toggles and ⋯ stay; at 520 px it is back", async () => {
  const { cx, draw, tree } = await openDetail();
  const order = tree => ids(tree).slice(ids(tree).indexOf("fizzy-back"), ids(tree).indexOf("fizzy-detail"));
  fire(must(tree, "fizzy"), "on_size_change", { width: 300, height: 600 }, cx);
  const narrow = await draw();
  assert.deepEqual(order(narrow), ["fizzy-back", "fizzy-golden", "fizzy-watch", "fizzy-pin", "fizzy-card-menu"]);
  fire(must(narrow, "fizzy"), "on_size_change", { width: 520, height: 600 }, cx);
  assert.deepEqual(order(await draw()), ["fizzy-back", "fizzy-golden", "fizzy-watch", "fizzy-pin", "fizzy-act-open", "fizzy-card-menu"]);
});

test("the card page lists its board's lanes in the board's order, its own filled in its color; a click on another moves the card there at once", async () => {
  const { view, cx, draw, tree } = await openDetail();
  assert.deepEqual(must(tree, "fizzy-lanes").kids.map(k => k.id), ["fizzy-lane-not-now", "fizzy-lane-maybe", "fizzy-lane", "fizzy-lane-c2", "fizzy-lane-done"]);
  const here = must(tree, "fizzy-lane"), other = must(tree, "fizzy-lane-c2");
  assert.deepEqual([textOf(here), here.style.bg, here.style.text_color, here.style.rounded_full, here.handlers.on_click], ["IN PROGRESS", must(tree, "fizzy-card-tab").style.bg, "#15171c", true, undefined],
    "its own: filled, no click");
  assert.deepEqual([textOf(other), other.style.bg, other.style.text_color, other.style.cursor_pointer, tipOf(tree, "fizzy-lane-c2")], ["REVIEW", undefined, here.style.bg, true, "Move to Review"]);
  let release;
  acct.hold = new Promise(resolve => { release = resolve; });
  click(tree, "fizzy-lane-c2", cx);
  assert.match(textOf(must(drawn(view, cx), "fizzy-lane")), /Review/i, "moved before Fizzy answers");
  release();
  await cx.settle();
  acct.hold = null;
  assert.deepEqual(acct.writes(), [["card", "column", "101", "--column", "c2"]]);
  click(await draw(), "fizzy-lane-done", cx);
  await cx.settle();
  assert.deepEqual(acct.writes().at(-1), ["card", "close", "101"]);
  assert.match(textOf(must(await draw(), "fizzy-lane")), /Done/i);
});

test("the card view has the bar: Insert pastes at once, Send and Start open their menus, Copy copies, and the link stays in the header", async () => {
  withAgent();
  installed(CLAUDE, CODEX);
  const { cx, tree } = await openDetail();
  for (const id of ACTIONS) assert.ok(!isOff(tree, id), `${id} works on the open card`);
  const clicker = makeCx();
  click(tree, "fizzy-bar-insert", clicker);
  assert.match(clicker.clipboard[0], /^Fizzy #101 "Fix the login redirect" \(https:\/\/app\.fizzy\.do\/111\/cards\/101\) $/);
  assert.deepEqual(calls.run, [["pane.focus", { pane: "p-t1" }], ["terminal.paste", undefined]], "no Enter, nothing else");
  assert.equal(calls.openOverlay.length, 0, "Insert opens nothing");
  click(tree, "fizzy-bar-send", clicker);
  assert.deepEqual([lastPopup().props.menu.kind, lastPopup().props.menu.cards.map(c => c.number)], ["agents", [101]]);
  click(tree, "fizzy-bar-start", clicker);
  assert.deepEqual([lastPopup().props.menu.kind, lastPopup().props.menu.cards.map(c => c.number)], ["start", [101]]);
  assert.equal(calls.openOverlay.length, 2);
  assert.equal(calls.run.length, 2, "neither pasted nor started anything: they only ask which");
  assert.deepEqual(calls.hc, [], "nothing is ever sent");
  click(tree, "fizzy-bar-copy", clicker);
  assert.equal(clicker.clipboard.at(-1), 'Fizzy #101 "Fix the login redirect" (https://app.fizzy.do/111/cards/101)');
  click(tree, "fizzy-act-open", cx);
  assert.deepEqual(cx.opened, ["https://app.fizzy.do/111/cards/101"]);
});

test("the detail's menu button opens the card menu; Tags by the tab and the people in the card's foot open their pickers; the board on the tab moves it", async () => {
  const { cx, tree } = await openDetail();
  click(tree, "fizzy-card-menu", cx);
  await cx.settle();
  assert.equal(lastPopup().props.menu.kind, "card");
  assert.deepEqual([iconOf(tree, "fizzy-tags"), must(tree, "fizzy-tags").style.size, must(tree, "fizzy-tags").style.rounded_full, tipOf(tree, "fizzy-tags")], ["tag.svg", 26, true, "Tags"]);
  assert.deepEqual(all(must(tree, "fizzy-tag-list"), n => n.kind === "text").map(n => n.text), ["#bug"], "the tags under the title");
  const people = must(tree, "fizzy-people");
  assert.deepEqual([people.style.cursor_pointer, tipOf(tree, "fizzy-people"), iconOf(tree, "fizzy-people")], [true, "Assign", "user-plus.svg"], "the photos, then the round add button");
  assert.match(textOf(must(tree, "fizzy-detail-assigned")), /ASSIGNED TO\s+ADA/);
  click(tree, "fizzy-people", cx);
  assert.deepEqual([lastPopup().props.menu.kind, lastPopup().props.menu.card.number], ["users", 101]);
  click(tree, "fizzy-tags", cx);
  assert.deepEqual([lastPopup().props.menu.kind, lastPopup().props.menu.card.number], ["tags", 101]);
  click(tree, "fizzy-detail-board", cx);
  assert.deepEqual([lastPopup().props.menu.kind, lastPopup().props.menu.card.number], ["moveBoard", 101]);
});

test("the card page: the card framed in its lane's color, its tab at the top left, then the title, lanes, tags, description, steps and foot; Edit and Mark as Done under it, then the comments", async () => {
  const { tree } = await openDetail();
  const body = must(tree, "fizzy-detail");
  assert.deepEqual([body.style.p, body.style.pb, body.style.gap, body.style.overflow_y_scrollbar], [10, 16, 12, true]);
  assert.deepEqual(body.kids.filter(k => k.id).map(k => k.id), ["fizzy-card-frame", "fizzy-card-actions", "fizzy-comments"], "no auto-postpone period known: no line about it");
  const frame = must(tree, "fizzy-card-frame"), color = must(tree, "fizzy-card-tab").style.bg;
  assert.deepEqual([frame.style.bg, frame.style.p, frame.style.rounded], [`${color}33`, 8, 12], "a tint of the lane's color around the card");
  const page = must(tree, "fizzy-card-page");
  assert.deepEqual([page.style.bg, page.style.rounded], ["background", 8]);
  assert.deepEqual(all(page, n => ["fizzy-card-tab", "fizzy-detail-top", "fizzy-desc", "fizzy-steps", "fizzy-detail-meta"].includes(n.id)).map(n => n.id),
    ["fizzy-card-tab", "fizzy-detail-top", "fizzy-desc", "fizzy-steps", "fizzy-detail-meta"]);
  assert.deepEqual(must(tree, "fizzy-detail-top").kids.map(k => k.id), ["fizzy-title", "fizzy-lanes", "fizzy-tag-list"]);
  const tab = must(tree, "fizzy-card-tab");
  assert.deepEqual([tab.style.rounded_br, tab.style.text_color, tab.style.font_semibold], [8, "#15171c", true]);
  assert.match(textOf(must(tree, "fizzy-detail-meta")), /ADDED .* BY .* UPDATED .* ASSIGNED TO ADA/);
  assert.equal(textOf(must(tree, "fizzy-comments-head")).replace(/\s+/g, " ").trim(), "COMMENTS 2");
  for (const id of ["fizzy-desc-edit", "fizzy-done"]) {
    const pill = must(tree, id);
    assert.deepEqual([pill.style.bg, pill.style.text_color, pill.style.rounded_full], [color, "#15171c", true], `${id}: in the lane's color`);
  }
});

test("Mark as Done closes the card at once; a done card offers Reopen instead", async () => {
  const { view, cx, draw, tree } = await openDetail();
  assert.equal(textOf(must(tree, "fizzy-done")), "Mark as Done");
  click(tree, "fizzy-done", cx);
  assert.match(textOf(must(drawn(view, cx), "fizzy-lane")), /Done/i, "shown before Fizzy answers");
  await cx.settle();
  assert.deepEqual(acct.writes(), [["card", "close", "101"]]);
  let next = await draw();
  assert.equal(find(next, "fizzy-done"), null);
  assert.equal(textOf(must(next, "fizzy-reopen")), "Reopen");
  click(next, "fizzy-reopen", cx);
  await cx.settle();
  assert.deepEqual(acct.writes().at(-1), ["card", "reopen", "101"]);
  next = await draw();
  assert.doesNotMatch(textOf(must(next, "fizzy-lane")), /Done/i);
  assert.ok(find(next, "fizzy-done"));
});

test("under an open card, Fizzy's line about when it moves to Not Now for want of activity, in the lane's color; none on a done card or with no period", async () => {
  acct.boards[0] = { ...acct.boards[0], auto_postpone_period_in_days: 30 };
  acct.card(101).last_active_at = new Date(Date.now() - 4 * 86400000).toISOString();
  const { cx, draw, tree } = await openDetail();
  const note = must(tree, "fizzy-postpone");
  assert.equal(textOf(note), "Moves to “Not Now” in 26 days if there’s no activity.");
  assert.deepEqual([note.style.text_color, note.style.text_center], [must(tree, "fizzy-card-tab").style.bg, true]);
  await press(cx, "open:105");
  const done = await draw();
  assert.equal(textOf(must(done, "fizzy-title")), "Shipped thing");
  assert.equal(find(done, "fizzy-postpone"), null, "a done card stays where it is");
  setup();
  assert.equal(find((await openDetail()).tree, "fizzy-postpone"), null, "no period known");
});

test("the title sits above the lanes, wrapping; editing puts the field in its place, larger when wide", async () => {
  const { cx, draw, tree } = await openDetail();
  const title = must(tree, "fizzy-title");
  assert.deepEqual([title.style.min_w, title.style.whitespace_normal], [0, true], "it wraps");
  click(tree, "fizzy-title", cx);
  const editing = await draw();
  assert.deepEqual(must(editing, "fizzy-detail-top").kids.map(k => k.id), ["fizzy-title-edit", "fizzy-lanes", "fizzy-tag-list"], "the field takes the title's place");
  fire(must(editing, "fizzy"), "on_size_change", { width: 520, height: 600 }, cx);
  const wide = await draw();
  assert.equal(all(must(wide, "fizzy-title-input"), n => n.kind === "input")[0].style.text_size, textPx(20));
  click(wide, "fizzy-title-cancel", cx);
  assert.equal(must(await draw(), "fizzy-title").style.text_size, textPx(20));
});

test("the card view in every state: ids on what reacts, unique, tooltips only where designed, no wide widths, and no draw acts or notifies late", async () => {
  const m = await mount();
  const TIPPED = /^(fizzy-(back|pin|watch|golden|act-open|card-menu|detail-board|tags|people|title-cancel)|fizzy-lane-.+|fizzy-bar-.+|fizzy-step-(del|cancel)-.+|fizzy-comment-(edit|del)-.+|fizzy-react-.+|fizzy-reaction-.+)$/;
  const check = (tree, what) => {
    const found = ids(tree);
    assert.equal(new Set(found).size, found.length, `${what}: unique ids`);
    assert.deepEqual(all(tree, n => Object.keys(n.handlers).filter(h => h !== "on_key_down" && h !== "on_mouse_up:left").length && n.id === null).map(n => n.kind), [], `${what}: handlers need an id`);
    const widths = all(tree, n => typeof n.style.w === "number" || typeof n.style.min_w === "number").map(n => n.style.w ?? n.style.min_w);
    assert.ok(widths.every(w => w < 200), `${what}: fixed widths ${widths}`);
    assert.ok(all(tree, n => n.style.max_w).every(n => n.style.max_w <= 180), `${what}: max widths`);
    for (const n of all(tree, x => x.style.tooltip !== undefined)) assert.match(n.id ?? "(no id)", TIPPED, `${what}: a tooltip on ${n.id}`);
  };
  // `held`: settling would wait for the held read for ever.
  const quiet = async (what, held = false) => {
    const tree = drawn(m.view, m.cx, { quiet: true });
    await tick();
    if (!held) await m.cx.settle();
    check(tree, what);
    return tree;
  };
  click(await m.draw(), "fizzy-card-101", m.cx);
  await m.draw();
  let tree = await quiet("read");
  click(tree, "fizzy-title", m.cx);
  await quiet("title being edited");
  click(await m.draw(), "fizzy-title-cancel", m.cx);
  click(await m.draw(), "fizzy-step-text-s1", m.cx);
  await quiet("a step being edited");
  click(await m.draw(), "fizzy-step-cancel-s1", m.cx);
  click(await m.draw(), "fizzy-desc-edit", m.cx);
  await quiet("the description being edited");
  click(await m.draw(), "fizzy-desc-cancel", m.cx);
  click(await m.draw(), "fizzy-comment-edit-cm1", m.cx);
  await quiet("a comment being edited");
  click(await m.draw(), "fizzy-comment-cancel-cm1", m.cx);
  click(await m.draw(), "fizzy-comment-del-cm1", m.cx);
  await quiet("a comment's delete asked for");
  click(await m.draw(), "fizzy-activity", m.cx);
  await quiet("the activity open");
  fire(must(await m.draw(), "fizzy"), "on_size_change", { width: 280, height: 600 }, m.cx);
  await quiet("a narrow panel");
  click(await m.draw(), "fizzy-back", m.cx);
  const list = await m.draw();
  const releaseList = holdOn();
  click(list, "fizzy-card-101", m.cx);
  const loading = await quiet("a card from a list, being read", true);
  assert.ok(find(loading, "fizzy-title") && find(loading, "fizzy-lane") && find(loading, "fizzy-detail-meta"), "what the list knows is drawn");
  assert.equal(find(loading, "fizzy-desc"), null);
  releaseList();
  await m.cx.settle();
  click(await m.draw(), "fizzy-back", m.cx);
  const release = holdOn();
  sendCommand("open:105");
  await tick();
  await quiet("a card opened by its number, being read", true);
  release();
  await m.cx.settle();
  await quiet("that card, read");
  click(await m.draw(), "fizzy-back", m.cx);
  acct.fail = args => (args[0] === "card" && args[1] === "show" ? failure("not_found", "Resource not found") : undefined);
  click(await m.draw(), "fizzy-card-101", m.cx);
  await m.cx.settle();
  await quiet("a card that could not be read");
});

test("the composer under the comments: the person's photo beside a box of three rows, the round Comment button at the right under it", async () => {
  const { tree } = await openDetail();
  const composer = must(tree, "fizzy-comment-new");
  assert.deepEqual([composer.kids.length, composer.kids[0].style.size ?? composer.kids[0].style.w], [2, 28], "the photo, then the box and its button");
  const box = all(must(tree, "fizzy-comment-input"), n => n.kind === "textarea")[0];
  assert.deepEqual([box.state.options.rows, box.style.px, box.style.border_1, box.style.rounded], [3, 10, true, 8]);
  assert.equal(box.state.options.placeholder, "Write a comment… (@ mention, # card, drop or paste images)");
  assert.equal(typeof must(tree, "fizzy-comment-input").handlers.on_drop, "function", "a file dropped on it is attached");
  const send = must(tree, "fizzy-comment-send");
  assert.deepEqual([parentOf(tree, "fizzy-comment-send").style.justify_end, iconOf(tree, "fizzy-comment-send"), textOf(send).trim(), send.style.rounded_full], [true, "send.svg", "Comment", true]);
});

test("a card without steps or comments has no count; it says so, and the lines it has are placed under their heads", async () => {
  const { tree } = await openDetail(103);
  assert.equal(find(tree, "fizzy-steps-count"), null);
  assert.equal(find(tree, "fizzy-comments-count"), null);
  assert.equal(textOf(must(tree, "fizzy-comments-empty")), "No comments");
  assert.ok(find(tree, "fizzy-step-new-row"), "the new-step field is the only line of Steps");
  assert.equal(all(must(tree, "fizzy-steps"), n => /^fizzy-step-s/.test(n.id ?? "")).length, 0);
});

test("an error reading the card shows inline with Retry; an error on a later poll keeps what was read", async () => {
  const { cx, draw } = await mount();
  let tree = await draw();
  acct.fail = args => (args[0] === "card" && args[1] === "show" ? failure("not_found", "Resource not found") : undefined);
  click(tree, "fizzy-card-101", cx);
  tree = await draw();
  assert.match(textOf(must(tree, "fizzy-detail")), /Not found in Fizzy/);
  assert.equal(find(tree, "fizzy-desc"), null);
  assert.equal(textOf(must(tree, "fizzy-detail")).split("Loading…").length - 1, 0, "an error replaces the Loading line");
  for (const id of ["fizzy-title", "fizzy-lane", "fizzy-detail-top", "fizzy-detail-meta", "fizzy-people", "fizzy-tags"]) assert.equal(find(tree, id), null, `${id}: only the error and Retry when nothing was read`);
  assert.deepEqual(must(tree, "fizzy-detail").kids.map(k => k.id ?? "status"), ["status"]);
  assert.ok(find(tree, "fizzy-back") && find(tree, "fizzy-card-menu"), "the header stays");
  acct.fail = null;
  click(tree, "fizzy-retry", cx);
  tree = await draw();
  assert.doesNotMatch(textOf(must(tree, "fizzy-detail")), /Not found in Fizzy/);
  assert.ok(find(tree, "fizzy-step-s1"));
  acct.fail = args => (args[0] === "card" && args[1] === "show" ? failure("not_found", "Resource not found") : undefined);
  timer(cx, POLL_VIEW).fn(cx);
  await cx.settle();
  tree = await draw();
  assert.match(textOf(must(tree, "fizzy-detail")), /Not found in Fizzy/);
  for (const kept of ["fizzy-title", "fizzy-lane", "fizzy-detail-meta", "fizzy-desc", "fizzy-steps", "fizzy-comments"]) assert.ok(find(tree, kept), `${kept} stays`);
  const order = ids(must(tree, "fizzy-detail"));
  assert.ok(order.indexOf("fizzy-step-new-row") < order.indexOf("fizzy-retry") && order.indexOf("fizzy-retry") < order.indexOf("fizzy-card-actions"), "the error sits right under the card");
});

test("Insert in chat: the clipboard gets the reference, the agent's pane is focused, the terminal pastes, the old clipboard returns after 500 ms", async () => {
  withAgent();
  const { draw } = await mount();
  const tree = await draw();
  const clicker = makeCx();
  clicker.clipboardText = "what I had copied";
  const write = clicker.write_to_clipboard;
  clicker.write_to_clipboard = text => { calls.order.push("clipboard"); write(text); };
  calls.order.length = 0;
  click(tree, "fizzy-insert-101", clicker);
  assert.deepEqual(clicker.clipboard, ['Fizzy #101 "Fix the login redirect" (https://app.fizzy.do/111/cards/101) '], "no Enter: the text only, with a space after it");
  assert.deepEqual(calls.run, [["pane.focus", { pane: "p-t1" }], ["terminal.paste", undefined]]);
  assert.deepEqual(calls.order, ["clipboard", "run", "run"], "the text is on the clipboard before the paste");
  assert.equal(clicker.stopped, 1, "the click does not also open the card");
  const after = clicker.timers.filter(t => t.after);
  assert.deepEqual(after.map(t => t.ms), [500]);
  assert.equal(clicker.clipboardText.endsWith(" "), true);
  after[0].fn(clicker);
  assert.equal(clicker.clipboardText, "what I had copied");
  assert.equal(calls.hc.length, 0, "nothing was sent");
});

test("a card's whole tile is the drag: the press writes the card's file (named after it) and picks the card up, so let go on a lane it moves and dropped on a terminal it is that file; a picked card drags every picked one", async () => {
  const { view, cx, draw } = await mount();
  let tree = await draw();
  const fileOf = n => `${state.appHome}/${cardFile(view.find(n))}`;
  const tile = must(tree, "fizzy-card-102");
  assert.deepEqual(tile.dragPaths, [`${state.appHome}/${FILE_DIR}/cards/#102 Write the changelog.md`]);
  assert.equal(must(tree, "fizzy-insert-102").dragPaths, undefined, "the ↵ is a button only");
  fire(tile, "on_mouse_down:left", {}, cx);
  await cx.settle();
  assert.deepEqual(acct.written, { [fileOf(102)]: cardMarkdown(view.find(102)) });
  fire(must(tree, "fizzy-section-c1"), "on_mouse_up:left", {}, cx);
  await cx.settle();
  assert.deepEqual(acct.writes(), [["card", "column", "102", "--column", "c1"]], "the same press moves it to the lane it is let go on");
  tree = await draw();
  click(tree, "fizzy-card-101", cx, { modifiers: { platform: true } });
  click(tree, "fizzy-card-103", cx, { modifiers: { platform: true } });
  tree = await draw();
  assert.deepEqual(must(tree, "fizzy-card-103").dragPaths, [fileOf(101), fileOf(103)]);
  assert.deepEqual(must(tree, "fizzy-card-102").dragPaths, [fileOf(102)], "one not picked drags itself");
  assert.deepEqual(must(tree, "fizzy-bar-insert").dragPaths, [fileOf(101), fileOf(103)], "and so does the bar's Insert");
});

test("on an open card the bar's Insert drags its file, which holds the card's own read, steps included", async () => {
  const { view, tree } = await openDetail(101);
  const bar = must(tree, "fizzy-bar-insert"), path = `${state.appHome}/${cardFile(view.detail.card)}`;
  assert.deepEqual(bar.dragPaths, [path]);
  const presser = makeCx();
  fire(bar, "on_mouse_down:left", {}, presser);
  await presser.settle();
  assert.equal(acct.written[path], cardMarkdown(view.detail.card));
  assert.match(acct.written[path], /\n## Steps\n- \[ \] Reproduce it\n- \[x\] Patch it\n$/);
});

test("Insert in chat with nothing copied before leaves the reference on the clipboard", async () => {
  withAgent();
  const { draw } = await mount();
  const clicker = makeCx();
  click(await draw(), "fizzy-insert-101", clicker);
  assert.equal(clicker.clipboard.length, 1);
  clicker.timers.find(t => t.after).fn(clicker);
  assert.equal(clicker.clipboard.length, 1, "there was no text to put back");
});

test("Insert in chat without an agent in the tab copies the reference and says so; nothing is pasted", async () => {
  const { draw } = await mount();
  const tree = await draw();
  const clicker = makeCx();
  click(tree, "fizzy-insert-102", clicker);
  assert.deepEqual(clicker.clipboard, ['Fizzy #102 "Write the changelog" (https://app.fizzy.do/111/cards/102)']);
  assert.deepEqual(calls.run, []);
  assert.equal(calls.notify.at(-1).body, COPIED_NO_AGENT);
});

test("Insert goes to the agent in view and follows the live agents and focus; an agent without a pane is focused by its terminal", async () => {
  state.agents = [AGENT("t9", { pane: "", tab: "other" })];
  state.focused = { space: "s1", tab: "s1-tab", pane: null, terminal: "t9", shown: null, agent: null, cwd: null };
  const { view, cx, draw } = await mount();
  const tree = await draw();
  click(tree, "fizzy-insert-101", makeCx());
  assert.deepEqual(calls.run[0], ["pane.focus", { terminal: "t9" }]);
  state.agents = [AGENT("t2", { tab_name: "docs" })];
  state.focused = { space: "s1", tab: "s1-tab", pane: "p-t2", terminal: "t2", shown: null, agent: null, cwd: null };
  calls.run.length = 0;
  click(drawn(view, cx), "fizzy-insert-101", makeCx());
  assert.deepEqual(calls.run[0], ["pane.focus", { pane: "p-t2" }], "the focus moved, so did Insert");
});

test("Send to session: the card menu opens the running sessions, choosing one brings it to focus and pastes the reference, never submitting", async () => {
  state.agents = [AGENT("t1"), AGENT("t2", { tab_name: "docs", status: "working", space: "s2", space_name: "other", tab: "s2-tab", pane: "p-t2" })];
  state.focused = { space: "s1", tab: "s1-tab", pane: "p-t2", terminal: "t2", shown: null, agent: null, cwd: null };
  const { cx, draw } = await mount();
  let tree = await draw();
  fire(must(tree, "fizzy-more-101"), "on_click", {}, makeCx());
  await tick();
  assert.equal(lastPopup().props.menu.kind, "card");
  let popup = await mountPopup();
  menuClick(popup, "send");
  assert.equal(lastPopup().props.menu.kind, "agents");
  popup = await mountPopup();
  assert.deepEqual(ids(popup.tree()).filter(i => i.startsWith("fizzy-menu-agent-")), ["fizzy-menu-agent-t2", "fizzy-menu-agent-t1"], "the current target is first");
  assert.match(textOf(must(popup.tree(), "fizzy-menu-agent-t2")), /Claude Code · docs\s+other · working/, "space name · status");
  assert.match(textOf(must(popup.tree(), "fizzy-menu-agent-t1")), /Claude Code · fix login\s+work · idle/);
  calls.order.length = 0;
  menuClick(popup, "agent-t1");
  assert.deepEqual(calls.order, ["closeOverlay", "setShared"], "the popup closes and leaves the work to the panel");
  assert.deepEqual(requestOps().at(-1), { kind: "paste", address: "t1", text: 'Fizzy #101 "Fix the login redirect" (https://app.fizzy.do/111/cards/101)' });
  assert.deepEqual(calls.run, [], "the popup itself runs nothing");
  tree = await draw();
  assert.deepEqual(calls.run, [["space.select", { id: "s1" }], ["tab.select", { id: "s1-tab" }], ["pane.focus", { pane: "p-t1" }], ["terminal.paste", undefined]], "that session's space, tab and pane, then the paste");
  assert.equal(cx.clipboard.at(-1), 'Fizzy #101 "Fix the login redirect" (https://app.fizzy.do/111/cards/101) ', "the reference and a space: no Enter");
  assert.deepEqual(calls.hc, [], "no hc send: nothing is submitted");
  assert.ok(tree);
});

test("a paste request brings the chosen session's own space, tab and pane to the front (a session with no pane by its terminal), then pastes, and puts the old clipboard back", async () => {
  state.agents = [AGENT("t1"), AGENT("t2", { tab_name: "docs", space: "s2", tab: "s2-tab", pane: "p-t2" }), AGENT("t3", { pane: "", space: "s3", tab: "s3-tab" })];
  state.focused = { space: "s1", tab: "s1-tab", pane: "p-t1", terminal: "t1", shown: null, agent: null, cwd: null };
  const { cx, draw } = await mount();
  await draw();
  cx.clipboardText = "mine";
  state.shared["fizzy.request"] = { id: "p1", op: { kind: "paste", address: "t2", text: 'Fizzy #7 "x"' } };
  await draw();
  assert.deepEqual(calls.run, [["space.select", { id: "s2" }], ["tab.select", { id: "s2-tab" }], ["pane.focus", { pane: "p-t2" }], ["terminal.paste", undefined]]);
  assert.equal(cx.clipboardText, 'Fizzy #7 "x" ');
  const restore = cx.timers.filter(t => t.after && t.ms === 500);
  assert.equal(restore.length, 1);
  restore[0].fn(cx);
  assert.equal(cx.clipboardText, "mine", "the person's own clipboard is back");
  calls.run.length = 0;
  state.shared["fizzy.request"] = { id: "p2", op: { kind: "paste", address: "t3", text: "x" } };
  await draw();
  assert.deepEqual(calls.run.map(c => c[0]), ["space.select", "tab.select", "pane.focus", "terminal.paste"]);
  assert.deepEqual(calls.run[2], ["pane.focus", { terminal: "t3" }], "no pane: the terminal");
  assert.deepEqual(calls.hc, []);
});

test("a paste request for a session that has closed meanwhile tells so and pastes nothing", async () => {
  withAgent();
  const { cx, draw } = await mount();
  await draw();
  state.shared["fizzy.request"] = { id: "gone", op: { kind: "paste", address: "t-gone", text: "x" } };
  await draw();
  assert.deepEqual(calls.run, []);
  assert.deepEqual(cx.clipboard, []);
  assert.equal(calls.notify.at(-1).body, "That session is gone");
});

function openOverlayFor(menu) {
  calls.openOverlay.push({ mod: "fizzy", kind: "popup", width: 300, height: 100, props: { menu } });
}

test("Start new session: the installed agents are listed (asked of the space's machine) and one asks the panel to start it, with no task", async () => {
  state.spaces = [space("s1", "remote", { active: true, folder: "/home/dev/work", machine: "devbox" })];
  state.knownAgents = async () => [agent("claude", "Claude Code"), agent("codex", "Codex", { run: ["codex", "--flag"] }), agent("off", "Not here", { installed: false })];
  const { draw } = await mount();
  await draw();
  const card = { number: 101, title: "Fix the login redirect", url: "https://app.fizzy.do/111/cards/101", board: { id: "b1", name: "Roadmap" }, column: { id: "c1", name: "In progress" } };
  openOverlayFor({ kind: "start", cards: [card] });
  const popup = await mountPopup();
  assert.deepEqual(calls.knownAgents, [{ on: "devbox" }], "only the popup asks: the bar does not read them");
  assert.deepEqual(ids(popup.tree()).filter(i => i.startsWith("fizzy-menu-agent-")), ["fizzy-menu-agent-0", "fizzy-menu-agent-1"], "only installed ones");
  calls.order.length = 0;
  menuClick(popup, "agent-1");
  assert.deepEqual(calls.order, ["closeOverlay", "setShared"], "closes first and leaves the start to the panel: a popup's cx dies on close");
  assert.deepEqual(requestOps().at(-1), { kind: "start", name: "#101 Fix the login redirect", argv: ["codex", "--flag"], text: REF_101, agent: "Codex" });
  assert.deepEqual(calls.run, []);
  assert.equal(tabName(card), "#101 Fix the login redirect");
  assert.deepEqual(state.shared["new-menu.agents"].devbox.map(a => a.key), ["claude", "codex", "off"], "the answer is kept for the next menu");
  await draw();
  assert.deepEqual(calls.run, [["tab.new", { name: "#101 Fix the login redirect", argv: ["codex", "--flag"] }]], "a new tab with the agent and no first message");
  assert.equal("task" in calls.run[0][1], false);
  assert.deepEqual(calls.hc, []);
});

const startOp = (more = {}) => ({ kind: "start", name: "#101 Fix the login redirect", argv: ["codex", "--flag"], text: REF_101, agent: "Codex", ...more });
const lookTimer = cx => cx.timers.find(t => !t.after && t.ms === REQUEST_EVERY);
// What the 300 ms timer does: takes a request, and looks for the session Start waits for.
const look = async cx => { lookTimer(cx).fn(cx); await cx.settle(); };
// A clock the test moves: Date.now() answers `clock.at` while it is set.
function clockAt() {
  const real = Date.now, clock = { at: real(), restore: () => { Date.now = real; }, advance(ms) { clock.at += ms; } };
  Date.now = () => clock.at;
  return clock;
}
const newAgent = (address, more = {}) => AGENT(address, { tab_name: "#101 Fix the login redirect", status: "working", pane: `p-${address}`, tab: `tab-${address}`, space: "s1", ...more });

test("Start: tab.new has no task, the session that is new is found on the 300 ms timer, and once it is idle the reference is pasted into its pane, once", async () => {
  withAgent();
  const { cx, draw } = await mount();
  await draw();
  assert.ok(lookTimer(cx), "the panel's 300 ms timer looks");
  state.shared["fizzy.request"] = { id: "s1", op: startOp() };
  await look(cx);
  assert.deepEqual(calls.run, [["tab.new", { name: "#101 Fix the login redirect", argv: ["codex", "--flag"] }]]);
  assert.equal(cx.clipboard.length, 0, "nothing is on the clipboard before the session is ready");
  await look(cx);
  assert.equal(calls.run.length, 1, "no new session yet: nothing happens");
  state.agents = [...state.agents, newAgent("t-new")];
  await look(cx);
  assert.equal(calls.run.length, 1, "it is not idle yet");
  state.agents = state.agents.map(a => (a.address === "t-new" ? { ...a, status: "idle" } : a));
  await look(cx);
  assert.deepEqual(calls.run.slice(1), [["space.select", { id: "s1" }], ["tab.select", { id: "tab-t-new" }], ["pane.focus", { pane: "p-t-new" }], ["terminal.paste", undefined]], "that session is brought to the front (as Send does), then its pane, then the paste: no Enter");
  assert.equal(cx.clipboard.at(-1), `${REF_101} `);
  await look(cx);
  await look(cx);
  assert.equal(calls.run.length, 5, "pasted once: tab.new, then space, tab, pane, paste");
  assert.deepEqual(calls.hc, []);
});

test("Start: a session that appears idle is pasted into at once; one that stays busy gets the paste 3 s after it appeared", async () => {
  withAgent();
  const clock = clockAt();
  try {
    const { cx, draw } = await mount();
    await draw();
    state.shared["fizzy.request"] = { id: "a", op: startOp() };
    await look(cx);
    state.agents = [...state.agents, newAgent("t-idle", { status: "idle" })];
    await look(cx);
    assert.deepEqual(calls.run.slice(1).map(c => c[0]), ["space.select", "tab.select", "pane.focus", "terminal.paste"], "idle: at once, brought to the front");
    calls.run.length = 0;
    state.shared["fizzy.request"] = { id: "b", op: startOp() };
    await look(cx);
    state.agents = [...state.agents, newAgent("t-busy")];
    await look(cx);
    clock.advance(READY_WAIT - 1);
    await look(cx);
    assert.deepEqual(calls.run.map(c => c[0]), ["tab.new"], "2999 ms: still waiting");
    clock.advance(1);
    await look(cx);
    assert.deepEqual(calls.run.slice(1), [["space.select", { id: "s1" }], ["tab.select", { id: "tab-t-busy" }], ["pane.focus", { pane: "p-t-busy" }], ["terminal.paste", undefined]], "3 s after it appeared: pasted anyway");
    assert.equal(cx.clipboard.at(-1), `${REF_101} `);
  } finally { clock.restore(); }
});

test("Start: a session that is not found within 30 s leaves the reference on the clipboard and says so; nothing is pasted", async () => {
  withAgent();
  const clock = clockAt();
  try {
    const { view, cx, draw } = await mount();
    await draw();
    state.shared["fizzy.request"] = { id: "a", op: startOp() };
    await look(cx);
    clock.advance(START_WAIT - 1);
    await look(cx);
    assert.deepEqual([cx.clipboard, calls.run.length], [[], 1], "29.999 s: still waiting");
    clock.advance(1);
    await look(cx);
    assert.deepEqual(cx.clipboard, [REF_101], "the reference, no trailing space: only copied");
    assert.deepEqual(calls.notify.at(-1), { title: "Fizzy", body: "Started Codex — the reference is on your clipboard", timeout: 4000 });
    assert.equal(calls.run.length, 1, "no pane was focused, no paste");
    assert.equal(view.starting, null, "and it stops looking");
    state.agents = [...state.agents, newAgent("t-late", { status: "idle" })];
    await look(cx);
    assert.equal(calls.run.length, 1, "a session that shows up later is left alone");
  } finally { clock.restore(); }
});

test("Start: a second start replaces the first one: only the newest is waited for, and only its reference is pasted", async () => {
  withAgent();
  const { cx, draw } = await mount();
  await draw();
  state.shared["fizzy.request"] = { id: "1", op: startOp({ text: "FIRST", agent: "Claude Code", name: "#1 one", argv: ["claude"] }) };
  await look(cx);
  state.shared["fizzy.request"] = { id: "2", op: startOp({ text: "SECOND", name: "#2 two" }) };
  await look(cx);
  assert.deepEqual(calls.run.map(c => c[1]?.name), ["#1 one", "#2 two"]);
  state.agents = [...state.agents, newAgent("t-a", { status: "idle", tab_name: "#2 two" })];
  await look(cx);
  assert.deepEqual(cx.clipboard, ["SECOND "], "only the second's text");
  state.agents = [...state.agents, newAgent("t-b", { status: "idle", tab_name: "#1 one" })];
  await look(cx);
  await look(cx);
  assert.deepEqual(cx.clipboard, ["SECOND "], "the first start is forgotten");
  assert.equal(calls.run.filter(c => c[0] === "terminal.paste").length, 1);
});

test("Start: a second start while the first one's session comes up first: the first's session is never given the second's reference", async () => {
  withAgent();
  const { cx, draw } = await mount();
  await draw();
  state.shared["fizzy.request"] = { id: "1", op: startOp({ text: "FIRST", agent: "Claude Code", name: "#1 one", argv: ["claude"] }) };
  await look(cx);
  state.shared["fizzy.request"] = { id: "2", op: startOp({ text: "SECOND", name: "#2 two" }) };
  await look(cx);
  calls.run.length = 0;
  // The first start's session is up before the second's: it is new to the second start too (its list was taken before it came), but it is in another tab.
  state.agents = [...state.agents, newAgent("t-first", { status: "idle", tab_name: "#1 one" })];
  await look(cx);
  await look(cx);
  assert.deepEqual([calls.run, cx.clipboard], [[], []], "not pasted into: it is not the tab the second start named");
  state.agents = [...state.agents, newAgent("t-second", { status: "idle", tab_name: "#2 two" })];
  await look(cx);
  assert.deepEqual(calls.run, [["space.select", { id: "s1" }], ["tab.select", { id: "tab-t-second" }], ["pane.focus", { pane: "p-t-second" }], ["terminal.paste", undefined]]);
  assert.deepEqual(cx.clipboard, ["SECOND "]);
});

test("Start: any other agent that comes up while it waits (a new one in another tab) is not pasted into, and the wait ends in the clipboard", async () => {
  withAgent();
  const clock = clockAt();
  try {
    const { view, cx, draw } = await mount();
    await draw();
    state.shared["fizzy.request"] = { id: "a", op: startOp() };
    await look(cx);
    calls.run.length = 0;
    state.agents = [...state.agents, newAgent("t-stranger", { status: "idle", tab_name: "docs" })];
    await look(cx);
    clock.advance(READY_WAIT + 1);
    await look(cx);
    assert.deepEqual([calls.run, cx.clipboard], [[], []], "a stranger is neither pasted into nor waited 3 s for");
    assert.ok(view.starting, "still looking for the session in the named tab");
    clock.advance(START_WAIT);
    await look(cx);
    assert.deepEqual(cx.clipboard, [REF_101], "the 30 s end: only copied");
    assert.equal(calls.notify.at(-1).body, "Started Codex — the reference is on your clipboard");
    assert.deepEqual(calls.run, [], "and still nothing pasted into the stranger");
  } finally { clock.restore(); }
});

test("Start: the new session is the one whose address was not there before and whose tab is the one it named", async () => {
  state.agents = [AGENT("t1"), AGENT("t2", { tab_name: "docs" })];
  state.focused = { space: "s1", tab: "s1-tab", pane: "p-t1", terminal: "t1", shown: null, agent: null, cwd: null };
  const { cx, draw } = await mount();
  await draw();
  state.shared["fizzy.request"] = { id: "a", op: startOp() };
  await look(cx);
  calls.run.length = 0;
  state.agents = [...state.agents, newAgent("t-other", { status: "idle", tab_name: "something else" }), newAgent("t-mine", { status: "idle" })];
  await look(cx);
  assert.deepEqual(calls.run[2], ["pane.focus", { pane: "p-t-mine" }], "the old ones are not it, and the tab's name picks among the new");
  // An old session that already has the name is not it either (its address was there before).
  calls.run.length = 0;
  state.agents = [...state.agents, AGENT("t-old", { tab_name: "late" })];
  state.shared["fizzy.request"] = { id: "b", op: startOp({ name: "late" }) };
  await look(cx);
  await look(cx);
  assert.deepEqual(calls.run.map(c => c[0]), ["tab.new"], "only a new address counts");
  // A new session whose tab has another name is not it: no first-new fallback.
  state.agents = [...state.agents, newAgent("t-x", { status: "idle", tab_name: "x" })];
  await look(cx);
  assert.deepEqual(calls.run.map(c => c[0]), ["tab.new"], "no name match, nothing pasted");
});

test("Start: a session with no pane is focused by its terminal; a start request with nothing to paste or no argv does nothing", async () => {
  withAgent();
  const { cx, draw } = await mount();
  await draw();
  state.shared["fizzy.request"] = { id: "a", op: startOp() };
  await look(cx);
  state.agents = [...state.agents, newAgent("t-np", { status: "idle", pane: "" })];
  await look(cx);
  assert.deepEqual(calls.run.slice(1), [["space.select", { id: "s1" }], ["tab.select", { id: "tab-t-np" }], ["pane.focus", { terminal: "t-np" }], ["terminal.paste", undefined]]);
  calls.run.length = 0;
  for (const [i, bad] of [startOp({ text: "" }), startOp({ argv: undefined })].entries()) {
    state.shared["fizzy.request"] = { id: `bad${i}`, op: bad };
    await look(cx);
  }
  assert.deepEqual(calls.run, []);
});

test("Start: a tab.new that fails is told, and nothing is waited for", async () => {
  withAgent();
  const { view, cx, draw } = await mount();
  await draw();
  state.runError = new Error("layout unavailable");
  state.shared["fizzy.request"] = { id: "a", op: startOp() };
  await look(cx);
  assert.equal(calls.notify.at(-1).level, "error");
  assert.equal(view.starting, null);
});

test("Start: the wait is the panel's timer, never a draw: drawing while it waits runs and writes nothing", async () => {
  withAgent();
  const { view, cx, draw } = await mount();
  await draw();
  state.shared["fizzy.request"] = { id: "a", op: startOp() };
  await look(cx);
  state.agents = [...state.agents, newAgent("t-new", { status: "idle" })];
  const before = [calls.run.length, cx.clipboard.length];
  drawn(view, cx);
  drawn(view, cx);
  assert.deepEqual([calls.run.length, cx.clipboard.length], before, "a draw does not look for the session");
  await look(cx);
  assert.equal(calls.run.length, before[0] + 4, "space, tab, pane, paste");
});

test("a Start menu shows the agents the last lookup found while it asks again, and says when it cannot", async () => {
  let reject;
  state.knownAgents = () => new Promise((_ok, no) => { reject = no; });
  openOverlayFor({ kind: "start", cards: [{ number: 1, title: "T" }] });
  const start = () => {
    state.props = { menu: lastPopup().props.menu, overlay: "ov-popup" };
    const cx = makeCx(), view = new Fizzy();
    view.init(undefined, cx);
    return { cx, view };
  };
  state.shared["new-menu.agents"] = { "": [agent("claude", "Claude Code")] };
  const first = start();
  assert.ok(find(drawn(first.view, first.cx), "fizzy-menu-agent-0"), "the last lookup, at once");
  assert.deepEqual(calls.knownAgents, [{ on: null }], "while it asks again");
  state.shared["new-menu.agents"] = {};
  const second = start();
  assert.match(textOf(drawn(second.view, second.cx)), /Checking installed agents…/);
  reject(new Error("no"));
  await second.cx.settle();
  assert.match(textOf(drawn(second.view, second.cx)), /Could not load agents/);
});

test("with several cards selected the bar hands all of them over: Insert pastes, Send and Start open their menus for them, Copy copies; the selection is the row highlight", async () => {
  withAgent();
  installed(CLAUDE, CODEX);
  const { view, cx, draw } = await mount();
  let tree = await draw();
  assert.deepEqual([Boolean(find(tree, "fizzy-bar")), Boolean(find(tree, "fizzy-list-bar"))], [false, true], "nothing picked: the list's own bar");
  assert.deepEqual(view.subject().map(s => s.kind), ["board"], "the keys act on the board shown");
  click(tree, "fizzy-card-101", cx, { modifiers: { platform: true } });
  tree = await draw();
  assert.deepEqual(view.picks().map(c => c.number), [101]);
  assert.equal(find(tree, "fizzy-list-bar"), null, "a card picked: the hand-offs take the list bar's place");
  for (const id of ACTIONS) assert.ok(!isOff(tree, id), `${id}: one card picked`);
  click(tree, "fizzy-card-103", cx, { modifiers: { control: true } });
  tree = await draw();
  assert.equal(acct.asked("card", "show").length, 0, "a modifier click selects, it does not open");
  assert.deepEqual(view.picks().map(c => c.number), [101, 103]);
  assert.deepEqual([must(tree, "fizzy-card-101").style.bg, must(tree, "fizzy-card-101").style.border_color], ["selected", "accent"]);
  assert.notEqual(must(tree, "fizzy-card-102").style.bg, "selected", "the others are not");
  const both = 'Fizzy #101 "Fix the login redirect" (https://app.fizzy.do/111/cards/101)\nFizzy #103 "Triage me" (https://app.fizzy.do/111/cards/103)';
  const clicker = makeCx();
  click(tree, "fizzy-bar-insert", clicker);
  assert.deepEqual(clicker.clipboard, [`${both} `]);
  click(tree, "fizzy-bar-send", clicker);
  assert.deepEqual([lastPopup().props.menu.kind, lastPopup().props.menu.cards.map(c => c.number)], ["agents", [101, 103]]);
  click(tree, "fizzy-bar-start", clicker);
  assert.deepEqual([lastPopup().props.menu.kind, lastPopup().props.menu.cards.map(c => c.number)], ["start", [101, 103]]);
  assert.deepEqual(calls.run.map(c => c[0]), ["pane.focus", "terminal.paste"], "only Insert pasted; Send and Start started nothing");
  assert.deepEqual(menuRows(lastPopup().props.menu, { known: [CODEX] })[0].act.start.text, both, "Start would paste both references, a line each");
  click(tree, "fizzy-bar-copy", clicker);
  assert.equal(clicker.clipboard.at(-1), both);
  click(tree, "fizzy-card-101", cx, { modifiers: { platform: true } });
  click(tree, "fizzy-card-103", cx, { modifiers: { platform: true } });
  tree = await draw();
  assert.notEqual(must(tree, "fizzy-card-101").style.bg, "selected", "nothing is selected");
  assert.deepEqual([Boolean(find(tree, "fizzy-bar")), Boolean(find(tree, "fizzy-list-bar"))], [false, true], "the list bar is back");
  assert.deepEqual(view.subject().map(s => s.kind), ["board"]);
});

test("a second modifier click unselects, and cards that vanish from the list drop out of the selection", async () => {
  const { view, cx, draw } = await mount();
  let tree = await draw();
  click(tree, "fizzy-card-101", cx, { modifiers: { platform: true } });
  click(tree, "fizzy-card-101", cx, { modifiers: { platform: true } });
  await draw();
  assert.deepEqual(view.subject().map(s => s.kind), ["board"], "unselected: the bar is back on the board");
  click(tree, "fizzy-card-103", cx, { modifiers: { platform: true } });
  assert.ok(!isOff(await draw(), "fizzy-bar-copy"));
  assert.deepEqual(view.picks().map(c => c.number), [103]);
  assert.deepEqual(view.subject().map(s => s.number), [103]);
  acct.card(103).closed = true;
  timer(cx, POLL_VIEW).fn(cx);
  tree = await draw();
  assert.deepEqual(view.picks(), [], "103 is closed now: not in the open lists");
  assert.deepEqual(view.subject().map(s => s.kind), ["board"]);
});

test("dragging a card onto another lane's header moves it, at once; onto one of its cards too", async () => {
  const { view, cx, draw } = await mount();
  const tree = await draw();
  let release;
  acct.hold = new Promise(resolve => { release = resolve; });
  fire(must(tree, "fizzy-card-101"), "on_mouse_down:left", {}, cx);
  fire(must(tree, "fizzy-section-c2"), "on_mouse_up:left", {}, cx);
  assert.deepEqual(lanesOf(drawn(view, cx)), { 103: "maybe", 102: "c2", 101: "c2" }, "moved before Fizzy has answered");
  assert.deepEqual(acct.writes(), [["card", "column", "101", "--column", "c2"]]);
  release();
  await cx.settle();
  acct.hold = null;
  fire(must(drawn(view, cx), "fizzy-card-103"), "on_mouse_down:left", {}, cx);
  fire(must(drawn(view, cx), "fizzy-card-102"), "on_mouse_up:left", {}, cx);
  await cx.settle();
  assert.deepEqual(acct.writes().at(-1), ["card", "column", "103", "--column", "c2"], "onto a card of the lane");
  assert.equal(acct.lane(103), "c2");
});

test("dragging to Not Now, Maybe? and Done uses postpone, untriage and close", async () => {
  const { cx, draw } = await mount();
  let tree = await draw();
  const drag = async (from, to) => {
    tree = await draw();
    fire(must(tree, `fizzy-card-${from}`), "on_mouse_down:left", {}, cx);
    fire(must(tree, `fizzy-section-${to}`), "on_mouse_up:left", {}, cx);
    await cx.settle();
  };
  await drag(101, "not-now");
  await drag(102, "maybe");
  await drag(103, "done");
  assert.deepEqual(acct.writes(), [["card", "postpone", "101"], ["card", "untriage", "102"], ["card", "close", "103"]]);
});

test("releasing on the same lane, or anywhere else, moves nothing and forgets the card", async () => {
  const { cx, draw } = await mount();
  const tree = await draw();
  fire(must(tree, "fizzy-card-101"), "on_mouse_down:left", {}, cx);
  fire(must(tree, "fizzy-section-c1"), "on_mouse_up:left", {}, cx);
  fire(must(tree, "fizzy-card-101"), "on_mouse_down:left", {}, cx);
  fire(must(tree, "fizzy"), "on_mouse_up:left", {}, cx);
  fire(must(tree, "fizzy-section-c2"), "on_mouse_up:left", {}, cx);
  await cx.settle();
  assert.deepEqual(acct.writes(), []);
});

// The panel at a width (px), drawn again.
async function atWidth(m, width) {
  fire(must(await m.draw(), "fizzy"), "on_size_change", { width, height: 700 }, m.cx);
  return m.draw();
}
const columnsOf = tree => must(tree, "fizzy-columns").kids.map(k => k.id.slice("fizzy-col-".length) + (k.style.flex_1 ? "" : " (folded)"));

test("from 480 px the board is Fizzy's: columns side by side in the board's order, Maybe? open, the rest folded into pills with their count; narrower, the lanes stack", async () => {
  const m = await mount();
  let tree = await atWidth(m, 479);
  assert.ok(find(tree, "fizzy-list") && !find(tree, "fizzy-columns"), "479 px: stacked");
  tree = await atWidth(m, 600);
  assert.equal(find(tree, "fizzy-lane-maybe"), null);
  assert.deepEqual(columnsOf(tree), ["not-now (folded)", "maybe", "c1 (folded)", "c2 (folded)", "done (folded)"]);
  assert.deepEqual(["c1", "c2", "not-now"].map(k => textOf(must(tree, `fizzy-col-count-${k}`))), ["1", "1", ""], "Not Now is read only when it opens");
  assert.equal(textOf(must(tree, "fizzy-col-head-maybe")).trim(), "MAYBE?");
  assert.deepEqual(ids(must(tree, "fizzy-col-cards-maybe")).filter(id => /^fizzy-(watch|card-\d+)$/.test(id)), ["fizzy-watch", "fizzy-card-103"], "Add a card and the watchers first, then its cards");
});

test("a folded column is Fizzy's pill: its color fading downwards to a tenth of it (never to nothing), round at both ends, as tall as its cards make it (a circle with none), over a faint line to the board's foot; Not Now and Done are gray, and as tall as it gets until read", async () => {
  acct.cards = acct.cards.filter(c => c.number !== 102);
  for (const n of [111, 112, 113]) acct.cards.push({ ...acct.card(101), id: `id-${n}`, number: n });
  const m = await mount();
  const tree = await atWidth(m, 600);
  const pillOf = key => all(must(tree, `fizzy-col-${key}`), n => n.kind === "path")[0];
  const look = key => { const p = pillOf(key); return [p.style.h, p.background.angle, p.background.from, p.background.to]; };
  const [c1, c2] = ["c1", "c2"].map(id => colorOf(acct.columns.b1.find(c => c.id === id)));
  assert.deepEqual(["c1", "c2"].map(k => textOf(must(tree, `fizzy-col-count-${k}`))), ["4", "0"]);
  assert.deepEqual(look("c1"), [36 + 4 * 28, 180, `${c1}b3`, `${c1}1a`], "four cards: taller, in its color, fading downwards to 10 %");
  assert.deepEqual(look("c2"), [36, 180, `${c2}b3`, `${c2}1a`], "none: a circle");
  assert.deepEqual(look("done"), [480, 180, "#8a8f98b3", "#8a8f981a"], "Done, not read: gray, as tall as it gets");
  const col = must(tree, "fizzy-col-c1"), line = must(tree, "fizzy-col-line-c1");
  assert.deepEqual([col.kids[0], col.kids[1]], [line, pillOf("c1")], "the line, then the pill over it, then the count and the name");
  assert.deepEqual([line.style.absolute, line.style.bottom, line.style.w, line.style.bg], [true, 0, 1, `${c1}4d`]);
  assert.ok(line.style.top > 36, "the line starts below the name");
  const h = 36 + 4 * 28;
  assert.deepEqual(pillOf("c1").path.steps, [
    ["move_to", 0, 18], ["arc_to", 18, 18, 0, false, true, 36, 18], ["line_to", 36, h - 18], ["arc_to", 18, 18, 0, false, true, 0, h - 18], ["close"],
  ], "a round top and a round foot, at its own height");
  assert.deepEqual(pillOf("c2").path.steps.slice(1, 4), [["arc_to", 18, 18, 0, false, true, 36, 18], ["line_to", 36, 18], ["arc_to", 18, 18, 0, false, true, 0, 18]], "at its smallest, a circle");
});

test("an open column grows no wider than 380 px, and the columns stay together in the middle of a wider panel, as Fizzy's", async () => {
  const m = await mount();
  const tree = await atWidth(m, 1200);
  const row = must(tree, "fizzy-columns"), open = must(tree, "fizzy-col-maybe");
  assert.deepEqual([open.style.flex_1, open.style.max_w], [true, 380]);
  assert.equal(row.style.justify_center, true);
});

test("the folded column under the pointer is drawn brighter, its pill and its line; moving from one to the next never leaves none lit", async () => {
  const m = await mount();
  let tree = await atWidth(m, 600);
  const lookOf = key => { const col = must(tree, `fizzy-col-${key}`), pill = all(col, n => n.kind === "path")[0]; return [pill.background.from.slice(-2), pill.background.to.slice(-2), must(tree, `fizzy-col-line-${key}`).style.bg.slice(-2)]; };
  assert.deepEqual(lookOf("c1"), ["b3", "1a", "4d"]);
  fire(must(tree, "fizzy-col-c1"), "on_hover", true, m.cx);
  tree = await m.draw();
  assert.deepEqual([lookOf("c1"), lookOf("c2")], [["e6", "33", "80"], ["b3", "1a", "4d"]], "lit: brighter");
  fire(must(tree, "fizzy-col-c2"), "on_hover", true, m.cx);
  fire(must(tree, "fizzy-col-c1"), "on_hover", false, m.cx);
  tree = await m.draw();
  assert.deepEqual([lookOf("c1"), lookOf("c2")], [["b3", "1a", "4d"], ["e6", "33", "80"]], "into the next before out of the last");
  fire(must(tree, "fizzy-col-c2"), "on_hover", false, m.cx);
  tree = await m.draw();
  assert.deepEqual(lookOf("c2"), ["b3", "1a", "4d"], "out of all: none lit");
});

test("a folded column's name is drawn sideways from an SVG file the request timer writes once; until then the pill shows its count alone", async () => {
  const m = await mount();
  let tree = await atWidth(m, 600);
  assert.equal(all(must(tree, "fizzy-col-c1"), n => n.kind === "svg").length, 0, "not written yet");
  await timer(m.cx, REQUEST_EVERY).fn(m.cx);
  await m.cx.settle();
  const path = `${state.appHome}/${labelFile("IN PROGRESS")}`;
  assert.equal(acct.written[path], labelSvg("IN PROGRESS"));
  tree = await m.draw();
  const label = all(must(tree, "fizzy-col-c1"), n => n.kind === "svg")[0];
  assert.equal(label.path, labelFile("IN PROGRESS"));
  assert.ok(label.style.h > label.style.w, "taller than wide");
  const writes = Object.keys(acct.written).length;
  await timer(m.cx, REQUEST_EVERY).fn(m.cx);
  await m.cx.settle();
  assert.equal(Object.keys(acct.written).length, writes, "written once");
});

test("a click opens a folded column and folds the open one, below 760 px; from 760 px two stay open and a third folds the one opened longest ago; an open column's head folds it unless it is the only one; kept per board", async () => {
  const m = await mount();
  let tree = await atWidth(m, 600);
  click(tree, "fizzy-col-c1", m.cx);
  tree = await m.draw();
  assert.deepEqual(columnsOf(tree).filter(c => !c.endsWith("(folded)")), ["c1"]);
  click(tree, "fizzy-col-head-c1", m.cx);
  tree = await m.draw();
  assert.deepEqual(columnsOf(tree).filter(c => !c.endsWith("(folded)")), ["c1"], "the only open one stays open");
  tree = await atWidth(m, 800);
  click(tree, "fizzy-col-c2", m.cx);
  tree = await m.draw();
  assert.deepEqual(columnsOf(tree).filter(c => !c.endsWith("(folded)")), ["c1", "c2"]);
  click(tree, "fizzy-col-done", m.cx);
  tree = await m.draw();
  assert.deepEqual(columnsOf(tree).filter(c => !c.endsWith("(folded)")), ["c2", "done"], "c1 was opened longest ago");
  await m.cx.settle();
  assert.equal(acct.asked("card", "list", "--board", "b1", "--indexed-by", "closed").length > 0, true, "Done is read when it opens");
  click(await m.draw(), "fizzy-col-head-c2", m.cx);
  tree = await m.draw();
  assert.deepEqual(columnsOf(tree).filter(c => !c.endsWith("(folded)")), ["done"]);
  assert.deepEqual(JSON.parse(localStorage.getItem("openColumns")), { b1: ["done"] });
});

test("crossing 480 px draws again, and a board left with Done open reads Done then, though its first read came before the width was known", async () => {
  localStorage.setItem("openColumns", JSON.stringify({ b1: ["done"] }));
  const m = await mount();
  let tree = await m.draw();
  const closed = () => acct.asked("card", "list", "--board", "b1", "--indexed-by", "closed").length;
  assert.equal(closed(), 0, "stacked, Done is folded");
  fire(must(tree, "fizzy"), "on_size_change", { width: 400, height: 700 }, m.cx);
  const before = m.cx.notified;
  fire(must(tree, "fizzy"), "on_size_change", { width: 600, height: 700 }, m.cx);
  assert.equal(m.cx.notified, before + 1, "the layout changes: drawn again");
  fire(must(tree, "fizzy"), "on_size_change", { width: 620, height: 700 }, m.cx);
  assert.equal(m.cx.notified, before + 1, "the same layout: not drawn again");
  await m.cx.settle();
  assert.ok(closed() > 0, "Done is read");
  tree = await m.draw();
  assert.ok(find(tree, "fizzy-card-105"), "and shows its cards");
});

test("side by side, a card let go over another column (open, or a folded pill) moves there, and a column's head let go over another column moves that column", async () => {
  const m = await mount();
  let tree = await atWidth(m, 600);
  fire(must(tree, "fizzy-card-103"), "on_mouse_down:left", {}, m.cx);
  fire(must(tree, "fizzy-col-c2"), "on_mouse_up:left", {}, m.cx);
  await m.cx.settle();
  assert.deepEqual(acct.writes(), [["card", "column", "103", "--column", "c2"]]);
  tree = await m.draw();
  fire(must(tree, "fizzy-col-c2"), "on_mouse_down:left", {}, m.cx);
  fire(must(tree, "fizzy-col-c1"), "on_mouse_up:left", {}, m.cx);
  await m.cx.settle();
  assert.deepEqual(acct.writes().at(-1), ["column", "move-left", "c2"]);
});

test("Maybe? starts with Add a card and the board's watchers: their photos, and Watch for new cards or Stop watching for the signed-in user, shown at once and read again", async () => {
  const m = await mount();
  let tree = await m.draw();
  const box = () => must(tree, "fizzy-watch");
  assert.match(textOf(box()), /Add a card[\s\S]*WATCHING FOR NEW CARDS/);
  assert.equal(all(must(tree, "fizzy-watchers"), n => n.style?.rounded_full && textOf(n) === "B").length, 1, "Bob watches it");
  assert.match(textOf(must(tree, "fizzy-watch-toggle")), /WATCH FOR NEW CARDS/);
  assert.deepEqual(iconsIn(tree, "fizzy-watch-toggle"), ["mods/fizzy/bell.svg"]);
  click(tree, "fizzy-watch-toggle", m.cx);
  tree = drawn(m.view, m.cx);
  assert.match(textOf(must(tree, "fizzy-watch-toggle")), /STOP WATCHING/, "at once");
  await m.cx.settle();
  assert.deepEqual(acct.writes(), [["board", "involvement", "b1", "--involvement", "watching"]]);
  assert.equal(acct.asked("board", "accesses").length, 2, "read with the columns, and again after");
  tree = await m.draw();
  assert.deepEqual(iconsIn(tree, "fizzy-watch-toggle"), ["mods/fizzy/bell-off.svg"]);
  click(tree, "fizzy-watch-toggle", m.cx);
  await m.cx.settle();
  assert.deepEqual(acct.writes().at(-1), ["board", "involvement", "b1", "--involvement", "access_only"]);
  click(await m.draw(), "fizzy-watch-add", m.cx);
  await m.cx.settle();
  assert.deepEqual(acct.writes().at(-1).slice(0, 4), ["card", "create", "--board", "b1"], "Add a card makes one in Maybe?");
});

test("dragging a column's header onto another column reorders the lanes at once, Fizzy moves it a place at a time, and the columns are read again", async () => {
  const { view, cx, draw } = await mount();
  let tree = await draw();
  let release;
  acct.hold = new Promise(resolve => { release = resolve; });
  fire(must(tree, "fizzy-section-c2"), "on_mouse_down:left", {}, cx);
  fire(must(tree, "fizzy-card-101"), "on_mouse_up:left", {}, cx);
  assert.deepEqual(sectionIds(drawn(view, cx)), ["not-now", "maybe", "c2", "c1", "done"], "moved before Fizzy has answered");
  const reads = acct.asked("column", "list").length;
  release();
  await cx.settle();
  acct.hold = null;
  assert.deepEqual(acct.asked("column", "move-left"), [["column", "move-left", "c2"]]);
  assert.equal(acct.asked("column", "list").length, reads + 1);
  assert.deepEqual(acct.columns.b1.map(c => c.id), ["not-now", "maybe", "c2", "c1", "done"]);
  tree = await draw();
  for (const [from, to] of [["c2", "c2"], ["c2", "maybe"], ["maybe", "c1"], ["done", "c1"]]) {
    fire(must(tree, `fizzy-section-${from}`), "on_mouse_down:left", {}, cx);
    fire(must(tree, `fizzy-section-${to}`), "on_mouse_up:left", {}, cx);
  }
  await cx.settle();
  assert.equal(acct.asked("column", "move-left").length + acct.asked("column", "move-right").length, 1, "its own lane, Maybe?, Not Now and Done neither move nor take a column");
  assert.deepEqual(acct.writes().filter(w => w[0] === "card"), [], "and no card moves");
});

test("a card moved out of Done is reopened first, then put in its lane", async () => {
  const { cx, draw } = await mount();
  let tree = await draw();
  click(tree, "fizzy-section-done", cx);
  tree = await draw();
  fire(must(tree, "fizzy-card-105"), "on_mouse_down:left", {}, cx);
  fire(must(tree, "fizzy-section-c2"), "on_mouse_up:left", {}, cx);
  await cx.settle();
  assert.deepEqual(acct.writes(), [["card", "reopen", "105"], ["card", "column", "105", "--column", "c2"]]);
  assert.equal(acct.lane(105), "c2");
});

test("New card on the board shown makes the card in Maybe? at once under a stand-in title and opens it, its title being written from empty; Enter saves the title", async () => {
  const m = await mount(), { view, cx, draw } = m;
  let tree = await newCardOn(m, "b1");
  const made = acct.cards.at(-1);
  assert.deepEqual(acct.writes(), [["card", "create", "--board", "b1", "--title", "New card"]], "made at once, in Maybe?: no move");
  assert.deepEqual([view.detail?.number, view.fresh], [made.number, made.number], "its card page is open");
  const input = inputOf(tree, "fizzy-title-input");
  assert.deepEqual([input.value(), input.options.placeholder, input.focused], ["", "Card title", true]);
  assert.ok(find(tree, "fizzy-fresh-bar"), "Discard and Done at its foot");
  input.edit("First one", cx);
  input.submit(cx);
  await cx.settle();
  assert.deepEqual(acct.writes().at(-1), ["card", "update", String(made.number), "--title", "First one"]);
  tree = await draw();
  assert.equal(textOf(must(tree, "fizzy-title")), "First one");
  click(tree, "fizzy-fresh-done", cx);
  tree = await draw();
  assert.equal(view.detail, null, "Done goes back to the board");
  assert.equal(lanesOf(tree)[made.number], "maybe");
  assert.equal(textOf(must(tree, `fizzy-card-title-${made.number}`)), "First one");
});

test("a card made from a real column's + is made in Maybe?, then moved there with the number the CLI returned, and opened", async () => {
  const { view, cx, draw } = await mount();
  await draw();
  const lists = () => acct.asked("card", "list", "--board", "b1", "--all").length, before = lists();
  click(await draw(), "fizzy-add-c1", cx);
  assert.equal(calls.openOverlay.length, 0, "no picker: the lane says where");
  await cx.settle();
  const made = acct.cards.at(-1);
  assert.deepEqual(acct.writes(), [["card", "create", "--board", "b1", "--title", "New card"], ["card", "column", String(made.number), "--column", "c1"]]);
  assert.deepEqual([view.detail?.number, view.editing], [made.number, "title"]);
  assert.equal(lists(), before + 1, "no extra list needed: only the read after the write");
  click(await draw(), "fizzy-fresh-done", cx);
  assert.equal(lanesOf(await draw())[made.number], "c1");
});

test("without a number in the answer, the new card is the newest one with the stand-in title", async () => {
  acct.createReturnsNumber = false;
  acct.cards.push({ ...acct.card(103), number: 90, id: "old", title: "New card" });
  const { view, cx, draw } = await mount();
  click(await draw(), "fizzy-add-c2", cx);
  await cx.settle();
  const made = acct.cards.at(-1);
  assert.ok(made.number > 90);
  assert.deepEqual(acct.writes().at(-1), ["card", "column", String(made.number), "--column", "c2"], "not the older card of that name");
  assert.equal(view.detail.number, made.number);
});

test("Maybe? and the real columns have a + and Not Now and Done do not; its click does not also fold the lane, nor its press start a drag", async () => {
  const { cx, draw } = await mount();
  const tree = await draw();
  assert.deepEqual(ids(tree).filter(i => i.startsWith("fizzy-add-")), ["fizzy-add-maybe", "fizzy-add-c1", "fizzy-add-c2"]);
  assert.deepEqual(ids(tree).filter(i => i.startsWith("fizzy-add-")).map(id => tipOf(tree, id)), ["New card here", "New card here", "New card here"]);
  fire(must(tree, "fizzy-add-maybe"), "on_click", {}, cx);
  assert.equal(cx.stopped, 1, "the lane's own click does not also fold it");
  fire(must(tree, "fizzy-add-c1"), "on_mouse_down:left", {}, cx);
  assert.equal(cx.stopped, 2, "and a press on it does not start a drag");
  await cx.settle();
});

test("a new card's Discard deletes it and goes back to the board; Back keeps it, as Done does", async () => {
  const m = await mount(), { view, cx, draw } = m;
  await newCardOn(m, "b1");
  const made = acct.cards.at(-1).number;
  click(await draw(), "fizzy-fresh-discard", cx);
  assert.deepEqual([view.detail, view.fresh], [null, null], "the page closes at once");
  await cx.settle();
  assert.deepEqual(acct.writes().at(-1), ["card", "delete", String(made)]);
  let tree = await draw();
  assert.equal(find(tree, `fizzy-card-${made}`), null, "gone from the board");
  assert.ok(find(tree, "fizzy-list-bar"));
  tree = await newCardOn(m, "b1");
  const kept = acct.cards.at(-1).number;
  click(tree, "fizzy-back", cx);
  await cx.settle();
  assert.equal(acct.writes().filter(a => a[1] === "delete").length, 1, "Back deletes nothing");
  assert.equal(lanesOf(await draw())[kept], "maybe", "the card stays, under its stand-in title");
  assert.equal(view.fresh, null);
});

test("the foot of a new card is Discard and Done, not the hand-off bar; a card opened any other way has the hand-off bar", async () => {
  const m = await mount(), { cx, draw } = m;
  let tree = await newCardOn(m, "b1");
  const foot = must(tree, "fizzy-fresh-bar");
  assert.equal(must(tree, "fizzy").kids.at(-1), foot, "at the panel's foot");
  assert.deepEqual(foot.kids.map(k => k.id ?? (k.style.flex_1 ? "spacer" : "?")), ["fizzy-fresh-discard", "spacer", "fizzy-fresh-done"]);
  assert.deepEqual(foot.kids.filter(k => k.id).map(k => [textOf(k).trim(), iconOf(tree, k.id), k.style.bg]), [["Discard", "trash.svg", "raised"], ["Done", "check.svg", "solid"]]);
  assert.equal(find(tree, "fizzy-bar"), null);
  click(tree, "fizzy-fresh-done", cx);
  click(await draw(), "fizzy-card-101", cx);
  tree = await draw();
  assert.deepEqual([Boolean(find(tree, "fizzy-bar")), Boolean(find(tree, "fizzy-fresh-bar"))], [true, false]);
});

test("one New card at a time: a + pressed again while the first card is being made does nothing", async () => {
  const { cx, draw } = await mount();
  const tree = await draw();
  const release = holdOn();
  click(tree, "fizzy-add-maybe", cx);
  click(tree, "fizzy-add-c1", cx);
  release();
  await cx.settle();
  assert.deepEqual(acct.writes(), [["card", "create", "--board", "b1", "--title", "New card"]]);
});

test("a card that could not be made says why and opens nothing", async () => {
  const { view, cx, draw } = await mount();
  acct.fail = args => (args[0] === "card" && args[1] === "create" ? failure("forbidden", "You can't add cards here") : undefined);
  click(await draw(), "fizzy-add-maybe", cx);
  await cx.settle();
  assert.equal(view.detail, null);
  assert.equal(view.creating, false, "a later New card can run");
  assert.equal(errors().length, 1);
});

test("a card's menu (the … button, a right-click) opens as a popup with the card's lanes", async () => {
  const { cx, draw } = await mount();
  let tree = await draw();
  fire(must(tree, "fizzy-card-101"), "on_mouse_down:right", {}, cx);
  assert.equal(cx.stopped, 1);
  await cx.settle();
  const spec = lastPopup();
  assert.equal(spec.mod, "fizzy");
  assert.equal(spec.kind, "popup");
  assert.equal(spec.props.menu.kind, "card");
  assert.equal(spec.props.menu.card.number, 101);
  assert.deepEqual(spec.props.menu.columns.map(c => c.id), ["not-now", "maybe", "c1", "c2", "done"]);
  assert.equal(spec.props.menu.pinned, false, "the pin list read at start");
  assert.ok(spec.height >= 300 && spec.height <= 560);
  const rows = menuRows(spec.props.menu, { agents: [], focused: null, boards: [], me: "u-me" });
  assert.equal(spec.height, Math.min(560, menuHeight(rows)));
  fire(must(tree, "fizzy-more-102"), "on_click", {}, cx);
  await cx.settle();
  assert.equal(lastPopup().props.menu.card.number, 102);
});

test("the card popup performs its rows: requests go to the panel (closing first), which does the write", async () => {
  const { draw, cx } = await mount();
  const tree = await draw();
  fire(must(tree, "fizzy-more-102"), "on_click", {}, cx);
  await cx.settle();
  const popup = await mountPopup();
  assert.equal(popup.cx.handles[0].focused, true, "the menu takes the keyboard");
  calls.order.length = 0;
  menuClick(popup, "golden");
  assert.deepEqual(calls.order, ["closeOverlay", "setShared"]);
  assert.deepEqual(calls.closeOverlay, ["ov-popup"]);
  const [, sent] = calls.setShared.find(([k]) => k === "fizzy.request");
  assert.equal(sent.op.on, false, "102 is golden: the row removes it");
  assert.equal(typeof sent.id, "string");
  await draw();
  assert.deepEqual(acct.writes(), [["card", "ungolden", "102"]]);
  await draw();
  assert.equal(acct.writes().length, 1, "a request is done once, however often the panel draws");
});

test("each request kind from a popup becomes the right command", async () => {
  const { draw, cx } = await mount();
  await draw();
  const ask = async op => { state.shared["fizzy.request"] = { id: `r${Math.random()}`, op }; await draw(); await cx.settle(); };
  await ask({ kind: "move", number: 101, target: "done" });
  await ask({ kind: "pin", number: 101, on: true });
  await ask({ kind: "pin", number: 101, on: false });
  await ask({ kind: "watch", number: 102, on: true });
  await ask({ kind: "watch", number: 102, on: false });
  await ask({ kind: "selfAssign", number: 102 });
  await ask({ kind: "assign", number: 102, user: "u-bob" });
  await ask({ kind: "tag", number: 102, name: "fresh" });
  await ask({ kind: "moveBoard", number: 103, board: "b2" });
  await ask({ kind: "move", number: 102, target: "not-now" });
  await ask({ kind: "move", number: 102, target: "maybe" });
  await ask({ kind: "remove", number: 104 });
  assert.deepEqual(acct.writes(), [
    ["card", "close", "101"], ["card", "pin", "101"], ["card", "unpin", "101"], ["card", "watch", "102"], ["card", "unwatch", "102"],
    ["card", "self-assign", "102"], ["card", "assign", "102", "--user", "u-bob"], ["card", "tag", "102", "--tag", "fresh"],
    ["card", "move", "103", "--to", "b2"], ["card", "postpone", "102"], ["card", "untriage", "102"], ["card", "delete", "104"],
  ]);
});

test("a tab bar's search request (⌘K) opens the search, also while the panel is hidden (its request timer takes it), and leaves shared state empty", async () => {
  const { view, cx, draw } = await mount();
  click(await draw(), "fizzy-card-101", cx);
  await cx.settle();
  state.layout = layoutWith({ hidden: true, active: "fizzy", children: ["files", "changes", "fizzy"] });
  state.shared["fizzy.request"] = { id: "search-1", op: { kind: "search" } };
  await timer(cx, REQUEST_EVERY).fn(cx);
  assert.ok(view.search, "the search is open");
  assert.equal(view.detail, null, "the open card made way for it");
  assert.equal(view.searchField.focused, true);
  assert.equal(state.shared["fizzy.request"], null);
});

test("a request from before this copy started is not done again; the next one is", async () => {
  state.shared["fizzy.request"] = { id: "old", op: { kind: "move", number: 101, target: "done" } };
  const { draw } = await mount();
  await draw();
  assert.deepEqual(acct.writes(), []);
  state.shared["fizzy.request"] = { id: "new", op: { kind: "golden", number: 103, on: true } };
  await draw();
  assert.deepEqual(acct.writes(), [["card", "golden", "103"]]);
});

test("a write that fails tells the person (explain) and the lists read again", async () => {
  const { draw, cx } = await mount();
  await draw();
  acct.fail = args => (args[1] === "golden" ? failure("not_found", "Resource not found") : undefined);
  const reads = acct.asked("card", "list").length;
  state.shared["fizzy.request"] = { id: "x", op: { kind: "golden", number: 103, on: true } };
  await draw();
  assert.equal(calls.notify.at(-1).level, "error");
  assert.equal(calls.notify.at(-1).body, "Not found in Fizzy: it was deleted, or you can't see it");
  assert.ok(acct.asked("card", "list").length > reads, "read again, so a hopeful change goes away");
  assert.ok(cx);
});

test("moving a card to another board, or deleting it, takes it off the screen at once", async () => {
  for (const op of [{ kind: "moveBoard", number: 102, board: "b2" }, { kind: "remove", number: 102 }]) {
    setup();
    const { view, cx, draw } = await mount();
    await draw();
    let release;
    acct.hold = new Promise(resolve => { release = resolve; });
    state.shared["fizzy.request"] = { id: "a", op };
    drawn(view, cx);
    assert.deepEqual(rowIds(drawn(view, cx)), [103, 101, 102], `${op.kind}: the draw only notes the request: nothing changed in it`);
    // The 1 ms timer runs it (the write itself is held back: it settles only after release).
    for (const t of cx.timers.filter(x => x.after && x.ms <= 1)) t.fn(cx);
    await tick();
    assert.deepEqual(rowIds(drawn(view, cx)), [103, 101], op.kind);
    release();
    await cx.settle();
  }
});

test("the open card moved to another board stays open, on that board at once, and is read again; deleted, it closes", async () => {
  const { view, cx, draw, tree } = await openDetail();
  click(tree, "fizzy-detail-board", cx);
  menuClick(await mountPopup(), "board-b2");
  drawn(view, cx);
  await due(cx);
  assert.equal(view.detail?.number, 101, "still open");
  assert.match(textOf(must(drawn(view, cx), "fizzy-detail-board")), /^PERSONAL/, "on its new board before Fizzy answers");
  await cx.settle();
  assert.deepEqual(acct.writes(), [["card", "move", "101", "--to", "b2"]]);
  const reads = acct.asked("card", "show").length;
  assert.ok(reads >= 2, "read again after the move");
  let next = await draw();
  assert.equal(view.board, "b1", "the board shown stays");
  assert.match(textOf(must(next, "fizzy-detail-board")), /^PERSONAL/);
  click(next, "fizzy-back", cx);
  assert.equal(rowIds(await draw()).includes(101), false, "gone from the board it left");
  click(await draw(), "fizzy-card-102", cx);
  await draw();
  state.shared["fizzy.request"] = { id: "del", op: { kind: "remove", number: 102 } };
  drawn(view, cx);
  await due(cx);
  assert.equal(view.detail, null, "a deleted card closes");
});

test("Delete in the card popup takes two clicks: the row arms, the second sends", async () => {
  const { draw, cx } = await mount();
  const tree = await draw();
  fire(must(tree, "fizzy-more-103"), "on_click", {}, cx);
  await cx.settle();
  const popup = await mountPopup();
  assert.match(textOf(must(popup.tree(), "fizzy-menu-delete")), /Delete card…/);
  menuClick(popup, "delete");
  assert.deepEqual(calls.closeOverlay, [], "armed, not closed");
  assert.match(textOf(must(popup.tree(), "fizzy-menu-delete")), /Click again to delete #103/);
  assert.deepEqual(requestOps(), []);
  menuClick(popup, "delete");
  assert.deepEqual(calls.closeOverlay, ["ov-popup"]);
  assert.deepEqual(requestOps(), [{ kind: "remove", number: 103 }]);
  await draw();
  assert.deepEqual(acct.writes(), [["card", "delete", "103"]]);
});

test("the card popup's other rows: insert and send go through the panel, copy and open act in the popup", async () => {
  withAgent();
  const { draw, cx } = await mount();
  const tree = await draw();
  fire(must(tree, "fizzy-more-101"), "on_click", {}, cx);
  await cx.settle();
  const spec = lastPopup();
  let popup = await mountPopup(spec);
  assert.match(textOf(must(popup.tree(), "fizzy-menu-insert")), /Insert in chat\s+Claude Code · fix login/, "the hint names where it goes");
  menuClick(popup, "copy-ref");
  assert.deepEqual(popup.cx.clipboard, ['Fizzy #101 "Fix the login redirect" (https://app.fizzy.do/111/cards/101)']);
  menuClick(popup, "copy-link");
  assert.equal(popup.cx.clipboard.length, 1, "a popup takes one choice: it closes with it");
  popup = await mountPopup(spec);
  menuClick(popup, "copy-link");
  assert.equal(popup.cx.clipboard.at(-1), "https://app.fizzy.do/111/cards/101");
  popup = await mountPopup(spec);
  menuClick(popup, "open");
  assert.deepEqual(popup.cx.opened, ["https://app.fizzy.do/111/cards/101"]);
  popup = await mountPopup(spec);
  menuClick(popup, "insert");
  assert.deepEqual(requestOps().at(-1), { kind: "insert", text: 'Fizzy #101 "Fix the login redirect" (https://app.fizzy.do/111/cards/101)' });
  assert.deepEqual(calls.run.map(c => c[0]), [], "the popup does not paste itself: it is gone a moment later");
  const click2 = makeCx();
  click2.clipboardText = "keep me";
  fire(must(tree, "fizzy-more-101"), "on_click", click2, cx);
  await draw();
  assert.deepEqual(calls.run.map(c => c[0]), ["pane.focus", "terminal.paste"], "the panel does");
});

test("the card popup's sub-menus open as new popups, the old one closing first", async () => {
  const { draw, cx } = await mount();
  const tree = await draw();
  fire(must(tree, "fizzy-more-101"), "on_click", {}, cx);
  await cx.settle();
  for (const [row, kind] of [["assign", "users"], ["tags", "tags"], ["move-board", "moveBoard"], ["start", "start"], ["send", "agents"]]) {
    const popup = await mountPopup(calls.openOverlay.filter(s => s.props.menu.kind === "card").at(-1));
    calls.order.length = 0;
    const opened = calls.openOverlay.length;
    menuClick(popup, row);
    assert.equal(calls.openOverlay.length, opened + 1);
    assert.equal(lastPopup().props.menu.kind, kind);
    assert.equal(lastPopup().props.menu.card?.number ?? lastPopup().props.menu.cards[0].number, 101);
    assert.deepEqual(calls.order, ["closeOverlay"]);
  }
});

test("People: the assign menu lists active people (not the system's), the person's own row says you, and a row assigns", async () => {
  const { draw, cx } = await mount();
  const tree = await draw();
  fire(must(tree, "fizzy-more-101"), "on_click", {}, cx);
  await cx.settle();
  assert.equal(calls.openOverlay.length, 1);
  assert.ok(acct.asked("user", "list").length >= 1 && acct.asked("tag", "list").length >= 1, "read when the card menu opened");
  openOverlayFor({ kind: "users", card: { number: 101, title: "T", assignees: [{ id: "u-me", name: "Ada" }] } });
  const popup = await mountPopup();
  assert.deepEqual(ids(popup.tree()).filter(i => i.startsWith("fizzy-menu-user-")), ["fizzy-menu-user-u-me", "fizzy-menu-user-u-bob"]);
  assert.match(textOf(must(popup.tree(), "fizzy-menu-user-u-me")), /Ada\s+you/);
  assert.equal(all(must(popup.tree(), "fizzy-menu-user-u-me"), n => n.path === "mods/fizzy/check.svg").length, 1, "assigned: checked");
  menuClick(popup, "user-u-bob");
  assert.deepEqual(requestOps(), [{ kind: "assign", number: 101, user: "u-bob" }]);
});

test("a menu opened before the people are read says so, and fills in when they arrive", async () => {
  openOverlayFor({ kind: "users", card: { number: 101, title: "T", assignees: [] } });
  const popup = await mountPopup(undefined, {});
  assert.deepEqual(acct.asked("user", "list").length, 1, "the popup reads them itself when no one has");
  assert.ok(find(popup.tree(), "fizzy-menu-user-u-me"));
  assert.deepEqual(state.shared["fizzy.people"].users.map(u => u.id), ["u-me", "u-bob", "u-bot", "u-off"], "shared with the other popups, without emails");
  assert.equal(JSON.stringify(state.shared["fizzy.people"]).includes("example.com"), false);
});

test("Tags: the card's tags are checked, a row toggles one, and the New tag field makes one", async () => {
  state.shared["fizzy.people"] = { me: "u-me", tags: [{ id: "t1", title: "bug" }, { id: "t2", title: "docs" }], users: [] };
  openOverlayFor({ kind: "tags", card: { number: 101, title: "T", tags: ["bug"] } });
  const popup = await mountPopup();
  assert.equal(all(must(popup.tree(), "fizzy-menu-tag-t1"), n => n.path === "mods/fizzy/check.svg").length, 1);
  assert.equal(all(must(popup.tree(), "fizzy-menu-tag-t2"), n => n.path === "mods/fizzy/check.svg").length, 0);
  const input = inputOf(popup.tree(), "fizzy-menu-newtag");
  assert.equal(input.options.placeholder, "New tag…");
  menuClick(popup, "tag-t2");
  assert.deepEqual(requestOps(), [{ kind: "tag", number: 101, name: "docs" }]);
  calls.setShared.length = 0;
  input.submit(popup.cx);
  assert.deepEqual(requestOps(), [], "an empty name sends nothing");
  input.edit("  brand new ", popup.cx);
  input.submit(popup.cx);
  assert.deepEqual(requestOps(), [{ kind: "tag", number: 101, name: "brand new" }]);
  assert.deepEqual(calls.closeOverlay.slice(-1), ["ov-popup"]);
});

test("Move to board lists the other boards; one moves the card there", async () => {
  state.shared["fizzy.boards"] = [{ id: "b1", name: "Roadmap" }, { id: "b2", name: "Personal" }];
  openOverlayFor({ kind: "moveBoard", card: { number: 101, title: "T", board: { id: "b1", name: "Roadmap" } } });
  const popup = await mountPopup();
  assert.deepEqual(ids(popup.tree()).filter(i => i.startsWith("fizzy-menu-board-")), ["fizzy-menu-board-b2"]);
  menuClick(popup, "board-b2");
  assert.deepEqual(requestOps(), [{ kind: "moveBoard", number: 101, board: "b2" }]);
});

test("a popup is keyboard-driven: Down/Up move, Enter chooses, Escape closes; notes are not rows", async () => {
  state.agents = [AGENT("t1"), AGENT("t2", { tab_name: "docs" })];
  openOverlayFor({ kind: "agents", cards: [{ number: 101, title: "T", board: { id: "b1", name: "Roadmap" } }] });
  const popup = await mountPopup();
  const key = name => { const k = makeCx(); fire(must(popup.tree(), "fizzy-menu"), "on_key_down", { key: name, modifiers: {} }, k); return k; };
  assert.equal(must(popup.tree(), "fizzy-menu-agent-t1").style.bg, "selected");
  key("down");
  assert.equal(must(popup.tree(), "fizzy-menu-agent-t2").style.bg, "selected");
  key("down");
  assert.equal(must(popup.tree(), "fizzy-menu-agent-t1").style.bg, "selected", "wraps");
  key("up");
  key("enter");
  assert.deepEqual(requestOps().map(o => [o.kind, o.address]), [["paste", "t2"]]);
  calls.closeOverlay.length = 0;
  key("escape");
  assert.deepEqual(calls.closeOverlay, ["ov-popup"]);
  state.agents = [];
  const empty = await mountPopup();
  assert.match(textOf(empty.tree()), /No agents running/);
  fire(must(empty.tree(), "fizzy-menu"), "on_key_down", { key: "down", modifiers: {} }, makeCx());
  fire(must(empty.tree(), "fizzy-menu"), "on_key_down", { key: "enter", modifiers: {} }, makeCx());
  assert.equal(requestOps().length, 1, "nothing to choose: nothing happens");
});

test("danger rows and lane colors are drawn: the armed delete in the blocked color, lanes with a dot", async () => {
  const columns = acct.columns.b1.map(c => ({ id: c.id, name: c.name, kind: c.kind, pseudo: c.pseudo, color: c.color }));
  openOverlayFor({ kind: "card", card: { number: 101, title: "T", url: "u", column: { id: "c1", name: "In progress" }, tags: [], assignees: [], board: { id: "b1", name: "Roadmap" } }, columns });
  const popup = await mountPopup();
  assert.equal(must(popup.tree(), "fizzy-menu-delete").style.text_color, "foreground");
  menuClick(popup, "delete");
  assert.equal(must(popup.tree(), "fizzy-menu-delete").style.text_color, "blocked");
  const review = colorOf(acct.columns.b1.find(c => c.id === "c2"));
  assert.ok(review, "the fixture's Review column has a color");
  const dot = all(must(popup.tree(), "fizzy-menu-lane-c2"), n => n.style.bg === review);
  assert.equal(dot.length, 1, "Review's dot is its column's color");
});

test("every popup row and header has an id, and the ids are unique", async () => {
  state.agents = [AGENT("t1")];
  state.knownAgents = async () => [agent("claude", "Claude Code")];
  state.shared["fizzy.people"] = { me: "u-me", users: [{ id: "u-me", name: "Ada", active: true, role: "owner" }], tags: [{ id: "t1", title: "bug" }] };
  state.shared["fizzy.boards"] = [{ id: "b1", name: "Roadmap" }, { id: "b2", name: "Personal" }];
  const card = { number: 101, title: "T", url: "u", column: { id: "c1", name: "In progress" }, tags: ["bug"], assignees: [], board: { id: "b1", name: "Roadmap" } };
  const columns = acct.columns.b1;
  for (const menu of [{ kind: "card", card, columns }, { kind: "card", card, columns, pinned: true }, { kind: "boards", current: "b1", follow: false, spaceBoard: "b2" }, { kind: "agents", cards: [card] }, { kind: "start", cards: [card] },
    { kind: "users", card }, { kind: "tags", card }, { kind: "moveBoard", card }]) {
    openOverlayFor(menu);
    const popup = await mountPopup();
    const tree = popup.tree();
    const found = ids(tree);
    assert.equal(new Set(found).size, found.length, `${menu.kind}: unique ids`);
    const bare = all(tree, n => Object.keys(n.handlers).length && n.id === null);
    assert.equal(bare.length, 0, `${menu.kind}: every interactive element has an id`);
    assert.ok(found.some(i => i.startsWith("fizzy-menu-") && i !== "fizzy-menu-list" && i !== "fizzy-menu-newtag"), `${menu.kind}: has rows`);
    for (const n of all(tree, x => x.kind === "svg" || x.kind === "image")) assert.equal(typeof n.path, "string");
  }
});

test("a popup is as tall as its rows (never over 560 px), with room for rows that arrive later", async () => {
  state.agents = [AGENT("t1"), AGENT("t2")];
  installed(CLAUDE);
  const { draw, cx } = await mount();
  let tree = await draw();
  click(tree, "fizzy-board", cx);
  assert.equal(lastPopup().width, 260);
  assert.equal(lastPopup().height, menuHeight(menuRows(lastPopup().props.menu, { boards: [B1, B2] })));
  fire(must(tree, "fizzy-more-101"), "on_click", {}, cx);
  await cx.settle();
  menuClick(await mountPopup(), "send");
  const send = lastPopup();
  assert.equal(send.width, 320, "a session's name and its space need more room");
  assert.equal(send.height, menuHeight(menuRows(send.props.menu, { agents: state.agents })));
  click(tree, "fizzy-card-101", cx, { modifiers: { platform: true } });
  tree = await draw();
  click(tree, "fizzy-bar-send", cx);
  assert.equal(lastPopup().width, 320, "the bar's Send opens the same popup");
  assert.equal(lastPopup().height, menuHeight(menuRows(lastPopup().props.menu, { agents: state.agents })));
  click(tree, "fizzy-bar-start", cx);
  assert.equal(lastPopup().width, 260);
  assert.equal(lastPopup().height, menuHeight([{ type: "note" }], 5), "a note now, room for the agents that are being looked up");
  fire(must(tree, "fizzy-more-101"), "on_click", {}, cx);
  await cx.settle();
  assert.equal(lastPopup().height, 560, "the long card menu is capped: its rows scroll");
  assert.equal(menuHeight([], 1), 12 + 31, "the measures are the lib's");
});

test("Mine reads the person's cards on every board, a few boards at a time, one section per board", async () => {
  for (let i = 3; i <= 9; i++) acct.boards.push({ id: `b${i}`, name: `Board ${i}`, url: `u${i}` });
  const { cx, draw } = await mount();
  let tree = await draw();
  acct.peak = 0;
  click(tree, "fizzy-view-mine", cx);
  tree = await draw();
  const asked = acct.asked("card", "list").filter(a => a.includes("--assignee"));
  assert.deepEqual(asked.map(a => a[3]).sort(), acct.boards.map(b => b.id).sort(), "every board, once");
  assert.ok(asked.every(a => a[5] === "u-me" && a.at(-1) === "--all"), "by the person's user id");
  assert.equal(acct.peak, CONCURRENCY, "six at a time, no more");
  assert.deepEqual(ids(tree).filter(i => i.startsWith("fizzy-mine-")), ["fizzy-mine-b1", "fizzy-mine-b2"], "only boards with cards");
  assert.deepEqual(rowIds(tree), [101, 201]);
  assert.equal(textOf(must(tree, "fizzy-mine-b2")), "Personal");
  assert.equal(localStorage.getItem("view"), '"mine"');
  assert.equal(find(tree, "fizzy-only-mine"), null, "Me is for the board view");
  assert.ok(find(tree, "fizzy-filter"));
  inputOf(tree, "fizzy-filter").edit("other", cx);
  assert.deepEqual(rowIds(await draw()), [201]);
});

test("Mine shows its progress while boards are still being read", async () => {
  const { cx, view } = await mount();
  let release;
  const { draw } = { draw: () => drawn(view, cx) };
  acct.hold = new Promise(resolve => { release = resolve; });
  click(draw(), "fizzy-view-mine", cx);
  assert.match(textOf(must(draw(), "fizzy-list")), /Loading 2 boards…/);
  release();
  await cx.settle();
  acct.hold = null;
  assert.doesNotMatch(textOf(must(draw(), "fizzy-list")), /Loading/);
});

test("a copy that starts on Mine waits for the boards and the person, then reads", async () => {
  localStorage.setItem("view", '"mine"');
  const { draw } = await mount();
  const tree = await draw();
  assert.deepEqual(rowIds(tree), [101, 201]);
  assert.equal(acct.asked("card", "list", "--board", "b1", "--all").length, 0, "the board's own cards are not read for Mine");
  assert.deepEqual(keptMe(), { account: "111", id: "u-me" });
});

test("Mine says why it cannot start when the person cannot be found out", async () => {
  localStorage.setItem("view", '"mine"');
  acct.fail = args => (args[0] === "identity" ? failure("auth_required", "Unauthorized") : undefined);
  const { cx, draw } = await mount();
  let tree = await draw();
  assert.match(textOf(must(tree, "fizzy-list")), /Not signed in to Fizzy/);
  acct.fail = null;
  click(tree, "fizzy-retry", cx);
  tree = await draw();
  assert.deepEqual(rowIds(tree), [101, 201]);
});

test("the person is kept with their account: a copy on the same account uses the kept one and asks nothing, until Refresh reads it again", async () => {
  localStorage.setItem("me", JSON.stringify({ account: "111", id: "u-kept" }));
  const { cx, draw } = await mount();
  let tree = await draw();
  assert.equal(acct.asked("identity").length, 0, "nothing is asked");
  assert.equal(sharedMe(), "u-kept", "the popups have it");
  click(tree, "fizzy-only-mine", cx);
  tree = await draw();
  assert.deepEqual(rowIds(tree), [], "Me filters by the kept id");
  let release;
  acct.hold = new Promise(resolve => { release = resolve; });
  click(tree, "fizzy-refresh", cx);
  await tick();
  assert.equal(sharedMe(), "u-kept", "the same account: the kept one stays while it is read again");
  release();
  await cx.settle();
  acct.hold = null;
  assert.equal(acct.asked("identity").length, 1, "Refresh reads the person again");
  assert.equal(sharedMe(), "u-me");
  assert.deepEqual(keptMe(), { account: "111", id: "u-me" });
  assert.deepEqual(rowIds(await draw()), [101]);
  await press(cx, "refresh");
  assert.equal(acct.asked("identity").length, 2, "and so does the refresh key");
});

// Holds back every `identity show` until the function it returns is called; every other call answers as it comes.
function holdIdentity() {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const exec = state.exec;
  state.exec = async (command, args, options) => {
    if (command === "fizzy" && args[0] === "identity") await held;
    return exec(command, args, options);
  };
  return release;
}

test("a copy on another account never uses the person kept for the first: the kept id is dropped and the person read for the account `config show` names", async () => {
  localStorage.setItem("me", JSON.stringify({ account: "222", id: "user-222" }));
  state.shared["fizzy.people"] = { me: "user-222", users: [], tags: [] };
  const release = holdIdentity();
  const { cx } = await mount({ settle: false });
  await tick();
  const before = sharedMe();
  release();
  await cx.settle();
  assert.equal(before, null, "dropped once `config show` has answered, before the person is read");
  assert.equal(acct.asked("identity").length, 1);
  assert.equal(sharedMe(), "u-me");
  assert.deepEqual(keptMe(), { account: "111", id: "u-me" });
  let was = "user-222";
  const changes = [];
  for (const [key, value] of calls.setShared) if (key === "fizzy.people") { if (value.me !== was) changes.push(value.me); was = value.me; }
  assert.deepEqual(changes, [null, "u-me"], "the panel never shares the other account's id: it only drops it, then shares this account's");
});

test("when `config show` names another account, Refresh asks it again, drops the person at once and reads them for the new account", async () => {
  acct.identity.accounts.push({ id: "acct-2", slug: "/222", user: { id: "user-222", name: "Ada" } });
  const { cx, draw } = await mount();
  const tree = await draw();
  assert.equal(sharedMe(), "u-me");
  acct.config = { account: "222", board: "b1" };
  const release = holdIdentity();
  click(tree, "fizzy-refresh", cx);
  await tick();
  const before = sharedMe();
  release();
  await cx.settle();
  assert.equal(acct.asked("config", "show").length, 2, "asked again");
  assert.equal(before, null, "the old account's person is dropped before the person is read again");
  assert.equal(sharedMe(), "user-222");
  assert.deepEqual(keptMe(), { account: "222", id: "user-222" });
  assert.deepEqual(JSON.parse(localStorage.getItem("config")), { board: "b1", account: "222" });
});

test("Mine, which asks every board, is polled every other time (and at once when the panel comes back)", async () => {
  const { cx, draw } = await mount();
  click(await draw(), "fizzy-view-mine", cx);
  await draw();
  const mineReads = () => acct.asked("card", "list").filter(a => a.includes("--assignee")).length;
  const first = mineReads();
  timer(cx, POLL_VIEW).fn(cx);
  await cx.settle();
  assert.equal(mineReads(), first, "the first poll leaves it");
  timer(cx, POLL_VIEW).fn(cx);
  await cx.settle();
  assert.equal(mineReads(), first * 2, "the second reads every board again");
  state.layout = HIDDEN();
  timer(cx, 1000).fn(cx);
  state.layout = LAYOUT;
  await draw();
  assert.equal(mineReads(), first * 3, "the panel coming back reads it at once");
});

test("the view switch is remembered, and a new copy opens on it", async () => {
  const { cx, draw } = await mount();
  click(await draw(), "fizzy-view-pins", cx);
  const again = await mount();
  const tree = await again.draw();
  assert.equal(must(tree, "fizzy-view-pins").style.bg, "selected");
  assert.equal(find(tree, "fizzy-board-bar"), null, "Pins has no board row");
  assert.deepEqual(acct.asked("pin", "list").length, 3, "one read per start (a copy that opens on Pins reads it once) and one as the view switched");
});

test("Pins lists the pinned cards (a pin may wrap its card), and their menu offers Unpin", async () => {
  acct.pins = [{ id: "pin1", card: acct.card(102) }, acct.card(101)];
  const { cx, draw } = await mount();
  click(await draw(), "fizzy-view-pins", cx);
  const tree = await draw();
  assert.deepEqual(rowIds(tree), [102, 101]);
  fire(must(tree, "fizzy-card-102"), "on_mouse_down:right", {}, cx);
  await cx.settle();
  assert.equal(lastPopup().props.menu.pinned, true);
  const popup = await mountPopup();
  assert.equal(find(popup.tree(), "fizzy-menu-pin"), null, "known to be pinned: only Unpin");
  menuClick(popup, "unpin");
  assert.deepEqual(requestOps(), [{ kind: "pin", number: 102, on: false }]);
  await draw();
  assert.deepEqual(acct.writes(), [["card", "unpin", "102"]]);
  inputOf(tree, "fizzy-filter").edit("zzz", cx);
  assert.match(textOf(must(await draw(), "fizzy-list")), /No cards match/);
});

test("no pins says so", async () => {
  const { cx, draw } = await mount();
  click(await draw(), "fizzy-view-pins", cx);
  assert.match(textOf(must(await draw(), "fizzy-list")), /No pinned cards/);
});

test("the card menu from Mine reads that board's columns first (a card of another board)", async () => {
  const { cx, draw } = await mount();
  click(await draw(), "fizzy-view-mine", cx);
  const tree = await draw();
  const before = calls.openOverlay.length;
  fire(must(tree, "fizzy-more-201"), "on_click", {}, cx);
  assert.equal(calls.openOverlay.length, before, "not yet: the columns are being read");
  await cx.settle();
  assert.equal(lastPopup().props.menu.card.number, 201);
  assert.deepEqual(lastPopup().props.menu.columns.map(c => c.id), ["not-now", "maybe", "done"], "b2's own lanes");
  assert.deepEqual(acct.asked("column", "list", "--board", "b2").length, 1);
});

test("Inbox: the unread notes, a click marks the note read and opens its card; Mark all read; the unread badge", async () => {
  const { view, cx, draw } = await mount();
  let tree = await draw();
  assert.match(textOf(must(tree, "fizzy-view-inbox")), /2/, "the badge counts the unread");
  click(tree, "fizzy-view-inbox", cx);
  tree = await draw();
  assert.deepEqual(acct.asked("notification", "tray").at(-1), ["notification", "tray"], "the unread tray: no --include-read");
  assert.deepEqual(noteIds(tree), ["n1", "n2"]);
  assert.match(textOf(must(tree, "fizzy-note-n1")), /Fix the login redirect\s+Assigned to you\s+#101 · Roadmap · Bob · 10m/);
  assert.equal(find(tree, "fizzy-filter"), null, "no filter for notifications");
  click(tree, "fizzy-note-n1", cx);
  assert.deepEqual(view.inbox.map(n => n.id), ["n2"], "gone from the list at once");
  tree = await draw();
  assert.deepEqual(acct.writes(), [["notification", "read", "n1"]]);
  assert.ok(find(tree, "fizzy-detail"), "the card opens");
  assert.deepEqual(acct.asked("card", "show"), [["card", "show", "101"]]);
  assert.equal(state.shared["fizzy.unread"], 1);
  click(tree, "fizzy-back", cx);
  tree = await draw();
  assert.deepEqual(noteIds(tree), ["n2"], "back in the Inbox: the one that was read is not there");
  click(tree, "fizzy-read-all", cx);
  assert.deepEqual(noteIds(drawn(view, cx)), [], "emptied at once");
  await cx.settle();
  assert.deepEqual(acct.writes().at(-1), ["notification", "read-all"]);
  assert.equal(state.shared["fizzy.unread"], 0);
  tree = await draw();
  assert.deepEqual(noteIds(tree), [], "read, they do not stay");
  assert.match(textOf(must(tree, "fizzy-list")), /You're all caught up/);
  assert.ok(acct.asked("notification", "tray").every(a => !a.includes("--include-read")), "no read notification was ever asked for");
});

test("a read note in the tray's answer is never drawn, and does not count", async () => {
  acct.trayShowsRead = true; // a CLI that answers the read ones too
  acct.notifications[0].read = true;
  const { view, cx, draw } = await mount();
  assert.equal(state.shared["fizzy.unread"], 1);
  click(await draw(), "fizzy-view-inbox", cx);
  const tree = await draw();
  assert.deepEqual(noteIds(tree), ["n2"], "n1 is read: no row for it");
  assert.deepEqual(view.inbox.map(n => n.id), ["n2"]);
  assert.equal(find(tree, "fizzy-note-n1"), null);
  assert.equal(state.shared["fizzy.unread"], 1);
});

test("the unread count is shared once, and again only when it changes — even while the panel is hidden", async () => {
  const { cx } = await mount();
  const setUnread = () => calls.setShared.filter(([k]) => k === "fizzy.unread").map(([, v]) => v);
  assert.deepEqual(setUnread(), [2], "asked at start");
  state.layout = layoutWith({ hidden: true, active: "fizzy", children: ["files", "changes", "fizzy"] });
  assert.equal(inboxTimer(cx).ms, 30000);
  inboxTimer(cx).fn(cx);
  await cx.settle();
  inboxTimer(cx).fn(cx);
  await cx.settle();
  assert.deepEqual(setUnread(), [2], "the same count: no redraw of every mod");
  assert.equal(acct.asked("notification", "tray").length, 3, "but it was asked, hidden or not");
  acct.notifications[0].read = true;
  inboxTimer(cx).fn(cx);
  await cx.settle();
  assert.deepEqual(setUnread(), [2, 1]);
  acct.notifications.length = 0;
  inboxTimer(cx).fn(cx);
  await cx.settle();
  assert.deepEqual(setUnread(), [2, 1, 0]);
});

test("the polls: the view every 30 s while it shows, the unread notifications every 30 s, a hidden-copy note every second, a popup's request every 300 ms", async () => {
  const { cx } = await mount();
  assert.deepEqual(cx.timers.filter(t => !t.after).map(t => t.ms), [POLL_VIEW, POLL_INBOX, 1000, REQUEST_EVERY, AVATAR_EVERY], "and the people (their photos) once a day");
  assert.equal(AVATAR_EVERY, 86400000);
  assert.equal(REQUEST_EVERY, 300);
  assert.equal(POLL_VIEW, 30000);
  assert.equal(POLL_INBOX, 30000);
});

test("a hidden panel does not poll its view; when it shows again it reads at once", async () => {
  const { view, cx, draw } = await mount();
  await draw();
  const hidden = layoutWith({ hidden: true, active: "fizzy", children: ["files", "changes", "fizzy"] });
  assert.equal(fizzyVisible(hidden), false);
  state.layout = hidden;
  const before = acct.log.length;
  timer(cx, POLL_VIEW).fn(cx);
  await cx.settle();
  assert.equal(acct.log.length, before, "nothing asked while hidden");
  timer(cx, 1000).fn(cx);
  state.layout = LAYOUT;
  drawn(view, cx);
  await cx.settle();
  assert.ok(acct.log.length > before, "back in view: read again");
  const shown = acct.log.length;
  timer(cx, POLL_VIEW).fn(cx);
  await cx.settle();
  assert.ok(acct.log.length > shown, "and the poll runs again");
});

test("with a card open the 30 s poll reads the card, its comments, a new comment's reactions and the tray, and nothing else: no pin list", async () => {
  const { cx, draw, tree } = await openDetail();
  assert.ok(tree);
  const before = acct.log.length;
  acct.comments[101].push({ id: "cm9", body: { html: "<p>Late</p>", plain_text: "Late" }, creator: ME, created_at: "2026-02-01T00:00:00Z" });
  timer(cx, POLL_VIEW).fn(cx);
  inboxTimer(cx).fn(cx);
  await cx.settle();
  assert.deepEqual(acct.log.slice(before).map(a => a.slice(0, 2).join(" ")).sort(), ["card show", "comment list", "notification tray", "reaction list"]);
  assert.deepEqual(acct.asked("reaction", "list").at(-1), ["reaction", "list", "--card", "101", "--comment", "cm9"], "the reactions already read are not read again");
  assert.ok(find(await draw(), "fizzy-comment-cm9"));
});

test("two refreshes of the same thing never overlap: the second waits and runs once the first is done", async () => {
  const { cx, draw } = await mount();
  const tree = await draw();
  const base = acct.asked("card", "list", "--board", "b1", "--all").length;
  let release;
  acct.hold = new Promise(resolve => { release = resolve; });
  click(tree, "fizzy-refresh", cx);
  click(tree, "fizzy-refresh", cx);
  click(tree, "fizzy-refresh", cx);
  assert.equal(acct.asked("card", "list", "--board", "b1", "--all").length, base + 1, "one in flight");
  release();
  await cx.settle();
  acct.hold = null;
  assert.equal(acct.asked("card", "list", "--board", "b1", "--all").length, base + 2, "and one more, for what came in meanwhile");
});

test("an answer that arrives after the board changed is dropped", async () => {
  const { view, cx, draw } = await mount();
  await draw();
  let release;
  acct.hold = new Promise(resolve => { release = resolve; });
  acct.fail = args => (args.includes("b1") ? failure("network", "reset") : undefined);
  click(drawn(view, cx), "fizzy-refresh", cx);
  state.shared["fizzy.board"] = { follow: false, board: "b2", id: "pick" };
  drawn(view, cx);
  release();
  await cx.settle();
  acct.hold = null;
  acct.fail = null;
  const tree = drawn(view, cx);
  assert.equal(boardName(tree), "Personal");
  assert.doesNotMatch(textOf(tree), /Can't reach Fizzy/, "b1's late failure is not b2's");
  assert.ok(cx);
});

test("not signed in: the panel says how to sign in and offers Retry, which reads again", async () => {
  acct.fail = () => failure("auth_required", "Unauthorized");
  const { cx, draw } = await mount();
  let tree = await draw();
  assert.match(textOf(must(tree, "fizzy-list")), /Not signed in to Fizzy: run `fizzy setup` in a terminal/);
  assert.doesNotMatch(textOf(must(tree, "fizzy-list")), /auth login/);
  assert.ok(find(tree, "fizzy-retry"));
  acct.fail = null;
  click(tree, "fizzy-retry", cx);
  tree = await draw();
  assert.deepEqual(rowIds(tree), [103, 101, 102]);
  assert.equal(find(tree, "fizzy-retry"), null);
});

test("the error of one board is not shown on the next one", async () => {
  const { cx, draw } = await mount();
  await draw();
  acct.fail = args => (args.includes("b1") ? failure("network", "reset") : undefined);
  click(await draw(), "fizzy-refresh", cx);
  assert.match(textOf(must(await draw(), "fizzy-list")), /Can't reach Fizzy/);
  state.shared["fizzy.board"] = { follow: false, board: "b2", id: "pick" };
  const tree = await draw();
  assert.doesNotMatch(textOf(must(tree, "fizzy-list")), /Can't reach Fizzy/);
  assert.deepEqual(rowIds(tree), [201]);
});

const MAYBE_BLUE = "#4f8ef7", NOT_NOW_GRAY = "#8a8f98", DONE_GRAY = "#9aa0aa";
// The layer that gives a golden card its glow (window.paint_path), or null.
const glowOf = tree_or_node => all(tree_or_node, n => n.kind === "path")[0] ?? null;

test("a lane's color is its column's; Maybe? is Fizzy's blue, Not Now gray and Done a muted gray: the lane's dot on the board, the lane named in its color on a card in a list, the card page's chip", async () => {
  const { cx, draw } = await mount();
  let tree = await draw();
  const dot = key => must(tree, `fizzy-section-${key}`).kids[1].style.bg;
  const [inProgress, review] = ["c1", "c2"].map(id => colorOf(acct.columns.b1.find(c => c.id === id)));
  assert.ok(inProgress && review && inProgress !== review, "the fixture's two colored columns differ");
  assert.deepEqual(["c1", "c2", "maybe", "not-now", "done"].map(dot), [inProgress, review, MAYBE_BLUE, NOT_NOW_GRAY, DONE_GRAY]);
  assert.equal(find(tree, "fizzy-card-lane-101"), null, "on the board the lane says it");
  click(tree, "fizzy-view-mine", cx);
  tree = await draw();
  const named = id => { const n = must(tree, id); return [n.style.text_color, n.kids[0].style.bg, textOf(n).trim()]; };
  assert.deepEqual(named("fizzy-card-lane-101"), [inProgress, inProgress, "IN PROGRESS"]);
  click(tree, "fizzy-home", cx);
  click(await draw(), "fizzy-section-done", cx);
  click(await draw(), "fizzy-card-105", cx);
  assert.equal(must(await draw(), "fizzy-lane").style.bg, DONE_GRAY, "the card page's lane chip has the same dot");
});

test("Escape while a new card's title is written stops the edit: the card keeps its stand-in title, and its page stays with Discard and Done", async () => {
  const m = await mount(), { view, cx, draw } = m;
  const tree = await newCardOn(m, "b1");
  fire(must(tree, "fizzy-title-edit"), "on_key_down", { key: "a", modifiers: {} }, cx);
  assert.equal(view.editing, "title", "other keys leave it");
  fire(must(tree, "fizzy-title-edit"), "on_key_down", { key: "escape", modifiers: {} }, cx);
  const after = await draw();
  assert.equal(view.editing, null);
  assert.equal(textOf(must(after, "fizzy-title")), "New card");
  assert.ok(find(after, "fizzy-fresh-bar"));
  await cx.settle();
  assert.equal(acct.writes().length, 1, "only the create");
});

test("a missing CLI says so", async () => {
  acct.missing = true;
  const { draw } = await mount();
  const tree = await draw();
  assert.match(textOf(must(tree, "fizzy-list")), /The fizzy CLI isn't installed \(or not on PATH\)/);
  assert.ok(find(tree, "fizzy-retry"));
});

test("a fizzy that Herdr stops at its time limit is called slow, not missing", async () => {
  acct.stopped = true;
  const { draw } = await mount();
  const tree = await draw();
  assert.match(textOf(must(tree, "fizzy-list")), /Fizzy took too long to answer/);
  assert.doesNotMatch(textOf(must(tree, "fizzy-list")), /isn't installed/);
  assert.ok(find(tree, "fizzy-retry"));
});

test("every fizzy call asks for the JSON envelope with --json last: the reads, the tray and the writes alike", async () => {
  const { cx, draw, tree } = await openDetail();
  click(tree, "fizzy-step-check-s1", cx);
  await cx.settle();
  await draw();
  const sent = calls.exec.filter(c => c.command === "fizzy");
  const kinds = new Set(sent.map(c => c.args.slice(0, 2).join(" ")));
  assert.ok(["board list", "card list", "card show", "comment list", "notification tray", "step update"].every(k => kinds.has(k)), [...kinds].join(", "));
  for (const c of sent) assert.equal(c.args.indexOf("--json"), c.args.length - 1, c.args.slice(0, 2).join(" "));
});

test("an error for the board's cards shows with Retry, and the cards read before stay on screen", async () => {
  const { cx, draw } = await mount();
  await draw();
  acct.fail = args => (args[0] === "card" && args[1] === "list" ? failure("network", "connection reset") : undefined);
  click(await draw(), "fizzy-refresh", cx);
  const tree = await draw();
  assert.match(textOf(must(tree, "fizzy-list")), /Can't reach Fizzy|connection reset/);
  assert.ok(find(tree, "fizzy-retry"), "Retry");
  assert.deepEqual(rowIds(tree), [103, 101, 102], "what was read before stays");
});

test("Done and Not Now errors show inside their lane with Retry", async () => {
  const { cx, draw } = await mount();
  let tree = await draw();
  acct.fail = args => (args.includes("closed") ? failure("network", "reset") : undefined);
  click(tree, "fizzy-section-done", cx);
  tree = await draw();
  assert.match(textOf(must(tree, "fizzy-list")), /Can't reach Fizzy/);
  assert.ok(find(tree, "fizzy-retry-done"), "the lane's own Retry");
  assert.equal(find(tree, "fizzy-retry"), null);
  acct.fail = null;
  click(tree, "fizzy-retry-done", cx);
  tree = await draw();
  assert.equal(lanesOf(tree)[105], "done");
  assert.equal(find(tree, "fizzy-retry-done"), null);
});

test("an account with no boards, and a board with no cards, say so", async () => {
  acct.boards.length = 0;
  let m = await mount();
  assert.match(textOf(must(await m.draw(), "fizzy-list")), /No boards/);
  setup();
  acct.cards.length = 0;
  m = await mount();
  assert.match(textOf(must(await m.draw(), "fizzy-list")), /No cards/);
});

test("every interactive element has an id, the ids are unique, and the root is the panel", async () => {
  state.agents = [AGENT("t1")];
  const m = await mount();
  const check = (tree, what) => {
    const found = ids(tree);
    assert.equal(new Set(found).size, found.length, `${what}: unique ids`);
    assert.deepEqual(all(tree, n => Object.keys(n.handlers).filter(h => h !== "on_key_down" && h !== "on_mouse_up:left").length && n.id === null).map(n => n.kind), [], `${what}: handlers need an id`);
  };
  let tree = await m.draw();
  assert.ok(find(tree, "fizzy"), "the panel's root");
  check(tree, "board");
  click(tree, "fizzy-section-not-now", m.cx);
  click(tree, "fizzy-section-done", m.cx);
  check(await m.draw(), "board, every lane open");
  inputOf(tree, "fizzy-filter").edit("login", m.cx);
  check(await m.draw(), "board, with words in the filter (its clear button)");
  inputOf(tree, "fizzy-filter").edit("", m.cx);
  click(await m.draw(), "fizzy-card-101", m.cx, { modifiers: { platform: true } });
  check(await m.draw(), "board, a card picked (the hand-off bar)");
  click(await m.draw(), "fizzy-card-101", m.cx, { modifiers: { platform: true } });
  click(await m.draw(), "fizzy-search-open", m.cx);
  check(await m.draw(), "the search field, before Enter");
  check(await searchFor(m, "login"), "search results");
  click(await m.draw(), "fizzy-search-back", m.cx);
  click(await m.draw(), "fizzy-add-c1", m.cx);
  check(await m.draw(), "a new card, its title being written");
  click(await m.draw(), "fizzy-fresh-done", m.cx);
  click(await m.draw(), "fizzy-card-101", m.cx);
  check(await m.draw(), "detail");
  click(await m.draw(), "fizzy-step-text-s1", m.cx);
  click(await m.draw(), "fizzy-comment-edit-cm1", m.cx);
  check(await m.draw(), "detail, a step and a comment being edited");
  click(await m.draw(), "fizzy-back", m.cx);
  acct.notifications[0].read = true;
  for (const view of ["mine", "inbox", "pins"]) {
    click(await m.draw(), `fizzy-view-${view}`, m.cx);
    check(await m.draw(), view);
  }
});

test("at 280 px no view fixes a width of 200 or more (Board, the search results, Mine, Inbox, Pins); the board name shrinks and is cut, a card title shrinks and wraps", async () => {
  acct.pins = [acct.card(102)];
  const m = await mount(), { draw, cx } = m;
  fire(must(await draw(), "fizzy"), "on_size_change", { width: 280, height: 600 }, cx);
  const narrow = async what => {
    const tree = await draw();
    const widths = all(tree, n => typeof n.style.w === "number" || typeof n.style.min_w === "number").map(n => n.style.w ?? n.style.min_w);
    assert.ok(widths.every(w => w < 200), `${what}: fixed widths ${widths}`);
    return tree;
  };
  let tree = await narrow("Board");
  assert.equal(must(tree, "fizzy-board").style.min_w, 0, "the name part can shrink");
  assert.equal(all(must(tree, "fizzy-board"), n => n.style.truncate)[0]?.style.truncate, true, "and its text is cut with an ellipsis");
  assert.equal(all(must(tree, "fizzy-board-bar"), n => n.style.max_w).length, 0, "the board dropdown has no width limit of its own");
  const title = must(must(tree, "fizzy-card-101"), "fizzy-card-title-101");
  assert.deepEqual([title.style.min_w, title.style.whitespace_normal, title.style.truncate], [0, true, undefined], "a card title shrinks and wraps: all of it shows");
  inputOf(tree, "fizzy-filter").edit("login", cx);
  await narrow("Board, with words in the filter");
  inputOf(tree, "fizzy-filter").edit("", cx);
  await searchFor(m, "login");
  tree = await narrow("search results");
  assert.ok(find(tree, "fizzy-card-101"), "the search found a card");
  click(tree, "fizzy-search-back", cx);
  for (const view of ["mine", "inbox", "pins"]) {
    click(await draw(), `fizzy-view-${view}`, cx);
    tree = await narrow(view);
    assert.ok(all(tree, n => /^fizzy-(card|note)-/.test(n.id ?? "")).length > 0, `${view} lists something`);
  }
});

test("the panel and the menus are one class: a props().menu makes the popup", async () => {
  openOverlayFor({ kind: "boards", current: "b1", follow: true, spaceBoard: null });
  const popup = await mountPopup();
  assert.ok(find(popup.tree(), "fizzy-menu"));
  assert.equal(find(popup.tree(), "fizzy"), null);
  assert.equal(acct.log.length, 0, "a popup reads nothing by itself unless a menu needs it");
  assert.equal(calls.readTextFile.length, 0);
  state.props = undefined;
  const panel = await mount();
  assert.ok(find(await panel.draw(), "fizzy"));
});

test("a popup's request is only noted by the draw: its work (clipboard, run, writes) is done by the timer it sets", async () => {
  withAgent();
  const { view, cx, draw } = await mount();
  await draw();
  const ops = [
    { kind: "insert", text: "Fizzy #101 x" }, { kind: "paste", address: "t1", text: "hello" },
    { kind: "start", name: "#1 x", argv: ["claude"], text: "Fizzy #1 x", agent: "Claude Code" }, { kind: "move", number: 101, target: "done" },
    { kind: "golden", number: 101, on: true }, { kind: "pin", number: 101, on: true }, { kind: "watch", number: 101, on: true }, { kind: "selfAssign", number: 102 },
    { kind: "assign", number: 102, user: "u-bob" }, { kind: "tag", number: 101, name: "fresh" }, { kind: "moveBoard", number: 103, board: "b2" }, { kind: "remove", number: 103 },
  ];
  for (const [i, op] of ops.entries()) {
    state.shared["fizzy.request"] = { id: `r${i}`, op };
    const seen = () => [calls.run.length, calls.notify.length, cx.clipboard.length, acct.writes().length];
    const was = seen();
    drawn(view, cx); // throws when the draw notifies, runs, notifies Herdr or writes the clipboard
    await cx.settle();
    assert.deepEqual(seen(), was, `${op.kind}: the draw did nothing`);
    assert.equal(cx.timers.filter(t => t.after && t.ms <= 1).length, 1, `${op.kind}: and left one 1 ms timer`);
    await due(cx);
    assert.notDeepEqual(seen(), was, `${op.kind}: the timer did it`);
  }
  assert.deepEqual(calls.run.slice(0, 2), [["pane.focus", { pane: "p-t1" }], ["terminal.paste", undefined]]);
  assert.deepEqual(calls.run.slice(2, 6), [["space.select", { id: "s1" }], ["tab.select", { id: "s1-tab" }], ["pane.focus", { pane: "p-t1" }], ["terminal.paste", undefined]], "the paste request brings that session to the front first");
  assert.deepEqual(calls.run[6], ["tab.new", { name: "#1 x", argv: ["claude"] }], "and the start request opens a tab with no task");
  assert.deepEqual(calls.hc, [], "nothing is ever sent");
  assert.equal(calls.notify.filter(n => n.level === "error").length, 0, "no error toast: every request went through");
  assert.equal(acct.writes().length, 9);
});

test("a draw that notices a request again (the same id) sets no second timer", async () => {
  const { view, cx, draw } = await mount();
  await draw();
  state.shared["fizzy.request"] = { id: "same", op: { kind: "pin", number: 101, on: true } };
  drawn(view, cx);
  drawn(view, cx);
  drawn(view, cx);
  assert.equal(cx.timers.filter(t => t.after && t.ms <= 1).length, 1);
  await due(cx);
  assert.equal(acct.writes().length, 1);
});

test("a tag request writes, then reads the tags again (a new tag shows in the menus); the write is a promise, not a task to chain on", async () => {
  const { cx, draw } = await mount();
  await draw();
  state.shared["fizzy.people"] = { me: "u-me", users: [], tags: [{ id: "t1", title: "bug" }] };
  state.shared["fizzy.request"] = { id: "t", op: { kind: "tag", number: 101, name: "fresh" } };
  await draw();
  assert.deepEqual(acct.writes(), [["card", "tag", "101", "--tag", "fresh"]]);
  assert.equal(acct.asked("tag", "list").length, 1, "the tags are read again afterwards");
  assert.deepEqual(state.shared["fizzy.people"].tags.map(t => t.title), ["bug", "docs", "fresh"]);
  assert.equal(calls.notify.length, 0, "no error toast");
  // The Task a spawn returns has no .then: any code that chained on it would have thrown by now.
  assert.equal(typeof cx.spawn(async () => {}).then, "undefined");
  await cx.settle();
});

test("opening the same card again while its first read is out: the second detail gets its data, not the first one's closure", async () => {
  const { view, cx, draw } = await mount();
  const tree = await draw();
  let release;
  acct.hold = new Promise(resolve => { release = resolve; });
  click(tree, "fizzy-card-101", cx);
  click(drawn(view, cx), "fizzy-back", cx);
  click(drawn(view, cx), "fizzy-card-101", cx);
  assert.match(textOf(must(drawn(view, cx), "fizzy-detail")), /Loading…/);
  release();
  await cx.settle();
  acct.hold = null;
  const text = textOf(must(drawn(view, cx), "fizzy-detail"));
  assert.doesNotMatch(text, /Loading…/, "the second detail was filled in");
  assert.match(text, /Reproduce it/);
  assert.match(text, /COMMENTS 2/);
  assert.equal(acct.asked("card", "show").length, 2, "the first read, and the queued one for the second detail");
});

test("the read that waits is the newest one asked for", async () => {
  const { view } = await mount();
  const order = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const cx = makeCx();
  view.load("k", cx, async () => { order.push("first"); await gate; });
  view.load("k", cx, async () => { order.push("second"); });
  view.load("k", cx, async () => { order.push("third"); });
  release();
  await cx.settle();
  assert.deepEqual(order, ["first", "third"], "one more run, with the last closure");
  assert.equal(view.busy.has("k"), false);
  assert.equal(view.again.size, 0);
});

test("a card pressed and released away from the panel does not follow the next click on a lane header", async () => {
  const { cx, draw } = await mount();
  let tree = await draw();
  // Pressed on a row, released outside (no mouse-up in the panel); then Done's header is clicked: down, up, click.
  fire(must(tree, "fizzy-card-101"), "on_mouse_down:left", {}, cx);
  fire(must(tree, "fizzy-section-done"), "on_mouse_down:left", {}, cx);
  fire(must(tree, "fizzy-section-done"), "on_mouse_up:left", {}, cx);
  click(tree, "fizzy-section-done", cx);
  await cx.settle();
  assert.deepEqual(acct.writes(), [], "no card close");
  assert.equal(JSON.parse(localStorage.getItem("collapsed:b1")).done, false, "it only unfolded");
  tree = await draw();
  // A press outside the panel forgets it as well, so a later release over a header moves nothing.
  fire(must(tree, "fizzy-card-101"), "on_mouse_down:left", {}, cx);
  fire(must(tree, "fizzy"), "on_mouse_down_out", {}, cx);
  fire(must(tree, "fizzy-section-c2"), "on_mouse_up:left", {}, cx);
  await cx.settle();
  assert.deepEqual(acct.writes(), []);
  // A real drag still works.
  fire(must(tree, "fizzy-card-101"), "on_mouse_down:left", {}, cx);
  fire(must(tree, "fizzy-section-c2"), "on_mouse_up:left", {}, cx);
  await cx.settle();
  assert.deepEqual(acct.writes(), [["card", "column", "101", "--column", "c2"]]);
});

test("a step's text edits in place: click it, Enter saves with step update --content; Escape, the x, an empty or unchanged text send nothing", async () => {
  const { view, cx, draw, tree } = await openDetail();
  assert.deepEqual([must(tree, "fizzy-step-text-s1").hover, tipOf(tree, "fizzy-step-text-s1")], [true, undefined]);
  fire(must(tree, "fizzy-step-text-s1"), "on_click", {}, cx);
  assert.deepEqual(acct.writes(), [], "the text edits; only the box ticks");
  let next = await draw();
  const edit = must(next, "fizzy-step-edit-s1");
  assert.deepEqual([edit.style.pl, Object.keys(edit.handlers).sort()], [26, ["on_key_down", "on_mouse_down:left"]]);
  const input = inputOf(next, "fizzy-step-input-s1");
  assert.equal(input.value(), "Reproduce it");
  assert.equal(input.focused, true);
  assert.equal(find(next, "fizzy-step-s1"), null, "the field replaces the row");
  assert.equal(find(next, "fizzy-step-text-s1"), null, "the field replaces the text");
  assert.ok(find(next, "fizzy-step-text-s2"), "the other steps stay as they are");
  // Polling leaves the card alone while a step is edited.
  const before = acct.log.length;
  timer(cx, POLL_VIEW).fn(cx);
  await cx.settle();
  assert.equal(acct.log.length, before);
  input.edit("Reproduce it twice", cx);
  input.submit(cx);
  await cx.settle();
  assert.deepEqual(acct.writes(), [["step", "update", "s1", "--card", "101", "--content", "Reproduce it twice"]]);
  next = await draw();
  assert.equal(find(next, "fizzy-step-input-s1"), null);
  assert.match(textOf(must(next, "fizzy-step-s1")), /Reproduce it twice/);
  // Unchanged, empty, the x and Escape: nothing is sent.
  for (const how of ["same", "empty", "x", "escape"]) {
    click(next, "fizzy-step-text-s2", cx);
    next = await draw();
    const box = inputOf(next, "fizzy-step-input-s2");
    if (how === "empty") box.edit("   ", cx);
    if (how === "same" || how === "empty") box.submit(cx);
    if (how === "x") click(next, "fizzy-step-cancel-s2", cx);
    if (how === "escape") fire(must(next, "fizzy-step-edit-s2"), "on_key_down", { key: "escape" }, cx);
    await cx.settle();
    next = await draw();
    assert.equal(find(next, "fizzy-step-input-s2"), null, `${how}: the edit is over`);
    assert.equal(acct.writes().length, 1, `${how}: nothing sent`);
  }
  assert.equal(view.editing, null);
});

test("a step edit shows at once, and a refusal puts the old text back after the read", async () => {
  const { view, cx, draw, tree } = await openDetail();
  click(tree, "fizzy-step-text-s1", cx);
  const next = await draw();
  acct.fail = args => (args[0] === "step" ? failure("not_found", "Resource not found") : undefined);
  inputOf(next, "fizzy-step-input-s1").edit("Changed", cx);
  inputOf(next, "fizzy-step-input-s1").submit(cx);
  assert.match(textOf(must(drawn(view, cx), "fizzy-step-s1")), /Changed/, "shown before Fizzy has answered");
  await cx.settle();
  acct.fail = null;
  assert.equal(calls.notify.at(-1).level, "error");
  assert.match(textOf(must(await draw(), "fizzy-step-s1")), /Reproduce it/, "as Fizzy has it");
});

test("the person's own comment can be edited: the pencil, a box with its text, Save sends HTML; Cancel, Escape, an empty or unchanged text send nothing", async () => {
  const { view, cx, draw, tree } = await openDetail();
  assert.equal(find(tree, "fizzy-comment-edit-cm2"), null, "only one's own comments have a pencil");
  assert.equal(find(tree, "fizzy-comment-edit-cm3"), null, "and not the system's");
  click(tree, "fizzy-comment-edit-cm1", cx);
  let next = await draw();
  const area = inputOf(next, "fizzy-comment-area-cm1");
  assert.equal(area.value(), "Tried twice", "the comment as plain text");
  assert.equal(area.focused, true);
    assert.equal(textOf(must(next, "fizzy-comment-lossy-cm1")), "Saving keeps only the text: formatting is lost.", "cm1 has a <b>");
  assert.equal(find(next, "fizzy-comment-lossy-cm2"), null);
  assert.deepEqual(all(must(next, "fizzy-comment-editor-cm1"), n => n.style.justify_end)[0].kids.map(k => k.id), ["fizzy-comment-cancel-cm1", "fizzy-comment-save-cm1"]);
  assert.equal(find(next, "fizzy-comment-html-cm1"), null, "the box replaces the text");
  assert.ok(find(next, "fizzy-comment-html-cm2"));
  assert.equal(find(next, "fizzy-comment-edit-cm1"), null, "no pencil or delete while editing it");
  const before = acct.log.length;
  timer(cx, POLL_VIEW).fn(cx);
  await cx.settle();
  assert.equal(acct.log.length, before, "not polled while editing");
  area.edit("Tried twice, then more\n\nSecond <b>", cx);
  click(next, "fizzy-comment-save-cm1", cx);
  assert.match(plain(must(drawn(view, cx), "fizzy-comment-html-cm1")), /then more/, "shown at once");
  await cx.settle();
  assert.deepEqual(acct.writes(), [["comment", "update", "cm1", "--card", "101", "--body", "<p>Tried twice, then more</p><p>Second &lt;b&gt;</p>"]]);
  next = await draw();
  assert.equal(find(next, "fizzy-comment-area-cm1"), null);
  assert.deepEqual(richLinesOf(must(next, "fizzy-comment-html-cm1")), [["", "Tried twice, then more", false], ["", "Second <b>", true]]);
  for (const how of ["same", "empty", "cancel", "escape"]) {
    click(next, "fizzy-comment-edit-cm1", cx);
    next = await draw();
    const box = inputOf(next, "fizzy-comment-area-cm1");
    if (how === "empty") box.edit("  ", cx);
    if (how === "same" || how === "empty") click(next, "fizzy-comment-save-cm1", cx);
    if (how === "cancel") click(next, "fizzy-comment-cancel-cm1", cx);
    if (how === "escape") fire(must(next, "fizzy-comment-cm1"), "on_key_down", { key: "escape" }, cx);
    await cx.settle();
    next = await draw();
    assert.equal(find(next, "fizzy-comment-area-cm1"), null, `${how}: the edit is over`);
    assert.equal(acct.writes().length, 1, `${how}: nothing sent`);
  }
});

test("a click on a note takes its row out at once and asks `notification read <id>` once; the inbox and the count are read again", async () => {
  const { view, cx, draw } = await mount();
  click(await draw(), "fizzy-view-inbox", cx);
  const tree = await draw();
  const reads = () => acct.asked("notification", "tray").length;
  const base = reads();
  click(tree, "fizzy-note-n1", cx);
  assert.deepEqual(view.inbox.map(n => n.id), ["n2"], "the row is gone at once");
  assert.equal(state.shared["fizzy.unread"], 1, "and the count follows at once");
  await cx.settle();
  assert.deepEqual(acct.asked("notification", "read"), [["notification", "read", "n1"]], "asked once");
  assert.deepEqual(acct.writes(), [["notification", "read", "n1"]]);
  assert.equal(reads(), base + 1, "the inbox is read again afterwards");
  assert.deepEqual(view.inbox.map(n => n.id), ["n2"]);
  assert.equal(state.shared["fizzy.unread"], 1);
  assert.ok(find(await draw(), "fizzy-detail"), "and the card is open");
});

test("a refusal of `notification read` puts the note back in the Inbox, restores the count and tells the person", async () => {
  const { view, cx, draw } = await mount();
  click(await draw(), "fizzy-view-inbox", cx);
  const tree = await draw();
  acct.fail = args => (args[1] === "read" ? failure("network", "offline") : undefined);
  click(tree, "fizzy-note-n1", cx);
  assert.deepEqual(view.inbox.map(n => n.id), ["n2"], "at once");
  assert.equal(state.shared["fizzy.unread"], 1);
  await cx.settle();
  acct.fail = null;
  assert.equal(calls.notify.at(-1).level, "error");
  assert.deepEqual(view.inbox.map(n => n.id), ["n1", "n2"], "put back, newest first");
  assert.equal(state.shared["fizzy.unread"], 2, "n1 is unread again");
  click(await draw(), "fizzy-back", cx);
  assert.deepEqual(noteIds(await draw()), ["n1", "n2"], "and drawn");
});

test("Mark all read empties the Inbox and reads it and the count again; a refusal puts the notes back", async () => {
  const { view, cx, draw } = await mount();
  click(await draw(), "fizzy-view-inbox", cx);
  let tree = await draw();
  const reads = () => acct.asked("notification", "tray").length;
  let base = reads();
  // Refused: the notes are back, the count is back, and the error is told.
  acct.fail = args => (args[1] === "read-all" ? failure("network", "offline") : undefined);
  click(tree, "fizzy-read-all", cx);
  assert.deepEqual(view.inbox, [], "emptied at once");
  assert.equal(state.shared["fizzy.unread"], 0, "and the count with it");
  assert.match(textOf(must(drawn(view, cx), "fizzy-list")), /You're all caught up/);
  await cx.settle();
  acct.fail = null;
  assert.equal(calls.notify.at(-1).level, "error");
  assert.deepEqual(view.inbox.map(n => n.id), ["n1", "n2"], "n1 and n2 are back");
  assert.equal(state.shared["fizzy.unread"], 2);
  assert.equal(reads(), base + 1, "read again");
  tree = await draw();
  assert.deepEqual(noteIds(tree), ["n1", "n2"]);
  // A good one: it stays empty, and the Inbox is read again.
  base = reads();
  click(tree, "fizzy-read-all", cx);
  await cx.settle();
  assert.deepEqual(acct.writes().at(-1), ["notification", "read-all"]);
  assert.equal(reads(), base + 1, "and read again after a good one");
  assert.equal(state.shared["fizzy.unread"], 0);
  assert.deepEqual(noteIds(await draw()), []);
});

const searchCalls = () => calls.exec.filter(c => c.command === "fizzy" && c.args[0] === "search").map(c => c.args);

test("the header's search icon opens a field in the header's place; Enter runs one `fizzy search` for every board, shown as one section per board", async () => {
  for (let i = 3; i <= 9; i++) acct.boards.push({ id: `b${i}`, name: `Board ${i}`, url: `u${i}` });
  const { view, cx, draw } = await mount();
  let tree = await draw();
  assert.deepEqual([tipOf(tree, "fizzy-search-open"), iconOf(tree, "fizzy-search-open")], ["Search all boards", "search.svg"]);
  click(tree, "fizzy-search-open", cx);
  tree = await draw();
  const field = inputOf(tree, "fizzy-search");
  assert.deepEqual([field.options.placeholder, field.focused], ["Search all boards, or #number…", true]);
  assert.deepEqual(headerOf(tree).kids.map(k => k.id), ["fizzy-search-back", "fizzy-search"], "Back and the field, nothing else");
  for (const id of ["fizzy-board-bar", "fizzy-list-bar", "fizzy-bar"]) assert.equal(find(tree, id), null, `${id} gives way`);
  assert.match(textOf(must(tree, "fizzy-list")), /Press Enter to search every board, comments included\./);
  field.edit("login", cx);
  tree = await draw();
  assert.equal(searchCalls().length, 0, "typing asks nothing: Fizzy counts the searches");
  assert.equal(tipOf(tree, "fizzy-search-clear"), "Clear", "words bring the clear button");
  acct.peak = 0;
  field.submit(cx);
  tree = await draw();
  assert.equal(view.search.q, "login");
  assert.deepEqual(acct.asked("search"), [["search", "--", "login"]], "one call for every board, not one per board");
  assert.deepEqual(searchCalls(), [["search", "--jq", JQ.cards, "--json", "--", "login"]], "--json before the --, the query last");
  assert.equal(acct.asked("card", "list").filter(a => a.includes("--search")).length, 0, "no per-board search");
  assert.equal(acct.peak, 1, "nothing runs beside it");
  assert.ok(find(tree, "fizzy-search-head"));
  assert.match(textOf(must(tree, "fizzy-search-head")), /Results for “login”/);
  assert.deepEqual(ids(tree).filter(i => i.startsWith("fizzy-search-board-")), ["fizzy-search-board-b1"], "only boards with a hit");
  assert.deepEqual(rowIds(tree), [101]);
  assert.equal(find(tree, "fizzy-section-c1"), null, "the board's lanes give way to the results");
  // A card of the results opens like any other, and Back returns to the results.
  click(tree, "fizzy-card-101", cx);
  tree = await draw();
  assert.ok(find(tree, "fizzy-detail"));
  click(tree, "fizzy-back", cx);
  assert.deepEqual(rowIds(await draw()), [101], "back on the results");
  // Back in the header returns to the list; the field keeps its words for the next time it opens.
  click(await draw(), "fizzy-search-back", cx);
  tree = await draw();
  assert.equal(view.search, null);
  assert.ok(find(tree, "fizzy-section-c1") && find(tree, "fizzy-home"));
  assert.deepEqual(rowIds(tree), [103, 101, 102], "the board's own cards: the search never filtered them");
  click(tree, "fizzy-search-open", cx);
  tree = await draw();
  assert.equal(inputOf(tree, "fizzy-search").value(), "login");
  assert.match(textOf(must(tree, "fizzy-list")), /Press Enter/, "and waits for Enter again");
  assert.equal(searchCalls().length, 1);
});

test("Escape in the search field, its x, and the `back` key close the search; the x also empties the field", async () => {
  const m = await mount(), { view, cx, draw } = m;
  let tree = await searchFor(m, "login");
  fire(must(tree, "fizzy-search"), "on_key_down", { key: "a", modifiers: {} }, cx);
  assert.ok(view.search, "other keys leave it");
  fire(must(tree, "fizzy-search"), "on_key_down", { key: "escape", modifiers: {} }, cx);
  assert.equal(view.search, null, "Escape");
  tree = await searchFor(m, "login");
  click(tree, "fizzy-search-clear", cx);
  tree = await draw();
  assert.equal(view.search, null, "the x");
  assert.equal(view.searchField.value(), "");
  assert.ok(find(tree, "fizzy-home"));
  await searchFor(m, "login");
  await press(cx, "back");
  assert.equal(view.search, null, "the back key");
});

test("#<number> in the search field opens that card from any board: at once when pasted, on Enter when typed; the field empties and the search closes", async () => {
  const m = await mount(), { view, cx, draw } = m;
  click(await draw(), "fizzy-search-open", cx);
  const field = inputOf(await draw(), "fizzy-search");
  field.edit("#201", cx);
  assert.deepEqual([view.detail?.number, view.search, field.value()], [201, null, ""], "pasted: at once, though 201 is on another board");
  await cx.settle();
  assert.deepEqual(acct.asked("card", "show").at(-1), ["card", "show", "201"]);
  click(await draw(), "fizzy-back", cx);
  click(await draw(), "fizzy-search-open", cx);
  field.edit("#", cx);
  field.edit("#1", cx);
  assert.equal(view.detail, null, "typed a key at a time: #1 on the way to #105 opens nothing");
  field.edit("#10", cx);
  field.edit("#105", cx);
  assert.equal(view.detail, null);
  field.submit(cx);
  assert.equal(view.detail?.number, 105, "Enter opens it");
  await cx.settle();
  assert.equal(searchCalls().length, 0, "no search is spent on it");
  assert.match(textOf(must(await draw(), "fizzy-title")), /Shipped thing/, "a closed card no list holds: read whole");
  click(await draw(), "fizzy-back", cx);
  click(await draw(), "fizzy-search-open", cx);
  field.edit(" #12 x", cx);
  field.submit(cx);
  assert.equal(view.detail, null, "anything else beside the number is a search");
  assert.equal(searchCalls().length, 1);
});

test("a search finds what the lanes do not hold: a closed card on another board, a Not Now card, a word in a comment; each is drawn as in its lane", async () => {
  acct.cards.push({ ...acct.card(201), id: "id-210", number: 210, title: "Old release notes", closed: true, column: acct.columns.b1[2], board: B2, assignees: [] });
  const m = await mount(), { cx, draw } = m;
  inputOf(await draw(), "fizzy-filter").edit("release", cx);
  let tree = await draw();
  assert.deepEqual(rowIds(tree), [102], "the filter sees only what is read: a golden card, tagged release");
  tree = await searchFor(m, "release");
  assert.deepEqual(ids(tree).filter(i => i.startsWith("fizzy-search-board-")), ["fizzy-search-board-b1", "fizzy-search-board-b2"], "in the boards' order");
  assert.deepEqual(rowIds(tree), [102, 210]);
  const bar = id => must(tree, id.replace("fizzy-card-", "fizzy-card-lane-")).style.text_color;
  assert.equal(bar("fizzy-card-102"), colorOf(acct.columns.b1.find(c => c.id === "c2")), "an open card: its column's color");
  assert.equal(bar("fizzy-card-210"), DONE_GRAY, "a closed card is Done's, whatever its last column was");
  click(tree, "fizzy-card-210", cx);
  assert.equal(must(await draw(), "fizzy-lane").style.bg, DONE_GRAY, "and opens in Done");
  click(await draw(), "fizzy-back", cx);
  tree = await searchFor(m, "later");
  assert.deepEqual(rowIds(tree), [104], "a card in Not Now, which no folded lane has read");
  assert.equal(bar("fizzy-card-104"), NOT_NOW_GRAY);
  assert.deepEqual(rowIds(await searchFor(m, "twice")), [101], "a word that only a comment has");
  assert.equal(acct.asked("search").length, 3, "one call each");
});

test("a search that finds nothing says so; another search error is explained as usual, with Retry that searches again, and nothing retries by itself", async () => {
  const m = await mount(), { cx } = m;
  let tree = await searchFor(m, "zzzz");
  assert.match(textOf(must(tree, "fizzy-list")), /No cards found/);
  assert.doesNotMatch(textOf(must(tree, "fizzy-list")), /newest matches/, "nothing found is not a full page");
  acct.fail = args => (args[0] === "search" ? failure("network", "offline") : undefined);
  tree = await searchFor(m, "release");
  assert.match(textOf(must(tree, "fizzy-list")), /Can't reach Fizzy/);
  assert.doesNotMatch(textOf(must(tree, "fizzy-list")), /No cards found/, "an error is not 'nothing found'");
  const asked = acct.asked("search").length;
  timer(cx, POLL_VIEW).fn(cx);
  inboxTimer(cx).fn(cx);
  await cx.settle();
  assert.equal(acct.asked("search").length, asked, "no retry on a timer");
  acct.fail = null;
  click(tree, "fizzy-search-retry", cx);
  assert.deepEqual(rowIds(await m.draw()), [102]);
  assert.equal(acct.asked("search").length, asked + 1);
});

test("a search Fizzy does not answer (rate limited, or stopped at Herdr's 30 s) says its limit may be used up, and does not retry by itself", async () => {
  const LIMIT = "Fizzy didn't answer the search. Its search limit (300 an hour, shared with your agents) may be used up. Try again later.";
  const m = await mount();
  acct.fail = args => (args[0] === "search" ? failure("rate_limit", "Rate limited") : undefined);
  let tree = await searchFor(m, "release");
  assert.match(textOf(must(tree, "fizzy-list")), new RegExp(LIMIT.replace(/[()]/g, "\\$&")));
  assert.ok(find(tree, "fizzy-search-retry"));
  acct.fail = null;
  acct.stopped = true;
  tree = await searchFor(m, "release");
  assert.match(textOf(must(tree, "fizzy-list")), new RegExp(LIMIT.replace(/[()]/g, "\\$&")), "TIMEOUT says the same");
  assert.doesNotMatch(textOf(must(tree, "fizzy-list")), /Fizzy took too long to answer/);
  assert.equal(acct.asked("search").length, 1, "the stopped one never reached the fake; nothing else was asked");
});

test("a search sends \"# 12\" as 12, trims the words, and a query starting with - stays a query", async () => {
  const m = await mount();
  for (const [typed, sent] of [["# 12", "12"], ["  login bug  ", "login bug"], ["-x --all", "-x --all"], ["a#b & c+d ü", "a#b & c+d ü"]]) {
    await searchFor(m, typed);
    const [argv] = searchCalls().slice(-1);
    assert.deepEqual([argv.at(-2), argv.at(-1)], ["--", sent], typed);
    assert.ok(argv.indexOf("--json") < argv.indexOf("--"), "--json before the --");
    assert.equal(argv.filter(a => a === "--json").length, 1);
  }
  assert.equal(searchCalls().length, 4);
});

test("a search that fills Fizzy's page of 15 says it shows the 15 newest matches; fewer, or none, say nothing of it", async () => {
  const NOTE = /Fizzy shows its 15 newest matches\. Add words to narrow it\./;
  for (let i = 0; i < 20; i++) acct.cards.push({ ...acct.card(103), id: `id-${600 + i}`, number: 600 + i, title: `Bulk ${i}` });
  const m = await mount();
  let tree = await searchFor(m, "bulk");
  assert.equal(rowIds(tree).length, 15, "Fizzy's page, not all 20");
  assert.match(textOf(must(tree, "fizzy-list")), NOTE);
  tree = await searchFor(m, "bulk 1");
  assert.equal(rowIds(tree).length, 11, "Bulk 1 and Bulk 10 to 19: fewer than a page");
  assert.doesNotMatch(textOf(must(tree, "fizzy-list")), NOTE);
});

test("the results of a search are dropped when a newer search starts, or the search closes, before they come; another view closes it too", async () => {
  const m = await mount(), { view, cx, draw } = m;
  click(await draw(), "fizzy-search-open", cx);
  const field = inputOf(await draw(), "fizzy-search");
  field.edit("login", cx);
  const release = holdOn();
  field.submit(cx);
  let tree = drawn(view, cx);
  assert.match(textOf(must(tree, "fizzy-list")), /Searching…/);
  assert.doesNotMatch(textOf(must(tree, "fizzy-list")), /boards/, "no per-board progress");
  field.edit("changelog", cx);
  field.submit(cx);
  release();
  await cx.settle();
  tree = await draw();
  assert.match(textOf(must(tree, "fizzy-search-head")), /Results for “changelog”/);
  assert.deepEqual(rowIds(tree), [102], "what came for the old words is not mixed in");
  field.edit("login", cx);
  const again = holdOn();
  field.submit(cx);
  click(drawn(view, cx), "fizzy-search-back", cx);
  again();
  await cx.settle();
  tree = await draw();
  assert.equal(view.search, null, "closed while it ran: nothing comes back");
  assert.equal(find(tree, "fizzy-search-head"), null);
  assert.deepEqual(rowIds(tree), [103, 101, 102]);
  await searchFor(m, "login");
  await press(cx, "view:pins");
  assert.equal(view.search, null, "another view");
});

test("the search opens from every view; its results take the list's place, and Back returns to the view it left", async () => {
  const m = await mount(), { view, cx, draw } = m;
  for (const name of ["mine", "inbox", "pins"]) {
    click(await draw(), `fizzy-view-${name}`, cx);
    const tree = await searchFor(m, "other");
    assert.deepEqual(rowIds(tree), [201], name);
    assert.match(textOf(must(tree, "fizzy-search-head")), /Results for “other”/, `${name}: the same head`);
    assert.equal(find(tree, "fizzy-list-bar"), null, `${name}: no filter under the results`);
    click(tree, "fizzy-search-back", cx);
    const back = await draw();
    assert.equal(view.view, name);
    assert.equal(find(back, "fizzy-search-head"), null, `${name}: its own list again`);
  }
  await press(cx, "open:201");
  assert.ok(view.detail);
  await press(cx, "search");
  const tree = await draw();
  assert.equal(view.detail, null, "the key from a card leaves the card");
  assert.ok(find(tree, "fizzy-search") && view.searchField.focused);
});

test("a new card's description is written on its card page and saved to the card New card made", async () => {
  const m = await mount(), { cx, draw } = m;
  let tree = await newCardOn(m, "b1");
  const made = acct.cards.at(-1).number;
  click(tree, "fizzy-desc-edit", cx);
  tree = await draw();
  inputOf(tree, "fizzy-desc-input").edit("Some <b> words\n\nSecond", cx);
  click(tree, "fizzy-desc-save", cx);
  await cx.settle();
  assert.deepEqual(acct.writes(), [["card", "create", "--board", "b1", "--title", "New card"], ["card", "update", String(made), "--description", "<p>Some &lt;b&gt; words</p><p>Second</p>"]]);
  assert.ok(find(await draw(), "fizzy-fresh-bar"), "still its page, Discard and Done at its foot");
});

test("two Inserts inside the restore window keep the person's own clipboard and put it back once, at the end", async () => {
  withAgent();
  const { draw } = await mount();
  const tree = await draw();
  const clicker = makeCx();
  clicker.clipboardText = "what I had copied";
  click(tree, "fizzy-insert-101", clicker);
  click(tree, "fizzy-insert-102", clicker);
  const restores = clicker.timers.filter(t => t.after && t.ms === 500);
  assert.equal(restores.length, 2);
  restores[0].fn(clicker);
  assert.match(clicker.clipboardText, /#102/, "the first restore waits: the second paste still needs its text");
  restores[1].fn(clicker);
  assert.equal(clicker.clipboardText, "what I had copied", "the person's own, not the first card's text");
  assert.equal(clicker.clipboard.filter(t => t === "what I had copied").length, 1, "put back once");
  // The next Insert, after that, saves the clipboard as it is then.
  clicker.clipboardText = "something newer";
  click(tree, "fizzy-insert-103", clicker);
  clicker.timers.filter(t => t.after && t.ms === 500).at(-1).fn(clicker);
  assert.equal(clicker.clipboardText, "something newer");
});

test("a restore that never ran does not keep an old clipboard for ever: an Insert long after saves it afresh", async () => {
  withAgent();
  const { draw } = await mount();
  const tree = await draw();
  const clicker = makeCx();
  clicker.clipboardText = "first";
  click(tree, "fizzy-insert-101", clicker); // its timer is lost
  const real = Date.now;
  Date.now = () => real() + 60000;
  try {
    clicker.clipboardText = "second";
    click(tree, "fizzy-insert-102", clicker);
    clicker.timers.filter(t => t.after && t.ms === 500).at(-1).fn(clicker);
  } finally { Date.now = real; }
  assert.equal(clicker.clipboardText, "second");
});

test("the panel waits for key commands in a loop of its own; a popup does not", async () => {
  const { cx } = await mount();
  assert.equal(calls.nextCommand.length >= 1, true, "a panel asks for its commands");
  await cx.settle();
  const before = calls.nextCommand.length;
  openOverlayFor({ kind: "boards", current: "b1", follow: true, spaceBoard: null });
  await mountPopup();
  assert.equal(calls.nextCommand.length, before, "a popup does not");
});

test("refresh reads the board again; unknown commands, and commands with nothing to act on, do nothing; the loop keeps listening", async () => {
  const { cx, draw } = await mount();
  await draw();
  const base = acct.log.length;
  for (const nonsense of ["bogus", "", "   ", "view:nope", "open", "open:abc", "open:0", "open:-3", "open:1.5", "board:nowhere", "menu:0", "menu:abc", "menu:-2", "menu", "refresh2", ":refresh", "1"]) await press(cx, nonsense);
  assert.equal(acct.log.length, base, "nothing was asked");
  // Mine has no card open or picked, and no board to hand over (the Board view's bar acts on its board): the hand-off keys do nothing.
  await press(cx, "view:mine");
  const inMine = acct.log.length;
  for (const needsCards of ["insert", "copy", "send", "start"]) await press(cx, needsCards);
  assert.equal(acct.log.length, inMine, "nothing was asked");
  assert.equal(calls.openOverlay.length, 0);
  assert.deepEqual(calls.run, []);
  await press(cx, "view:board");
  const lists = acct.asked("card", "list", "--board", "b1", "--all").length, boards = acct.asked("board", "list").length;
  await press(cx, "refresh");
  assert.ok(acct.log.length > base, "and it still listens");
  assert.ok(acct.asked("card", "list", "--board", "b1", "--all").length > lists);
  assert.ok(acct.asked("board", "list").length > boards, "the boards too, as the Refresh button does");
});

test("view:<name> shows that view; view with no name shows the next one; the choice is kept", async () => {
  const { cx, draw } = await mount();
  await draw();
  await press(cx, "view:inbox");
  let tree = await draw();
  assert.ok(find(tree, "fizzy-read-all"), "the inbox");
  assert.equal(localStorage.getItem("view"), '"inbox"');
  await press(cx, "view");
  assert.equal(localStorage.getItem("view"), '"pins"', "the next one");
  await press(cx, "view");
  assert.equal(localStorage.getItem("view"), '"board"', "and back to the first");
  await press(cx, "view");
  assert.equal(localStorage.getItem("view"), '"mine"');
  await press(cx, "VIEW:Board");
  assert.equal(localStorage.getItem("view"), '"board"', "any case");
  await press(cx, "view mine");
  assert.equal(localStorage.getItem("view"), '"mine"', "a space does for the colon");
  assert.ok(acct.asked("card", "list").some(a => a.includes("--assignee")), "and the view is read");
  // It leaves an open card behind.
  await press(cx, "view:board");
  click(await draw(), "fizzy-card-101", cx);
  assert.ok(find(await draw(), "fizzy-detail"));
  await press(cx, "view:pins");
  tree = await draw();
  assert.equal(find(tree, "fizzy-detail"), null);
  assert.ok(find(tree, "fizzy-list"));
  assert.ok(find(tree, "fizzy-view-pins"));
});

test("board:<id or exact name> shows that board and stops following the space; follow starts again", async () => {
  acct.yaml["/work/roadmap"] = "board: b1\n";
  const { cx, draw } = await mount();
  let tree = await draw();
  assert.equal(boardName(tree), "Roadmap");
  await press(cx, "board:b2");
  tree = await draw();
  assert.equal(boardName(tree), "Personal");
  assert.deepEqual([localStorage.getItem("follow"), localStorage.getItem("board")], ["false", '"b2"']);
  assert.deepEqual(rowIds(tree), [201]);
  await press(cx, "board:Roadmap");
  tree = await draw();
  assert.equal(boardName(tree), "Roadmap", "by its exact name");
  await press(cx, "board Personal");
  assert.equal(boardName(await draw()), "Personal", "a space does for the colon");
  await press(cx, "board:nowhere");
  assert.equal(boardName(await draw()), "Personal", "an unknown board changes nothing");
  await press(cx, "follow");
  assert.equal(localStorage.getItem("follow"), "true");
  tree = await draw();
  assert.equal(boardName(tree), "Roadmap", "following: the space's board again");
  // Picking by name works for a name with spaces.
  acct.boards.push({ id: "b3", name: "Another board", url: "u" });
  acct.columns.b3 = acct.columns.b2;
  await press(cx, "refresh");
  await draw();
  await press(cx, "board:Another board");
  assert.equal(boardName(await draw()), "Another board");
});

test("open:<number> shows that card; back returns; a number the lists do not hold is read from Fizzy", async () => {
  const { cx, draw } = await mount();
  await draw();
  await press(cx, "open:101");
  let tree = await draw();
  assert.equal(textOf(must(tree, "fizzy-title")), "Fix the login redirect");
  assert.match(textOf(must(tree, "fizzy-detail")), /Reproduce it/);
  assert.deepEqual(acct.asked("card", "show"), [["card", "show", "101"]]);
  await press(cx, "back");
  tree = await draw();
  assert.equal(find(tree, "fizzy-detail"), null);
  assert.ok(find(tree, "fizzy-list"));
  await press(cx, "open 105");
  tree = await draw();
  assert.match(textOf(must(tree, "fizzy-title")), /Shipped thing/, "a closed card no list holds yet: from card show");
  await press(cx, "open:  102 ");
  assert.equal(textOf(must(await draw(), "fizzy-title")), "Write the changelog");
  await press(cx, "back");
  await press(cx, "back");
  assert.ok(find(await draw(), "fizzy-list"), "back with nothing open does nothing");
});

test("back also closes the results of a search", async () => {
  const m = await mount();
  assert.ok(find(await searchFor(m, "login"), "fizzy-search-head"));
  await press(m.cx, "back");
  assert.equal(find(await m.draw(), "fizzy-search-head"), null);
});

test("insert, copy, send and start act like the bar's buttons, on the open card, else on the selection", async () => {
  withAgent();
  installed(CLAUDE, CODEX);
  const { cx, draw } = await mount();
  let tree = await draw();
  click(tree, "fizzy-card-101", cx, { modifiers: { platform: true } });
  click(tree, "fizzy-card-102", cx, { modifiers: { platform: true } });
  const both = 'Fizzy #101 "Fix the login redirect" (https://app.fizzy.do/111/cards/101)\nFizzy #102 "Write the changelog" (https://app.fizzy.do/111/cards/102)';
  await press(cx, "insert");
  assert.equal(cx.clipboard.at(-1), `${both} `);
  assert.deepEqual(calls.run, [["pane.focus", { pane: "p-t1" }], ["terminal.paste", undefined]]);
  await press(cx, "copy");
  assert.equal(cx.clipboard.at(-1), both);
  assert.equal(calls.notify.at(-1).body, "Copied");
  await press(cx, "send");
  assert.deepEqual([lastPopup().props.menu.kind, lastPopup().props.menu.cards.map(c => c.number)], ["agents", [101, 102]], "send: the popup of sessions for both cards");
  await press(cx, "start");
  assert.deepEqual([lastPopup().props.menu.kind, lastPopup().props.menu.cards.map(c => c.number)], ["start", [101, 102]], "start: the popup of agents for both cards");
  assert.equal(calls.openOverlay.length, 2);
  assert.deepEqual(calls.run.map(c => c[0]), ["pane.focus", "terminal.paste"], "neither started anything: they ask which");
  assert.deepEqual(calls.hc, [], "and nothing is sent");
  // The open card wins over the selection.
  click(await draw(), "fizzy-card-103", cx);
  tree = await draw();
  assert.ok(find(tree, "fizzy-detail"));
  const one = 'Fizzy #103 "Triage me" (https://app.fizzy.do/111/cards/103)';
  await press(cx, "insert");
  assert.equal(cx.clipboard.at(-1), `${one} `);
  await press(cx, "copy");
  assert.equal(cx.clipboard.at(-1), one);
  await press(cx, "send");
  assert.deepEqual([lastPopup().props.menu.kind, lastPopup().props.menu.cards.map(c => c.number)], ["agents", [103]]);
  await press(cx, "start");
  assert.deepEqual([lastPopup().props.menu.kind, lastPopup().props.menu.cards.map(c => c.number)], ["start", [103]]);
  assert.equal(calls.openOverlay.length, 4);
});

test("send and start with no agent running or installed still open their popups, which say so; nothing is sent or started", async () => {
  installed();
  const { cx, draw } = await mount();
  click(await draw(), "fizzy-card-101", cx, { modifiers: { platform: true } });
  await press(cx, "send");
  assert.equal(lastPopup().props.menu.kind, "agents");
  assert.match(textOf((await mountPopup()).tree()), /No agents running/);
  await press(cx, "start");
  assert.equal(lastPopup().props.menu.kind, "start");
  assert.match(textOf((await mountPopup()).tree()), /No agents found/);
  assert.deepEqual([calls.hc, calls.run, calls.notify.filter(n => n.level === "info")], [[], [], []]);
});

test("start while the agents could not be read leaves the choice to the popup, which asks for itself and says so", async () => {
  state.knownAgents = async () => { throw new Error("no answer"); };
  const { cx, draw } = await mount();
  click(await draw(), "fizzy-card-101", cx, { modifiers: { platform: true } });
  await press(cx, "start");
  assert.equal(lastPopup().props.menu.kind, "start");
  assert.deepEqual([lastPopup().props.menu.cards.map(c => c.number), calls.run], [[101], []]);
  assert.match(textOf((await mountPopup()).tree()), /Could not load agents/);
});

test("new opens the New card picker; choosing a board makes the card there and opens it, leaving an open card or another view; filter focuses the filter of the view shown", async () => {
  const m = await mount(), { view, cx, draw } = m;
  await draw();
  await press(cx, "new");
  assert.deepEqual(lastPopup().props.menu, { kind: "newCard", current: "b1" });
  assert.deepEqual(acct.writes(), [], "the picker only asks: nothing is made yet");
  let tree = await chooseNewCard(m, "b1");
  assert.deepEqual([view.detail?.number, view.titleInput.focused], [acct.cards.at(-1).number, true]);
  click(tree, "fizzy-fresh-done", cx);
  click(await draw(), "fizzy-card-101", cx);
  assert.ok(find(await draw(), "fizzy-detail"));
  await press(cx, "new");
  assert.equal(view.detail?.number, 101, "the card stays while the picker is open");
  tree = await chooseNewCard(m, "b1");
  assert.equal(view.detail?.number, acct.cards.at(-1).number, "the new card takes its place");
  click(tree, "fizzy-fresh-done", cx);
  click(await draw(), "fizzy-view-inbox", cx);
  await press(cx, "new");
  tree = await chooseNewCard(m, "b1");
  assert.equal(view.detail?.number, acct.cards.at(-1).number);
  assert.equal(localStorage.getItem("view"), '"board"', "with the Board view behind it");
  click(tree, "fizzy-fresh-done", cx);
  click(await draw(), "fizzy-card-101", cx);
  await draw();
  const filter = view.boardFilter;
  assert.equal(filter.focused, false);
  await press(cx, "filter");
  tree = await draw();
  assert.equal(filter.focused, true, "the board's own filter");
  assert.equal(find(tree, "fizzy-detail"), null, "the open card is left");
  assert.ok(find(tree, "fizzy-filter"));
  filter.focused = false;
  click(tree, "fizzy-view-inbox", cx);
  await press(cx, "filter");
  tree = await draw();
  assert.ok(find(tree, "fizzy-filter"), "the Inbox has none: the board's view is shown");
  assert.equal(filter.focused, true);
  click(tree, "fizzy-card-101", cx, { modifiers: { platform: true } });
  await press(cx, "filter");
  assert.deepEqual([view.selected.size, Boolean(find(await draw(), "fizzy-list-bar"))], [0, true], "picked cards give way to the filter's bar");
  click(await draw(), "fizzy-view-mine", cx);
  await press(cx, "filter");
  assert.equal(view.filter.focused, true, "Mine's filter, which Pins shares");
});

test("new does nothing without a board", async () => {
  acct.config = { account: "111", board: null };
  acct.boards.length = 0;
  const { cx, draw } = await mount();
  await draw();
  await press(cx, "new");
  assert.equal(calls.openOverlay.length, 0, "no picker");
  assert.equal(find(await draw(), "fizzy-composer"), null);
});

test("menu:<number> opens that card's popup; a card that is not held is read first, and one that does not exist opens nothing", async () => {
  const { cx, draw } = await mount();
  await draw();
  await press(cx, "menu:102");
  assert.equal(calls.openOverlay.length, 1);
  const spec = lastPopup();
  assert.equal(spec.mod, "fizzy");
  assert.equal(spec.kind, "popup");
  assert.equal(spec.props.menu.kind, "card");
  assert.equal(spec.props.menu.card.number, 102);
  assert.deepEqual(spec.props.menu.columns.map(c => c.id), ["not-now", "maybe", "c1", "c2", "done"]);
  await press(cx, "menu:424242");
  assert.equal(calls.openOverlay.length, 1);
  assert.equal(calls.notify.at(-1).level, "error", "Fizzy has no such card: that is told, no menu opens");
  // The open card's menu, found even when no list holds it.
  await press(cx, "open:105");
  await draw();
  await press(cx, "menu:105");
  assert.equal(lastPopup().props.menu.card.number, 105);
});

test("commands redraw the panel", async () => {
  const { cx, draw } = await mount();
  await draw();
  const before = cx.notified;
  await press(cx, "bogus");
  assert.ok(cx.notified > before);
});

test("a command that throws is reported and the loop goes on", async () => {
  const { view, cx, draw } = await mount();
  await draw();
  view.command = () => { throw new Error("boom"); };
  await press(cx, "refresh");
  assert.deepEqual([calls.notify.at(-1).level, calls.notify.at(-1).body], ["error", "boom"]);
  view.command = Fizzy.prototype.command;
  const base = acct.log.length;
  await press(cx, "refresh");
  assert.ok(acct.log.length > base, "the loop still listens");
});

const HIDDEN = () => layoutWith({ hidden: true, active: "fizzy", children: ["files", "changes", "fizzy"] });
const requestTimer = cx => cx.timers.find(t => !t.after && t.ms === REQUEST_EVERY);

test("a card popup left open when the panel is hidden gets its request done by the panel's timer, once", async () => {
  const { cx, draw } = await mount();
  await draw();
  // Herdr delivers `fizzy.<command>` to a shown copy only: the key comes while the panel shows, the panel is hidden after.
  await press(cx, "menu:102");
  state.layout = HIDDEN();
  assert.equal(fizzyVisible(state.layout), false);
  assert.equal(lastPopup().props.menu.card.number, 102);
  const popup = await mountPopup();
  menuClick(popup, "golden");
  assert.equal(requestOps().at(-1).kind, "golden");
  assert.deepEqual(acct.writes(), [], "the panel is hidden, so no draw has seen the request yet");
  // No draw will come: the timer is what takes it.
  assert.ok(requestTimer(cx), "a timer looks for requests");
  requestTimer(cx).fn(cx);
  await cx.settle();
  assert.deepEqual(acct.writes(), [["card", "ungolden", "102"]], "102 is golden: the row removes it");
  requestTimer(cx).fn(cx);
  await cx.settle();
  assert.equal(acct.writes().length, 1, "a request is done once, however often the timer looks");
  // Showing the panel again draws it: that does not do the request a second time.
  state.layout = LAYOUT;
  await draw();
  assert.equal(acct.writes().length, 1);
});

test("Send to session, Start new session and Insert in chat, chosen in popups that were left open when the panel was hidden, happen at once and not when the panel shows", async () => {
  withAgent();
  installed(CLAUDE);
  const { cx, draw } = await mount();
  await draw();
  await press(cx, "menu:101");
  menuClick(await mountPopup(), "send");
  state.layout = HIDDEN();
  assert.equal(lastPopup().props.menu.kind, "agents");
  menuClick(await mountPopup(), "agent-t1");
  assert.equal(calls.run.length, 0, "not before the timer");
  requestTimer(cx).fn(cx);
  await cx.settle();
  assert.deepEqual(calls.run, [["space.select", { id: "s1" }], ["tab.select", { id: "s1-tab" }], ["pane.focus", { pane: "p-t1" }], ["terminal.paste", undefined]], "pasted now, while hidden");
  assert.match(cx.clipboard.at(-1), /#101/);
  assert.deepEqual(calls.hc, []);

  // A started session is waited for by the same timer while the panel stays hidden.
  calls.run.length = 0;
  state.layout = LAYOUT;
  await press(cx, "menu:101");
  menuClick(await mountPopup(), "start");
  state.layout = HIDDEN();
  menuClick(await mountPopup(), "agent-0");
  requestTimer(cx).fn(cx);
  await cx.settle();
  assert.deepEqual(calls.run, [["tab.new", { name: "#101 Fix the login redirect", argv: ["claude"] }]]);
  state.agents = [...state.agents, AGENT("t-new", { tab_name: "#101 Fix the login redirect", status: "idle" })];
  requestTimer(cx).fn(cx);
  await cx.settle();
  assert.deepEqual(calls.run.slice(1), [["space.select", { id: "s1" }], ["tab.select", { id: "s1-tab" }], ["pane.focus", { pane: "p-t-new" }], ["terminal.paste", undefined]], "brought to the front and pasted into, while hidden");

  calls.run.length = 0;
  state.layout = LAYOUT;
  await press(cx, "menu:101");
  state.layout = HIDDEN();
  menuClick(await mountPopup(), "insert");
  assert.deepEqual(calls.run, [], "the popup itself does not paste");
  requestTimer(cx).fn(cx);
  await cx.settle();
  assert.deepEqual(calls.run.map(c => c[0]), ["pane.focus", "terminal.paste"], "pasted at once, into the chat that has the focus now");
  assert.equal(cx.clipboard.at(-1), 'Fizzy #101 "Fix the login redirect" (https://app.fizzy.do/111/cards/101) ');
  // Nothing is left over for a later draw.
  const before = [calls.hc.length, calls.run.length];
  state.layout = LAYOUT;
  await draw();
  assert.deepEqual([calls.hc.length, calls.run.length], before);
});

test("a request a draw already noted is not done again by the timer, and a request that cannot be done is told and does not stop the timer", async () => {
  const { view, cx, draw } = await mount();
  await draw();
  state.shared["fizzy.request"] = { id: "once", op: { kind: "golden", number: 103, on: true } };
  drawn(view, cx); // the draw only notes it
  assert.deepEqual(acct.writes(), []);
  requestTimer(cx).fn(cx); // the timer finds it taken
  await due(cx);
  assert.deepEqual(acct.writes(), [["card", "golden", "103"]], "once");
  state.shared["fizzy.request"] = { id: "bad", op: null };
  assert.doesNotThrow(() => requestTimer(cx).fn(cx));
  assert.equal(calls.notify.at(-1).level, "error");
  state.shared["fizzy.request"] = { id: "next", op: { kind: "golden", number: 102, on: false } };
  requestTimer(cx).fn(cx);
  await cx.settle();
  assert.equal(acct.writes().length, 2, "the next request is still taken");
});

test("a copy started after a request does not do it from its timer either", async () => {
  state.shared["fizzy.request"] = { id: "old", op: { kind: "move", number: 101, target: "done" } };
  const { cx } = await mount();
  requestTimer(cx).fn(cx);
  await cx.settle();
  assert.deepEqual(acct.writes(), []);
});

test("New card by its key while a search's results show (from the Board view or Mine) closes the search, makes the card and opens it", async () => {
  for (const from of ["board", "mine"]) {
    setup();
    const m = await mount(), { view, cx } = m;
    if (from === "mine") click(await m.draw(), "fizzy-view-mine", cx);
    assert.ok(find(await searchFor(m, "login"), "fizzy-search-head"), from);
    await press(cx, "new");
    const tree = await chooseNewCard(m, "b1");
    assert.equal(view.search, null, `${from}: the results give way`);
    assert.deepEqual(acct.writes(), [["card", "create", "--board", "b1", "--title", "New card"]]);
    assert.equal(view.detail?.number, acct.cards.at(-1).number, `${from}: the new card is open`);
    assert.equal(view.view, "board");
    click(tree, "fizzy-fresh-done", cx);
    assert.ok(find(await m.draw(), "fizzy-section-maybe"), `${from}: Done goes back to the board, not to the results`);
  }
});

// A line of Fizzy's own activity, as `comment list` returns it ("Ada moved this to Not Now"): creator role "system".
const SYSTEM = (id, text, at) => ({ id, body: { html: `<div>${text}</div>`, plain_text: text }, creator: { id: "u-sys", name: "System", role: "system" }, created_at: at, updated_at: at });
const activityIds = tree => ids(tree).filter(i => i.startsWith("fizzy-activity-") && i !== "fizzy-activity-count");

test("Fizzy's own activity is one folded group after the people's comments; the Comments count is people's comments only", async () => {
  acct.comments[101].push(SYSTEM("sys-late", "Ada reopened this", "2026-01-07T10:00:00Z"), SYSTEM("sys-early", "Ada moved this to Not Now", "2026-01-01T10:00:00Z"));
  const { cx, draw, tree: first } = await openDetail();
  let tree = first;
  assert.match(textOf(must(tree, "fizzy-detail")), /COMMENTS 2/, "three system lines are not counted");
  assert.equal(textOf(must(tree, "fizzy-activity")).trim(), "Activity 3");
  assert.deepEqual(ids(tree).filter(i => /^fizzy-comment-cm\d$/.test(i)), ["fizzy-comment-cm1", "fizzy-comment-cm2"], "the people's comments");
  assert.deepEqual(activityIds(tree), [], "folded by default: no line shows");
  const order = ids(tree);
  assert.ok(order.indexOf("fizzy-comment-cm2") < order.indexOf("fizzy-activity") && order.indexOf("fizzy-activity") < order.indexOf("fizzy-comment-input"), "after the comments, before the box");
  const row = must(tree, "fizzy-activity");
  assert.deepEqual([row.style.h, row.style.px, row.style.text_color, row.style.text_size], [28, 8, "muted", textPx(12)]);
  assert.equal(textOf(must(tree, "fizzy-activity-count")), "3");
  assert.deepEqual(all(row, n => n.kind === "svg").map(n => n.path), ["mods/fizzy/chevron-right.svg"]);

  click(tree, "fizzy-activity", cx);
  tree = await draw();
  assert.deepEqual(activityIds(tree), ["fizzy-activity-sys-early", "fizzy-activity-cm3", "fizzy-activity-sys-late"], "oldest first, an id each");
  assert.deepEqual(all(must(tree, "fizzy-activity"), n => n.kind === "svg").map(n => n.path), ["mods/fizzy/chevron-down.svg"]);
  for (const [id, text] of [["sys-early", "Ada moved this to Not Now"], ["cm3", "Bob moved this to In progress"], ["sys-late", "Ada reopened this"]]) {
    const line = must(tree, `fizzy-activity-${id}`);
    assert.match(textOf(line), new RegExp(`^${text} · `), "the plain text, then how long ago");
    assert.equal(line.style.text_size, textPx(11));
    assert.equal(line.style.text_color, "dim");
    assert.equal(line.style.pl, 26);
    assert.deepEqual(Object.keys(line.handlers), [], "a line only reads");
    assert.equal(find(tree, `fizzy-comment-${id}`), null, "it is not drawn as a comment");
    assert.equal(find(tree, `fizzy-comment-html-${id}`), null);
  }
  assert.deepEqual(ids(tree).filter(i => /^fizzy-comment-(edit|del)-/.test(i)), ["fizzy-comment-edit-cm1", "fizzy-comment-del-cm1"], "edit and delete are the person's own comment's alone, never a system line's");
  assert.match(textOf(must(tree, "fizzy-detail")), /COMMENTS 2/, "opening the group changes no count");

  click(tree, "fizzy-activity", cx);
  tree = await draw();
  assert.deepEqual(activityIds(tree), [], "folded again");
});

test("whether Activity is open is kept for the session: Back and another card do not close it", async () => {
  const { view, cx, draw, tree: first } = await openDetail();
  click(first, "fizzy-activity", cx);
  assert.equal(view.activityOpen, true);
  let tree = await draw();
  assert.deepEqual(activityIds(tree), ["fizzy-activity-cm3"]);
  click(tree, "fizzy-back", cx);
  tree = await draw();
  click(tree, "fizzy-card-101", cx);
  tree = await draw();
  assert.deepEqual(activityIds(tree), ["fizzy-activity-cm3"], "the same card again: still open");
  click(tree, "fizzy-back", cx);
  const fresh = await mount();
  click(await fresh.draw(), "fizzy-card-101", fresh.cx);
  assert.deepEqual(activityIds(await fresh.draw()), [], "a new copy starts folded");
});

test("a card with only activity says 'No comments' and still offers Activity; a card with neither shows no Activity", async () => {
  acct.comments[101] = [SYSTEM("sys-a", "Ada assigned this to Ada.", "2026-01-02T10:00:00Z")];
  let { tree } = await openDetail();
  assert.equal(find(tree, "fizzy-comments-count"), null, "no count of none");
  assert.equal(textOf(must(tree, "fizzy-comments-empty")), "No comments");
  assert.equal(textOf(must(tree, "fizzy-activity")).trim(), "Activity 1");
  const order = ids(tree);
  assert.ok(order.indexOf("fizzy-activity") < order.indexOf("fizzy-comment-input"));

  setup();
  ({ tree } = await openDetail(102));
  assert.equal(textOf(must(tree, "fizzy-comments-empty")), "No comments");
  assert.equal(find(tree, "fizzy-activity"), null, "no activity: no row");
});

test("while the comments are still coming there is one 'Loading…', no Comments section, no 'No comments' and no Activity", async () => {
  const { view, cx, draw } = await mount();
  const tree = await draw();
  let release;
  acct.hold = new Promise(resolve => { release = resolve; });
  click(tree, "fizzy-card-101", cx);
  const text = textOf(must(drawn(view, cx), "fizzy-detail"));
  assert.equal(text.split("Loading…").length - 1, 1);
  assert.doesNotMatch(text, /Comments|No comments/);
  assert.equal(find(drawn(view, cx), "fizzy-activity"), null);
  release();
  await cx.settle();
  acct.hold = null;
});

test("Mine with no boards reads nothing and notifies nothing in the microtask right after the draw that asked", async () => {
  localStorage.setItem("view", '"mine"');
  acct.boards.length = 0;
  const { view, cx, draw } = await mount();
  let tree = await draw();
  assert.match(textOf(must(tree, "fizzy-list")), /No cards/);
  assert.equal(acct.asked("card", "list").length, 0, "no board, nothing to ask");
  // The panel goes away and comes back: that draw reads the view again at once (poll, forced), which for Mine is loadMine.
  state.layout = HIDDEN();
  timer(cx, 1000).fn(cx);
  assert.equal(view.shown, false);
  state.layout = LAYOUT;
  const told = cx.notified;
  drawn(view, cx, { quiet: true }); // from here until the next macrotask a notify without I/O behind it throws
  assert.equal(view.shown, true, "and it is the draw that noticed");
  await cx.settle();
  assert.deepEqual([cx.late, cx.notified], [[], told], "it started nothing: nothing was told either");
  assert.equal(acct.asked("card", "list").length, 0);
  // The same from the poll's timer, which is no draw (Mine is read every other time): still nothing asked.
  timer(cx, POLL_VIEW).fn(cx);
  timer(cx, POLL_VIEW).fn(cx);
  await cx.settle();
  assert.equal(acct.asked("card", "list").length, 0);
  assert.match(textOf(must(await draw(), "fizzy-list")), /No cards/);
});

test("Mine says Loading… while the boards are still being read, and the boards' arrival starts the read", async () => {
  localStorage.setItem("view", '"mine"');
  localStorage.setItem("me", JSON.stringify({ account: "111", id: "u-me" })); // known from before, for this account: only the boards are awaited
  let release;
  acct.hold = new Promise(resolve => { release = resolve; });
  const { view, cx } = await mount({ settle: false });
  const tree = drawn(view, cx);
  assert.match(textOf(must(tree, "fizzy-list")), /Loading…/);
  assert.doesNotMatch(textOf(must(tree, "fizzy-list")), /No cards/);
  assert.equal(acct.asked("card", "list").filter(a => a.includes("--assignee")).length, 0, "no board known yet: no read");
  release();
  await cx.settle();
  acct.hold = null;
  assert.deepEqual(rowIds(drawn(view, cx)), [101, 201], "the boards came, and with them the cards");
  assert.equal(acct.asked("identity").length, 0, "the kept person was used");
});

test("Mine drops what it held when the boards turn out to be none, and tells it from a timer", async () => {
  const { view, cx, draw } = await mount();
  click(await draw(), "fizzy-view-mine", cx);
  let tree = await draw();
  assert.deepEqual(rowIds(tree), [101, 201]);
  assert.ok(view.mine.size > 0);
  acct.boards.length = 0;
  click(tree, "fizzy-refresh", cx);
  await cx.settle();
  assert.equal(view.mine.size, 0, "nothing is held for boards that are gone");
  tree = await draw();
  assert.deepEqual(rowIds(tree), []);
  assert.match(textOf(must(tree, "fizzy-list")), /No cards/);
});

// Card 105 is closed: no open list holds it, so open:105 shows a stub (title "#105", no link) until card show answers.
const REF_105 = 'Fizzy #105 "Shipped thing" (https://app.fizzy.do/111/cards/105)';
const showFails = args => (args[0] === "card" && args[1] === "show" ? failure("not_found", "Resource not found") : undefined);

test("open:<n> for a card in no list, then copy at once: the reference waits for the card (title and link), from one card show", async () => {
  const { cx, draw } = await mount();
  await draw();
  sendCommand("open:105");
  sendCommand("copy");
  await tick();
  await cx.settle();
  assert.deepEqual(cx.clipboard, [REF_105], "not Fizzy #105 \"#105\" with no link");
  assert.equal(calls.notify.at(-1).body, "Copied");
  assert.deepEqual(acct.asked("card", "show"), [["card", "show", "105"]], "the detail's read and the hand-off share one card show");
});

test("open:<n> for a card in no list, then insert at once: the agent's chat gets the full reference", async () => {
  withAgent();
  const { cx, draw } = await mount();
  await draw();
  sendCommand("open:105");
  sendCommand("insert");
  await tick();
  await cx.settle();
  assert.deepEqual(cx.clipboard, [`${REF_105} `]);
  assert.deepEqual(calls.run, [["pane.focus", { pane: "p-t1" }], ["terminal.paste", undefined]]);
  assert.deepEqual(acct.asked("card", "show"), [["card", "show", "105"]]);
});

test("open:<n> then send or start at once: their popups carry the card as read, not the stub, and choosing pastes its full reference", async () => {
  withAgent();
  installed(CLAUDE);
  const { cx, draw } = await mount();
  await draw();
  sendCommand("open:105");
  sendCommand("send");
  sendCommand("start");
  await tick();
  await cx.settle();
  assert.deepEqual(calls.openOverlay.map(o => o.props.menu.kind), ["agents", "start"]);
  for (const o of calls.openOverlay) assert.deepEqual(o.props.menu.cards.map(c => [c.title, c.url]), [["Shipped thing", "https://app.fizzy.do/111/cards/105"]]);
  assert.deepEqual(calls.hc, []);
  menuClick(await mountPopup(calls.openOverlay[0]), "agent-t1");
  await draw();
  assert.equal(cx.clipboard.at(-1), `${REF_105} `);
  menuClick(await mountPopup(calls.openOverlay[1]), "agent-0");
  await draw();
  assert.deepEqual(calls.run.at(-1), ["tab.new", { name: "#105 Shipped thing", argv: ["claude"] }]);
  assert.deepEqual(acct.asked("card", "show"), [["card", "show", "105"]]);
});

test("a card show that fails: insert, copy, send and start tell the error and do nothing else", async () => {
  withAgent();
  installed(CLAUDE);
  const { cx, draw } = await mount();
  await draw();
  acct.fail = showFails;
  await press(cx, "open:105");
  const told = calls.notify.length;
  for (const [i, command] of ["insert", "copy", "send", "start"].entries()) {
    await press(cx, command);
    assert.equal(calls.notify.length, told + i + 1, `${command}: one notification`);
    assert.deepEqual([calls.notify.at(-1).level, calls.notify.at(-1).body], ["error", "Not found in Fizzy: it was deleted, or you can't see it"]);
  }
  assert.deepEqual(cx.clipboard, [], "nothing copied");
  assert.deepEqual(calls.run, [], "nothing pasted");
  assert.equal(calls.openOverlay.length, 0, "no menu");
  assert.ok(acct.asked("card", "show").length >= 5, "each command asked again: nothing was made up from the stub");
});

test("copy and insert with nothing open and nothing picked (in Mine) leave the clipboard alone; so does a selection no list holds a card for", async () => {
  withAgent();
  installed(CLAUDE);
  const { view, cx, draw } = await mount();
  click(await draw(), "fizzy-view-mine", cx);
  await draw();
  await press(cx, "copy");
  await press(cx, "insert");
  await press(cx, "send");
  await press(cx, "start");
  assert.deepEqual(cx.clipboard, [], "no write: an empty clipboard is never written");
  assert.deepEqual([calls.run, calls.hc, calls.openOverlay], [[], [], []]);
  assert.equal(calls.notify.filter(n => n.body === "Copied").length, 0);
  // A number that no list holds is picked: the bar has no card to hand over, and its buttons do nothing.
  view.selected.add(4999);
  const tree = await draw();
  for (const id of ACTIONS) assert.equal(must(tree, id).handlers.on_click, undefined, `${id} is disabled`);
  await press(cx, "copy");
  assert.deepEqual([cx.clipboard, calls.run, calls.hc, calls.openOverlay], [[], [], [], []]);
  assert.equal(acct.asked("card", "show").length, 0, "no card to read either");
});

test("the detail's bar and card menu on a stub wait for the card: copy, insert, send, start and the menu's rows carry its title and link", async () => {
  withAgent();
  installed(CLAUDE);
  const { view, cx, draw } = await mount();
  await draw();
  let release;
  acct.hold = new Promise(resolve => { release = resolve; });
  sendCommand("open:105");
  await tick();
  const tree = drawn(view, cx);
  assert.equal(find(tree, "fizzy-title"), null, "a card known only by its number has no title yet");
  assert.match(textOf(must(tree, "fizzy-detail")), /Loading…/);
  const clicker = makeCx();
  for (const id of ACTIONS) assert.ok(!isOff(tree, id), `${id}: the open card is the subject, even a stub`);
  for (const id of ["fizzy-bar-copy", "fizzy-bar-insert", "fizzy-bar-send", "fizzy-bar-start", "fizzy-card-menu"]) click(tree, id, clicker);
  assert.deepEqual([clicker.clipboard, calls.run, calls.hc, calls.openOverlay], [[], [], [], []], "nothing is handed over while the card is out");
  release();
  await cx.settle();
  await clicker.settle();
  acct.hold = null;
  assert.deepEqual(clicker.clipboard, [REF_105, `${REF_105} `], "copy, then insert");
  assert.deepEqual(calls.run.map(c => c[0]), ["pane.focus", "terminal.paste"], "Send and Start only opened their popups");
  assert.deepEqual(calls.hc, []);
  const menus = calls.openOverlay.map(o => o.props.menu);
  assert.deepEqual(menus.map(m => m.kind).sort(), ["agents", "card", "start"], "the bar's two popups and the card menu opened once the card was read");
  for (const m of menus.filter(x => x.kind !== "card")) assert.deepEqual(m.cards.map(c => [c.title, c.url]), [["Shipped thing", "https://app.fizzy.do/111/cards/105"]]);
  const menu = menus.find(m => m.kind === "card");
  assert.deepEqual([menu.card.title, menu.card.url, menu.card.board.id], ["Shipped thing", "https://app.fizzy.do/111/cards/105", "b1"]);
  const rows = menuRows(menu, {});
  assert.deepEqual([rows.find(r => r.id === "insert").act, rows.find(r => r.id === "copy-ref").act], [{ insert: REF_105 }, { copy: REF_105 }]);
  assert.deepEqual(acct.asked("card", "show"), [["card", "show", "105"]], "one card show served them all");
});

test("a popup's insert request with no text does nothing: no clipboard write, no paste", async () => {
  withAgent();
  const { view, cx, draw } = await mount();
  await draw();
  state.shared["fizzy.request"] = { id: "empty", op: { kind: "insert", text: "" } };
  drawn(view, cx);
  await due(cx);
  assert.deepEqual(cx.clipboard, []);
  assert.deepEqual(calls.run, []);
});

// In Herdr a popup is only as tall as its content, and a scroll area has no height of its own: a column that only
// has min_h(0) around a list without flex_1 collapses to its padding, an empty strip with no rows. So the column
// carries an explicit height (its rows as drawn now, never past what the popup asked for) and the list fills it.
const INSIDE = spec => spec.height - FRAME;
const INPUT_ROW = 40; // the New tag field above the tags
// The rows a popup draws now, worked out the way its own draw works them out.
function rowsNow(menu, known = []) {
  const people = state.shared["fizzy.people"] ?? {};
  return menuRows(menu, { agents: state.agents, focused: state.focused, boards: state.shared["fizzy.boards"] ?? [], groups: state.shared["fizzy.boardGroups"], users: people.users, tags: people.tags, me: people.me, known, checking: false, failed: false, armed: null });
}
const columnHeight = (menu, rows) => menuHeight(rows) + (menu.kind === "tags" ? INPUT_ROW : 0) - FRAME;
const rowCount = list => all(list, n => /^fizzy-menu-/.test(n.id ?? "") && n.id !== "fizzy-menu-list").length;
// A popup as Herdr starts it, without waiting for what it reads (a lookup a test holds back is still pending).
function popupNow(spec) {
  state.props = { menu: spec.props.menu, overlay: "ov-popup" };
  const cx = makeCx(), view = new Fizzy();
  view.init(undefined, cx);
  return { view, cx, tree: () => drawn(view, cx) };
}

// Every kind of popup, opened the way the panel opens them, so each has the height it really asked for.
async function everyPopup() {
  withAgent();
  state.knownAgents = async () => [agent("claude", "Claude Code"), agent("codex", "Codex")];
  const { cx, draw } = await mount();
  let tree = await draw();
  click(tree, "fizzy-board", cx);
  fire(must(tree, "fizzy-more-101"), "on_click", {}, cx);
  await cx.settle();
  const card = calls.openOverlay.filter(s => s.props.menu.kind === "card").at(-1);
  for (const row of ["assign", "tags", "move-board", "start", "send"]) menuClick(await mountPopup(card), row);
  click(tree, "fizzy-card-101", cx);
  await draw();
  return Object.fromEntries(calls.openOverlay.map(s => [s.props.menu.kind, s]));
}

// A sub-menu's popup, opened from the card menu's row; `between` changes the world after the card menu opened.
// `wait: false` leaves what the popup reads pending.
async function fromCardMenu(row, { between = () => {}, wait = true } = {}) {
  state.props = undefined; // an earlier popup's props would make this a popup too
  const { cx, draw } = await mount();
  const tree = await draw();
  fire(must(tree, "fizzy-more-101"), "on_click", {}, cx);
  await cx.settle();
  const card = lastPopup();
  between();
  menuClick(await mountPopup(card), row);
  const spec = lastPopup(), popup = popupNow(spec);
  if (wait) await popup.cx.settle();
  return { spec, popup };
}

test("every popup is a column with a height of its own and a list that fills it, so it never opens as an empty strip", async () => {
  const specs = await everyPopup();
  assert.deepEqual(Object.keys(specs).sort(), ["agents", "boards", "card", "moveBoard", "start", "tags", "users"]);
  for (const [kind, spec] of Object.entries(specs)) {
    const popup = await mountPopup(spec), tree = popup.tree(), menu = spec.props.menu;
    const rows = rowsNow(menu, popup.view.known);
    const root = must(tree, "fizzy-menu"), list = must(tree, "fizzy-menu-list");
    assert.equal(root.style.h, Math.min(columnHeight(menu, rows), INSIDE(spec)), `${kind}: the column is as tall as its rows, at most what was asked`);
    assert.ok(root.style.h >= 2 * 5 + 31, `${kind}: more than its padding, room for a row`);
    assert.equal(list.style.flex_1, true, `${kind}: the list fills the column`);
    assert.equal(list.style.min_h, 0, `${kind}: and may shrink`);
    assert.equal(list.style.overflow_y_scrollbar, true, `${kind}: and scrolls`);
    assert.equal(rowCount(list), rows.filter(r => r.type === "row").length, `${kind}: every row is drawn`);
  }
  assert.equal(specs.card.height, 560, "the card menu is taller than a popup may be");
  const card = await mountPopup(specs.card);
  assert.equal(must(card.tree(), "fizzy-menu").style.h, 560 - FRAME, "so its column stops at the popup's inside");
});

test("the tags popup's column makes room for the New tag field above its list", async () => {
  state.shared["fizzy.people"] = { me: "u-me", tags: [{ id: "t1", title: "bug" }, { id: "t2", title: "docs" }], users: [] };
  const { cx, draw } = await mount();
  const tree = await draw();
  fire(must(tree, "fizzy-more-101"), "on_click", {}, cx);
  await cx.settle();
  menuClick(await mountPopup(), "tags");
  const spec = lastPopup(), popup = await mountPopup(spec), t = popup.tree();
  const rows = rowsNow(spec.props.menu);
  assert.equal(must(t, "fizzy-menu").style.h, menuHeight(rows) + INPUT_ROW - FRAME);
  assert.ok(find(t, "fizzy-menu-newtag"));
  assert.equal(must(t, "fizzy-menu-list").style.flex_1, true);
});

test("many boards: the boards popup is as tall as a popup may be, lists every board in its list, and scrolls", async () => {
  const { cx, draw } = await mount();
  const tree = await draw();
  const many = Array.from({ length: 40 }, (_, i) => ({ id: `b${i + 1}`, name: `Board ${i + 1}` })), last = many.at(-1).id;
  state.shared["fizzy.boards"] = many;
  click(tree, "fizzy-board", cx);
  const spec = lastPopup();
  assert.equal(spec.props.menu.kind, "boards");
  assert.equal(spec.height, 560, "asks for the most a popup may be");
  const popup = await mountPopup(spec), t = popup.tree();
  assert.ok(menuHeight(rowsNow(spec.props.menu)) - FRAME > 560 - FRAME, "the rows do not fit");
  const root = must(t, "fizzy-menu"), list = must(t, "fizzy-menu-list");
  assert.equal(root.style.h, 560 - FRAME, "so the column is as tall as the popup's inside");
  assert.deepEqual([list.style.flex_1, list.style.min_h, list.style.overflow_y_scrollbar], [true, 0, true]);
  const boards = ids(list).filter(i => i.startsWith("fizzy-menu-board-"));
  assert.equal(boards.length, many.length);
  assert.deepEqual([boards[0], boards.at(-1)], ["fizzy-menu-board-b1", `fizzy-menu-board-${last}`]);
  menuClick(popup, `board-${last}`);
  assert.deepEqual(state.shared["fizzy.board"].board, last, "a row far down still chooses");
});

test("rows that arrive after a popup opened make its column grow, never past the height it asked for", async () => {
  // Start: the agents are asked after it opens; the note is one row and six agents fill the room kept for them.
  let found;
  // Only the popup asks for the agents (the bar does not read them): its read is held back.
  state.knownAgents = () => new Promise(ok => { found = ok; });
  const start = await fromCardMenu("start", { wait: false });
  const first = must(start.popup.tree(), "fizzy-menu").style.h;
  assert.equal(first, menuHeight([{ type: "note" }]) - FRAME, "the note while it asks");
  found(Array.from({ length: 8 }, (_, i) => agent(`a${i}`, `Agent ${i}`)));
  await start.popup.cx.settle();
  const list = must(start.popup.tree(), "fizzy-menu-list");
  assert.equal(ids(list).filter(i => i.startsWith("fizzy-menu-agent-")).length, 6, "the most it shows");
  const grown = must(start.popup.tree(), "fizzy-menu").style.h;
  assert.ok(grown > first, "it grew with its rows");
  assert.equal(grown, INSIDE(start.spec), "to what it asked for, and no further");
  installed(); // the panels below ask for the agents too, and are not held

  // Users: the people are read after it opens; many more than the room kept for them.
  const users = await fromCardMenu("assign", { between: () => { delete state.shared["fizzy.people"]; } });
  const before = must(users.popup.tree(), "fizzy-menu").style.h;
  assert.ok(before < INSIDE(users.spec), "people read: the rows are fewer than the room kept");
  state.shared["fizzy.people"] = { me: "u-me", tags: [], users: Array.from({ length: 30 }, (_, i) => ({ id: `u${i}`, name: `Person ${i}`, role: "member", active: true })) };
  const many = users.popup.tree();
  assert.ok(menuHeight(rowsNow(users.spec.props.menu)) - FRAME > INSIDE(users.spec), "thirty people do not fit");
  assert.equal(must(many, "fizzy-menu").style.h, INSIDE(users.spec), "the column stops at what was asked");
  assert.equal(ids(must(many, "fizzy-menu-list")).filter(i => i.startsWith("fizzy-menu-user-")).length, 30, "they are all in the list");

  // Agents: more of them start running while it is open.
  withAgent();
  const agents = await fromCardMenu("send");
  const one = must(agents.popup.tree(), "fizzy-menu").style.h;
  assert.equal(one, INSIDE(agents.spec));
  state.agents = [...state.agents, ...Array.from({ length: 10 }, (_, i) => AGENT(`more${i}`))];
  const eleven = agents.popup.tree();
  assert.equal(must(eleven, "fizzy-menu").style.h, INSIDE(agents.spec), "never past what it asked for");
  assert.equal(ids(must(eleven, "fizzy-menu-list")).filter(i => i.startsWith("fizzy-menu-agent-")).length, 11, "and all of them are in the list");
});

const minutesAgo = m => new Date(Date.now() - m * 60_000).toISOString();
// A notification as Fizzy's tray gives it: a mention (title "X @mentioned you", the comment as body) or an event (the card's title).
const note = (id, more = {}) => ({
  id, title: `Note ${id}`, body: `Body of ${id}`, source_type: "event", read: false, created_at: minutesAgo(1), creator: { name: "Bob" },
  card: { id: "id-101", number: 101, title: "Fix the login redirect", status: "published", closed: false, postponed: false, column: null, board_name: "Roadmap", url: "https://app.fizzy.do/111/cards/101" },
  ...more,
});
const noteIds = tree => ids(must(tree, "fizzy-list")).filter(i => i.startsWith("fizzy-note-")).map(i => i.slice("fizzy-note-".length));
const titleNode = (tree, id) => all(must(tree, `fizzy-note-${id}`), n => n.style.flex_1 && n.style.truncate)[0];
const dotsOf = (tree, id) => all(must(tree, `fizzy-note-${id}`), n => n.style.size === 7).length;
// The toasts of new notifications (the panel's other toasts are errors, "Copied" and the like).
const toasts = () => calls.notify.filter(n => n.level === "info");
const pollNow = async cx => { inboxTimer(cx).fn(cx); await cx.settle(); };
// A tick of the 300 ms timer, which also looks for a toast's click that had to bring the panel up.
const tickRequest = async cx => { requestTimer(cx).fn(cx); await cx.settle(); };
const ELSEWHERE = (more = {}) => layoutWith({ active: "files", children: ["files", "changes", "fizzy"], ...more });

test("the Inbox lists only the unread notifications, newest first, each with the accent dot, a semibold title in the normal color", async () => {
  acct.notifications = [
    note("r-old", { read: true, title: "Old read", created_at: minutesAgo(3 * 24 * 60) }),
    note("u-old", { title: "Unread old", created_at: minutesAgo(120) }),
    note("r-new", { read: true, title: "Read new", created_at: minutesAgo(60) }),
    note("u-new", { title: "Unread new", created_at: minutesAgo(10) }),
  ];
  const { cx, draw } = await mount();
  click(await draw(), "fizzy-view-inbox", cx);
  const tree = await draw();
  assert.deepEqual(acct.asked("notification", "tray").at(-1), ["notification", "tray"], "`notification tray`, without --include-read");
  assert.ok(acct.asked("notification", "tray").every(a => a.length === 2), "and never any flag, from the poll or from the Inbox");
  assert.deepEqual(noteIds(tree), ["u-new", "u-old"]);
  for (const id of ["u-new", "u-old"]) {
    assert.equal(dotsOf(tree, id), 1, `${id}: the dot`);
    assert.equal(all(must(tree, `fizzy-note-${id}`), n => n.style.size === 7)[0].style.bg, "accent", `${id}: in the accent color`);
    assert.equal(titleNode(tree, id).style.font_semibold, true, `${id}: semibold`);
    assert.equal(titleNode(tree, id).style.text_color, undefined, `${id}: the normal color`);
  }
  assert.match(textOf(must(tree, "fizzy-note-u-new")), /Unread new\s+Body of u-new\s+#101 · Roadmap · Bob · 10m/, "a row: title, body, its line");
  assert.ok(find(tree, "fizzy-read-all"), "Mark all read is there");
  assert.equal(state.shared["fizzy.unread"], 2, "the count is the unread ones");
  assert.match(textOf(must(tree, "fizzy-view-inbox")), /2/, "and so is the badge");
});

test("the Inbox's empty state is \"You're all caught up\", also when the only notifications are read ones; the bar stays", async () => {
  acct.notifications.length = 0;
  const { cx, draw } = await mount();
  click(await draw(), "fizzy-view-inbox", cx);
  let tree = await draw();
  assert.match(textOf(must(tree, "fizzy-list")), /You're all caught up/);
  assert.ok(find(tree, "fizzy-read-all"), "the bar stays");
  // Only read ones, even from a tray that hands them out: nothing is drawn for them.
  acct.notifications.push(note("r1", { read: true }));
  acct.trayShowsRead = true;
  click(await draw(), "fizzy-refresh", cx);
  await cx.settle();
  tree = await draw();
  assert.deepEqual(noteIds(tree), []);
  assert.match(textOf(must(tree, "fizzy-list")), /You're all caught up/);
  // And a new unread one fills the list again.
  acct.notifications.push(note("u1", { created_at: minutesAgo(2) }));
  click(await draw(), "fizzy-refresh", cx);
  await cx.settle();
  tree = await draw();
  assert.deepEqual(noteIds(tree), ["u1"]);
  assert.doesNotMatch(textOf(must(tree, "fizzy-list")), /caught up/);
});

test("the first poll of a copy with nothing seen only learns what is there; a later poll toasts a new notification", async () => {
  const { cx } = await mount();
  assert.equal(toasts().length, 0, "n1 and n2 were there at the start: no toast");
  assert.deepEqual(JSON.parse(localStorage.getItem("seenNotes")), ["n2", "n1"], "learned, oldest first");
  await pollNow(cx);
  assert.equal(toasts().length, 0, "nothing new");
  acct.notifications.push(note("m1", { title: "Helper (bot) @mentioned you", body: "Can you look at this?\nA second line", source_type: "mention", created_at: minutesAgo(0) }));
  await pollNow(cx);
  assert.deepEqual(toasts(), [{ title: "Helper (bot) @mentioned you", body: "Can you look at this? · #101 · Roadmap", level: "info", timeout: 8000, action: { name: "fizzy.open:101:m1" } }]);
  await pollNow(cx);
  assert.equal(toasts().length, 1, "each notification once");
  assert.deepEqual(JSON.parse(localStorage.getItem("seenNotes")), ["n2", "n1", "m1"]);
  // An event's toast: the card's title, then what happened.
  acct.notifications.push(note("e1", { title: "Write the changelog", body: "Moved to In progress by Helper (Bot)", card: { number: 102, board_name: "Roadmap", title: "Write the changelog" } }));
  await pollNow(cx);
  assert.deepEqual([toasts().at(-1).title, toasts().at(-1).body, toasts().at(-1).action], ["Write the changelog", "Moved to In progress by Helper (Bot) · #102 · Roadmap", { name: "fizzy.open:102:e1" }]);
});

test("a first poll that fails does not count: the first one that works seeds, the next one toasts", async () => {
  setup();
  acct.fail = args => (args[1] === "tray" ? failure("network", "offline") : undefined);
  const { cx } = await mount();
  assert.equal(localStorage.getItem("seenNotes"), null);
  acct.fail = null;
  await pollNow(cx);
  assert.equal(toasts().length, 0, "seeded");
  assert.deepEqual(JSON.parse(localStorage.getItem("seenNotes")), ["n2", "n1"]);
  acct.notifications.push(note("late"));
  await pollNow(cx);
  assert.deepEqual(toasts().map(n => n.title), ["Note late"]);
});

test("a copy that starts with seen ids toasts what is new since, once; a copy with none seeds again", async () => {
  localStorage.setItem("seenNotes", JSON.stringify(["n1"]));
  const { cx } = await mount();
  assert.deepEqual(toasts().map(n => n.title), ["Write the changelog"], "n2 was not seen: toasted by the first poll");
  await pollNow(cx);
  assert.equal(toasts().length, 1);
  // The same ids again (the copy was reloaded): nothing to say.
  const before = toasts().length;
  await mount();
  assert.equal(toasts().length, before);
  // Cleared storage: nothing to compare with, so it only learns.
  localStorage.clear();
  const fresh = await mount();
  assert.equal(toasts().length, before, "no flood");
  assert.deepEqual(JSON.parse(localStorage.getItem("seenNotes")), ["n2", "n1"]);
  assert.ok(fresh.cx);
});

test("1, 3 or 5 new notifications: a toast each up to three; more than that, the three newest and one \"N more in Fizzy\"", async () => {
  for (const count of [1, 3, 5]) {
    setup();
    const { cx } = await mount();
    for (let i = 1; i <= count; i++) acct.notifications.push(note(`new${i}`, { created_at: minutesAgo(count - i) })); // new1 is the oldest
    const told = calls.notify.length;
    await pollNow(cx);
    const posted = calls.notify.slice(told);
    if (count <= 3) {
      assert.deepEqual(posted.map(n => n.title), Array.from({ length: count }, (_, i) => `Note new${i + 1}`), `${count}: oldest first`);
    } else {
      assert.deepEqual(posted.map(n => n.title), ["Note new3", "Note new4", "Note new5", "Fizzy"], `${count}: the three newest, oldest of them first, then the rest`);
      assert.deepEqual(posted.at(-1), { title: "Fizzy", body: "2 more in Fizzy", level: "info", timeout: 8000 });
    }
    assert.deepEqual(JSON.parse(localStorage.getItem("seenNotes")), ["n2", "n1", ...Array.from({ length: count }, (_, i) => `new${i + 1}`)], `${count}: all of them are seen, the ones not toasted too`);
    await pollNow(cx);
    assert.equal(calls.notify.length, told + posted.length, `${count}: and none is toasted twice`);
  }
});

test("the seen ids are kept at 300, the oldest dropped; a toast has the title cut at 80, the body line at 140, and no action without a card", async () => {
  localStorage.setItem("seenNotes", JSON.stringify(Array.from({ length: 300 }, (_, i) => `x${i}`)));
  const { cx } = await mount();
  const seen = JSON.parse(localStorage.getItem("seenNotes"));
  assert.equal(seen.length, 300);
  assert.deepEqual([seen[0], seen.at(-2), seen.at(-1)], ["x2", "n2", "n1"], "n2 and n1 were new; x0 and x1 went");
  calls.notify.length = 0;
  acct.notifications.push(
    note("long", { title: "T".repeat(100), body: `${"b".repeat(200)}\nsecond`, created_at: minutesAgo(0.5) }),
    note("bare", { title: "No card here", body: "", card: null, created_at: minutesAgo(0.4) }),
    note("nobody", { title: "No board", body: "", card: { number: 7 }, created_at: minutesAgo(0.3) }),
  );
  await pollNow(cx);
  const [long, bare, nobody] = toasts();
  assert.equal(long.title, `${"T".repeat(79)}…`);
  assert.equal(long.body, `${"b".repeat(139)}… · #101 · Roadmap`);
  assert.deepEqual(bare, { title: "No card here", level: "info", timeout: 8000 }, "no body, no number, no board, no action");
  assert.deepEqual(nobody, { title: "No board", body: "#7", level: "info", timeout: 8000, action: { name: "fizzy.open:7:nobody" } });
  assert.equal(JSON.parse(localStorage.getItem("seenNotes")).length, 300);
});

test("a notification about no card (Fizzy numbers it 0): no #0 in its toast or its row, no action, and a click only reads it", async () => {
  const { cx, draw } = await mount();
  calls.notify.length = 0;
  const none = { number: 0, title: "", url: "", closed: false, postponed: false, column: { created_at: "", id: "", name: "" }, board_name: "" };
  acct.notifications.push(note("zero", { title: "Welcome to Example Co", body: "", card: none, created_at: minutesAgo(0.5) }));
  await pollNow(cx);
  assert.deepEqual(toasts(), [{ title: "Welcome to Example Co", level: "info", timeout: 8000 }]);
  let tree = await draw();
  click(tree, "fizzy-view-inbox", cx);
  tree = await draw();
  assert.doesNotMatch(textOf(must(tree, "fizzy-note-zero")), /#0/);
  click(tree, "fizzy-note-zero", cx);
  tree = await draw();
  assert.deepEqual(acct.writes(), [["notification", "read", "zero"]]);
  assert.equal(acct.asked("card", "show").length, 0, "no card to read");
  assert.equal(find(tree, "fizzy-detail"), null);
});

test("a popup does not poll or toast", async () => {
  openOverlayFor({ kind: "boards", current: "b1", follow: true, spaceBoard: null });
  const popup = await mountPopup();
  assert.equal(acct.asked("notification").length, 0);
  assert.equal(popup.cx.timers.length, 0, "no poll of its own");
  assert.equal(calls.notify.length, 0);
  assert.equal(localStorage.getItem("seenNotes"), null);
});

test("a toast's action is chosen from the layout when it is posted: open when Fizzy shows, else bring it up", async () => {
  const { view, cx } = await mount();
  const post = async (layout, id) => {
    state.layout = layout;
    acct.notifications.push(note(id, { created_at: minutesAgo(0) }));
    await pollNow(cx);
    return toasts().at(-1);
  };
  // Fizzy is showing: the command reaches this copy.
  let toast = await post(LAYOUT, "a1");
  assert.deepEqual(toast.action, { name: "fizzy.open:101:a1" });
  assert.equal(view.pendingNote, null, "nothing to wait for");
  // The Fizzy page is the stack's active child but the panel is hidden.
  const before = Date.now();
  toast = await post(HIDDEN(), "a2");
  assert.deepEqual(toast.action, { name: "layout.show", args: { id: "panel" } });
  assert.deepEqual({ ...view.pendingNote, until: undefined }, { number: 101, id: "a2", until: undefined, before: { active: "fizzy", hidden: true } });
  assert.ok(view.pendingNote.until >= before + 60000 && view.pendingNote.until <= Date.now() + 60000, "for a minute");
  // Another page is in front (panel shown, or hidden too).
  toast = await post(ELSEWHERE(), "a3");
  assert.deepEqual(toast.action, { name: "layout.select", args: { stack: "panel-body", child: "fizzy" } });
  assert.deepEqual(view.pendingNote.before, { active: "files", hidden: false });
  assert.equal(view.pendingNote.id, "a3", "the newest toast wins");
  toast = await post(ELSEWHERE({ hidden: true }), "a4");
  assert.deepEqual(toast.action, { name: "layout.select", args: { stack: "panel-body", child: "fizzy" } });
  assert.deepEqual([view.pendingNote.id, view.pendingNote.before], ["a4", { active: "files", hidden: true }]);
  // A toast that opens at once leaves an earlier toast's wait alone (only one that brings the panel up replaces it).
  toast = await post(LAYOUT, "a5");
  assert.deepEqual(toast.action, { name: "fizzy.open:101:a5" });
  assert.equal(view.pendingNote.id, "a4", "the wait of the toast before stays");
  // A layout without the panel stack shows Fizzy wherever it was put.
  toast = await post({ id: "root", type: "row", children: [] }, "a6");
  assert.deepEqual(toast.action, { name: "fizzy.open:101:a6" });
  assert.equal(view.pendingNote.id, "a4");
});

test("a toast that brought the panel up: once the layout shows Fizzy the card opens, its notification is read, and it happens once", async () => {
  const { view, cx, draw } = await mount();
  state.layout = ELSEWHERE();
  acct.notifications.push(note("p1", { created_at: minutesAgo(0), card: { number: 102, title: "Write the changelog", board_name: "Roadmap" } }));
  await pollNow(cx);
  assert.equal(view.pendingNote.number, 102);
  // Nothing has changed: a tick does nothing, however often it comes.
  const asked = acct.log.length;
  await tickRequest(cx);
  await tickRequest(cx);
  assert.equal(acct.log.length, asked);
  assert.deepEqual(calls.run, []);
  // The toast was clicked: layout.select ran, and the Fizzy page is in front. A draw only looks.
  state.layout = LAYOUT;
  drawn(view, cx, { quiet: true });
  await tick();
  assert.deepEqual([acct.asked("card", "show").length, acct.writes().length, calls.run.length], [0, 0, 0], "a draw opens nothing and reads nothing");
  assert.notEqual(view.pendingNote, null);
  await tickRequest(cx);
  assert.deepEqual(acct.asked("card", "show", "102"), [["card", "show", "102"]]);
  assert.deepEqual(acct.writes(), [["notification", "read", "p1"]]);
  assert.deepEqual(calls.run, [], "the panel was shown: no layout.show");
  assert.equal(view.pendingNote, null);
  assert.equal(view.detail.number, 102);
  assert.ok(find(await draw(), "fizzy-detail"));
  assert.equal(state.shared["fizzy.unread"], 2, "the unread count is asked again: n1, n2 are still unread (p1 is read)");
  await tickRequest(cx);
  assert.equal(acct.asked("card", "show", "102").length, 1, "once");
  assert.equal(acct.writes().length, 1);
});

test("a toast that had to show the panel too: the panel is still hidden when the Fizzy page comes up, so layout.show runs first", async () => {
  const { view, cx } = await mount();
  state.layout = ELSEWHERE({ hidden: true });
  acct.notifications.push(note("p2", { created_at: minutesAgo(0) }));
  await pollNow(cx);
  state.layout = HIDDEN(); // layout.select ran; the panel is still hidden
  await tickRequest(cx);
  assert.deepEqual(calls.run, [["layout.show", { id: "panel" }]]);
  assert.deepEqual(acct.asked("card", "show", "101"), [["card", "show", "101"]]);
  assert.deepEqual(acct.writes(), [["notification", "read", "p2"]]);
  assert.equal(view.pendingNote, null);
  // Another page that comes up is no click on the toast.
  state.layout = ELSEWHERE({ hidden: true });
  acct.notifications.push(note("p3", { created_at: minutesAgo(0) }));
  await pollNow(cx);
  state.layout = layoutWith({ active: "changes", children: ["files", "changes", "fizzy"] });
  await tickRequest(cx);
  assert.equal(calls.run.length, 1);
  assert.notEqual(view.pendingNote, null, "still waiting for Fizzy");
});

test("a toast whose panel was hidden with Fizzy already the active page: showing the panel opens the card", async () => {
  const { view, cx } = await mount();
  state.layout = HIDDEN();
  acct.notifications.push(note("p4", { created_at: minutesAgo(0) }));
  await pollNow(cx);
  await tickRequest(cx);
  assert.equal(acct.asked("card", "show").length, 0, "still hidden: nothing yet");
  assert.deepEqual(calls.run, []);
  state.layout = LAYOUT; // layout.show ran
  await tickRequest(cx);
  assert.deepEqual(acct.asked("card", "show", "101"), [["card", "show", "101"]]);
  assert.deepEqual(acct.writes(), [["notification", "read", "p4"]]);
  assert.deepEqual(calls.run, [], "it was shown already");
  assert.equal(view.pendingNote, null);
});

test("a toast that was not clicked within a minute is forgotten: nothing opens when Fizzy shows later", async () => {
  const { view, cx } = await mount();
  state.layout = ELSEWHERE();
  acct.notifications.push(note("old1", { created_at: minutesAgo(0) }));
  await pollNow(cx);
  assert.notEqual(view.pendingNote, null);
  state.layout = LAYOUT;
  const real = Date.now;
  Date.now = () => real() + 61_000;
  try { await tickRequest(cx); } finally { Date.now = real; }
  assert.equal(view.pendingNote, null);
  assert.equal(acct.asked("card", "show").length, 0);
  assert.deepEqual(acct.writes(), []);
  assert.deepEqual(calls.run, []);
});

test("open:<number>:<id> (a toast's click while Fizzy shows) opens the card and reads that notification; open:<number> alone reads nothing", async () => {
  const { view, cx, draw } = await mount();
  await draw();
  await press(cx, "open:102");
  assert.equal(view.detail.number, 102);
  assert.deepEqual(acct.writes(), [], "a plain open reads nothing");
  await press(cx, "open:101:n1");
  assert.equal(view.detail.number, 101);
  assert.deepEqual(acct.writes(), [["notification", "read", "n1"]]);
  assert.equal(state.shared["fizzy.unread"], 1, "and the count follows");
  await press(cx, "open:101:n1");
  assert.equal(acct.writes().length, 2, "asked once more: Fizzy decides (the note was not loaded in the Inbox)");
  // The id may follow a space; a number that fits nothing opens nothing, whatever the id.
  await press(cx, "open:0:n2");
  await press(cx, "open:abc:n2");
  assert.equal(acct.writes().length, 2);
  assert.equal(view.detail.number, 101);
  // It also ends the wait of a toast that was posted earlier.
  state.layout = ELSEWHERE();
  acct.notifications.push(note("w1", { created_at: minutesAgo(0) }));
  await pollNow(cx);
  assert.notEqual(view.pendingNote, null);
  await press(cx, "open:101:w1");
  assert.equal(view.pendingNote, null);
});

test("a notification opened from a toast goes through the Inbox's own copy when the Inbox is loaded: it leaves the list; one the Inbox does not hold is left to Fizzy", async () => {
  acct.notifications = [note("u1", { created_at: minutesAgo(5) }), note("r1", { read: true, created_at: minutesAgo(30) })];
  const { cx, draw } = await mount();
  click(await draw(), "fizzy-view-inbox", cx);
  assert.deepEqual(noteIds(await draw()), ["u1"], "r1 is read: not listed");
  await press(cx, "open:101:u1");
  assert.deepEqual(acct.writes(), [["notification", "read", "u1"]]);
  assert.equal(state.shared["fizzy.unread"], 0);
  assert.ok(find(await draw(), "fizzy-detail"), "the card is open");
  await press(cx, "back");
  assert.deepEqual(noteIds(await draw()), [], "back in the Inbox: u1 has left it");
  assert.equal(acct.writes().length, 1, "and still one write");
  await press(cx, "open:101:r1");
  assert.equal(acct.writes().length, 2, "r1 is not in the Inbox: asked once more, Fizzy decides");
});

test("menu:<number> for a card no list holds reads it first, then opens its menu", async () => {
  const { cx, draw } = await mount();
  await draw();
  assert.equal(rowIds(await draw()).includes(201), false, "card 201 is on another board");
  await press(cx, "menu:201");
  assert.deepEqual(acct.asked("card", "show", "201"), [["card", "show", "201"]]);
  assert.equal(calls.openOverlay.length, 1);
  assert.equal(lastPopup().props.menu.kind, "card");
  assert.equal(lastPopup().props.menu.card.number, 201);
  assert.equal(lastPopup().props.menu.card.url, "https://app.fizzy.do/111/cards/201", "the card was read: its link is there");
  assert.deepEqual(lastPopup().props.menu.columns.map(c => c.id), ["not-now", "maybe", "done"], "its own board's lanes");
});

test("a draw of the Inbox with notes, toasts and a wait pending acts on nothing", async () => {
  acct.notifications = [note("u1"), note("r1", { read: true })];
  const { view, cx, draw } = await mount();
  click(await draw(), "fizzy-view-inbox", cx);
  await draw();
  state.layout = ELSEWHERE();
  acct.notifications.push(note("g1", { created_at: minutesAgo(0) }));
  await pollNow(cx);
  state.layout = LAYOUT;
  const seen = () => [calls.run.length, calls.notify.length, acct.log.length, cx.clipboard.length];
  const was = seen();
  drawn(view, cx, { quiet: true }); // throws when the draw notifies, runs, writes or asks
  await cx.settle();
  assert.deepEqual(seen(), was);
  assert.notEqual(view.pendingNote, null, "the timer's work, not the draw's");
});

test("a note marked read in the panel is seen: when it turns up unread again, the next poll does not toast it as new", async () => {
  acct.notifications = [note("u1", { created_at: minutesAgo(5) })];
  const { cx, draw } = await mount();
  assert.deepEqual(JSON.parse(localStorage.getItem("seenNotes")), ["u1"], "the first poll learned the unread one");
  acct.notifications.push(note("u2", { created_at: minutesAgo(0.5) })); // arrived since: no poll has seen it
  click(await draw(), "fizzy-view-inbox", cx);
  assert.deepEqual(noteIds(await draw()), ["u2", "u1"], "opening the Inbox is the unread poll: it fills the list");
  assert.deepEqual(toasts().map(n => n.title), ["Note u2"], "and announces what it has not seen");
  click(await draw(), "fizzy-note-u2", cx);
  await cx.settle();
  assert.deepEqual(acct.writes(), [["notification", "read", "u2"]]);
  assert.deepEqual(JSON.parse(localStorage.getItem("seenNotes")), ["u1", "u2"], "touched: seen, and kept");
  // Unread again from elsewhere (the web app, say): a poll says nothing about it; a note that is really new still gets its toast.
  acct.notifications.find(n => n.id === "u2").read = false;
  acct.notifications.push(note("fresh", { created_at: minutesAgo(0) }));
  const announced = toasts().length;
  await pollNow(cx);
  assert.deepEqual(toasts().slice(announced).map(n => n.title), ["Note fresh"], "only the untouched one");
});

test("a note marked read is kept in the seen ids at the cap: the newest last, the oldest dropped", async () => {
  localStorage.setItem("seenNotes", JSON.stringify(Array.from({ length: 300 }, (_, i) => `x${i}`)));
  acct.notifications = [];
  const { cx, draw } = await mount();
  acct.notifications.push(note("u1", { created_at: minutesAgo(0.5) })); // arrived since the last poll
  click(await draw(), "fizzy-view-inbox", cx);
  click(await draw(), "fizzy-note-u1", cx);
  await cx.settle();
  const seen = JSON.parse(localStorage.getItem("seenNotes"));
  assert.equal(seen.length, 300);
  assert.deepEqual([seen[0], seen.at(-1)], ["x1", "u1"]);
  acct.notifications[0].read = false;
  const announced = toasts().length;
  await pollNow(cx);
  assert.equal(toasts().length, announced, "u1 is unread again and seen: no toast");
});

test("Mark all read adds the notes it read to the seen ids, so one that turns up unread again is no news", async () => {
  acct.notifications = [note("u1", { created_at: minutesAgo(5) })];
  const { cx, draw } = await mount();
  assert.deepEqual(JSON.parse(localStorage.getItem("seenNotes")), ["u1"]);
  acct.notifications.push(note("u2", { created_at: minutesAgo(0.5) })); // arrived since: no poll has seen it
  click(await draw(), "fizzy-view-inbox", cx);
  click(await draw(), "fizzy-read-all", cx);
  await cx.settle();
  assert.deepEqual(acct.writes().at(-1), ["notification", "read-all"]);
  assert.deepEqual(JSON.parse(localStorage.getItem("seenNotes")).sort(), ["u1", "u2"], "every note of the Inbox is seen");
  // Unread again from elsewhere (the web app, say): the notes read here are still no news.
  acct.notifications.find(n => n.id === "u2").read = false;
  const announced = toasts().length;
  await pollNow(cx);
  assert.equal(toasts().length, announced);
});

test("a toast with no card, or one that opens at once, does not clear the wait of an earlier toast that brought the panel up", async () => {
  const { view, cx, draw } = await mount();
  state.layout = ELSEWHERE();
  // One poll: the older note has a card (its click has to bring the panel up), the newer has none (no action).
  acct.notifications.push(
    note("p1", { created_at: minutesAgo(2), card: { number: 102, title: "Write the changelog", board_name: "Roadmap" } }),
    note("bare", { title: "No card here", body: "", card: null, created_at: minutesAgo(0) }),
  );
  await pollNow(cx);
  assert.deepEqual(toasts().map(n => [n.title, n.action?.name]), [["Note p1", "layout.select"], ["No card here", undefined]]);
  assert.equal(view.pendingNote?.id, "p1", "the card-less toast left the wait alone");
  // The first toast was clicked: the Fizzy page is in front, and the card opens and its notification is read.
  state.layout = LAYOUT;
  await tickRequest(cx);
  assert.deepEqual(acct.asked("card", "show", "102"), [["card", "show", "102"]]);
  assert.deepEqual(acct.writes(), [["notification", "read", "p1"]]);
  assert.equal(view.detail.number, 102);
  assert.equal(view.pendingNote, null);
  assert.ok(find(await draw(), "fizzy-detail"));
});

test("a toast that opens at once (Fizzy showing) leaves the wait of an earlier toast too; the newest toast that brings the panel up wins", async () => {
  const { view, cx } = await mount();
  state.layout = ELSEWHERE();
  acct.notifications.push(note("p1", { created_at: minutesAgo(1) }));
  await pollNow(cx);
  assert.equal(view.pendingNote?.id, "p1");
  // The next poll finds Fizzy showing (not clicked, the person went there): its toast opens in place, p1 is still waited for.
  state.layout = LAYOUT;
  acct.notifications.push(note("p2", { created_at: minutesAgo(0.5), card: { number: 103, board_name: "Roadmap", title: "Third" } }));
  await pollNow(cx);
  assert.equal(toasts().at(-1).action.name, "fizzy.open:103:p2");
  assert.equal(view.pendingNote?.id, "p1", "not cleared by a toast that opens at once");
  // Another page again, a newer toast that has to bring the panel up replaces it.
  state.layout = ELSEWHERE();
  acct.notifications.push(note("p3", { created_at: minutesAgo(0) }));
  await pollNow(cx);
  assert.equal(view.pendingNote?.id, "p3");
});

const pick = async (cx, draw, ...numbers) => {
  for (const n of numbers) click(await draw(), `fizzy-card-${n}`, cx, { modifiers: { platform: true } });
  return draw();
};
// Two agents: t1 is the one in focus ("fix login"), t2 is another ("docs").
const twoAgents = () => {
  state.agents = [AGENT("t1"), AGENT("t2", { tab_name: "docs", status: "working" })];
  state.focused = { space: "s1", tab: "s1-tab", pane: "p-t1", terminal: "t1", shown: null, agent: null, cwd: null };
};

test("the bar of hand-offs sits at the panel's foot in the card view and under a list with cards picked: what it is for between two rules, then exactly four round buttons; otherwise the list's own bar is there (none in the Inbox)", async () => {
  withAgent();
  installed(CLAUDE);
  const { cx, draw } = await mount();
  const hasBar = tree => {
    for (const id of ACTIONS) must(tree, id);
    const bar = must(tree, "fizzy-bar"), panel = must(tree, "fizzy");
    assert.equal(panel.kids.at(-1), bar, "the last thing in the panel: under the list or the card");
    assert.deepEqual([bar.style.bg, bar.style.border_t, bar.style.px, bar.style.gap], [undefined, undefined, 12, 6], "the list bar's look: no strip of its own");
    assert.equal(bar.kids[0].id, "fizzy-bar-label");
    assert.deepEqual(bar.kids[1].kids.map(k => k.id), ACTIONS, "four buttons, in this order, in one line");
    for (const id of ACTIONS) assert.deepEqual([must(tree, id).style.rounded_full, must(tree, id).style.border_1, must(tree, id).style.h], [true, true, 30], id);
    assert.equal(textOf(bar), "HAND THIS CARD TO AN AGENT Insert Send Start Copy", "what it is for, then the four labels");
    assert.deepEqual(ids(bar), ["fizzy-bar", "fizzy-bar-label", ...ACTIONS], "and no other element a person could press");
  };
  let tree = await draw();
  assert.ok(find(tree, "fizzy-insert-101") && find(tree, "fizzy-more-101"), "the rows keep their quick buttons");
  for (const [id, foot] of [["fizzy-view-mine", "fizzy-list-bar"], ["fizzy-view-inbox", "fizzy-list"], ["fizzy-view-pins", "fizzy-list-bar"], ["fizzy-home", "fizzy-list-bar"]]) {
    click(tree, id, cx);
    tree = await draw();
    assert.equal(find(tree, "fizzy-bar"), null, `${id}: nothing picked, no hand-offs`);
    assert.equal(must(tree, "fizzy").kids.at(-1).id, foot, `${id}: the panel ends with ${foot}`);
  }
  tree = await pick(cx, draw, 101);
  hasBar(tree);
  tree = await pick(cx, draw, 101);
  assert.equal(find(tree, "fizzy-bar"), null, "unpicked: gone again");
  click(tree, "fizzy-view-mine", cx);
  hasBar(await pick(cx, draw, 101));
  click(await draw(), "fizzy-card-101", cx);
  tree = await draw();
  assert.ok(find(tree, "fizzy-detail"));
  hasBar(tree);
  assert.ok(find(tree, "fizzy-act-open") && find(tree, "fizzy-card-menu"), "the card's link and menu stay in its header");
});

test("with nothing open or picked there is no bar of hand-offs; a picked card brings it, every button awake and saying what it does; an open card wins over the picked ones, which stay picked", async () => {
  withAgent();
  installed(CLAUDE);
  const { cx, draw } = await mount();
  let tree = await draw();
  click(tree, "fizzy-view-mine", cx);
  tree = await draw();
  assert.equal(find(tree, "fizzy-bar"), null, "nothing to act on: no bar");
  click(tree, "fizzy-home", cx);
  tree = await pick(cx, draw, 101);
  assert.equal(textOf(must(tree, "fizzy-bar")), "HAND THIS CARD TO AN AGENT Insert Send Start Copy");
  assert.deepEqual(ACTIONS.map(id => tipOf(tree, id)),
    ["Paste into the chat in view, or drag into a terminal", "Paste into a running session", "Start a new agent session with it", "Copy the reference"]);
  for (const id of ACTIONS) {
    const b = must(tree, id);
    assert.deepEqual(Object.keys(b.handlers).sort(), ["on_click", "on_mouse_down:left"], `${id}: it clicks and does not pass the press on`);
    assert.equal(b.hover, true, `${id}: hover`);
    assert.equal(b.style.cursor_pointer, true);
    assert.equal(b.style.text_color, "foreground");
  }

  // The open card is what the buttons act on, whatever is picked.
  tree = await pick(cx, draw, 103);
  assert.match(textOf(must(tree, "fizzy-bar")), /^HAND 2 CARDS TO AN AGENT/);
  const both = 'Fizzy #101 "Fix the login redirect" (https://app.fizzy.do/111/cards/101)\nFizzy #103 "Triage me" (https://app.fizzy.do/111/cards/103)';
  const clicker = makeCx();
  click(tree, "fizzy-bar-copy", clicker);
  assert.equal(clicker.clipboard.at(-1), both);
  click(tree, "fizzy-card-102", cx);
  tree = await draw();
  assert.ok(find(tree, "fizzy-detail"));
  click(tree, "fizzy-bar-copy", clicker);
  assert.equal(clicker.clipboard.at(-1), 'Fizzy #102 "Write the changelog" (https://app.fizzy.do/111/cards/102)', "the open card, not the two picked");
  click(tree, "fizzy-back", cx);
  tree = await draw();
  click(tree, "fizzy-bar-copy", clicker);
  assert.equal(clicker.clipboard.at(-1), both, "the picked cards are still picked");
});

test("a card opened by its number has the bar on at once (it is the open card); the references wait for the card to be read", async () => {
  const { view, cx, draw } = await mount();
  await draw();
  let release;
  acct.hold = new Promise(resolve => { release = resolve; });
  sendCommand("open:105");
  await tick();
  const tree = drawn(view, cx);
  for (const id of ACTIONS) assert.ok(!isOff(tree, id), `${id} is on`);
  const clicker = makeCx();
  click(tree, "fizzy-bar-copy", clicker);
  assert.deepEqual(clicker.clipboard, [], "no title and link yet: nothing is copied from the stub");
  release();
  await cx.settle();
  await clicker.settle();
  acct.hold = null;
  assert.deepEqual(clicker.clipboard, ['Fizzy #105 "Shipped thing" (https://app.fizzy.do/111/cards/105)']);
});

test("Insert pastes into the current chat, not into a chosen one: the bar's Insert, the row's ↵, the card menu's Insert and the key all go to the agent in view; the old clipboard comes back", async () => {
  twoAgents();
  state.focused = { space: "s1", tab: "s1-tab", pane: "p-t2", terminal: "t2", shown: null, agent: null, cwd: null };
  const { cx, draw } = await mount();
  let tree = await pick(cx, draw, 101);
  const clicker = makeCx();
  clicker.clipboardText = "mine";
  click(tree, "fizzy-bar-insert", clicker);
  assert.deepEqual(clicker.clipboard, [`${REF_101} `]);
  assert.deepEqual(calls.run, [["pane.focus", { pane: "p-t2" }], ["terminal.paste", undefined]], "the focused agent's pane, no Enter");
  assert.deepEqual(calls.hc, [], "pasted, not sent");
  assert.equal(calls.openOverlay.length, 0, "no dropdown, no target to choose");
  clicker.timers.find(t => t.after && t.ms === 500).fn(clicker);
  assert.equal(clicker.clipboardText, "mine", "the person's clipboard is back");
  calls.run.length = 0;
  click(tree, "fizzy-insert-102", clicker);
  assert.deepEqual(calls.run[0], ["pane.focus", { pane: "p-t2" }]);
  calls.run.length = 0;
  fire(must(tree, "fizzy-more-101"), "on_click", {}, cx);
  await cx.settle();
  assert.equal(lastPopup().props.menu.to, "Claude Code · docs", "the card menu says where its Insert goes");
  const popup = await mountPopup();
  assert.match(textOf(must(popup.tree(), "fizzy-menu-insert")), /Insert in chat\s+Claude Code · docs/);
  menuClick(popup, "insert");
  await draw();
  assert.deepEqual(calls.run[0], ["pane.focus", { pane: "p-t2" }]);
  calls.run.length = 0;
  await press(cx, "insert");
  assert.deepEqual(calls.run, [["pane.focus", { pane: "p-t2" }], ["terminal.paste", undefined]]);
  // The focus moves, so does Insert.
  state.focused = { space: "s1", tab: "s1-tab", pane: "p-t1", terminal: "t1", shown: null, agent: null, cwd: null };
  calls.run.length = 0;
  click(tree, "fizzy-bar-insert", clicker);
  assert.deepEqual(calls.run[0], ["pane.focus", { pane: "p-t1" }]);
});

test("Insert with no agent in view copies the reference (no trailing space) and says so; nothing is pasted, and no menu opens", async () => {
  const { cx, draw } = await mount();
  const tree = await pick(cx, draw, 101);
  const clicker = makeCx();
  click(tree, "fizzy-bar-insert", clicker);
  assert.deepEqual(clicker.clipboard, [REF_101], "copied, without the trailing space of a paste");
  assert.deepEqual(calls.run, [], "nothing pasted");
  assert.equal(calls.notify.at(-1).body, COPIED_NO_AGENT);
  assert.equal(calls.openOverlay.length, 0);
  // Agents run, but none is in this tab: the same.
  state.agents = [AGENT("t9", { tab: "other" })];
  state.focused = { space: "s1", tab: "s1-tab", pane: null, terminal: "shell", shown: null, agent: null, cwd: null };
  click(await draw(), "fizzy-bar-insert", clicker);
  assert.deepEqual(calls.run, []);
  assert.equal(clicker.clipboard.length, 2);
  assert.ok(!isOff(await draw(), "fizzy-bar-send"), "Send is still there to pick that session");
});

test("Send opens the running sessions (the one in view first); choosing one brings it to focus and pastes the reference into it, and nothing is submitted", async () => {
  twoAgents();
  const { cx, draw } = await mount();
  let tree = await pick(cx, draw, 101, 103);
  click(tree, "fizzy-bar-send", cx);
  assert.deepEqual([lastPopup().kind, lastPopup().props.menu.kind, lastPopup().props.menu.cards.map(c => c.number)], ["popup", "agents", [101, 103]]);
  assert.deepEqual(calls.run, [], "nothing happens before a session is chosen");
  const popup = await mountPopup();
  assert.deepEqual(ids(popup.tree()).filter(i => i.startsWith("fizzy-menu-") && i !== "fizzy-menu-list"), ["fizzy-menu-agent-t1", "fizzy-menu-agent-t2"]);
  assert.match(textOf(must(popup.tree(), "fizzy-menu-agent-t2")), /Claude Code · docs\s+work · working/);
  assert.ok(all(must(popup.tree(), "fizzy-menu-agent-t2"), n => n.kind === "image" && n.path === "icons/claude.svg").length === 1, "its program icon");
  menuClick(popup, "agent-t2");
  assert.deepEqual(calls.closeOverlay, ["ov-popup"]);
  tree = await draw();
  const both = 'Fizzy #101 "Fix the login redirect" (https://app.fizzy.do/111/cards/101)\nFizzy #103 "Triage me" (https://app.fizzy.do/111/cards/103)';
  assert.deepEqual(calls.run, [["space.select", { id: "s1" }], ["tab.select", { id: "s1-tab" }], ["pane.focus", { pane: "p-t2" }], ["terminal.paste", undefined]]);
  assert.equal(cx.clipboard.at(-1), `${both} `, "both references, a line each, then a space: no Enter");
  assert.deepEqual(calls.hc, [], "no hc send, ever");
  assert.ok(tree);
  // The key does the same: it opens the same popup.
  await press(cx, "send");
  assert.deepEqual([lastPopup().props.menu.kind, lastPopup().props.menu.cards.map(c => c.number)], ["agents", [101, 103]]);
});

test("Send with no agent running opens its popup, which says so; nothing is dim, nothing is sent", async () => {
  const { cx, draw } = await mount();
  const tree = await pick(cx, draw, 101);
  assert.ok(!isOff(tree, "fizzy-bar-send"));
  click(tree, "fizzy-bar-send", cx);
  assert.equal(lastPopup().props.menu.kind, "agents");
  const popup = await mountPopup();
  assert.match(textOf(popup.tree()), /No agents running/);
  assert.deepEqual(ids(popup.tree()).filter(i => i.startsWith("fizzy-menu-agent-")), []);
  assert.deepEqual([calls.run, calls.hc], [[], []]);
});

test("Start opens the start popup: the installed agents of the active space's machine, whether they are known yet or not", async () => {
  installed(CLAUDE, CODEX);
  const { cx, draw } = await mount();
  let tree = await pick(cx, draw, 101);
  assert.equal(textOf(must(tree, "fizzy-bar-start")), "Start");
  click(tree, "fizzy-bar-start", cx);
  assert.deepEqual([lastPopup().kind, lastPopup().props.menu.kind, lastPopup().props.menu.cards.map(c => c.number)], ["popup", "start", [101]]);
  assert.deepEqual(calls.run, [], "nothing starts before an agent is chosen");
  const popup = await mountPopup();
  assert.deepEqual(ids(popup.tree()).filter(i => i.startsWith("fizzy-menu-agent-")), ["fizzy-menu-agent-0", "fizzy-menu-agent-1"]);
  assert.deepEqual(calls.knownAgents, [{ on: null }], "only the popup asks");
  menuClick(popup, "agent-0");
  await draw();
  assert.deepEqual(calls.run, [["tab.new", { name: "#101 Fix the login redirect", argv: ["claude"] }]], "a new tab with that agent, no task");
  // The agents could not be read (and none were kept): the popup says so; with none installed it says that.
  state.shared["new-menu.agents"] = {};
  state.knownAgents = async () => { throw new Error("no answer"); };
  click(await draw(), "fizzy-bar-start", cx);
  assert.match(textOf((await mountPopup()).tree()), /Could not load agents/);
  installed();
  click(await draw(), "fizzy-bar-start", cx);
  assert.match(textOf((await mountPopup()).tree()), /No agents found/);
  assert.ok(!isOff(await draw(), "fizzy-bar-start"), "the button itself is never dim for that");
});

test("the bar does not read the installed agents: only a Start popup does, from the active space's machine, and it keeps the answer", async () => {
  state.shared["new-menu.agents"] = { "": [CODEX] };
  state.spaces = [space("s2", "remote", { active: true, folder: "/home/dev/work", machine: "devbox" })];
  state.knownAgents = async () => [CLAUDE];
  const { cx, draw } = await mount();
  const tree = await pick(cx, draw, 101);
  assert.deepEqual(calls.knownAgents, [], "a panel, a draw and a selection read nothing");
  assert.equal(textOf(must(tree, "fizzy-bar-start")), "Start");
  click(tree, "fizzy-bar-start", cx);
  const popup = await mountPopup();
  assert.deepEqual(calls.knownAgents, [{ on: "devbox" }]);
  assert.deepEqual(state.shared["new-menu.agents"].devbox.map(a => a.key), ["claude"], "kept for the next popup and for new-menu");
  assert.ok(popup);
});

test("Copy copies the reference of the card(s)", async () => {
  const { cx, draw } = await mount();
  let tree = await pick(cx, draw, 101, 102);
  const clicker = makeCx();
  click(tree, "fizzy-bar-copy", clicker);
  assert.equal(clicker.clipboard.at(-1), 'Fizzy #101 "Fix the login redirect" (https://app.fizzy.do/111/cards/101)\nFizzy #102 "Write the changelog" (https://app.fizzy.do/111/cards/102)');
  assert.equal(calls.notify.at(-1).body, "Copied");
});

// What a bar button is made of, left to right: an icon's name, the label's text.
const partsOf = (tree, id) => must(tree, id).kids.map(k => (k.kind === "svg" ? k.path.replace(/^mods\/fizzy\/|\.svg$/g, "") : textOf(k)));

test("the buttons have an icon and a label, Send and Start a chevron after it; below 340 px the icons go and the labels and chevrons stay, in one row at 280; the width is measured on the panel", async () => {
  const { cx, draw } = await mount();
  let tree = await pick(cx, draw, 101);
  assert.equal(typeof must(tree, "fizzy").handlers.on_size_change, "function", "measured on the panel's root");
  const wide = () => ({
    insert: partsOf(tree, "fizzy-bar-insert"), send: partsOf(tree, "fizzy-bar-send"), start: partsOf(tree, "fizzy-bar-start"), copy: partsOf(tree, "fizzy-bar-copy"),
  });
  assert.deepEqual(wide(), {
    insert: ["insert", "Insert"], send: ["send", "Send", "chevron-down"], start: ["bot", "Start", "chevron-down"], copy: ["copy", "Copy"],
  }, "wide: an icon, the label, and a chevron on the two that open a menu");
  for (const [id, size] of [["fizzy-bar-insert", 13], ["fizzy-bar-send", 13], ["fizzy-bar-start", 13], ["fizzy-bar-copy", 13]]) {
    assert.equal(must(tree, id).kids[0].style.size, size, `${id}: icon 13`);
  }
  assert.ok(must(tree, "fizzy-bar-send").kids.at(-1).style.size < 13, "the chevron is small");
  const before = cx.notified;
  fire(must(tree, "fizzy"), "on_size_change", { width: 339, height: 600 }, cx);
  assert.ok(cx.notified > before, "the panel draws again");
  tree = await draw();
  assert.deepEqual(wide(), { insert: ["Insert"], send: ["Send", "chevron-down"], start: ["Start", "chevron-down"], copy: ["Copy"] }, "narrow: no icons, the labels and chevrons stay");
  fire(must(tree, "fizzy"), "on_size_change", { width: 280, height: 600 }, cx);
  tree = await draw();
  assert.deepEqual(wide().send, ["Send", "chevron-down"]);
  const bar = must(tree, "fizzy-bar"), row = bar.kids[1];
  assert.deepEqual(row.kids.map(k => k.id), ACTIONS, "one row of four at 280, nothing second");
  assert.equal(row.style.flex_wrap, undefined, "it never wraps");
  for (const id of ACTIONS) {
    const b = must(tree, id);
    assert.deepEqual([b.style.flex_1, b.style.min_w, b.style.rounded_full, b.style.text_size, b.style.px, b.style.items_center, b.style.justify_center], [true, 0, true, textPx(12), 8, true, true], `${id}: shares the row, can shrink`);
    assert.equal(b.style.flex_none, undefined, `${id}: not a fixed size`);
    assert.equal(b.kids.find(k => k.kind !== "svg").style.truncate, true, `${id}: the label gives way last, by being cut`);
    assert.equal(b.style.overflow_hidden, true);
  }
  assert.ok(Object.keys(bar.style).every(k => typeof bar.style[k] !== "number" || k !== "w"), "the bar has no fixed width");
  const quiet = cx.notified;
  fire(must(tree, "fizzy"), "on_size_change", { width: 300, height: 600 }, cx);
  assert.equal(cx.notified, quiet, "no change, no redraw");
  fire(must(tree, "fizzy"), "on_size_change", { width: 340, height: 600 }, cx);
  tree = await draw();
  assert.deepEqual(wide().insert, ["insert", "Insert"], "340 and up: icons again");
});

test("narrow (under 340 px) the list bar keeps one line: the round filters keep their size, the field takes what is left", async () => {
  const { cx, draw } = await mount();
  let tree = await draw();
  fire(must(tree, "fizzy"), "on_size_change", { width: 280, height: 600 }, cx);
  tree = await draw();
  for (const id of ["fizzy-only-mine", "fizzy-only-golden", "fizzy-only-pinned"]) assert.deepEqual([must(tree, id).style.size, must(tree, id).style.flex_none], [30, true], id);
  assert.equal(must(tree, "fizzy-list-bar").style.flex_wrap, undefined, "it never wraps");
  assert.deepEqual([must(tree, "fizzy-filter").style.flex_1, must(tree, "fizzy-filter").style.min_w], [true, 0], "the filter takes what is left");
});

test("narrow, a click on each of the bar's buttons does what the wide one does", async () => {
  twoAgents();
  installed(CLAUDE);
  const { cx, draw } = await mount();
  let tree = await pick(cx, draw, 101);
  fire(must(tree, "fizzy"), "on_size_change", { width: 280, height: 600 }, cx);
  tree = await draw();
  const clicker = makeCx();
  click(tree, "fizzy-bar-copy", clicker);
  assert.equal(clicker.clipboard.at(-1), REF_101);
  click(tree, "fizzy-bar-insert", clicker);
  assert.equal(clicker.clipboard.at(-1), `${REF_101} `);
  click(tree, "fizzy-bar-send", clicker);
  assert.equal(lastPopup().props.menu.kind, "agents");
  click(tree, "fizzy-bar-start", clicker);
  assert.equal(lastPopup().props.menu.kind, "start");
  assert.deepEqual(calls.run.map(c => c[0]), ["pane.focus", "terminal.paste"]);
});

test("the key commands act like the bar's buttons: insert pastes into the chat in view, send and start open their popups, copy copies; none of them submits", async () => {
  twoAgents();
  installed(CLAUDE, CODEX);
  const { cx, draw } = await mount();
  await pick(cx, draw, 101);
  await press(cx, "insert");
  assert.deepEqual(calls.run, [["pane.focus", { pane: "p-t1" }], ["terminal.paste", undefined]]);
  await press(cx, "send");
  assert.equal(lastPopup().props.menu.kind, "agents");
  await press(cx, "start");
  assert.equal(lastPopup().props.menu.kind, "start");
  assert.equal(calls.openOverlay.length, 2);
  assert.deepEqual(calls.run.map(c => c[0]), ["pane.focus", "terminal.paste"], "neither started or sent anything");
  await press(cx, "copy");
  assert.equal(cx.clipboard.at(-1), REF_101);
  assert.deepEqual(calls.hc, []);
});

test("nothing is ever submitted: main.js has no hc import or call and never passes a task to tab.new", () => {
  const main = readFileSync(join(MOD_DIR, "main.js"), "utf8");
  assert.doesNotMatch(main, /import\s*\{[^}]*\bhc\b[^}]*\}\s*from\s*"herdr"/, "no hc import");
  assert.doesNotMatch(main, /\bhc\s*\(/, "no hc call");
  assert.doesNotMatch(main, /\[\s*"send"/, "no hc send argv");
  assert.doesNotMatch(main, /\btask\s*:/, "no task passed anywhere");
  const newTabs = [...main.matchAll(/run\(\s*"tab\.new"[^)]*\)/g)].map(m => m[0]);
  assert.ok(newTabs.length > 0, "the scan finds the tabs it starts");
  for (const call of newTabs) assert.doesNotMatch(call, /task/);
});

const PHOTO_DIR = `${state.appHome}/data/fizzy/avatars`;
// The file a seeded photo has (ids are made file-safe the way avatarBase does), and the image path a draw uses for it.
const seededFile = id => `${id.replace(/-/g, "_")}-20250115.png`;
const photoPath = id => `${AVATAR_DIR}/${seededFile(id)}`;
// Photos already cached from an earlier run, as the index in localStorage holds them (call it before mount()).
const seedPhotos = (ids, at = Date.now()) => localStorage.setItem("avatars", JSON.stringify(Object.fromEntries(ids.map(id => [id, { file: seededFile(id), at }]))));
const imagesIn = el => all(el, n => n.kind === "image" && n.path.startsWith(`${AVATAR_DIR}/`));
// The round initials circle(s) with these letters inside an element.
const circlesIn = (el, letters) => all(el, n => n.style?.rounded_full && n.kind === "div" && textOf(n) === letters);
const avatarSets = () => calls.setShared.filter(([k]) => k === "fizzy.avatars").map(([, v]) => v);
const daily = async cx => { timer(cx, AVATAR_EVERY).fn(cx); await cx.settle(); };
const triesFor = id => acct.photos.log.filter(l => l.url.includes(`/${id}.`)).length;
const ME_USER = () => ({ id: "u-me", name: "Ada", role: "owner", active: true, avatar_url: "https://example.com/u-me.png" });

test("a person is drawn as their cached photo (round, the size the initials had), or as their initials when there is none: card rows, the People line, comment authors", async () => {
  seedPhotos(["u-me"]);
  const { cx, draw } = await mount();
  let tree = await draw();
  const mine = imagesIn(must(tree, "fizzy-card-101"));
  assert.deepEqual(mine.map(n => [n.path, n.style.size, n.style.rounded_full, n.style.flex_none]), [[photoPath("u-me"), 20, true, true]], "the card's assignee: the photo, 20 px, round");
  assert.equal(circlesIn(must(tree, "fizzy-card-101"), "A").length, 0, "and not the initials besides");
  const bob = must(tree, "fizzy-card-102");
  assert.equal(imagesIn(bob).length, 0, "Bob has no photo yet");
  assert.deepEqual(circlesIn(bob, "B").map(n => [n.style.size, n.style.bg]), [[20, "ansi6"], [20, "ansi6"]], "who made it and who has it, both Bob: the initials circle, in the colour of hue 5 of the user id");
  // The card view: the people in the card's foot (26 px), comment authors and the composer (28 px).
  click(tree, "fizzy-card-101", cx);
  tree = await draw();
  const detail = must(tree, "fizzy-detail");
  assert.deepEqual(imagesIn(detail).map(n => [n.path, n.style.size]), [[photoPath("u-me"), 26], [photoPath("u-me"), 28], [photoPath("u-me"), 28]],
    "Ada in the card's foot, on Ada's comment, and beside the comment box");
  assert.deepEqual(circlesIn(detail, "B").map(n => n.style.size), [28, 28], "Bob, who made the card, in its foot, and on Bob's comment: the initials, 28 px");
  // The Inbox: the creator, 16 px, before the title.
  seedPhotos(["u-me", "u-bob"]);
  const second = await mount();
  click(await second.draw(), "fizzy-view-inbox", second.cx);
  tree = await second.draw();
  const line = must(tree, "fizzy-note-n1").kids[0];
  assert.deepEqual(line.kids.map(k => k.kind), ["div", "image", "div"], "the unread dot, the creator's photo, the title");
  assert.deepEqual([line.kids[1].path, line.kids[1].style.size, line.kids[1].style.rounded_full], [photoPath("u-bob"), 16, true]);
  assert.equal(textOf(line.kids[2]), "Fix the login redirect");
});

test("a person without a photo in the Inbox gets their initials, 16 px, in the same place", async () => {
  const { cx, draw } = await mount();
  click(await draw(), "fizzy-view-inbox", cx);
  const tree = await draw();
  const line = must(tree, "fizzy-note-n1").kids[0];
  assert.deepEqual(line.kids.map(k => k.kind), ["div", "div", "div"]);
  assert.deepEqual([textOf(line.kids[1]), line.kids[1].style.size, line.kids[1].style.rounded_full], ["B", 16, true]);
  assert.equal(imagesIn(tree).length, 0);
});

test("the people popup (Assign…) draws each person's photo, or their initials, before the name; the tick for an assigned person follows the name", async () => {
  seedPhotos(["u-me"]);
  const { cx, draw } = await mount();
  click(await draw(), "fizzy-card-101", cx);
  click(await draw(), "fizzy-people", cx);
  assert.equal(lastPopup().props.menu.kind, "users");
  assert.deepEqual(state.shared["fizzy.avatars"], { "u-me": photoPath("u-me") }, "the panel shares the paths with its popups");
  const popup = await mountPopup();
  const tree = popup.tree();
  const me = must(tree, "fizzy-menu-user-u-me"), bob = must(tree, "fizzy-menu-user-u-bob");
  assert.deepEqual([me.kids[0].kind, me.kids[0].path, me.kids[0].style.size, me.kids[0].style.rounded_full], ["image", photoPath("u-me"), 16, true]);
  assert.equal(textOf(me.kids[1]), "Ada");
  assert.equal(textOf(me.kids[2]), "you");
  assert.deepEqual([me.kids.at(-1).kind, me.kids.at(-1).path], ["svg", "mods/fizzy/check.svg"], "assigned: a tick after");
  assert.deepEqual([bob.kids[0].kind, textOf(bob.kids[0]), bob.kids[0].style.size, bob.kids[0].style.rounded_full], ["div", "B", 16, true], "no photo: the initials");
  assert.equal(bob.kids.length, 3, "not assigned: no tick");
  assert.equal(popup.cx.timers.length, 0, "a popup has no timer: it only reads");
  assert.deepEqual(acct.photos.log, [], "and fetches nothing");
});

test("a popup reads the photo paths from shared state only (it never fetches)", async () => {
  state.shared["fizzy.people"] = { users: [{ id: "u-me", name: "Ada" }, { id: "u-bob", name: "Bob" }], tags: [], me: "u-me" };
  state.shared["fizzy.avatars"] = { "u-bob": photoPath("u-bob") };
  const popup = await mountPopup({ props: { menu: { kind: "users", card: { number: 1, title: "t", url: "u", assignees: [] } } } });
  const tree = popup.tree();
  assert.equal(imagesIn(must(tree, "fizzy-menu-user-u-me")).length, 0);
  assert.deepEqual(imagesIn(must(tree, "fizzy-menu-user-u-bob")).map(n => n.path), [photoPath("u-bob")]);
  assert.deepEqual(acct.photos.log, []);
  assert.equal(calls.exec.length, 0, "no read, no script");
});

test("photos: the people are read once at start, and each user's photo is fetched once into the app's folder; nothing is fetched by a read or a draw", async () => {
  const { cx, draw } = await mount();
  await draw();
  assert.equal(acct.asked("user", "list").length, 1, "the list arrives at start");
  assert.deepEqual(acct.photos.log, [], "a draw and a read fetch nothing: the 300 ms timer does");
  await look(cx);
  const log = acct.photos.log;
  assert.deepEqual(log.map(l => l.url).sort(), acct.users.map(u => u.avatar_url).sort(), "one fetch per user, at the address the CLI gave");
  for (const l of log) {
    assert.equal(l.dir, PHOTO_DIR, "in the app's folder, from appHome()");
    const id = acct.users.find(u => u.avatar_url === l.url).id;
    assert.equal(l.base, avatarBase(id), "named <user id>-<day>");
  }
  const index = JSON.parse(localStorage.getItem("avatars"));
  assert.deepEqual(Object.keys(index).sort(), ["u-bob", "u-bot", "u-me", "u-off"]);
  for (const [id, p] of Object.entries(index)) assert.deepEqual([p.file, typeof p.at], [`${avatarBase(id)}.png`, "number"]);
  assert.equal(avatarSets().length, 1, "the shared map is set once for the whole batch");
  assert.deepEqual(avatarSets()[0], Object.fromEntries(Object.entries(index).map(([id, p]) => [id, `${AVATAR_DIR}/${p.file}`])));
  const tree = await draw();
  assert.deepEqual(imagesIn(must(tree, "fizzy-card-101")).map(n => n.path), [avatarSets()[0]["u-bob"], avatarSets()[0]["u-me"]], "now drawn from the file: who made it, who has it");
  assert.deepEqual(imagesIn(must(tree, "fizzy-card-102")).map(n => n.path), [avatarSets()[0]["u-bob"], avatarSets()[0]["u-bob"]]);
  // Nothing again: not on the next ticks, not when the people are read again (a day later), until a photo is a week old.
  await look(cx); await look(cx);
  await daily(cx);
  await look(cx);
  assert.equal(acct.photos.log.length, 4);
  assert.equal(avatarSets().length, 1, "no change, no set");
  assert.equal(calls.notify.filter(n => n.level === "error").length, 0);
});

test("the people are read once at start and shared: a card opened meanwhile does not read them again", async () => {
  let release;
  acct.hold = new Promise(resolve => { release = resolve; });
  const { cx } = await mount({ settle: false });
  assert.equal(acct.asked("user", "list").length, 1, "asked as the panel starts");
  sendCommand("open:101");
  await tick();
  assert.equal(acct.asked("user", "list").length, 1, "the card's read of the people joins the one in flight");
  release();
  await cx.settle();
  acct.hold = null;
  assert.equal(acct.asked("user", "list").length, 1);
  assert.deepEqual(state.shared["fizzy.people"].users.map(u => u.id), ["u-me", "u-bob", "u-bot", "u-off"]);
  assert.equal(acct.asked("tag", "list").length, 1, "the tags are still read when a card opens");
});

test("photos of people met in cards, notes, comments, Not Now, Mine and Pins are fetched too, even when the people list lacks them", async () => {
  const NEW = id => ({ id, name: `New ${id}`, role: "member", active: true, avatar_url: `https://example.com/${id}.jpg` });
  acct.cards.find(c => c.number === 103).assignees = [NEW("u-board")];
  acct.cards.find(c => c.number === 104).assignees = [NEW("u-notnow")];
  acct.cards.find(c => c.number === 201).assignees = [ME_USER(), NEW("u-mine")];
  acct.cards.find(c => c.number === 105).assignees = [NEW("u-pinned")];
  acct.pins = [acct.card(105)];
  acct.comments[101].push({ id: "cm9", body: { html: "<p>hi</p>", plain_text: "hi" }, creator: NEW("u-comment"), created_at: "2026-01-06T10:00:00Z" });
  acct.notifications[0].creator = NEW("u-note");
  const { cx, draw } = await mount();
  let tree = await draw();
  click(tree, "fizzy-section-not-now", cx);
  await draw();
  click(await draw(), "fizzy-card-101", cx);
  await draw();
  click(await draw(), "fizzy-back", cx);
  for (const view of ["mine", "pins", "inbox"]) { click(await draw(), `fizzy-view-${view}`, cx); await draw(); }
  await look(cx);
  const fetched = new Set(acct.photos.log.map(l => l.url.split("/").at(-1).replace(/\.\w+$/, "")));
  for (const id of ["u-board", "u-notnow", "u-mine", "u-pinned", "u-comment", "u-note", "u-me", "u-bob"]) assert.ok(fetched.has(id), `${id} was fetched`);
  assert.equal(acct.photos.log.length, new Set(acct.photos.log.map(l => l.url)).size, "each once, whatever number of places they were met in");
  assert.equal(avatarSets().length, 1);
});

test("at most four photos are fetched at once, each user once however often they are met, and the rest follow as those finish", async () => {
  for (let i = 0; i < 9; i++) acct.users.push({ id: `u-x${i}`, name: `Extra ${i}`, role: "member", active: true, avatar_url: `https://example.com/u-x${i}.png` });
  let release;
  acct.photos.hold = new Promise(resolve => { release = resolve; });
  const { cx } = await mount();
  lookTimer(cx).fn(cx);
  await tick();
  assert.equal(acct.photos.inflight, 4, "four at once");
  assert.equal(acct.photos.log.length, 4);
  lookTimer(cx).fn(cx);
  await tick();
  timer(cx, AVATAR_EVERY).fn(cx); // the people read again: the same users are met again meanwhile
  await tick();
  lookTimer(cx).fn(cx);
  await tick();
  assert.equal(acct.photos.log.length, 4, "still those four: the same users are not fetched a second time, and no fifth starts");
  assert.equal(avatarSets().length, 0, "nothing is shared before the batch ends");
  release();
  await cx.settle();
  assert.equal(acct.photos.log.length, 13);
  assert.equal(new Set(acct.photos.log.map(l => l.url)).size, 13, "each once");
  assert.equal(acct.photos.peak, 4, "never more than four at once");
  assert.equal(Object.keys(JSON.parse(localStorage.getItem("avatars"))).length, 13);
  assert.equal(avatarSets().length, 1, "one set for the batch, at its end");
  assert.equal(Object.keys(avatarSets()[0]).length, 13);
});

test("a photo older than a week is fetched again under a new name; one a day younger is left alone; the shared map follows", async () => {
  const clock = clockAt();
  try {
    const { cx, draw } = await mount();
    await look(cx);
    assert.equal(acct.photos.log.length, 4);
    const first = JSON.parse(localStorage.getItem("avatars"));
    clock.advance(AVATAR_TTL - 86400000);
    await daily(cx);
    await look(cx);
    assert.equal(acct.photos.log.length, 4, "six days: kept");
    clock.advance(86400000 + 1000);
    await daily(cx);
    await look(cx);
    assert.equal(acct.photos.log.length, 8, "past a week: each is fetched again");
    const second = JSON.parse(localStorage.getItem("avatars"));
    for (const id of Object.keys(first)) {
      assert.notEqual(second[id].file, first[id].file, `${id}: a new name, so Herdr's own image cache cannot show the old photo`);
      assert.equal(second[id].file, `${avatarBase(id, clock.at)}.png`);
    }
    assert.equal(avatarSets().length, 2, "set again, once");
    assert.equal(avatarSets()[1]["u-me"], `${AVATAR_DIR}/${second["u-me"].file}`);
    assert.deepEqual(imagesIn(must(await draw(), "fizzy-card-people-101")).map(n => n.path), [`${AVATAR_DIR}/${second["u-me"].file}`]);
  } finally { clock.restore(); }
});

test("an old photo is still drawn while its replacement is fetched, then the new one", async () => {
  seedPhotos(["u-me"], Date.now() - 8 * 86400000);
  let release;
  acct.photos.hold = new Promise(resolve => { release = resolve; });
  const { view, cx, draw } = await mount();
  await draw();
  lookTimer(cx).fn(cx);
  await tick();
  assert.ok(triesFor("u-me") === 1, "a week old: asked again");
  // (a plain draw: the fetch is held back, and draw() would wait for it)
  assert.deepEqual(imagesIn(must(drawn(view, cx), "fizzy-card-people-101")).map(n => n.path), [photoPath("u-me")], "the old one meanwhile");
  release();
  await cx.settle();
  assert.deepEqual(imagesIn(must(await draw(), "fizzy-card-people-101")).map(n => n.path), [`${AVATAR_DIR}/${avatarBase("u-me")}.png`]);
});

test("photos that are fresh enough are not fetched at all, and their paths are shared at start", async () => {
  seedPhotos(["u-me", "u-bob", "u-bot", "u-off"], Date.now() - 86400000);
  const { cx } = await mount();
  await look(cx);
  await daily(cx);
  await look(cx);
  assert.deepEqual(acct.photos.log, []);
  assert.equal(avatarSets().length, 1);
  assert.equal(Object.keys(avatarSets()[0]).length, 4);
});

test("a photo that fails is left alone for an hour (the initials stay, nobody is told), then tried again; a script that cannot start counts as a failure", async () => {
  const clock = clockAt();
  try {
    acct.photos.fail = url => url.includes("/u-bob.");
    const { cx, draw } = await mount();
    await look(cx);
    assert.equal(triesFor("u-bob"), 1);
    assert.deepEqual(Object.keys(JSON.parse(localStorage.getItem("avatars"))).sort(), ["u-bot", "u-me", "u-off"], "no entry for the one that failed");
    let tree = await draw();
    assert.equal(imagesIn(must(tree, "fizzy-card-102")).length, 0, "Bob keeps the initials");
    assert.equal(circlesIn(must(tree, "fizzy-card-people-102"), "B").length, 1);
    assert.equal(imagesIn(must(tree, "fizzy-card-people-101")).length, 1, "and the others have theirs");
    // Within the hour: the people are read again and the card lists too, and still no retry.
    clock.advance(AVATAR_BACKOFF - 1000);
    await daily(cx);
    timer(cx, POLL_VIEW).fn(cx);
    await look(cx);
    assert.equal(triesFor("u-bob"), 1, "left alone for an hour");
    // After it: tried again. The script cannot start this time.
    clock.advance(2000);
    acct.photos.fail = null; acct.photos.throws = true;
    await daily(cx);
    await look(cx);
    assert.equal(triesFor("u-bob"), 2, "an hour later");
    assert.equal(calls.notify.filter(n => n.level === "error").length, 0, "a failure is not told");
    clock.advance(AVATAR_BACKOFF - 1000);
    await daily(cx);
    await look(cx);
    assert.equal(triesFor("u-bob"), 2, "and again an hour of rest after that one");
    clock.advance(2000);
    acct.photos.throws = false;
    await daily(cx);
    await look(cx);
    assert.equal(triesFor("u-bob"), 3);
    assert.ok(JSON.parse(localStorage.getItem("avatars"))["u-bob"], "it worked this time");
    tree = await draw();
    assert.equal(imagesIn(must(tree, "fizzy-card-people-102")).length, 1);
  } finally { clock.restore(); }
});

test("a script that prints something else (or fails) is no photo: only a file name it should have made is taken", async () => {
  acct.photos.ext = "bmp";
  const { cx, draw } = await mount();
  await look(cx);
  assert.equal(acct.photos.log.length, 4);
  assert.equal(localStorage.getItem("avatars"), null, "a name that is not an image file is not kept");
  assert.equal(imagesIn(await draw()).length, 0);
  assert.equal(avatarSets().length, 0);
});

test("a damaged photo index is ignored: odd file names and non-numbers are dropped, text that is no JSON too, and nothing is drawn from them", async () => {
  localStorage.setItem("avatars", JSON.stringify({ "u-me": { file: "../../etc/passwd", at: Date.now() }, "u-bob": { file: seededFile("u-bob") }, "u-bot": "x", "u-off": null }));
  let { cx, draw } = await mount();
  assert.equal(imagesIn(await draw()).length, 0);
  assert.equal(avatarSets().length, 0);
  await look(cx);
  assert.equal(acct.photos.log.length, 4, "all four are fetched afresh");
  setup();
  localStorage.setItem("avatars", "not json{");
  ({ cx, draw } = await mount());
  assert.equal(imagesIn(await draw()).length, 0);
  localStorage.setItem("avatars", "[1,2]");
  ({ cx, draw } = await mount());
  assert.equal(imagesIn(await draw()).length, 0);
});

test("with no fizzy CLI (or no people) there are no photos and no error: the initials stay", async () => {
  acct.missing = true;
  const { cx, draw } = await mount();
  await look(cx);
  assert.deepEqual(acct.photos.log, []);
  assert.equal(imagesIn(await draw()).length, 0);
  assert.equal(calls.notify.filter(n => n.level === "error").length, 0, "the people's read for photos is quiet");
  assert.equal(state.shared["fizzy.avatars"], undefined);
});

// The read of the people at start failed (offline, signed out): nobody on a card has been met, so the next read of the people
// (a card opening, a card's menu) is the one that must hand them over for their photos, or they keep their initials until tomorrow.
const LONE = { id: "u-lone", name: "Lone", role: "member", active: true, avatar_url: "https://example.com/u-lone.png" };
function usersFailAtStart() {
  acct.users.push(LONE);
  let reads = 0;
  acct.fail = args => (args[0] === "user" && args[1] === "list" && reads++ === 0 ? failure("network", "offline") : undefined);
}

test("photos: when the read of the people at start failed, the next card that opens reads them again and their photos are fetched, also those on no card", async () => {
  usersFailAtStart();
  const { cx, draw } = await mount();
  click(await draw(), "fizzy-card-101", cx); // the card's own read of the people is the first to succeed
  await draw();
  assert.equal(acct.asked("user", "list").length, 2, "the failed read at start, then the card's");
  await look(cx);
  assert.ok(triesFor("u-lone") === 1, "the person on no card is fetched too");
  assert.deepEqual(acct.photos.log.map(l => l.url.split("/").at(-1).replace(/\.\w+$/, "")).sort(), ["u-bob", "u-bot", "u-lone", "u-me", "u-off"], "each user once");
  assert.equal(avatarSets().length, 1);
  assert.equal(state.shared["fizzy.avatars"]["u-lone"], `${AVATAR_DIR}/${avatarBase("u-lone")}.png`, "and the popups hear of it");
  assert.equal(calls.notify.filter(n => n.level === "error").length, 0);
});

test("photos: when the read of the people at start failed, a card's menu reads them again and hands them over for their photos too", async () => {
  usersFailAtStart();
  const { cx, draw } = await mount();
  assert.equal(triesFor("u-lone"), 0);
  fire(must(await draw(), "fizzy-card-101"), "on_mouse_down:right", {}, cx);
  await cx.settle();
  assert.equal(lastPopup().props.menu.kind, "card", "the card's menu opened");
  assert.equal(acct.asked("user", "list").length, 2, "the failed read at start, then the menu's");
  await look(cx);
  assert.equal(triesFor("u-lone"), 1);
  assert.ok(JSON.parse(localStorage.getItem("avatars"))["u-lone"]);
});

test("photos: a popup that has to read the people itself shows initials and fetches nothing (only the panel fetches)", async () => {
  state.shared["fizzy.people"] = { tags: [], me: "u-me" }; // the list is not there yet
  acct.users.push(LONE);
  const popup = await mountPopup({ props: { menu: { kind: "users", card: { number: 1, title: "t", url: "u", assignees: [] } } } });
  await popup.cx.settle();
  assert.equal(acct.asked("user", "list").length, 1, "the popup read them");
  assert.ok(must(popup.tree(), "fizzy-menu-user-u-lone"), "and lists them");
  assert.deepEqual(acct.photos.log, [], "no photo script");
  assert.equal(popup.cx.timers.length, 0);
});

test("avatar files are not mod assets: every image(...) the panel draws for a person is under data/fizzy/avatars, never a path of the mod", async () => {
  seedPhotos(["u-me"]);
  const { draw } = await mount();
  const tree = await draw();
  for (const n of all(tree, n => n.kind === "image")) assert.ok(n.path.startsWith(`${AVATAR_DIR}/`) || n.path.startsWith("icons/"), n.path);
  const main = readFileSync(join(MOD_DIR, "main.js"), "utf8");
  assert.doesNotMatch(main, /image\(\s*["'`]data\//, "no literal image path in the source");
});

const BOARD = boardRef(B1);
const BOARD_SUBJECT = { kind: "board", id: "b1", name: "Roadmap", url: B1.url };

test("on the Board view with nothing open or picked the insert and copy keys act on the board shown (there is no bar): insert pastes its reference, copy copies it, nothing is submitted", async () => {
  twoAgents();
  const { view, cx, draw } = await mount();
  const tree = await draw();
  assert.equal(BOARD, 'Fizzy board "Roadmap" (https://app.fizzy.do/111/boards/b1)');
  assert.equal(find(tree, "fizzy-bar"), null);
  assert.deepEqual(view.subject(), [BOARD_SUBJECT]);
  await press(cx, "insert");
  assert.deepEqual(cx.clipboard, [`${BOARD} `], "the reference and a space: no Enter");
  assert.deepEqual(calls.run, [["pane.focus", { pane: "p-t1" }], ["terminal.paste", undefined]], "pasted into the chat in view, nothing else");
  await press(cx, "copy");
  assert.equal(cx.clipboard.at(-1), BOARD);
  assert.equal(calls.notify.filter(n => n.body === "Copied").length, 1);
  assert.deepEqual(calls.hc, [], "nothing is sent");
  assert.equal(acct.asked("card", "show").length, 0, "a board needs no card read");
  assert.deepEqual(acct.writes(), [], "and nothing is written to Fizzy");
});

test("insert on the board with no agent in view copies the reference and says so, as it does for a card", async () => {
  const { cx, draw } = await mount();
  await draw();
  await press(cx, "insert");
  assert.deepEqual(cx.clipboard, [BOARD]);
  assert.equal(calls.notify.at(-1).body, COPIED_NO_AGENT);
  assert.deepEqual(calls.run, []);
});

test("send on the board opens the running sessions with the board's reference; choosing one brings it to focus and pastes it there, not submitted", async () => {
  twoAgents();
  const { cx, draw } = await mount();
  let tree = await draw();
  await press(cx, "send");
  assert.deepEqual([lastPopup().kind, lastPopup().props.menu.kind, lastPopup().props.menu.cards], ["popup", "agents", [BOARD_SUBJECT]]);
  assert.deepEqual(calls.run, [], "nothing happens before a session is chosen");
  const popup = await mountPopup();
  assert.deepEqual(menuRows(lastPopup().props.menu, { agents: state.agents, focused: state.focused }).map(r => r.act.paste.text), [BOARD, BOARD]);
  menuClick(popup, "agent-t2");
  tree = await draw();
  assert.deepEqual(requestOps(), [{ kind: "paste", address: "t2", text: BOARD }]);
  assert.deepEqual(calls.run, [["space.select", { id: "s1" }], ["tab.select", { id: "s1-tab" }], ["pane.focus", { pane: "p-t2" }], ["terminal.paste", undefined]]);
  assert.equal(cx.clipboard.at(-1), `${BOARD} `);
  assert.deepEqual(calls.hc, []);
  assert.ok(tree);
});

test("start on the board opens the agents to start; choosing one opens a new tab named after the board, and the board's reference is pasted into it once it is up, not submitted", async () => {
  twoAgents();
  installed(CLAUDE, CODEX);
  const { cx, draw } = await mount();
  await draw();
  await press(cx, "start");
  assert.deepEqual([lastPopup().props.menu.kind, lastPopup().props.menu.cards], ["start", [BOARD_SUBJECT]]);
  assert.deepEqual(calls.run, [], "nothing starts before an agent is chosen");
  const popup = await mountPopup();
  assert.deepEqual(menuRows(lastPopup().props.menu, { known: [CLAUDE, CODEX] }).map(r => r.act.start), [
    { name: "Roadmap", argv: ["claude"], text: BOARD, agent: "Claude Code" },
    { name: "Roadmap", argv: ["codex", "--flag"], text: BOARD, agent: "Codex" },
  ]);
  menuClick(popup, "agent-1");
  await draw();
  await look(cx);
  assert.deepEqual(calls.run, [["tab.new", { name: "Roadmap", argv: ["codex", "--flag"] }]], "a new tab named after the board, no first message");
  state.agents = [...state.agents, newAgent("t-new", { tab_name: "Roadmap", status: "idle" })];
  await look(cx);
  assert.deepEqual(calls.run.slice(1), [["space.select", { id: "s1" }], ["tab.select", { id: "tab-t-new" }], ["pane.focus", { pane: "p-t-new" }], ["terminal.paste", undefined]]);
  assert.equal(cx.clipboard.at(-1), `${BOARD} `, "pasted with a space, no Enter");
  assert.deepEqual(calls.hc, []);
});

test("a long board name makes a tab name of 32 characters at most, ellipsis last; the reference keeps the whole name, one line", async () => {
  twoAgents();
  installed(CODEX);
  const name = "Product launch\nplanning board for the second half of the year", original = B1.name;
  B1.name = name;
  try {
    const { cx, draw } = await mount();
    await draw();
    await press(cx, "start");
    const [start] = menuRows(lastPopup().props.menu, { known: [CODEX] });
    assert.equal(start.act.start.name, "Product launch planning board f…");
    assert.equal([...start.act.start.name].length, 32);
    assert.equal(start.act.start.text, `Fizzy board "Product launch planning board for the second half of the year" (${B1.url})`);
    assert.ok(!start.act.start.text.includes("\n"));
  } finally { B1.name = original; }
});

test("opening a card or picking cards switches the hand-offs to cards; closing it or unpicking returns the keys to the board", async () => {
  twoAgents();
  const { view, cx, draw } = await mount();
  const clicker = makeCx();
  let tree = await draw();
  assert.deepEqual(view.subject(), [BOARD_SUBJECT]);
  tree = await pick(cx, draw, 101);
  assert.deepEqual(view.subject().map(s => s.number), [101], "a picked card");
  click(tree, "fizzy-bar-copy", clicker);
  assert.equal(clicker.clipboard.at(-1), REF_101);
  click(tree, "fizzy-card-102", cx);
  tree = await draw();
  assert.deepEqual(view.subject().map(s => s.number), [102], "the open card wins over the picked one");
  click(tree, "fizzy-bar-copy", clicker);
  assert.equal(clicker.clipboard.at(-1), 'Fizzy #102 "Write the changelog" (https://app.fizzy.do/111/cards/102)');
  click(tree, "fizzy-back", cx);
  tree = await draw();
  assert.deepEqual(view.subject().map(s => s.number), [101], "back to the picked card");
  click(tree, "fizzy-card-101", cx, { modifiers: { platform: true } });
  tree = await draw();
  assert.deepEqual(view.subject(), [BOARD_SUBJECT], "unpicked: the board again");
  assert.equal(find(tree, "fizzy-bar"), null, "whose hand-offs are the keys'");
  await press(cx, "copy");
  assert.equal(cx.clipboard.at(-1), BOARD);
  // A card opened by its number (a stub) is the open card too, never the board.
  sendCommand("open:105");
  await tick();
  assert.deepEqual(view.subject().map(s => s.number), [105]);
  await cx.settle();
});

test("in Mine, the Inbox and Pins, with no card open or picked, there is nothing to hand off: no bar, and the keys do nothing", async () => {
  withAgent();
  installed(CLAUDE);
  const { view, cx, draw } = await mount();
  for (const name of ["mine", "inbox", "pins"]) {
    click(await draw(), `fizzy-view-${name}`, cx);
    const tree = await draw();
    assert.deepEqual(view.subject(), [], `${name}: no subject`);
    assert.equal(find(tree, "fizzy-bar"), null, `${name}: no bar`);
    await press(cx, "copy");
    await press(cx, "insert");
    assert.deepEqual([cx.clipboard, calls.run, calls.openOverlay], [[], [], []], `${name}: the keys do nothing`);
  }
  // A card picked in Mine wakes the bar for it.
  click(await draw(), "fizzy-view-mine", cx);
  const tree = await pick(cx, draw, 101);
  assert.deepEqual(view.subject().map(s => s.number), [101]);
  for (const id of ACTIONS) assert.ok(!isOff(tree, id), `${id} is awake for the picked card`);
});

test("with no board to show (none on the account) the Board view has nothing to hand off either: the keys do nothing", async () => {
  acct.boards.length = 0;
  const { view, cx, draw } = await mount();
  const tree = await draw();
  assert.deepEqual(view.subject(), []);
  assert.equal(find(tree, "fizzy-bar"), null);
  await press(cx, "copy");
  assert.deepEqual(cx.clipboard, []);
});

test("the keys insert, copy, send and start follow the same rule: the open card, else the picked cards, else the board shown (Board view)", async () => {
  twoAgents();
  installed(CLAUDE);
  const { view, cx, draw } = await mount();
  await draw();
  await press(cx, "copy");
  assert.equal(cx.clipboard.at(-1), BOARD);
  await press(cx, "insert");
  assert.equal(cx.clipboard.at(-1), `${BOARD} `);
  assert.deepEqual(calls.run.map(c => c[0]), ["pane.focus", "terminal.paste"]);
  await press(cx, "send");
  assert.deepEqual([lastPopup().props.menu.kind, lastPopup().props.menu.cards], ["agents", [BOARD_SUBJECT]]);
  await press(cx, "start");
  assert.deepEqual([lastPopup().props.menu.kind, lastPopup().props.menu.cards], ["start", [BOARD_SUBJECT]]);
  assert.equal(calls.openOverlay.length, 2);
  // Another board shown: that one.
  await press(cx, "board:Personal");
  await draw();
  assert.deepEqual(view.subject(), [{ kind: "board", id: "b2", name: "Personal", url: B2.url }]);
  await press(cx, "copy");
  assert.equal(cx.clipboard.at(-1), 'Fizzy board "Personal" (https://app.fizzy.do/111/boards/b2)');
  // With a card open the key is about the card.
  await press(cx, "open:201");
  await press(cx, "copy");
  assert.match(cx.clipboard.at(-1), /^Fizzy #201 /);
});

test("the card's ⋯ menu is unchanged by the board subject: its hand-off rows are the card's", async () => {
  twoAgents();
  const { cx, draw } = await mount();
  click(await draw(), "fizzy-more-101", cx);
  const spec = calls.openOverlay.findLast(s => s.props.menu.kind === "card");
  const rows = menuRows(spec.props.menu, { agents: state.agents, focused: state.focused });
  assert.deepEqual([rows[0].act, rows[3].act], [{ insert: REF_101 }, { copy: REF_101 }]);
  assert.deepEqual(rows.slice(0, 5).map(r => r.id), ["insert", "send", "start", "copy-ref", "copy-link"]);
});

const sampleBoards = () => { acct.boards = SAMPLE_BOARDS.map((name, i) => ({ id: `n${i + 1}`, name, url: `https://app.fizzy.do/111/boards/n${i + 1}` })); };
const boardId = name => `n${SAMPLE_BOARDS.indexOf(name) + 1}`;
const ALL_IDS = SAMPLE_BOARDS.map(boardId);
const TEAM_IDS = SAMPLE_BOARDS.filter(isTeamBoard).map(boardId), OTHER_IDS = SAMPLE_BOARDS.filter(n => !isTeamBoard(n)).map(boardId);
const isAcme = name => name.toLowerCase().includes("acme");
const TEAM = { id: "team", name: "Team", match: "[team]", hidden: false };
// The groups a test starts with, put in shared state as a saved config would be (nothing is saved by it).
const seedGroups = (config = { groups: [{ ...TEAM }], boards: {} }) => { state.shared["fizzy.boardGroups"] = config; };
const savedGroups = () => calls.setShared.filter(([k]) => k === "fizzy.boardGroups").map(([, v]) => v);
// A popup's list as the person sees it, top to bottom: a row by its id, a label as "# text", a separator as "-".
const listOf = tree => must(tree, "fizzy-menu-list").kids.map(k => (k.id ? k.id.slice("fizzy-menu-".length) : textOf(k).trim() ? `# ${textOf(k).trim()}` : "-"));
// What the panel shows once the gear has been clicked and Board groups picked from the list of settings.
async function settingsPage(m) {
  click(await m.draw(), "fizzy-open-settings", m.cx);
  click(await m.draw(), "fizzy-setting-groups", m.cx);
  return m.draw();
}
// Out of Settings from one of its pages: Back to the list of settings, then Back out of it.
async function leaveSettings(m) {
  click(await m.draw(), "fizzy-back", m.cx);
  click(await m.draw(), "fizzy-back", m.cx);
  return m.draw();
}
const iconsIn = (tree, id) => all(must(tree, id), n => n.kind === "svg").map(n => n.path);
const escapeIn = (tree, id, cx) => fire(all(must(tree, id), n => n.handlers.on_key_down)[0], "on_key_down", { key: "escape" }, cx);
const keptFolds = () => JSON.parse(localStorage.getItem("folds"));
const blockIds = tree => must(tree, "fizzy-settings-groups").kids.map(k => k.id).filter(id => (id?.startsWith("fizzy-group-") && id !== "fizzy-group-new-row") || id === "fizzy-nogroup");
const boardRowsIn = (tree, id) => all(must(tree, id), n => n.id?.startsWith("fizzy-board-row-")).map(n => n.id.slice("fizzy-board-row-".length));
const rowOf = id => `fizzy-board-row-${id}`;

test("the boards list puts the team boards under Team: the others first, then the group", async () => {
  sampleBoards();
  seedGroups();
  const m = await mount();
  click(await m.draw(), "fizzy-board", m.cx);
  const spec = lastPopup(), popup = await mountPopup(spec), tree = popup.tree();
  assert.ok(TEAM_IDS.length >= 2 && OTHER_IDS.length >= 2, "the sample has boards in the group and out of it");
  assert.deepEqual(listOf(tree), ["follow", "-", ...OTHER_IDS.map(i => `board-${i}`), "# Team", ...TEAM_IDS.map(i => `board-${i}`)]);
  assert.equal(textOf(must(tree, `fizzy-menu-board-${boardId("Borealis  survey [team]")}`)).trim(), "Borealis  survey [team]", "the name as it is, double space and all");
  // The popup keeps its explicit height: asked for as the rows are worked out, never over 560, and its column is as tall.
  assert.equal(spec.height, Math.min(560, menuHeight(rowsNow(spec.props.menu))));
  assert.equal(must(tree, "fizzy-menu").style.h, spec.height - FRAME);
  assert.deepEqual(acct.writes(), [], "nothing is saved or written by looking");
  assert.deepEqual(savedGroups(), [], "the groups are read, not saved again");
  // A board in the group is chosen as any other.
  menuClick(popup, `board-${boardId("Field notes [TEAM]")}`);
  assert.deepEqual([state.shared["fizzy.board"].follow, state.shared["fizzy.board"].board], [false, boardId("Field notes [TEAM]")]);
});

test("the boards list lists the board the panel shows even when it is hidden, with its group; the tick stays on it", async () => {
  sampleBoards();
  const tagged = boardId("Support rota [team]"), sibling = boardId("Field notes [TEAM]");
  const m = await mount();
  await press(m.cx, `board:${tagged}`);
  seedGroups({ groups: [{ ...TEAM, hidden: true }], boards: { [boardId("Roadmap")]: { hidden: true } } });
  click(await m.draw(), "fizzy-board", m.cx);
  const popup = await mountPopup(), tree = popup.tree();
  assert.deepEqual(listOf(tree), ["follow", "-", ...OTHER_IDS.filter(i => i !== boardId("Roadmap")).map(i => `board-${i}`), "# Team", `board-${tagged}`]);
  assert.ok(!listOf(tree).includes(`board-${sibling}`), "the rest of the hidden group is out");
  assert.ok(!listOf(tree).includes(`board-${boardId("Roadmap")}`), "so is a hidden board");
  assert.equal(all(must(tree, `fizzy-menu-board-${tagged}`), n => n.path === "mods/fizzy/check.svg").length, 1, "the current board is ticked");
});

test("with nothing saved there are no groups: the boards list has every board in the CLI's order and no labels, Settings only No group; looking saves nothing", async () => {
  sampleBoards();
  const m = await mount();
  click(await m.draw(), "fizzy-board", m.cx);
  const list = (await mountPopup()).tree();
  assert.deepEqual(listOf(list), ["follow", "-", ...ALL_IDS.map(i => `board-${i}`)]);
  const tree = await settingsPage(m);
  assert.deepEqual(blockIds(tree), ["fizzy-nogroup"]);
  assert.deepEqual(boardRowsIn(tree, "fizzy-nogroup"), ALL_IDS);
  assert.equal(textOf(must(tree, "fizzy-nogroup-count")).trim(), String(ALL_IDS.length));
  assert.equal(state.shared["fizzy.boardGroups"], undefined);
  assert.deepEqual(savedGroups(), []);
});

test("saved groups are used as they are and never replaced by the default: a refresh, the boards list and Settings leave them untouched", async () => {
  sampleBoards();
  const saved = { groups: [{ ...TEAM }, { id: "g-2", name: "Later", match: "", hidden: true }], boards: { [boardId("Garden")]: { group: "g-2" }, [boardId("Roadmap")]: { hidden: true } } };
  seedGroups(structuredClone(saved));
  const m = await mount();
  await press(m.cx, "refresh");
  click(await m.draw(), "fizzy-board", m.cx);
  const list = (await mountPopup()).tree();
  assert.deepEqual(listOf(list), ["follow", "-", ...OTHER_IDS.filter(i => i !== boardId("Garden") && i !== boardId("Roadmap")).map(i => `board-${i}`), "# Team", ...TEAM_IDS.map(i => `board-${i}`)]);
  const tree = await settingsPage(m);
  assert.deepEqual(blockIds(tree), ["fizzy-group-team", "fizzy-group-g-2", "fizzy-nogroup"]);
  assert.deepEqual(boardRowsIn(tree, "fizzy-group-g-2"), [boardId("Garden")]);
  assert.deepEqual(state.shared["fizzy.boardGroups"], saved);
  assert.deepEqual(savedGroups(), []);
});

test("the Fizzy bar ends with a gear (not the card view's header): it opens Settings, a page of its own with no views, filter or bar; looking saves nothing", async () => {
  const m = await mount();
  let tree = await m.draw();
  assert.ok(find(tree, "fizzy-list-bar") && find(tree, "fizzy-list") && find(tree, "fizzy-board"));
  for (const view of ["board", "mine", "inbox", "pins"]) {
    tree = view === "board" ? tree : (click(tree, `fizzy-view-${view}`, m.cx), await m.draw());
    const buttons = parentOf(tree, "fizzy-open-settings").kids;
    assert.equal(buttons.at(-1).id, "fizzy-open-settings", `${view}: the gear is the last button`);
    assert.deepEqual(buttons.map(k => k.id), ["fizzy-refresh", "fizzy-open-settings"]);
  }
  click(tree, "fizzy-home", m.cx);
  tree = await m.draw();
  assert.deepEqual(iconsIn(tree, "fizzy-open-settings"), ["mods/fizzy/settings.svg"], "a gear and no chevron");
  assert.equal(tipOf(tree, "fizzy-open-settings"), "Settings");
  assert.deepEqual([must(tree, "fizzy-open-settings").style.size, must(tree, "fizzy-open-settings").style.rounded_full], [30, true]);
  click(tree, "fizzy-card-101", m.cx);
  assert.equal(find(await m.draw(), "fizzy-open-settings"), null, "the card view's header does not have it");
  click(await m.draw(), "fizzy-back", m.cx);
  tree = await m.draw();
  click(tree, "fizzy-open-settings", m.cx);
  tree = await m.draw();
  assert.ok(find(tree, "fizzy-settings"), "the page");
  assert.deepEqual(requestOps(), [], "no popup took part");
  for (const id of ["fizzy-bar", "fizzy-list-bar", "fizzy-list", "fizzy-board-bar", "fizzy-view-mine", "fizzy-filter", "fizzy-home", "fizzy-board", "fizzy-only-mine", "fizzy-search-open", "fizzy-open-settings"]) {
    assert.equal(find(tree, id), null, `${id} is not on the page`);
  }
  assert.deepEqual(must(tree, "fizzy").kids.map(k => k.id ?? "header"), ["header", "fizzy-settings"], "a header and the page, nothing else");
  assert.equal(textOf(must(tree, "fizzy").kids[0]).trim(), "Settings");
  assert.deepEqual(iconsIn(tree, "fizzy-back"), ["mods/fizzy/arrow-left.svg"]);
  assert.equal(tipOf(tree, "fizzy-back"), "Back");
  assert.deepEqual(savedGroups(), [], "looking at it saves nothing");
  assert.deepEqual(acct.writes(), []);
});

test("with Settings open the keys insert, copy, send and start still act on the board shown, or on the cards picked; the bar is not drawn and nothing is sent", async () => {
  twoAgents();
  installed(CLAUDE, CODEX);
  const { view, cx, draw } = await mount();
  await press(cx, "settings");
  let tree = await draw();
  assert.ok(find(tree, "fizzy-settings"));
  assert.equal(find(tree, "fizzy-bar"), null, "the bar is not drawn");
  assert.deepEqual(view.subject(), [BOARD_SUBJECT], "nothing picked: the board the panel shows");
  const ran = calls.run.length, opened = calls.openOverlay.length;
  await press(cx, "copy");
  assert.equal(cx.clipboard.at(-1), BOARD);
  await press(cx, "insert");
  assert.equal(cx.clipboard.at(-1), `${BOARD} `);
  assert.deepEqual(calls.run.slice(ran), [["pane.focus", { pane: "p-t1" }], ["terminal.paste", undefined]], "pasted, no Enter");
  await press(cx, "send");
  assert.deepEqual([lastPopup().props.menu.kind, lastPopup().props.menu.cards], ["agents", [BOARD_SUBJECT]]);
  await press(cx, "start");
  assert.deepEqual([lastPopup().props.menu.kind, lastPopup().props.menu.cards], ["start", [BOARD_SUBJECT]]);
  assert.equal(calls.openOverlay.length, opened + 2);
  assert.ok(find(await draw(), "fizzy-settings"), "and Settings is still open");
  // Cards picked in the list are what the keys act on once Settings is open.
  await press(cx, "back");
  tree = await pick(cx, draw, 101);
  await press(cx, "settings");
  tree = await draw();
  assert.ok(find(tree, "fizzy-settings"), "opened again with a card picked");
  assert.deepEqual(view.subject().map(s => s.number), [101]);
  await press(cx, "copy");
  assert.equal(cx.clipboard.at(-1), REF_101);
  assert.deepEqual(calls.hc, [], "nothing is ever sent");
  assert.deepEqual(acct.writes(), []);
});

test("Settings opens with the key `settings`, from the list or a card, and leaves with Back, the `back` key, a view, a card or a new card", async () => {
  const m = await mount();
  let tree = await m.draw();
  await press(m.cx, "settings");
  tree = await m.draw();
  assert.ok(find(tree, "fizzy-settings"));
  click(tree, "fizzy-back", m.cx);
  tree = await m.draw();
  assert.equal(find(tree, "fizzy-settings"), null);
  assert.ok(find(tree, "fizzy-list") && find(tree, "fizzy-list-bar") && find(tree, "fizzy-board"), "the list as it was, with its bar and the board button");
  assert.deepEqual(rowIds(tree).sort(), [101, 102, 103], "the cards are still there");
  // From a setting's own page Back (the button or the key) returns to the list of settings first.
  tree = await settingsPage(m);
  assert.ok(find(tree, "fizzy-settings-groups"));
  click(tree, "fizzy-back", m.cx);
  tree = await m.draw();
  assert.deepEqual([Boolean(find(tree, "fizzy-setting-groups")), Boolean(find(tree, "fizzy-settings-groups"))], [true, false], "the list of settings");
  click(tree, "fizzy-setting-groups", m.cx);
  await m.draw();
  await press(m.cx, "back");
  assert.ok(find(await m.draw(), "fizzy-setting-groups"), "the key does the same");
  await press(m.cx, "back");
  assert.equal(find(await m.draw(), "fizzy-settings"), null, "and from the list it leaves");
  // The key `back`, from the page.
  await press(m.cx, "settings");
  assert.ok(find(await m.draw(), "fizzy-settings"));
  await press(m.cx, "back");
  assert.equal(find(await m.draw(), "fizzy-settings"), null);
  // From a card: the card goes and the page comes; Back returns to the list, not to the card.
  click(await m.draw(), "fizzy-card-101", m.cx);
  assert.ok(find(await m.draw(), "fizzy-title"), "a card is open");
  await press(m.cx, "settings");
  tree = await m.draw();
  assert.ok(find(tree, "fizzy-settings"));
  assert.equal(find(tree, "fizzy-title"), null, "the card is not shown");
  assert.equal(m.view.detail, null);
  click(tree, "fizzy-back", m.cx);
  tree = await m.draw();
  assert.ok(find(tree, "fizzy-list"));
  assert.equal(find(tree, "fizzy-title"), null, "the card is not reopened");
  // A view, a card (a toast's click), the composer: each leaves the page.
  for (const [command, expected] of [["view:inbox", "fizzy-view-inbox"], ["open:101", "fizzy-title"], ["new", "fizzy-fresh-bar"]]) {
    await press(m.cx, "settings");
    assert.ok(find(await m.draw(), "fizzy-settings"), `${command}: the page is open`);
    await press(m.cx, command);
    if (command === "new") {
      assert.ok(find(await m.draw(), "fizzy-settings"), "new: the page stays while the picker is open");
      tree = await chooseNewCard(m, "b1");
    } else tree = await m.draw();
    assert.equal(find(tree, "fizzy-settings"), null, `${command}: the page is gone`);
    assert.ok(find(tree, expected), `${command}: shows ${expected}`);
    await press(m.cx, "back");
    await press(m.cx, "view:board");
  }
  assert.ok(find(await m.draw(), "fizzy-board"));
  assert.deepEqual(savedGroups(), [], "none of it saves anything");
});

test("Settings > Board groups: a head that says what groups do, with its plus, then one block per group in order, then No group; every board is in exactly one block, in the CLI's order, with its count", async () => {
  sampleBoards();
  seedGroups();
  const m = await mount();
  const tree = await settingsPage(m);
  const page = must(tree, "fizzy-settings");
  assert.deepEqual([page.style.flex_1, page.style.min_h, page.style.overflow_y_scrollbar], [true, 0, true], "it scrolls");
  assert.deepEqual([page.style.p, page.style.pb, page.style.gap], [10, 14, 8]);
  assert.deepEqual(page.kids.map(k => k.id), ["fizzy-settings-groups"], "one section");
  assert.equal(textOf(headerOf(tree)).trim(), "Board groups", "the page's name in the header");
  assert.equal(tipOf(tree, "fizzy-back"), "Settings", "whose Back returns to Settings");
  const section = must(tree, "fizzy-settings-groups");
  assert.equal(section.kids[0].id, "fizzy-settings-groups-head");
  assert.equal(textOf(section.kids[0]).trim(), "Groups sort the board dropdown. The eye hides a board or a group from it.");
  assert.deepEqual([section.kids[0].style.min_h, section.kids[0].style.pl, section.kids[0].style.pr], [30, 8, 8]);
  assert.deepEqual(all(section.kids[0], n => n.id).map(n => n.id), ["fizzy-settings-groups-head", "fizzy-groups-add"]);
  assert.deepEqual(iconsIn(tree, "fizzy-groups-add"), ["mods/fizzy/plus.svg"]);
  assert.equal(tipOf(tree, "fizzy-groups-add"), "New group");
  assert.deepEqual(blockIds(tree), ["fizzy-group-team", "fizzy-nogroup"]);
  assert.deepEqual(boardRowsIn(tree, "fizzy-group-team"), TEAM_IDS, "the team boards, in the CLI's order");
  assert.deepEqual(boardRowsIn(tree, "fizzy-nogroup"), OTHER_IDS, "the others, in the CLI's order");
  const every = boardRowsIn(tree, "fizzy-settings");
  assert.equal(every.length, SAMPLE_BOARDS.length);
  assert.deepEqual([...every].sort(), [...ALL_IDS].sort(), "every board appears exactly once");
  assert.equal(textOf(must(tree, "fizzy-group-count-team")).trim(), String(TEAM_IDS.length));
  assert.equal(textOf(must(tree, "fizzy-nogroup-count")).trim(), String(OTHER_IDS.length));
  for (const name of SAMPLE_BOARDS) {
    const id = boardId(name), row = must(tree, rowOf(id));
    assert.equal(textOf(must(row, `fizzy-board-name-${id}`)), name);
    assert.deepEqual(iconsIn(tree, rowOf(id)), ["mods/fizzy/eye.svg"], `${name}: one icon, the eye`);
    assert.equal(must(row, `fizzy-board-name-${id}`).style.text_color, "foreground", `${name}: nothing is dim`);
  }
  const name = must(tree, `fizzy-board-name-${boardId("Borealis  survey [team]")}`);
  assert.deepEqual([name.style.truncate, name.style.flex_1, name.style.min_w, name.style.tooltip], [true, true, 0, "Borealis  survey [team]"]);
  for (const id of ["fizzy-group-team", "fizzy-nogroup"]) {
    const block = must(tree, id);
    assert.deepEqual([block.style.relative, block.style.flex_none, block.style.rounded], [true, true, 7], id);
    for (const key of ["p", "px", "py", "pl", "pr", "pt", "pb", "gap"]) assert.equal(block.style[key], undefined, `${id}: no ${key}, so every press lands on a row`);
  }
  assert.equal(section.style.gap, 2);
  assert.deepEqual(acct.writes(), []);
  assert.deepEqual(savedGroups(), []);
});

test("a group's header: the name (Rename), the rule (contains “…”, only the text when narrow, No rule), the chevron, the bin and the eye; a hidden group and a hidden board are dim with the shut eye", async () => {
  sampleBoards();
  state.shared["fizzy.boardGroups"] = {
    groups: [{ ...TEAM, hidden: true }, { id: "g-2", name: "By hand", match: "", hidden: false }],
    boards: { [boardId("Roadmap")]: { group: "g-2" }, [boardId("Personal")]: { hidden: true }, [boardId("Garden")]: { group: "g-2", hidden: true } },
  };
  const m = await mount();
  let tree = await settingsPage(m);
  const name = must(tree, "fizzy-group-name-team"), rule = must(tree, "fizzy-group-match-team");
  assert.equal(textOf(name).trim(), "Team");
  assert.deepEqual([name.style.tooltip, name.style.px, name.style.h, name.style.min_w, name.style.rounded], ["Rename", 5, 22, 0, 5]);
  assert.equal(textOf(rule).trim(), "contains “[team]”");
  assert.deepEqual([rule.style.h, rule.style.px, rule.style.flex_shrink, rule.style.min_w, rule.style.text_size, rule.style.text_color], [22, 5, 4, 0, textPx(11), "dim"]);
  assert.equal(textOf(must(tree, "fizzy-group-match-g-2")).trim(), "No rule");
  assert.equal(must(tree, "fizzy-group-name-g-2").style.text_color, "foreground");
  assert.equal(name.style.text_color, "dim", "a hidden group");
  assert.deepEqual(iconsIn(tree, "fizzy-group-head-team").map(p => p.slice("mods/fizzy/".length)), ["chevron-down.svg", "trash.svg", "eye-off.svg"], "chevron, bin, eye");
  assert.deepEqual(iconsIn(tree, "fizzy-group-head-g-2").map(p => p.slice("mods/fizzy/".length)), ["chevron-down.svg", "trash.svg", "eye.svg"]);
  assert.equal(tipOf(tree, "fizzy-group-hide-team"), "Show");
  assert.equal(tipOf(tree, "fizzy-group-hide-g-2"), "Hide");
  assert.equal(tipOf(tree, "fizzy-group-del-g-2"), "Delete");
  assert.equal(must(tree, "fizzy-group-hide-team").style.text_color, "muted", "the shut eye stands out");
  assert.equal(must(tree, "fizzy-group-hide-g-2").style.text_color, "dim");
  // The text is all the rule shows when the panel is narrow.
  fire(must(tree, "fizzy"), "on_size_change", { width: 300, height: 600 }, m.cx);
  tree = await m.draw();
  assert.equal(textOf(must(tree, "fizzy-group-match-team")).trim(), "“[team]”");
  assert.equal(textOf(must(tree, "fizzy-group-match-g-2")).trim(), "No rule");
  fire(must(tree, "fizzy"), "on_size_change", { width: 520, height: 600 }, m.cx);
  assert.equal(textOf(must(await m.draw(), "fizzy-group-match-team")).trim(), "contains “[team]”");
  // Boards: dim in a hidden group and when hidden themselves; the eye is the board's own flag.
  const dim = id => must(tree, `fizzy-board-name-${id}`).style.text_color === "dim";
  assert.equal(dim(boardId("Support rota [team]")), true, "in a hidden group");
  assert.deepEqual(iconsIn(tree, rowOf(boardId("Support rota [team]"))), ["mods/fizzy/eye.svg"], "its own eye is not set");
  assert.equal(dim(boardId("Personal")), true, "hidden itself");
  assert.deepEqual(iconsIn(tree, rowOf(boardId("Personal"))), ["mods/fizzy/eye-off.svg"]);
  assert.equal(must(tree, `fizzy-board-hide-${boardId("Personal")}`).style.text_color, "muted");
  assert.equal(dim(boardId("Garden")), true);
  assert.equal(dim(boardId("Roadmap")), false, "put by hand in a group that is shown");
  assert.equal(dim(boardId("Travel")), false);
  assert.deepEqual(boardRowsIn(tree, "fizzy-group-g-2"), [boardId("Roadmap"), boardId("Garden")], "the boards put there by hand, in the CLI's order");
  // Folded: the chevron turns, the boards go, the header and the count stay.
  click(tree, "fizzy-group-head-g-2", m.cx);
  tree = await m.draw();
  assert.deepEqual(iconsIn(tree, "fizzy-group-head-g-2").slice(0, 1), ["mods/fizzy/chevron-right.svg"]);
  assert.deepEqual(boardRowsIn(tree, "fizzy-group-g-2"), []);
  assert.equal(textOf(must(tree, "fizzy-group-count-g-2")).trim(), "2");
});

test("Settings rows reserve a clear 1 px border; board rows start at 31 and empty rows at 32", async () => {
  sampleBoards();
  state.shared["fizzy.boardGroups"] = { groups: [{ ...TEAM }, { id: "g-2", name: "Empty", match: "", hidden: false }], boards: {} };
  const m = await mount();
  let tree = await settingsPage(m);
  const clear = "#00000000";
  for (const id of ["fizzy-group-head-team", "fizzy-group-head-g-2", "fizzy-nogroup-head", rowOf("n1"), rowOf("n2")]) {
    const row = must(tree, id);
    assert.deepEqual([row.style.border_1, row.style.border_color], [true, clear], id);
  }
  assert.equal(must(tree, rowOf("n1")).style.pl, 31);
  assert.equal(must(tree, "fizzy-group-empty-g-2").style.pl, 32);
  assert.equal(textOf(must(tree, "fizzy-group-empty-g-2")).trim(), "No boards");
  click(tree, "fizzy-group-name-team", m.cx);
  tree = await m.draw();
  assert.deepEqual([must(tree, "fizzy-group-rename-team").style.border_1, must(tree, "fizzy-group-rename-team").style.border_color], [true, clear], "the rename row too");
});

test("the eye on a group and on a board each save once and redraw; the boards list follows, and the second click shows it again", async () => {
  sampleBoards();
  seedGroups();
  const m = await mount();
  await press(m.cx, `board:${boardId("Roadmap")}`);
  let tree = await settingsPage(m);
  const tagged = boardId("Support rota [team]"), garden = boardId("Garden");
  let n = m.cx.notified;
  click(tree, "fizzy-group-hide-team", m.cx);
  assert.ok(m.cx.notified > n, "it redraws");
  assert.equal(savedGroups().length, 1, "saved once");
  assert.deepEqual(savedGroups()[0], { groups: [{ ...TEAM, hidden: true }], boards: {} });
  tree = await m.draw();
  assert.deepEqual(iconsIn(tree, "fizzy-group-hide-team"), ["mods/fizzy/eye-off.svg"]);
  assert.equal(must(tree, `fizzy-board-name-${tagged}`).style.text_color, "dim");
  assert.equal(must(tree, "fizzy-group-hide-team").style.tooltip, "Show");
  // The boards list leaves the whole group out (the board shown, Roadmap, is not in it).
  click(await leaveSettings(m), "fizzy-board", m.cx);
  assert.deepEqual(listOf((await mountPopup()).tree()), ["follow", "-", ...OTHER_IDS.map(i => `board-${i}`)]);
  // Shown again.
  tree = await settingsPage(m);
  click(tree, "fizzy-group-hide-team", m.cx);
  assert.equal(savedGroups().length, 2);
  assert.equal(savedGroups()[1].groups[0].hidden, false);
  // A board: its own eye.
  tree = await m.draw();
  n = m.cx.notified;
  click(tree, `fizzy-board-hide-${garden}`, m.cx);
  assert.ok(m.cx.notified > n);
  assert.equal(savedGroups().length, 3, "once");
  assert.deepEqual(savedGroups()[2].boards, { [garden]: { hidden: true } });
  tree = await m.draw();
  assert.deepEqual(iconsIn(tree, `fizzy-board-hide-${garden}`), ["mods/fizzy/eye-off.svg"]);
  assert.equal(must(tree, `fizzy-board-name-${garden}`).style.text_color, "dim");
  click(await leaveSettings(m), "fizzy-board", m.cx);
  const list = listOf((await mountPopup()).tree());
  assert.ok(!list.includes(`board-${garden}`) && list.includes(`board-${boardId("Travel")}`), "Garden is out of the list, the rest is not");
  tree = await settingsPage(m);
  click(tree, `fizzy-board-hide-${garden}`, m.cx);
  assert.deepEqual(savedGroups()[3].boards, {}, "shown again: nothing is kept of it");
  assert.equal(savedGroups().length, 4);
  assert.deepEqual(acct.writes(), [], "nothing here writes to Fizzy");
});

test("hidden is for the boards list only: Mine and the search still read every board, and the board shown is shown", async () => {
  sampleBoards();
  const [first] = SAMPLE_BOARDS;
  seedGroups({ groups: [{ ...TEAM, hidden: true }], boards: { [boardId(first)]: { hidden: true }, [boardId("Garden")]: { hidden: true } } });
  const m = await mount();
  let tree = await m.draw();
  assert.equal(boardName(tree), first, "the board shown is the first, though hidden");
  click(tree, "fizzy-view-mine", m.cx);
  await m.draw();
  const mine = acct.asked("card", "list").filter(a => a.includes("--assignee")).map(a => a[3]);
  assert.deepEqual(mine.sort(), [...ALL_IDS].sort(), "every board");
  acct.cards.push({ ...acct.card(103), id: "id-900", number: 900, title: "Xylophone", board: acct.boards.find(b => b.name === "Garden") });
  tree = await searchFor(m, "xylo");
  assert.deepEqual(acct.asked("search"), [["search", "--", "xylo"]], "the search is one call, whatever is hidden");
  assert.deepEqual(rowIds(tree), [900], "a hit on a hidden board is shown");
  click(tree, "fizzy-search-back", m.cx);
  // Another board of the hidden group can still be picked by its id.
  await press(m.cx, `board:${boardId("Release train [team]")}`);
  click(await m.draw(), "fizzy-home", m.cx);
  tree = await m.draw();
  assert.equal(boardName(tree), "Release train [team]", "a board of a hidden group can be shown");
  assert.equal(calls.setShared.filter(([k]) => k === "fizzy.boards").at(-1)[1].length, SAMPLE_BOARDS.length, "the shared boards are all of them");
});

test("New group: the plus opens a focused field under the head; Enter adds the group first (trimmed, no rule, shown), once, and closes it; an empty name does nothing; the x and Escape close it without saving", async () => {
  seedGroups();
  const m = await mount();
  let tree = await settingsPage(m);
  assert.equal(find(tree, "fizzy-group-new-row"), null, "no field until the plus is clicked");
  let n = m.cx.notified;
  click(tree, "fizzy-groups-add", m.cx);
  assert.ok(m.cx.notified > n, "it redraws");
  tree = await m.draw();
  const section = must(tree, "fizzy-settings-groups");
  assert.deepEqual(section.kids.slice(0, 2).map(k => k.id), ["fizzy-settings-groups-head", "fizzy-group-new-row"], "directly after the head");
  const input = inputOf(tree, "fizzy-group-new");
  assert.equal(input.options.placeholder, "New group");
  assert.equal(input.focused, true);
  assert.deepEqual(iconsIn(tree, "fizzy-group-new-cancel"), ["mods/fizzy/x.svg"]);
  assert.equal(tipOf(tree, "fizzy-group-new-cancel"), "Cancel");
  assert.deepEqual(savedGroups(), [], "opening it saves nothing");
  // An empty name does nothing, and the field stays.
  input.edit("   ", m.cx);
  input.submit(m.cx);
  input.edit("", m.cx);
  input.submit(m.cx);
  assert.deepEqual(savedGroups(), []);
  assert.ok(find(await m.draw(), "fizzy-group-new-row"), "still open");
  n = m.cx.notified;
  input.edit("  Work  ", m.cx);
  input.submit(m.cx);
  assert.ok(m.cx.notified > n);
  assert.equal(savedGroups().length, 1, "saved once");
  assert.deepEqual(savedGroups()[0].groups, [{ id: "g-2", name: "Work", match: "", hidden: false }, { ...TEAM }]);
  tree = await m.draw();
  assert.equal(find(tree, "fizzy-group-new-row"), null, "closed");
  assert.deepEqual(blockIds(tree), ["fizzy-group-g-2", "fizzy-group-team", "fizzy-nogroup"], "the new group is first, under the head");
  assert.equal(textOf(must(tree, "fizzy-group-name-g-2")).trim(), "Work");
  assert.equal(textOf(must(tree, "fizzy-group-match-g-2")).trim(), "No rule");
  // Opened again it is empty; the x and Escape close it without saving; the plus again focuses it again.
  click(tree, "fizzy-groups-add", m.cx);
  tree = await m.draw();
  assert.equal(inputOf(tree, "fizzy-group-new").value(), "");
  inputOf(tree, "fizzy-group-new").edit("Draft", m.cx);
  click(tree, "fizzy-groups-add", m.cx);
  assert.equal(inputOf(await m.draw(), "fizzy-group-new").value(), "Draft", "the plus while it is open keeps what was typed");
  click(tree, "fizzy-group-new-cancel", m.cx);
  tree = await m.draw();
  assert.equal(find(tree, "fizzy-group-new-row"), null);
  click(tree, "fizzy-groups-add", m.cx);
  tree = await m.draw();
  assert.equal(inputOf(tree, "fizzy-group-new").value(), "", "what was typed is gone");
  inputOf(tree, "fizzy-group-new").edit("Never saved", m.cx);
  escapeIn(tree, "fizzy-group-new-row", m.cx);
  assert.equal(find(await m.draw(), "fizzy-group-new-row"), null);
  assert.equal(savedGroups().length, 1, "nothing else was saved");
  // The new group takes the next free id and is first again.
  click(await m.draw(), "fizzy-groups-add", m.cx);
  const again = inputOf(await m.draw(), "fizzy-group-new");
  again.edit("Third", m.cx);
  again.submit(m.cx);
  assert.deepEqual(savedGroups().at(-1).groups.map(g => g.id), ["g-3", "g-2", "team"]);
  assert.deepEqual(acct.writes(), []);
});

test("a click on a group's name renames it in place: the header gives way to a focused field, Enter saves once, the x, Escape, an unchanged or an empty name leave it; with ⌘/Ctrl the click does nothing", async () => {
  sampleBoards();
  seedGroups();
  const m = await mount();
  let tree = await settingsPage(m);
  assert.equal(find(tree, "fizzy-group-rename-team"), null);
  const clicked = makeCx();
  click(tree, "fizzy-group-name-team", clicked);
  assert.equal(clicked.stopped, 1, "the click does not fold the block");
  assert.ok(clicked.notified > 0, "it redraws");
  assert.ok(clicked.timers.some(t => t.after && t.ms === 200), "focused again after 200 ms");
  tree = await m.draw();
  let input = inputOf(tree, "fizzy-group-input-team");
  assert.equal(input.value(), "Team");
  assert.equal(input.focused, true);
  assert.equal(find(tree, "fizzy-group-head-team"), null, "the field replaces the header");
  assert.deepEqual(Object.keys(must(tree, "fizzy-group-rename-team").handlers).sort(), ["on_key_down", "on_mouse_down:left"], "no click and no pick on the rename row");
  assert.deepEqual(iconsIn(tree, "fizzy-group-rename-team"), ["mods/fizzy/chevron-down.svg", "mods/fizzy/x.svg"]);
  assert.equal(tipOf(tree, "fizzy-group-cancel-team"), "Cancel");
  assert.equal(boardRowsIn(tree, "fizzy-group-team").length, TEAM_IDS.length, "the fold is as it was: the boards stay");
  input.edit("Renamed", m.cx);
  input.submit(m.cx);
  assert.equal(savedGroups().length, 1, "saved once");
  assert.equal(savedGroups()[0].groups[0].name, "Renamed");
  tree = await m.draw();
  assert.equal(find(tree, "fizzy-group-rename-team"), null, "the edit is over, the header is back");
  assert.equal(textOf(must(tree, "fizzy-group-name-team")).trim(), "Renamed");
  // Nothing changes, nothing is saved: unchanged text, an empty name, the x, Escape.
  for (const how of ["same", "empty", "x", "escape"]) {
    click(tree, "fizzy-group-name-team", m.cx);
    tree = await m.draw();
    input = inputOf(tree, "fizzy-group-input-team");
    if (how === "empty") input.edit("   ", m.cx);
    if (how === "same" || how === "empty") input.submit(m.cx);
    if (how === "x") click(tree, "fizzy-group-cancel-team", m.cx);
    if (how === "escape") escapeIn(tree, "fizzy-group-rename-team", m.cx);
    tree = await m.draw();
    assert.equal(find(tree, "fizzy-group-rename-team"), null, `${how}: the edit is over`);
    assert.equal(savedGroups().length, 1, `${how}: nothing saved`);
  }
  assert.equal(textOf(must(tree, "fizzy-group-name-team")).trim(), "Renamed", "the name is as it was");
  // With ⌘/Ctrl the click is the end of a drag's press: it neither renames nor stops the click.
  const held = makeCx();
  click(tree, "fizzy-group-name-team", held, CMD);
  assert.equal(held.stopped, 0);
  assert.equal(find(await m.draw(), "fizzy-group-rename-team"), null);
  assert.deepEqual(acct.writes(), []);
});

test("a click on a group's rule opens its field under the header, folded or not, and leaves the fold alone; Enter sets the rule (empty is none) and the boards follow; the x and Escape leave it", async () => {
  sampleBoards();
  seedGroups();
  const m = await mount();
  let tree = await settingsPage(m);
  const clicked = makeCx();
  click(tree, "fizzy-group-match-team", clicked);
  assert.equal(clicked.stopped, 1, "the click does not fold the block");
  tree = await m.draw();
  assert.deepEqual(must(tree, "fizzy-group-team").kids.slice(0, 2).map(k => k.id), ["fizzy-group-head-team", "fizzy-group-match-edit-team"], "right after the header");
  let input = inputOf(tree, "fizzy-group-match-input-team");
  assert.equal(input.value(), "[team]");
  assert.equal(input.focused, true);
  assert.equal(input.options.placeholder, "Names containing…");
  assert.deepEqual(iconsIn(tree, "fizzy-group-match-cancel-team"), ["mods/fizzy/x.svg"]);
  assert.ok(find(tree, "fizzy-group-head-team"), "the header stays");
  assert.equal(boardRowsIn(tree, "fizzy-group-team").length, TEAM_IDS.length, "the block stays open");
  input.edit("  [te  ", m.cx);
  input.submit(m.cx);
  assert.equal(savedGroups().length, 1);
  assert.equal(savedGroups()[0].groups[0].match, "[te", "trimmed");
  tree = await m.draw();
  assert.equal(find(tree, "fizzy-group-match-edit-team"), null, "closed");
  assert.equal(textOf(must(tree, "fizzy-group-match-team")).trim(), "contains “[te”");
  // A folded block shows the rule field and no boards, and is folded after Enter.
  click(tree, "fizzy-group-head-team", m.cx);
  tree = await m.draw();
  assert.deepEqual(boardRowsIn(tree, "fizzy-group-team"), []);
  click(tree, "fizzy-group-match-team", m.cx);
  tree = await m.draw();
  assert.ok(find(tree, "fizzy-group-match-edit-team"), "the field of a folded block");
  assert.deepEqual(boardRowsIn(tree, "fizzy-group-team"), [], "and no boards");
  input = inputOf(tree, "fizzy-group-match-input-team");
  input.submit(m.cx);
  assert.equal(savedGroups().length, 1, "the same rule saves nothing");
  tree = await m.draw();
  assert.equal(find(tree, "fizzy-group-match-edit-team"), null);
  assert.deepEqual(boardRowsIn(tree, "fizzy-group-team"), [], "still folded");
  assert.equal(m.view.folds.has("team"), true);
  // An empty rule is no rule: the team boards leave for No group.
  click(tree, "fizzy-group-match-team", m.cx);
  input = inputOf(await m.draw(), "fizzy-group-match-input-team");
  input.edit("", m.cx);
  input.submit(m.cx);
  assert.equal(savedGroups().length, 2, "saved once");
  assert.equal(savedGroups()[1].groups[0].match, "");
  tree = await m.draw();
  assert.equal(textOf(must(tree, "fizzy-group-match-team")).trim(), "No rule");
  assert.deepEqual(boardRowsIn(tree, "fizzy-nogroup"), ALL_IDS, "every board is in No group now");
  assert.equal(textOf(must(tree, "fizzy-nogroup-count")).trim(), String(SAMPLE_BOARDS.length));
  // The x and Escape leave the field as it was.
  for (const how of ["x", "escape"]) {
    click(tree, "fizzy-group-match-team", m.cx);
    tree = await m.draw();
    inputOf(tree, "fizzy-group-match-input-team").edit("zzz", m.cx);
    if (how === "x") click(tree, "fizzy-group-match-cancel-team", m.cx);
    else escapeIn(tree, "fizzy-group-match-edit-team", m.cx);
    tree = await m.draw();
    assert.equal(find(tree, "fizzy-group-match-edit-team"), null, `${how}: the edit is over`);
    assert.equal(savedGroups().length, 2, `${how}: nothing saved`);
  }
  const held = makeCx();
  click(tree, "fizzy-group-match-team", held, CMD);
  assert.equal(held.stopped, 0, "with ⌘/Ctrl the click does nothing");
  assert.equal(find(await m.draw(), "fizzy-group-match-edit-team"), null);
  assert.deepEqual(acct.writes(), []);
});

test("only one editor is open at a time: the new-group field, a rename and a rule field each close the others", async () => {
  seedGroups();
  const m = await mount();
  let tree = await settingsPage(m);
  const open = tree => ["fizzy-group-new-row", "fizzy-group-rename-team", "fizzy-group-match-edit-team"].filter(id => find(tree, id));
  click(tree, "fizzy-group-name-team", m.cx);
  tree = await m.draw();
  assert.deepEqual(open(tree), ["fizzy-group-rename-team"]);
  click(tree, "fizzy-groups-add", m.cx);
  tree = await m.draw();
  assert.deepEqual(open(tree), ["fizzy-group-new-row"], "the composer closes the rename");
  click(await m.draw(), "fizzy-group-match-team", m.cx);
  tree = await m.draw();
  assert.deepEqual(open(tree), ["fizzy-group-match-edit-team"], "a rule field closes the composer");
  click(tree, "fizzy-group-name-team", m.cx);
  tree = await m.draw();
  assert.deepEqual(open(tree), ["fizzy-group-rename-team"], "a rename closes the rule field");
  click(tree, "fizzy-groups-add", m.cx);
  click(await m.draw(), "fizzy-group-name-team", m.cx);
  assert.deepEqual(open(await m.draw()), ["fizzy-group-rename-team"], "and closes the composer");
  assert.deepEqual(savedGroups(), []);
});

test("a rule moves boards at once: the blocks and the boards list follow it, in the order of the groups when two fit; a new group is first, so its rule is read before Team", async () => {
  sampleBoards();
  seedGroups();
  const acmeOnly = SAMPLE_BOARDS.filter(n => isAcme(n) && !isTeamBoard(n)).map(boardId);
  const teamOnly = SAMPLE_BOARDS.filter(n => isTeamBoard(n) && !isAcme(n)).map(boardId);
  assert.ok(acmeOnly.length && teamOnly.length && teamOnly.length < TEAM_IDS.length, "both rules fit some boards, and one board fits both");
  const m = await mount();
  let tree = await settingsPage(m);
  click(tree, "fizzy-groups-add", m.cx);
  tree = await m.draw();
  inputOf(tree, "fizzy-group-new").edit("Acme", m.cx);
  inputOf(tree, "fizzy-group-new").submit(m.cx);
  tree = await m.draw();
  click(tree, "fizzy-group-match-g-2", m.cx);
  const box = inputOf(await m.draw(), "fizzy-group-match-input-g-2");
  box.edit("acme", m.cx);
  box.submit(m.cx);
  tree = await m.draw();
  assert.deepEqual(blockIds(tree), ["fizzy-group-g-2", "fizzy-group-team", "fizzy-nogroup"]);
  assert.equal(boardRowsIn(tree, "fizzy-group-g-2").length, SAMPLE_BOARDS.filter(isAcme).length, "the new group is first, so every Acme board is its own");
  assert.deepEqual(boardRowsIn(tree, "fizzy-group-team"), teamOnly, "Team keeps only the team boards with no Acme in the name");
  assert.deepEqual(boardRowsIn(tree, "fizzy-nogroup"), SAMPLE_BOARDS.filter(n => !isAcme(n) && !isTeamBoard(n)).map(boardId));
  // Dragged below Team, the order of the groups decides: Team first.
  pressRow(tree, "fizzy-group-head-g-2", m.cx);
  hoverOn(tree, "fizzy-group-team", true, m.cx);
  releaseOn(tree, "fizzy-group-team", m.cx);
  tree = await m.draw();
  assert.deepEqual(blockIds(tree), ["fizzy-group-team", "fizzy-group-g-2", "fizzy-nogroup"]);
  assert.deepEqual(boardRowsIn(tree, "fizzy-group-team"), TEAM_IDS, "Team comes first");
  assert.deepEqual(boardRowsIn(tree, "fizzy-group-g-2"), acmeOnly);
  click(await leaveSettings(m), "fizzy-board", m.cx);
  const list = listOf((await mountPopup()).tree());
  assert.deepEqual(list.filter(i => i.startsWith("# ")), ["# Team", "# Acme"]);
  assert.deepEqual(list.slice(list.indexOf("# Acme") + 1), acmeOnly.map(i => `board-${i}`));
});

test("deleting a group takes two clicks (the first asks Delete?); the boards put in it by hand go back to Automatic", async () => {
  sampleBoards();
  state.shared["fizzy.boardGroups"] = {
    groups: [{ ...TEAM }, { id: "g-2", name: "By hand", match: "", hidden: false }],
    boards: { [boardId("Roadmap")]: { group: "g-2" }, [boardId("Support rota [team]")]: { group: "g-2", hidden: true }, [boardId("Personal")]: { group: null } },
  };
  const m = await mount();
  let tree = await settingsPage(m);
  assert.ok(boardRowsIn(tree, "fizzy-group-g-2").includes(boardId("Roadmap")), "put there by hand");
  const asked = makeCx();
  click(tree, "fizzy-group-del-g-2", asked);
  assert.equal(asked.stopped, 1, "the click does not fold the block");
  assert.ok(asked.notified > 0, "the first click redraws");
  assert.deepEqual(savedGroups(), [], "and only asks");
  tree = await m.draw();
  assert.equal(textOf(must(tree, "fizzy-group-del-g-2")).trim(), "Delete?");
  assert.equal(must(tree, "fizzy-group-del-g-2").style.text_color, "blocked");
  assert.equal(must(tree, "fizzy-group-del-g-2").style.tooltip, undefined, "no tooltip while it asks");
  assert.equal(textOf(must(tree, "fizzy-group-del-team")).trim(), "", "the other group's bin is not armed");
  // The bin's own press does not disarm it, so the second click is a second click on the same bin.
  const pressed = makeCx();
  fire(must(tree, "fizzy-group-del-g-2"), "on_mouse_down:left", { button: "left", click_count: 1, modifiers: {} }, pressed);
  assert.equal(pressed.stopped, 1);
  assert.equal(textOf(must(await m.draw(), "fizzy-group-del-g-2")).trim(), "Delete?");
  // Asking about another group moves the question.
  click(tree, "fizzy-group-del-team", m.cx);
  tree = await m.draw();
  assert.equal(textOf(must(tree, "fizzy-group-del-g-2")).trim(), "");
  assert.equal(textOf(must(tree, "fizzy-group-del-team")).trim(), "Delete?");
  click(tree, "fizzy-group-del-g-2", m.cx);
  tree = await m.draw();
  assert.deepEqual(savedGroups(), [], "still only asking");
  const n = m.cx.notified;
  click(tree, "fizzy-group-del-g-2", m.cx);
  assert.ok(m.cx.notified > n);
  assert.equal(savedGroups().length, 1, "the second click deletes, once");
  assert.deepEqual(savedGroups()[0], {
    groups: [{ ...TEAM }],
    boards: { [boardId("Support rota [team]")]: { hidden: true }, [boardId("Personal")]: { group: null } },
  });
  tree = await m.draw();
  assert.equal(find(tree, "fizzy-group-g-2"), null, "the group is gone");
  assert.ok(boardRowsIn(tree, "fizzy-nogroup").includes(boardId("Roadmap")), "Automatic again: no rule picks it");
  assert.ok(boardRowsIn(tree, "fizzy-group-team").includes(boardId("Support rota [team]")), "back where its name puts it");
  assert.equal(textOf(must(tree, "fizzy-group-del-team")).trim(), "", "a delete asks again from the start");
  // The last group goes too: no groups at all is kept as it is.
  click(tree, "fizzy-group-del-team", m.cx);
  assert.equal(savedGroups().length, 1, "the first click asks");
  click(await m.draw(), "fizzy-group-del-team", m.cx);
  tree = await m.draw();
  assert.equal(savedGroups().length, 2);
  assert.deepEqual(savedGroups().at(-1).groups, []);
  assert.deepEqual(blockIds(tree), ["fizzy-nogroup"], "no groups: only No group, holding every board");
  assert.equal(boardRowsIn(tree, "fizzy-nogroup").length, SAMPLE_BOARDS.length);
  assert.equal(find(tree, "fizzy-group-team"), null);
  click(await leaveSettings(m), "fizzy-board", m.cx);
  assert.equal(listOf((await mountPopup()).tree()).some(i => i.startsWith("# ")), false, "no groups: no labels");
  assert.deepEqual(acct.writes(), []);
});

test("leaving Settings, or only its Board groups page, forgets an armed delete, an open editor and a drag; the group is still there when it is opened again", async () => {
  seedGroups();
  const m = await mount();
  let tree = await settingsPage(m);
  click(tree, "fizzy-group-del-team", m.cx);
  await leaveSettings(m);
  tree = await settingsPage(m);
  assert.equal(textOf(must(tree, "fizzy-group-del-team")).trim(), "", "asked again from the start");
  click(tree, "fizzy-group-name-team", m.cx);
  await leaveSettings(m);
  assert.equal(find(await settingsPage(m), "fizzy-group-rename-team"), null, "an edit does not survive it either");
  click(await m.draw(), "fizzy-groups-add", m.cx);
  assert.ok(find(await m.draw(), "fizzy-group-new-row"));
  click(await m.draw(), "fizzy-back", m.cx);
  click(await m.draw(), "fizzy-setting-groups", m.cx);
  assert.equal(find(await m.draw(), "fizzy-group-new-row"), null, "nor does the new-group field, Back to the list of settings being enough");
  pressRow(await m.draw(), "fizzy-group-head-team", m.cx);
  assert.deepEqual(m.view.drag, { kind: "group", id: "team", over: null });
  click(await m.draw(), "fizzy-back", m.cx);
  assert.equal(m.view.drag, null);
  assert.deepEqual(savedGroups(), []);
});

test("an armed delete is forgotten by any other click in the tree, but not by the bin's own press", async () => {
  sampleBoards();
  state.shared["fizzy.boardGroups"] = TWO();
  const m = await mount();
  let tree = await settingsPage(m);
  const armed = async () => textOf(must(await m.draw(), "fizzy-group-del-team")).trim() === "Delete?";
  const arm = async () => { click(await m.draw(), "fizzy-group-del-team", m.cx); assert.equal(await armed(), true, "armed"); };
  const others = {
    "folding another block": tree => click(tree, "fizzy-group-head-g-2", m.cx),
    "folding No group": tree => click(tree, "fizzy-nogroup-head", m.cx),
    "a group's eye": tree => click(tree, "fizzy-group-hide-g-2", m.cx),
    "a board's eye": tree => click(tree, `fizzy-board-hide-${boardId("Roadmap")}`, m.cx),
    "a plain press on a board row": tree => pressRow(tree, rowOf(boardId("Roadmap")), m.cx, { modifiers: {} }),
    "a plain press on a header": tree => pressRow(tree, "fizzy-group-head-g-2", m.cx, { modifiers: {} }),
    "starting a drag": tree => pressRow(tree, rowOf(boardId("Roadmap")), m.cx),
    "the new-group field": tree => click(tree, "fizzy-groups-add", m.cx),
    "a rename": tree => click(tree, "fizzy-group-name-g-2", m.cx),
    "a rule field": tree => click(tree, "fizzy-group-match-g-2", m.cx),
    "a press outside the panel": tree => fire(must(tree, "fizzy"), "on_mouse_down_out", {}, m.cx),
  };
  for (const [what, act] of Object.entries(others)) {
    await arm();
    act(await m.draw());
    assert.equal(await armed(), false, `${what}: forgotten`);
    await leaveSettings(m);
    await settingsPage(m);
    if (what.startsWith("folding")) act(await m.draw());
  }
  // The bin's own press leaves it armed (the second click deletes).
  await arm();
  fire(must(await m.draw(), "fizzy-group-del-team"), "on_mouse_down:left", { button: "left", modifiers: {} }, m.cx);
  assert.equal(await armed(), true);
  assert.equal(savedGroups().filter(c => c.groups.length < 2).length, 0, "nothing was deleted by all that");
  click(await m.draw(), "fizzy-group-del-team", m.cx);
  assert.equal(savedGroups().at(-1).groups.map(g => g.id).join(), "g-2");
});

test("a deleted group's fold is forgotten: the next group to get its id is drawn open", async () => {
  seedGroups();
  const m = await mount();
  let tree = await settingsPage(m);
  click(tree, "fizzy-groups-add", m.cx);
  inputOf(await m.draw(), "fizzy-group-new").edit("Second", m.cx);
  inputOf(await m.draw(), "fizzy-group-new").submit(m.cx);
  tree = await m.draw();
  assert.deepEqual(blockIds(tree), ["fizzy-group-g-2", "fizzy-group-team", "fizzy-nogroup"]);
  click(tree, "fizzy-group-head-g-2", m.cx);
  assert.equal(find(await m.draw(), "fizzy-group-empty-g-2"), null, "folded");
  assert.deepEqual(keptFolds(), { ids: ["g-2"], none: false });
  click(await m.draw(), "fizzy-group-del-g-2", m.cx);
  click(await m.draw(), "fizzy-group-del-g-2", m.cx);
  assert.deepEqual(keptFolds(), { ids: [], none: false }, "the fold left with the group");
  click(await m.draw(), "fizzy-groups-add", m.cx);
  inputOf(await m.draw(), "fizzy-group-new").edit("X", m.cx);
  inputOf(await m.draw(), "fizzy-group-new").submit(m.cx);
  tree = await m.draw();
  assert.ok(find(tree, "fizzy-group-empty-g-2"), "it gets the id g-2 again, and is open");
  assert.equal(textOf(must(tree, "fizzy-group-empty-g-2")).trim(), "No boards");
});

test("a group's header and the No group header fold their blocks (not with ⌘/Ctrl); the eye and the bin never fold; folds are kept between runs", async () => {
  sampleBoards();
  seedGroups();
  const m = await mount();
  let tree = await settingsPage(m);
  assert.equal(boardRowsIn(tree, "fizzy-group-team").length, TEAM_IDS.length);
  const n = m.cx.notified;
  click(tree, "fizzy-group-head-team", m.cx);
  assert.ok(m.cx.notified > n);
  tree = await m.draw();
  assert.deepEqual(boardRowsIn(tree, "fizzy-group-team"), [], "the boards go");
  assert.ok(find(tree, "fizzy-group-head-team"), "the header stays");
  assert.equal(textOf(must(tree, "fizzy-group-count-team")).trim(), String(TEAM_IDS.length), "and its count");
  assert.deepEqual(iconsIn(tree, "fizzy-group-head-team").slice(0, 1), ["mods/fizzy/chevron-right.svg"]);
  assert.equal(boardRowsIn(tree, "fizzy-nogroup").length, OTHER_IDS.length, "the other block is as it was");
  assert.deepEqual(keptFolds(), { ids: ["team"], none: false });
  click(tree, "fizzy-nogroup-head", m.cx);
  tree = await m.draw();
  assert.deepEqual(boardRowsIn(tree, "fizzy-nogroup"), []);
  assert.deepEqual(iconsIn(tree, "fizzy-nogroup-head"), ["mods/fizzy/chevron-right.svg"]);
  assert.equal(textOf(must(tree, "fizzy-nogroup-count")).trim(), String(OTHER_IDS.length));
  assert.deepEqual(keptFolds(), { ids: ["team"], none: true });
  const again = await mount();
  tree = await settingsPage(again);
  assert.deepEqual([boardRowsIn(tree, "fizzy-group-team"), boardRowsIn(tree, "fizzy-nogroup")], [[], []]);
  click(tree, "fizzy-group-head-team", again.cx, CMD);
  click(tree, "fizzy-nogroup-head", again.cx, CMD);
  tree = await again.draw();
  assert.deepEqual([boardRowsIn(tree, "fizzy-group-team").length, boardRowsIn(tree, "fizzy-nogroup").length], [0, 0], "⌘/Ctrl does not fold or unfold");
  click(tree, "fizzy-group-head-team", again.cx);
  click(tree, "fizzy-nogroup-head", again.cx);
  tree = await again.draw();
  assert.deepEqual([boardRowsIn(tree, "fizzy-group-team").length, boardRowsIn(tree, "fizzy-nogroup").length], [TEAM_IDS.length, OTHER_IDS.length]);
  assert.deepEqual(keptFolds(), { ids: [], none: false });
  // The buttons in a header stop the click: the fold is unchanged.
  for (const id of ["fizzy-group-hide-team", "fizzy-group-del-team"]) {
    const c = makeCx();
    click(tree, id, c);
    assert.equal(c.stopped, 1, id);
    assert.equal(boardRowsIn(await again.draw(), "fizzy-group-team").length, TEAM_IDS.length, `${id}: not folded`);
  }
  assert.deepEqual(acct.writes(), []);
});

test("what another copy saved is what the page and the list show: the groups are read from shared state at every draw", async () => {
  sampleBoards();
  seedGroups();
  const m = await mount();
  let tree = await settingsPage(m);
  assert.ok(boardRowsIn(tree, "fizzy-nogroup").includes(boardId("Garden")));
  state.shared["fizzy.boardGroups"] = { groups: [{ id: "x", name: "Mine", match: "garden", hidden: false }], boards: {} };
  tree = await m.draw();
  assert.deepEqual(boardRowsIn(tree, "fizzy-group-x"), [boardId("Garden")]);
  assert.equal(find(tree, "fizzy-group-team"), null);
  assert.ok(find(tree, "fizzy-group-x"));
  // Junk is the default: no groups.
  state.shared["fizzy.boardGroups"] = "junk";
  tree = await m.draw();
  assert.deepEqual(blockIds(tree), ["fizzy-nogroup"]);
  assert.deepEqual(boardRowsIn(tree, "fizzy-nogroup"), ALL_IDS);
});

test("while the boards are read Settings shows the headers with no counts and no rows, then Loading…; the groups can be managed meanwhile; an account with no boards shows No boards in every block", async () => {
  seedGroups();
  let release;
  acct.hold = new Promise(ok => { release = ok; });
  const { view, cx, draw } = await mount({ settle: false });
  sendCommand("settings"); // (press() would wait for the reads that are held back)
  await tick();
  assert.equal(textOf(must(drawn(view, cx), "fizzy-setting-mentions-summary")), "Loading people…");
  click(drawn(view, cx), "fizzy-setting-groups", cx);
  let page = drawn(view, cx);
  assert.ok(find(page, "fizzy-settings"));
  assert.equal(all(page, n => n.id?.startsWith("fizzy-board-row-")).length, 0);
  assert.deepEqual(blockIds(page), ["fizzy-group-team", "fizzy-nogroup"], "the headers are there");
  assert.equal(textOf(must(page, "fizzy-group-count-team")), "", "an empty count");
  assert.equal(textOf(must(page, "fizzy-nogroup-count")), "");
  assert.equal(find(page, "fizzy-group-empty-team") ?? find(page, "fizzy-nogroup-empty"), null, "no No boards while they are not known");
  assert.equal(textOf(must(page, "fizzy-settings-groups")).match(/Loading…/g)?.length, 1, "one status");
  // Rename, hide, add, reorder and delete work meanwhile.
  click(page, "fizzy-group-name-team", cx);
  page = drawn(view, cx);
  inputOf(page, "fizzy-group-input-team").edit("Renamed", cx);
  inputOf(page, "fizzy-group-input-team").submit(cx);
  click(drawn(view, cx), "fizzy-group-hide-team", cx);
  click(drawn(view, cx), "fizzy-groups-add", cx);
  inputOf(drawn(view, cx), "fizzy-group-new").edit("Work", cx);
  inputOf(drawn(view, cx), "fizzy-group-new").submit(cx);
  page = drawn(view, cx);
  assert.deepEqual(blockIds(page), ["fizzy-group-g-2", "fizzy-group-team", "fizzy-nogroup"]);
  pressRow(page, "fizzy-group-head-g-2", cx);
  releaseOn(page, "fizzy-group-team", cx);
  click(drawn(view, cx), "fizzy-group-del-g-2", cx);
  click(drawn(view, cx), "fizzy-group-del-g-2", cx);
  assert.deepEqual(savedGroups().map(c => c.groups.map(g => g.name)), [["Renamed"], ["Renamed"], ["Work", "Renamed"], ["Renamed", "Work"], ["Renamed"]]);
  release();
  await cx.settle();
  page = await draw();
  assert.doesNotMatch(textOf(must(page, "fizzy-settings")), /Loading…/);
  assert.deepEqual(all(page, n => n.id?.startsWith("fizzy-board-row-")).map(n => n.id), ["fizzy-board-row-b1", "fizzy-board-row-b2"]);
  // An account with no boards.
  setup();
  seedGroups();
  acct.boards.length = 0;
  const none = await mount();
  const empty = await settingsPage(none);
  assert.deepEqual(blockIds(empty), ["fizzy-group-team", "fizzy-nogroup"]);
  assert.ok(find(empty, "fizzy-group-empty-team") && find(empty, "fizzy-nogroup-empty"));
  assert.equal(textOf(must(empty, "fizzy-group-count-team")), "0");
  assert.equal(textOf(must(empty, "fizzy-nogroup-count")), "0");
  assert.match(textOf(must(empty, "fizzy-nogroup")), /No boards/);
  assert.doesNotMatch(textOf(must(empty, "fizzy-settings")), /Loading…/);
});

test("Settings is built like the rest: ids on everything that can be clicked, unique ids, no fixed width of 200 or more, no max width over 150, and no draw acts or notifies late", async () => {
  sampleBoards();
  state.shared["fizzy.boardGroups"] = TWO();
  const m = await mount();
  const check = (tree, what) => {
    const found = ids(tree);
    assert.equal(new Set(found).size, found.length, `${what}: unique ids`);
    assert.deepEqual(all(tree, n => Object.keys(n.handlers).filter(h => h !== "on_key_down").length && n.id === null).map(n => n.kind), [], `${what}: handlers need an id`);
    const widths = all(tree, n => typeof n.style.w === "number" || typeof n.style.min_w === "number").map(n => n.style.w ?? n.style.min_w);
    assert.ok(widths.every(w => w < 200), `${what}: fixed widths ${widths}`);
    assert.ok(all(must(tree, "fizzy-settings"), n => n.style.max_w).every(n => n.style.max_w <= 150), `${what}: max widths`);
    for (const n of all(tree, x => x.kind === "svg" || x.kind === "image")) assert.equal(typeof n.path, "string");
  };
  // Every draw passes the render guard: nothing acts, nothing notifies late.
  const quiet = async what => {
    const tree = drawn(m.view, m.cx, { quiet: true });
    await tick();
    await m.cx.settle();
    check(tree, what);
    return tree;
  };
  let tree = await settingsPage(m);
  await quiet("the page");
  const roadmap = boardId("Roadmap");
  click(tree, "fizzy-group-head-g-2", m.cx);
  await quiet("a folded block");
  click(await m.draw(), "fizzy-group-match-team", m.cx);
  await quiet("a rule being changed");
  click(await m.draw(), "fizzy-group-match-g-2", m.cx);
  await quiet("a rule field on a folded block");
  click(await m.draw(), "fizzy-group-name-team", m.cx);
  await quiet("a name being changed");
  click(await m.draw(), "fizzy-groups-add", m.cx);
  await quiet("the new-group field");
  click(await m.draw(), "fizzy-group-del-team", m.cx);
  await quiet("a delete asked for");
  const release = async () => fire(must(await m.draw(), "fizzy"), "on_mouse_up:left", {}, m.cx);
  pressRow(await m.draw(), rowOf(roadmap), m.cx);
  hoverOn(tree, "fizzy-group-team", true, m.cx);
  await quiet("a board being dragged");
  await release();
  pressRow(await m.draw(), "fizzy-group-head-team", m.cx);
  hoverOn(tree, "fizzy-group-g-2", true, m.cx);
  await quiet("a group being dragged");
  await release();
  fire(must(await m.draw(), "fizzy"), "on_size_change", { width: 280, height: 600 }, m.cx);
  await quiet("a narrow panel");
  assert.deepEqual(acct.writes(), []);
});

const CMD = { modifiers: { platform: true } };
const TWO = () => ({ groups: [{ ...TEAM }, { id: "g-2", name: "By hand", match: "", hidden: false }], boards: {} });
// A left press on a row (with ⌘ unless `event` says otherwise), the pointer entering or leaving a block, and the button let go over one.
const pressRow = (tree, id, cx, event = CMD) => fire(must(tree, id), "on_mouse_down:left", { button: "left", click_count: 1, ...event }, cx);
const releaseOn = (tree, id, cx) => fire(must(tree, id), "on_mouse_up:left", { button: "left" }, cx);
const hoverOn = (tree, id, entered, cx) => fire(must(tree, id), "on_hover", entered, cx);
// The rows drawn as picked up (an accent border), the blocks drawn as taking a board (the selected background) and the insertion lines.
function lit(tree) {
  const page = must(tree, "fizzy-settings");
  return {
    picked: all(page, n => n.id && n.style.border_color === "accent").map(n => n.id),
    over: all(page, n => n.id && n.style.bg === "selected").map(n => n.id),
    lines: all(page, n => n.id?.startsWith("fizzy-group-line-")).map(n => n.id),
  };
}
const NOTHING_LIT = { picked: [], over: [], lines: [] };
const orderOf = tree => blockIds(tree).filter(id => id !== "fizzy-nogroup").map(id => id.slice("fizzy-group-".length));

test("⌘/Ctrl-drag a board onto a group's block saves once: it is stored as that group unless its name already picks it (then Automatic); the other flag stays; the boards list follows", async () => {
  sampleBoards();
  const [roadmap, tagged, personal] = ["Roadmap", "Support rota [team]", "Personal"].map(boardId);
  state.shared["fizzy.boardGroups"] = { ...TWO(), boards: { [personal]: { hidden: true } } };
  const m = await mount();
  let tree = await settingsPage(m);
  assert.ok(boardRowsIn(tree, "fizzy-nogroup").includes(roadmap));
  pressRow(tree, rowOf(roadmap), m.cx);
  releaseOn(tree, "fizzy-group-team", m.cx);
  assert.equal(savedGroups().length, 1, "saved once");
  assert.equal(savedGroups()[0].boards[roadmap].group, "team", "its name has no [team]: stored as that group");
  assert.deepEqual(savedGroups()[0].boards[personal], { hidden: true });
  tree = await m.draw();
  assert.ok(boardRowsIn(tree, "fizzy-group-team").includes(roadmap), "its row is in the block now");
  assert.ok(!boardRowsIn(tree, "fizzy-nogroup").includes(roadmap));
  assert.equal(m.view.drag, null);
  assert.deepEqual(lit(tree), NOTHING_LIT, "nothing is left drawn as dragged");
  // Into a group that has no rule, and out of the group its name picks.
  pressRow(tree, rowOf(tagged), m.cx);
  releaseOn(tree, "fizzy-group-g-2", m.cx);
  assert.equal(savedGroups().length, 2);
  assert.deepEqual(savedGroups()[1].boards[tagged], { group: "g-2" });
  // The other flag is kept.
  tree = await m.draw();
  pressRow(tree, rowOf(personal), m.cx);
  releaseOn(tree, "fizzy-group-g-2", m.cx);
  assert.deepEqual(savedGroups()[2].boards[personal], { hidden: true, group: "g-2" });
  // Back to the block its name picks: Automatic again, nothing kept of the choice.
  tree = await m.draw();
  pressRow(tree, rowOf(tagged), m.cx);
  releaseOn(tree, "fizzy-group-team", m.cx);
  assert.equal(savedGroups().length, 4);
  assert.equal(Object.hasOwn(savedGroups()[3].boards, tagged), false, "no entry left for it");
  // The boards list follows.
  click(await leaveSettings(m), "fizzy-board", m.cx);
  const list = listOf((await mountPopup()).tree());
  assert.equal(list.includes("# By hand"), false, "a group with no board to show has no label in the list");
  assert.ok(list.indexOf(`board-${roadmap}`) > list.indexOf("# Team"));
  assert.deepEqual(acct.writes(), [], "nothing here writes to Fizzy");
  assert.deepEqual(calls.hc, []);
});

test("⌘/Ctrl-drag a board onto another board's row: a line shows where it lands, and letting go puts it there (after it moving down, before it moving up), joining that row's group; the boards list follows", async () => {
  sampleBoards();
  seedGroups(TWO());
  const roadmap = boardId("Roadmap");
  const m = await mount();
  let tree = await settingsPage(m);
  const team = boardRowsIn(tree, "fizzy-group-team");
  const lines = () => all(must(tree, "fizzy-settings"), n => n.id?.startsWith("fizzy-board-line-")).map(n => [n.id.slice("fizzy-board-line-".length), "top" in n.style ? "top" : "bottom"]);
  pressRow(tree, rowOf(team[0]), m.cx);
  hoverOn(tree, rowOf(team[0]), true, m.cx);
  tree = await m.draw();
  assert.deepEqual(lines(), [], "its own row draws none");
  hoverOn(tree, rowOf(team[2]), true, m.cx);
  hoverOn(tree, rowOf(team[0]), false, m.cx);
  tree = await m.draw();
  assert.deepEqual(lines(), [[team[2], "bottom"]]);
  const stopped = m.cx.stopped;
  releaseOn(tree, rowOf(team[2]), m.cx);
  assert.equal(m.cx.stopped, stopped + 1, "the block around the row does not take it too");
  assert.equal(savedGroups().length, 1);
  tree = await m.draw();
  assert.deepEqual(boardRowsIn(tree, "fizzy-group-team"), [team[1], team[2], team[0], ...team.slice(3)]);
  assert.deepEqual([m.view.drag, lines()], [null, []]);
  // Up from No group: before the row, in its group.
  pressRow(tree, rowOf(roadmap), m.cx);
  hoverOn(tree, rowOf(team[2]), true, m.cx);
  tree = await m.draw();
  assert.deepEqual(lines(), [[team[2], "top"]]);
  releaseOn(tree, rowOf(team[2]), m.cx);
  assert.equal(savedGroups()[1].boards[roadmap].group, "team");
  tree = await m.draw();
  assert.deepEqual(boardRowsIn(tree, "fizzy-group-team"), [team[1], roadmap, team[2], team[0], ...team.slice(3)]);
  // Let go on its own row: nothing saved. A group let go over a row is left to the block around it.
  pressRow(tree, rowOf(roadmap), m.cx);
  releaseOn(tree, rowOf(roadmap), m.cx);
  assert.equal(savedGroups().length, 2);
  pressRow(tree, "fizzy-group-head-g-2", m.cx);
  releaseOn(tree, rowOf(roadmap), m.cx);
  assert.equal(m.view.drag?.kind, "group");
  m.view.endDrag(m.cx);
  click(await leaveSettings(m), "fizzy-board", m.cx);
  const list = listOf((await mountPopup()).tree()), at = [team[1], roadmap, team[2]].map(id => list.indexOf(`board-${id}`));
  assert.ok(at[0] >= 0 && at[0] < at[1] && at[1] < at[2], "in the boards list's order too");
  assert.deepEqual(acct.writes(), [], "nothing here writes to Fizzy");
});

test("⌘/Ctrl-drag a board onto No group saves once: Automatic when no rule picks it, a choice of no group when one does; a board stored in a group by hand and not picked by a rule goes back to Automatic", async () => {
  sampleBoards();
  const [tagged, roadmap, garden, travel] = ["Support rota [team]", "Roadmap", "Garden", "Travel"].map(boardId);
  state.shared["fizzy.boardGroups"] = { ...TWO(), boards: { [garden]: { group: "team" }, [travel]: { group: "g-2", hidden: true } } };
  const m = await mount();
  let tree = await settingsPage(m);
  assert.ok(boardRowsIn(tree, "fizzy-group-team").includes(garden), "put there by hand");
  pressRow(tree, rowOf(garden), m.cx);
  releaseOn(tree, "fizzy-nogroup", m.cx);
  assert.equal(savedGroups().length, 1, "saved once");
  assert.equal(Object.hasOwn(savedGroups()[0].boards, garden), false, "no rule picks Garden: Automatic, nothing kept");
  tree = await m.draw();
  assert.ok(boardRowsIn(tree, "fizzy-nogroup").includes(garden));
  // A board its name puts in Team, dragged out: a choice of no group.
  pressRow(tree, rowOf(tagged), m.cx);
  releaseOn(tree, "fizzy-nogroup", m.cx);
  assert.equal(savedGroups().length, 2);
  assert.deepEqual(savedGroups()[1].boards[tagged], { group: null });
  tree = await m.draw();
  assert.ok(boardRowsIn(tree, "fizzy-nogroup").includes(tagged));
  // Its hidden flag stays with it.
  pressRow(tree, rowOf(travel), m.cx);
  releaseOn(tree, "fizzy-nogroup", m.cx);
  assert.deepEqual(savedGroups()[2].boards[travel], { hidden: true });
  // A board in No group dropped on No group, and a board dropped on its own block: nothing is saved.
  tree = await m.draw();
  pressRow(tree, rowOf(roadmap), m.cx);
  releaseOn(tree, "fizzy-nogroup", m.cx);
  pressRow(tree, rowOf(boardId("Field notes [TEAM]")), m.cx);
  releaseOn(tree, "fizzy-group-team", m.cx);
  assert.equal(savedGroups().length, 3, "nothing to save");
  assert.deepEqual(lit(await m.draw()), NOTHING_LIT);
  assert.deepEqual(acct.writes(), []);
});

test("a board dropped on its own block saves nothing, even when its choice is the one its name would make", async () => {
  sampleBoards();
  const [tagged, roadmap] = ["Support rota [team]", "Roadmap"].map(boardId);
  state.shared["fizzy.boardGroups"] = { ...TWO(), boards: { [tagged]: { group: "team" }, [roadmap]: { group: null } } };
  const m = await mount();
  const tree = await settingsPage(m);
  pressRow(tree, rowOf(tagged), m.cx);
  releaseOn(tree, "fizzy-group-team", m.cx);
  pressRow(tree, rowOf(roadmap), m.cx);
  releaseOn(tree, "fizzy-nogroup", m.cx);
  assert.deepEqual(savedGroups(), []);
  assert.equal(m.view.drag, null);
});

test("without ⌘/Ctrl nothing is dragged and every click works; Ctrl picks a row up like ⌘; a press on a button, in a field or on a plain row never does", async () => {
  sampleBoards();
  state.shared["fizzy.boardGroups"] = TWO();
  const m = await mount();
  let tree = await settingsPage(m);
  const roadmap = boardId("Roadmap");
  // A press without ⌘/Ctrl (no modifiers at all, or only others) is only a press: letting go on another block changes nothing, and
  // none of it redraws.
  const n = m.cx.notified;
  for (const event of [{ modifiers: {} }, {}, { modifiers: { shift: true, alt: true, platform: false, control: false } }]) {
    pressRow(tree, rowOf(roadmap), m.cx, event);
    hoverOn(tree, "fizzy-group-g-2", true, m.cx);
    releaseOn(tree, "fizzy-group-g-2", m.cx);
    pressRow(tree, "fizzy-group-head-g-2", m.cx, event);
    releaseOn(tree, "fizzy-group-team", m.cx);
    fire(must(tree, "fizzy"), "on_mouse_up:left", {}, m.cx);
  }
  assert.equal(m.cx.notified, n, "no state changed");
  assert.deepEqual(lit(await m.draw()), NOTHING_LIT);
  assert.deepEqual(savedGroups(), []);
  // The clicks.
  click(tree, "fizzy-group-name-team", m.cx);
  tree = await m.draw();
  assert.ok(find(tree, "fizzy-group-rename-team"), "a click on the name renames it");
  click(tree, "fizzy-group-cancel-team", m.cx);
  tree = await m.draw();
  click(tree, "fizzy-group-match-g-2", m.cx);
  tree = await m.draw();
  assert.ok(find(tree, "fizzy-group-match-edit-g-2"), "a click on the rule changes it");
  click(tree, "fizzy-group-match-cancel-g-2", m.cx);
  tree = await m.draw();
  click(tree, "fizzy-group-hide-g-2", m.cx);
  assert.equal(savedGroups().length, 1, "the eye");
  assert.equal(savedGroups()[0].groups[1].hidden, true);
  tree = await m.draw();
  click(tree, `fizzy-board-hide-${roadmap}`, m.cx);
  assert.equal(savedGroups().length, 2, "a board's eye");
  click(tree, "fizzy-group-del-g-2", m.cx);
  assert.equal(savedGroups().length, 2, "the first click on the bin only asks");
  // Ctrl (as on other systems than the Mac) picks up like ⌘.
  tree = await m.draw();
  pressRow(tree, rowOf(roadmap), m.cx, { modifiers: { control: true } });
  assert.deepEqual(lit(await m.draw()).picked, [rowOf(roadmap)]);
  releaseOn(tree, "fizzy-group-g-2", m.cx);
  assert.equal(savedGroups().length, 3);
  assert.deepEqual(savedGroups()[2].boards[roadmap], { hidden: true, group: "g-2" });
  // The buttons and the fields stop a press: it is not a press on a row, with ⌘/Ctrl or without.
  const stopsPress = (tree, list) => {
    for (const id of list) {
      const pressed = makeCx();
      fire(must(tree, id), "on_mouse_down:left", { ...CMD, button: "left" }, pressed);
      assert.equal(pressed.stopped, 1, id);
    }
  };
  tree = await m.draw();
  click(tree, "fizzy-group-match-g-2", m.cx);
  tree = await m.draw();
  stopsPress(tree, [`fizzy-board-hide-${roadmap}`, "fizzy-group-hide-team", "fizzy-group-del-team", "fizzy-groups-add", "fizzy-group-match-edit-g-2", "fizzy-group-match-cancel-g-2"]);
  click(tree, "fizzy-groups-add", m.cx);
  stopsPress(await m.draw(), ["fizzy-group-new-row", "fizzy-group-new-cancel"]);
  assert.deepEqual(lit(await m.draw()), NOTHING_LIT);
  assert.deepEqual(acct.writes(), []);
});

test("⌘/Ctrl on a group's name or rule is not a click: it neither renames nor folds, and the press falls through to the header, which picks the group up", async () => {
  seedGroups();
  const m = await mount();
  let tree = await settingsPage(m);
  // The name has no press of its own, so a ⌘/Ctrl-press on it reaches the header.
  assert.equal(must(tree, "fizzy-group-name-team").handlers["on_mouse_down:left"], undefined);
  assert.equal(must(tree, "fizzy-group-match-team").handlers["on_mouse_down:left"], undefined);
  pressRow(tree, "fizzy-group-head-team", m.cx);
  assert.deepEqual(m.view.drag, { kind: "group", id: "team", over: null });
  releaseOn(tree, "fizzy-group-team", m.cx);
  const held = makeCx();
  click(tree, "fizzy-group-name-team", held, CMD);
  click(tree, "fizzy-group-match-team", held, CMD);
  assert.equal(held.stopped, 0, "the click goes on to the header, which ignores it with ⌘/Ctrl");
  tree = await m.draw();
  assert.equal(find(tree, "fizzy-group-rename-team") ?? find(tree, "fizzy-group-match-edit-team"), null);
  assert.deepEqual(savedGroups(), []);
  // A group being renamed has no header, so it cannot be picked up; a press in its row ends a drag left behind.
  click(tree, "fizzy-group-name-team", m.cx);
  tree = await m.draw();
  assert.equal(find(tree, "fizzy-group-head-team"), null);
  pressRow(tree, rowOf("b1"), m.cx);
  assert.deepEqual(m.view.drag, { kind: "board", id: "b1", over: null }, "left behind");
  pressRow(tree, "fizzy-group-rename-team", m.cx, { modifiers: {} });
  releaseOn(tree, "fizzy-group-team", m.cx);
  assert.equal(m.view.drag, null, "the row's press ended it and picked nothing");
  assert.deepEqual(savedGroups(), [], "and the release moved nothing");
});

test("⌘/Ctrl-drag a group's header onto another group's block: it takes that place (before when moving up, after when moving down), saved once, the boards list follows; onto itself or No group: nothing", async () => {
  sampleBoards();
  const [travel, garden] = ["Travel", "Garden"].map(boardId);
  state.shared["fizzy.boardGroups"] = {
    groups: [
      { ...TEAM }, { id: "g-2", name: "Later", match: "", hidden: true }, { id: "g-3", name: "Quiet", match: "quiet", hidden: false },
    ],
    boards: { [travel]: { group: "g-2" }, [garden]: { group: "g-3" } },
  };
  const m = await mount();
  let tree = await settingsPage(m);
  const kept = () => savedGroups().at(-1).groups.map(g => g.id);
  // The boards list shows the groups in this order; Settings is reopened afterwards.
  const labels = async () => {
    click(await leaveSettings(m), "fizzy-board", m.cx);
    const found = listOf((await mountPopup()).tree()).filter(i => i.startsWith("# "));
    tree = await settingsPage(m);
    return found;
  };
  const drag = async (from, to) => {
    tree = await m.draw();
    pressRow(tree, `fizzy-group-head-${from}`, m.cx);
    hoverOn(tree, to === "nogroup" ? "fizzy-nogroup" : `fizzy-group-${to}`, true, m.cx);
    releaseOn(tree, to === "nogroup" ? "fizzy-nogroup" : `fizzy-group-${to}`, m.cx);
    tree = await m.draw();
  };
  assert.deepEqual(orderOf(tree), ["team", "g-2", "g-3"]);
  assert.deepEqual(await labels(), ["# Team", "# Quiet"], "(a hidden group is not in the list)");
  await drag("g-3", "team");        // up, to the first place
  assert.equal(savedGroups().length, 1, "saved once");
  assert.deepEqual(kept(), ["g-3", "team", "g-2"]);
  assert.deepEqual(orderOf(tree), ["g-3", "team", "g-2"], "the page");
  assert.deepEqual(await labels(), ["# Quiet", "# Team"], "the boards list");
  await drag("g-3", "g-2");            // down, to the last place
  assert.deepEqual(kept(), ["team", "g-2", "g-3"]);
  assert.deepEqual(orderOf(tree), ["team", "g-2", "g-3"]);
  await drag("team", "g-3");        // down, past two
  assert.deepEqual(kept(), ["g-2", "g-3", "team"]);
  assert.deepEqual(await labels(), ["# Quiet", "# Team"]);
  await drag("g-3", "g-2");            // up by one
  assert.deepEqual(kept(), ["g-3", "g-2", "team"]);
  await drag("g-2", "team");        // down by one
  assert.deepEqual(kept(), ["g-3", "team", "g-2"]);
  assert.equal(savedGroups().length, 5);
  // The groups themselves and the boards in them are as they were.
  assert.deepEqual(savedGroups().at(-1).groups.find(g => g.id === "g-3"), { id: "g-3", name: "Quiet", match: "quiet", hidden: false });
  assert.deepEqual(savedGroups().at(-1).groups.find(g => g.id === "g-2"), { id: "g-2", name: "Later", match: "", hidden: true });
  assert.deepEqual(savedGroups().at(-1).boards, { [travel]: { group: "g-2" }, [garden]: { group: "g-3" } });
  // Onto itself, and onto No group: nothing.
  await drag("g-3", "g-3");
  await drag("team", "nogroup");
  tree = await m.draw();
  pressRow(tree, "fizzy-group-head-team", m.cx);
  releaseOn(tree, "fizzy-group-team", m.cx);
  assert.equal(savedGroups().length, 5, "nothing saved");
  assert.deepEqual(orderOf(tree), ["g-3", "team", "g-2"]);
  assert.deepEqual(lit(await m.draw()), NOTHING_LIT);
  assert.deepEqual(acct.writes(), []);
});

test("while a group is dragged an accent line shows where it lands: at the top edge of a block above it, at the bottom edge of one below it; No group and its own block draw none", async () => {
  state.shared["fizzy.boardGroups"] = TWO();
  const m = await mount();
  let tree = await settingsPage(m);
  const team = tree => must(tree, "fizzy-group-team"), second = tree => must(tree, "fizzy-group-g-2");
  pressRow(tree, "fizzy-group-head-g-2", m.cx);
  hoverOn(tree, "fizzy-group-team", true, m.cx);
  tree = await m.draw();
  assert.deepEqual(lit(tree), { picked: ["fizzy-group-head-g-2"], over: [], lines: ["fizzy-group-line-team"] }, "no block is lit for a group");
  const line = must(tree, "fizzy-group-line-team");
  assert.deepEqual([line.style.absolute, line.style.left, line.style.right, line.style.h, line.style.rounded, line.style.bg, line.style.top, line.style.bottom], [true, 8, 8, 2, 1, "accent", -2, undefined]);
  assert.equal(team(tree).kids[0], line, "a child of the target block, before its header");
  assert.equal(typeof line.handlers["on_mouse_down:left"], "function");
  releaseOn(tree, "fizzy-group-team", m.cx);
  assert.equal(savedGroups().length, 1);
  assert.deepEqual(savedGroups()[0].groups.map(g => g.id), ["g-2", "team"], "it lands before Team");
  // The reverse: the line is at the bottom edge of the block below.
  tree = await m.draw();
  pressRow(tree, "fizzy-group-head-g-2", m.cx);
  hoverOn(tree, "fizzy-group-team", true, m.cx);
  tree = await m.draw();
  assert.deepEqual(lit(tree).lines, ["fizzy-group-line-team"]);
  assert.deepEqual([must(tree, "fizzy-group-line-team").style.top, must(tree, "fizzy-group-line-team").style.bottom], [undefined, -2], "g-2 now sits above Team: it lands after");
  releaseOn(tree, "fizzy-group-team", m.cx);
  assert.deepEqual(savedGroups()[1].groups.map(g => g.id), ["team", "g-2"]);
  // Its own block, No group, and leaving a block draw none.
  tree = await m.draw();
  pressRow(tree, "fizzy-group-head-g-2", m.cx);
  hoverOn(tree, "fizzy-group-g-2", true, m.cx);
  assert.deepEqual(lit(await m.draw()).lines, []);
  hoverOn(tree, "fizzy-nogroup", true, m.cx);
  assert.deepEqual(lit(await m.draw()), { picked: ["fizzy-group-head-g-2"], over: [], lines: [] });
  hoverOn(tree, "fizzy-group-team", true, m.cx);
  hoverOn(tree, "fizzy-nogroup", false, m.cx);
  assert.deepEqual(lit(await m.draw()).lines, ["fizzy-group-line-team"]);
  hoverOn(tree, "fizzy-group-team", false, m.cx);
  assert.deepEqual(lit(await m.draw()).lines, []);
  releaseOn(tree, "fizzy-nogroup", m.cx);
  assert.equal(savedGroups().length, 2, "No group is always last: nothing");
  assert.equal(second(await m.draw()).style.bg, undefined);
});

test("a ⌘/Ctrl-pressed board has an accent border, a raised background and a grabbing pointer on the page; rows, headers, buttons and eyes lose their hover and pointer while the drag lasts", async () => {
  sampleBoards();
  state.shared["fizzy.boardGroups"] = TWO();
  const m = await mount();
  let tree = await settingsPage(m);
  const roadmap = boardId("Roadmap");
  // Nothing is dragged: the page is plain, and the rows have their hover.
  assert.equal(must(tree, "fizzy-settings").style.cursor_grabbing, undefined);
  const hoverable = ["fizzy-group-head-team", rowOf(roadmap), "fizzy-nogroup-head", "fizzy-group-name-team", "fizzy-group-match-team", "fizzy-groups-add", "fizzy-group-hide-team", "fizzy-group-del-team", `fizzy-board-hide-${roadmap}`];
  for (const id of hoverable) assert.equal(must(tree, id).hover, true, `${id}: hover`);
  for (const id of hoverable.filter(id => id !== rowOf(roadmap))) assert.equal(must(tree, id).style.cursor_pointer, true, `${id}: pointer`);
  pressRow(tree, rowOf(roadmap), m.cx);
  tree = await m.draw();
  const row = must(tree, rowOf(roadmap));
  assert.deepEqual([row.style.border_color, row.style.bg, row.style.border_1], ["accent", "raised", true]);
  assert.equal(must(tree, "fizzy-settings").style.cursor_grabbing, true);
  assert.deepEqual(lit(tree), { picked: [rowOf(roadmap)], over: [], lines: [] });
  for (const id of hoverable) {
    assert.equal(must(tree, id).hover, false, `${id}: no hover while dragging`);
    assert.equal(must(tree, id).style.cursor_pointer, undefined, `${id}: no pointer while dragging`);
  }
  releaseOn(tree, "fizzy-group-team", m.cx);
  tree = await m.draw();
  assert.equal(must(tree, "fizzy-settings").style.cursor_grabbing, undefined);
  assert.equal(must(tree, "fizzy-group-head-team").hover, true);
  // A group's header looks the same when it is picked.
  pressRow(tree, "fizzy-group-head-g-2", m.cx);
  tree = await m.draw();
  const head = must(tree, "fizzy-group-head-g-2");
  assert.deepEqual([head.style.border_color, head.style.bg], ["accent", "raised"]);
  assert.equal(must(tree, "fizzy-group-head-team").style.border_color, "#00000000");
});

test("hovering blocks while a board is dragged: the block that takes it is lit as a whole, the board's own block never is, and A to B never ends with no target; hovering without a drag changes nothing", async () => {
  sampleBoards();
  state.shared["fizzy.boardGroups"] = TWO();
  const m = await mount();
  let tree = await settingsPage(m);
  const roadmap = boardId("Roadmap"), at = async () => lit((tree = await m.draw()));
  // Nothing is dragged: entering and leaving blocks is quiet.
  const n = m.cx.notified;
  for (const id of ["fizzy-group-team", "fizzy-nogroup"]) { hoverOn(tree, id, true, m.cx); hoverOn(tree, id, false, m.cx); }
  assert.equal(m.cx.notified, n, "not even a redraw");
  pressRow(tree, rowOf(roadmap), m.cx);
  assert.deepEqual(await at(), { picked: [rowOf(roadmap)], over: [], lines: [] });
  hoverOn(tree, "fizzy-group-team", true, m.cx);
  assert.deepEqual(await at(), { picked: [rowOf(roadmap)], over: ["fizzy-group-team"], lines: [] }, "the whole Team block is lit");
  hoverOn(tree, "fizzy-group-team", false, m.cx);
  assert.deepEqual((await at()).over, [], "leaving it puts it out");
  // The next block is entered before the last is left, and the other way round: the last one entered is lit.
  hoverOn(tree, "fizzy-group-team", true, m.cx);
  hoverOn(tree, "fizzy-group-g-2", true, m.cx);
  hoverOn(tree, "fizzy-group-team", false, m.cx);
  assert.deepEqual((await at()).over, ["fizzy-group-g-2"], "B stays lit");
  hoverOn(tree, "fizzy-group-g-2", false, m.cx);
  hoverOn(tree, "fizzy-group-team", true, m.cx);
  assert.deepEqual((await at()).over, ["fizzy-group-team"]);
  // The board's own block takes nothing, and leaving a block that is not lit changes nothing.
  hoverOn(tree, "fizzy-nogroup", true, m.cx);
  hoverOn(tree, "fizzy-group-team", false, m.cx);
  assert.deepEqual((await at()).over, [], "No group is Roadmap's own block");
  const quiet = m.cx.notified;
  hoverOn(tree, "fizzy-group-g-2", false, m.cx);
  hoverOn(tree, "fizzy-nogroup", true, m.cx);
  assert.equal(m.cx.notified, quiet, "nothing changed, nothing redrawn");
  // A board in a group lights No group, and the other group, not its own.
  hoverOn(tree, "fizzy-nogroup", false, m.cx);
  releaseOn(tree, "fizzy-group-team", m.cx);
  tree = await m.draw();
  pressRow(tree, rowOf(roadmap), m.cx);
  hoverOn(tree, "fizzy-group-team", true, m.cx);
  assert.deepEqual((await at()).over, [], "Team is its own block now");
  hoverOn(tree, "fizzy-nogroup", true, m.cx);
  assert.deepEqual((await at()).over, ["fizzy-nogroup"]);
  releaseOn(tree, "fizzy-nogroup", m.cx);
  assert.deepEqual(await at(), NOTHING_LIT);
  assert.equal(savedGroups().length, 2);
  assert.deepEqual(acct.writes(), []);
});

test("a drag ends with nothing changed: let go on the panel's root, a press outside it, a plain press in a block, Back, the back key, or a card opened; a release on a block afterwards drops nothing", async () => {
  sampleBoards();
  state.shared["fizzy.boardGroups"] = TWO();
  const m = await mount();
  let tree = await settingsPage(m);
  const roadmap = boardId("Roadmap");
  let picked;
  const ends = {
    "let go on the root": () => fire(must(tree, "fizzy"), "on_mouse_up:left", {}, m.cx),
    "a press outside the panel": () => fire(must(tree, "fizzy"), "on_mouse_down_out", {}, m.cx),
    "a plain press on a header": () => pressRow(tree, "fizzy-group-head-g-2", m.cx, { modifiers: {} }),
    "a plain press on a board row": () => pressRow(tree, rowOf(boardId("Personal")), m.cx, { modifiers: {} }),
    "a press on the No group header": () => pressRow(tree, "fizzy-nogroup-head", m.cx),
    "back": () => click(tree, "fizzy-back", m.cx),
    "the back key": () => sendCommand("back"),
    "a card opened": () => sendCommand("open:101"),
  };
  for (const [what, end] of Object.entries(ends)) {
    for (picked of [rowOf(roadmap), "fizzy-group-head-team"]) {
      tree = await m.draw();
      pressRow(tree, picked, m.cx);
      hoverOn(tree, "fizzy-group-g-2", true, m.cx);
      assert.deepEqual((tree = await m.draw()) && lit(tree).picked, [picked], `${what}: it is picked up`);
      end();
      await tick();
      await m.cx.settle();
      if (what === "back" || what === "the back key" || what === "a card opened") {
        assert.equal(m.view.drag, null, `${what}: the page is left`);
        if (what === "a card opened") {
          click(await m.draw(), "fizzy-back", m.cx);
          tree = await settingsPage(m);
        } else {
          click(await m.draw(), "fizzy-setting-groups", m.cx);
          tree = await m.draw();
        }
      } else {
        tree = await m.draw();
        assert.deepEqual(lit(tree), NOTHING_LIT, `${what}: nothing is drawn as dragged`);
      }
      assert.equal(m.view.drag, null, `${what}: the drag is over`);
      releaseOn(tree, "fizzy-group-g-2", m.cx);
      assert.deepEqual(savedGroups(), [], `${what}: nothing saved`);
    }
  }
  assert.deepEqual(acct.writes(), []);
});

test("a drag left behind (let go away from the panel) ends with the next press on a button, a field's row, an empty row or the insertion line: the plain click after it moves nothing", async () => {
  sampleBoards();
  const [roadmap, personal] = ["Roadmap", "Personal"].map(boardId);
  state.shared["fizzy.boardGroups"] = { ...TWO(), boards: { [personal]: { group: "g-2" } } };
  const m = await mount();
  let tree = await settingsPage(m);
  // Roadmap is picked up with ⌘/Ctrl and let go outside the panel: nothing here hears the release, so the drag stays.
  const leftBehind = async () => {
    tree = await m.draw();
    pressRow(tree, rowOf(roadmap), m.cx);
    assert.deepEqual(m.view.drag, { kind: "board", id: roadmap, over: null }, "left behind");
  };
  // A plain click on a button as Herdr delivers it: the press, the release over the block that holds it, the click.
  const plainClick = async (button, block) => {
    fire(must(tree, button), "on_mouse_down:left", { button: "left", click_count: 1, modifiers: {} }, m.cx);
    assert.equal(m.view.drag, null, `${button}: the press ended the drag`);
    if (block) releaseOn(tree, block, m.cx);
    click(tree, button, m.cx);
    assert.deepEqual(lit(tree = await m.draw()), NOTHING_LIT);
  };
  await leftBehind();
  await plainClick(`fizzy-board-hide-${personal}`, "fizzy-group-g-2");
  assert.equal(savedGroups().length, 1, "only the eye saved");
  assert.deepEqual(savedGroups()[0].boards, { [personal]: { group: "g-2", hidden: true } }, "and Roadmap did not join the group Personal is in");
  await leftBehind();
  await plainClick("fizzy-group-hide-g-2", "fizzy-group-g-2");
  assert.equal(savedGroups().length, 2);
  assert.equal(savedGroups()[1].groups[1].hidden, true);
  assert.deepEqual(savedGroups()[1].boards, savedGroups()[0].boards, "Roadmap was not put in the group whose eye was clicked");
  await leftBehind();
  await plainClick("fizzy-group-del-g-2", "fizzy-group-g-2");
  assert.equal(savedGroups().length, 2, "the first click on the bin only asks");
  assert.match(textOf(must(tree, "fizzy-group-del-g-2")), /Delete\?/);
  await leftBehind();
  await plainClick("fizzy-groups-add", "fizzy-group-team");
  assert.ok(find(tree, "fizzy-group-new-row"));
  assert.equal(savedGroups().length, 2);
  // A field's row: its press ends the drag, and so does the x.
  await leftBehind();
  fire(must(tree, "fizzy-group-new-row"), "on_mouse_down:left", { button: "left", click_count: 1, modifiers: {} }, m.cx);
  assert.equal(m.view.drag, null, "a press in the field's row");
  releaseOn(tree, "fizzy-group-team", m.cx);
  await leftBehind();
  await plainClick("fizzy-group-new-cancel", "fizzy-group-team");
  assert.equal(find(tree, "fizzy-group-new-row"), null);
  click(tree, "fizzy-group-name-team", m.cx);
  await leftBehind();
  assert.ok(find(tree, "fizzy-group-rename-team"));
  await plainClick("fizzy-group-cancel-team", "fizzy-group-team");
  assert.equal(find(tree, "fizzy-group-rename-team"), null, "the x left the edit");
  // The empty row of a group, and the No group header: presses that pick nothing.
  state.shared["fizzy.boardGroups"] = { ...TWO(), groups: [...TWO().groups, { id: "g-3", name: "Empty", match: "", hidden: false }] };
  tree = await m.draw();
  for (const id of ["fizzy-group-empty-g-3", "fizzy-nogroup-head"]) {
    await leftBehind();
    fire(must(tree, id), "on_mouse_down:left", { ...CMD, button: "left", click_count: 1 }, m.cx);
    assert.equal(m.view.drag, null, `${id}: ends the drag and picks nothing`);
    releaseOn(tree, "fizzy-group-team", m.cx);
  }
  assert.equal(savedGroups().length, 2, "nothing moved");
  assert.deepEqual(acct.writes(), []);
});

test("a drag left behind is also ended by the insertion line and the empty rows, and the release on a block afterwards drops nothing", async () => {
  sampleBoards();
  state.shared["fizzy.boardGroups"] = { ...TWO(), boards: { [boardId("Roadmap")]: { group: "g-2" } } };
  const m = await mount();
  let tree = await settingsPage(m);
  const roadmap = boardId("Roadmap"), personal = boardId("Personal");
  // A board is picked up and left behind; a group drag shows the line, whose press ends it.
  pressRow(tree, rowOf(personal), m.cx);
  pressRow(tree, "fizzy-group-head-g-2", m.cx);
  hoverOn(tree, "fizzy-group-team", true, m.cx);
  tree = await m.draw();
  const line = must(tree, "fizzy-group-line-team");
  fire(line, "on_mouse_down:left", { button: "left", ...CMD }, m.cx);
  assert.equal(m.view.drag, null, "the line's press ends it");
  releaseOn(tree, "fizzy-group-team", m.cx);
  // ⌘/Ctrl-press on a board row, then on the empty row of an empty group and a release on that block.
  click(tree, "fizzy-groups-add", m.cx);
  inputOf(await m.draw(), "fizzy-group-new").edit("Empty", m.cx);
  inputOf(await m.draw(), "fizzy-group-new").submit(m.cx);
  tree = await m.draw();
  const empty = orderOf(tree)[0];
  assert.equal(textOf(must(tree, `fizzy-group-empty-${empty}`)).trim(), "No boards");
  const saved = savedGroups().length;
  pressRow(tree, rowOf(roadmap), m.cx);
  fire(must(tree, `fizzy-group-empty-${empty}`), "on_mouse_down:left", { button: "left", ...CMD }, m.cx);
  assert.equal(m.view.drag, null, "the empty row's press ends it");
  releaseOn(tree, `fizzy-group-${empty}`, m.cx);
  assert.equal(savedGroups().length, saved, "nothing moved");
  pressRow(tree, rowOf(personal), m.cx);
  fire(must(tree, "fizzy-nogroup-head"), "on_mouse_down:left", { button: "left", ...CMD }, m.cx);
  releaseOn(tree, "fizzy-nogroup", m.cx);
  assert.equal(savedGroups().length, saved);
});

test("the hover and the release are on the blocks and the board rows, the press is on the headers and board rows; the No group header, the empty rows and the insertion line press without ever picking", async () => {
  sampleBoards();
  state.shared["fizzy.boardGroups"] = { groups: [...TWO().groups, { id: "g-3", name: "Empty", match: "nobody", hidden: false }], boards: {} };
  const m = await mount();
  let tree = await settingsPage(m);
  pressRow(tree, "fizzy-group-head-g-2", m.cx);
  hoverOn(tree, "fizzy-group-team", true, m.cx);
  tree = await m.draw();
  const page = must(tree, "fizzy-settings");
  const blocks = ["fizzy-group-team", "fizzy-group-g-2", "fizzy-group-g-3", "fizzy-nogroup"];
  const targets = all(page, n => blocks.includes(n.id) || /^fizzy-board-row-/.test(n.id ?? "")).map(n => n.id);
  assert.equal(targets.length, blocks.length + SAMPLE_BOARDS.length);
  assert.deepEqual(all(page, n => n.handlers.on_hover).map(n => n.id), targets, "the hover is on the blocks and the board rows only");
  assert.deepEqual(all(page, n => n.handlers["on_mouse_up:left"]).map(n => n.id), targets, "and so is the release");
  const picks = all(page, n => n.id && /^fizzy-(?:group-head|board-row)-/.test(n.id));
  assert.equal(picks.length, 3 + SAMPLE_BOARDS.length);
  for (const n of picks) assert.equal(typeof n.handlers["on_mouse_down:left"], "function", n.id);
  for (const n of picks.filter(p => p.id.startsWith("fizzy-group-head-"))) assert.deepEqual(["on_hover", "on_mouse_up:left"].filter(h => n.handlers[h]), [], `${n.id}: no hover and no release of its own`);
  const pressOnly = ["fizzy-nogroup-head", "fizzy-group-empty-g-2", "fizzy-group-empty-g-3", "fizzy-group-line-team"];
  for (const id of pressOnly) assert.equal(typeof must(tree, id).handlers["on_mouse_down:left"], "function", id);
  // None of them picks anything up, even with ⌘/Ctrl.
  fire(must(tree, "fizzy-group-line-team"), "on_mouse_down:left", { button: "left", ...CMD }, m.cx);
  for (const id of pressOnly.slice(0, 3)) {
    pressRow(tree, "fizzy-group-head-team", m.cx);
    fire(must(tree, id), "on_mouse_down:left", { button: "left", ...CMD }, m.cx);
    assert.equal(m.view.drag, null, id);
  }
  assert.deepEqual(calls.hc, [], "nothing is ever sent");
  assert.deepEqual(acct.writes(), []);
  assert.deepEqual(savedGroups(), []);
});

const LOGO = "mods/fizzy/kanban.svg";
const headerOf = tree => must(tree, "fizzy").kids[0];
const resize = (tree, cx, width) => fire(must(tree, "fizzy"), "on_size_change", { width, height: 600 }, cx);
const LONG_NAME = "Acme: a long board name that has to be cut short";

test("the header of every list view at the default width: the round Search alone at the left, Fizzy, Mine, Inbox and Pins as one round group in the middle, round Refresh and the gear at the right", async () => {
  const { cx, draw } = await mount();
  let tree = await draw();
  for (const view of ["board", "mine", "inbox", "pins"]) {
    if (view !== "board") { click(tree, `fizzy-view-${view}`, cx); tree = await draw(); }
    const head = headerOf(tree);
    assert.deepEqual([head.style.h, head.style.px, head.style.gap, head.style.border_b, head.style.flex_none], [46, 12, 8, 1, true], `${view}: the header`);
    const [left, views, right] = head.kids;
    assert.equal(head.kids.length, 3);
    assert.deepEqual([left.style.flex_1, right.style.flex_1, right.style.justify_end], [true, true, true], `${view}: the sides share the room, so the group is centered`);
    assert.deepEqual(left.kids.map(k => k.id), ["fizzy-search-open"], `${view}: Search alone`);
    const home = views.kids[0];
    assert.deepEqual(home.kids.map(k => k.kind), ["svg"], `${view}: the icon alone at this width`);
    const [icon] = home.kids;
    assert.deepEqual([icon.path, icon.style.size, icon.style.flex_none], [LOGO, 14, true], `${view}: the kanban icon, 14 px`);
    assert.deepEqual([icon.id, icon.style.tooltip, Object.keys(icon.handlers)], [null, undefined, []], `${view}: the button holds the click, not the icon`);
    assert.equal(home.style.tooltip, "Board", `${view}: without its word it says what it opens`);
    assert.equal(views.id, "fizzy-views");
    assert.deepEqual(views.kids.map(k => k.id), ["fizzy-home", "fizzy-view-mine", "fizzy-view-inbox", "fizzy-view-pins"], `${view}: Fizzy first, then the other views`);
    assert.deepEqual([views.style.gap, views.style.p, views.style.flex_none, views.style.rounded_full, views.style.border_1], [2, 2, true, true, true], "one round group");
    assert.deepEqual(right.kids.map(k => k.id), ["fizzy-refresh", "fizzy-open-settings"]);
    for (const id of ["fizzy-search-open", "fizzy-refresh", "fizzy-open-settings"]) assert.deepEqual([must(tree, id).style.size, must(tree, id).style.rounded_full], [30, true], id);
    assert.match(textOf(must(tree, "fizzy-view-inbox")), /Inbox\s+2/, `${view}: the unread badge stays on the Inbox`);
    for (const id of ["fizzy-view-board", "fizzy-open-board", "fizzy-board"]) assert.equal(find(head, id), null, `${view}: ${id} is not in the header`);
  }
  assert.equal(find(tree, "fizzy-view-board"), null, "there is no Board tab");
});

test("the board row sits under the header in the Board view only, and the list bar at the panel's foot of Board, Mine and Pins; the Inbox has neither", async () => {
  const m = await mount(), { cx, draw } = m;
  let tree = await draw();
  const parts = tree => must(tree, "fizzy").kids.slice(1).map(k => k.id);
  assert.deepEqual(parts(tree), ["fizzy-board-bar", "fizzy-list", "fizzy-list-bar"], "Board");
  for (const [view, expected] of [["mine", ["fizzy-list", "fizzy-list-bar"]], ["inbox", ["fizzy-list"]], ["pins", ["fizzy-list", "fizzy-list-bar"]]]) {
    click(tree, `fizzy-view-${view}`, cx);
    tree = await draw();
    assert.deepEqual(parts(tree), expected, view);
    for (const id of ["fizzy-board-bar", "fizzy-board", "fizzy-open-board"]) assert.equal(find(tree, id), null, `${view}: ${id}`);
  }
  click(tree, "fizzy-home", cx);
  tree = await draw();
  assert.ok(find(tree, "fizzy-board-bar") && find(tree, "fizzy-board") && find(tree, "fizzy-open-board"), "back on Board: all there");
  tree = await searchFor(m, "login");
  assert.deepEqual(parts(tree), ["fizzy-list"], "a search's results: neither");
  click(tree, "fizzy-search-back", cx);
  click(await draw(), "fizzy-card-101", cx);
  assert.deepEqual(parts(await draw()), ["fizzy-detail", "fizzy-bar"], "a card: its page and the hand-offs");
});

test("the list bar per view: on Board the board's own filter and its round filters; on Mine and Pins only the filter they share; each filters its list as it is typed into", async () => {
  acct.pins = [acct.card(102), acct.card(201)];
  const { cx, draw } = await mount();
  let tree = await draw();
  const bar = () => must(tree, "fizzy-list-bar");
  assert.deepEqual(bar().kids.map(k => k.id), ["fizzy-filter", "fizzy-only-mine", "fizzy-only-golden", "fizzy-only-pinned"]);
  assert.equal(inputOf(tree, "fizzy-filter").options.placeholder, "Filter this board…");
  inputOf(tree, "fizzy-filter").edit("changelog", cx);
  tree = await draw();
  assert.deepEqual(rowIds(tree), [102]);
  assert.equal(tipOf(tree, "fizzy-filter-clear"), "Clear", "words bring the clear button");
  for (const view of ["mine", "pins"]) {
    click(tree, `fizzy-view-${view}`, cx);
    tree = await draw();
    assert.deepEqual(bar().kids.map(k => k.id), ["fizzy-filter"], `${view}: the filter alone`);
    assert.deepEqual([inputOf(tree, "fizzy-filter").options.placeholder, inputOf(tree, "fizzy-filter").value()], ["Filter cards…", ""], `${view}: not the board's`);
  }
  inputOf(tree, "fizzy-filter").edit("other", cx);
  tree = await draw();
  assert.deepEqual(rowIds(tree), [201], "Pins, filtered");
  click(tree, "fizzy-view-mine", cx);
  tree = await draw();
  assert.equal(inputOf(tree, "fizzy-filter").value(), "other", "Mine shares Pins' words");
  assert.deepEqual(rowIds(tree), [201]);
  click(tree, "fizzy-home", cx);
  tree = await draw();
  assert.equal(inputOf(tree, "fizzy-filter").value(), "changelog", "the board keeps its own");
  click(tree, "fizzy-filter-clear", cx);
  tree = await draw();
  assert.equal(inputOf(tree, "fizzy-filter").value(), "");
  assert.deepEqual(rowIds(tree), [103, 101, 102]);
});

test("a filter shows every lane that holds a match, folded or not, and leaves the fold kept for the lane as it was", async () => {
  const { cx, draw } = await mount();
  let tree = await draw();
  click(tree, "fizzy-section-c1", cx);
  tree = await draw();
  assert.equal(lanesOf(tree)[101], undefined, "folded");
  inputOf(tree, "fizzy-filter").edit("login", cx);
  tree = await draw();
  assert.deepEqual(lanesOf(tree), { 101: "c1" }, "its match shows");
  assert.equal(iconOf(tree, "fizzy-section-c1"), "chevron-down.svg");
  inputOf(tree, "fizzy-filter").edit("", cx);
  assert.equal(lanesOf(await draw())[101], undefined, "folded again once the filter is empty");
  assert.equal(JSON.parse(localStorage.getItem("collapsed:b1")).c1, true);
});

test("the header's views are pills in their group: the lit one is the view that shows, in medium weight; none is lit in the Board view; each lights on hover", async () => {
  const { cx, draw } = await mount();
  let tree = await draw();
  const look = id => { const b = must(tree, id); return [b.style.h, b.style.px, b.style.rounded_full, b.style.text_size, b.style.flex_none, b.style.bg, b.style.text_color, b.style.font_medium, b.hoverStyle]; };
  const shape = [24, 8, true, textPx(12), true], hover = { bg: "hover", text_color: "foreground" };
  for (const id of ["fizzy-view-mine", "fizzy-view-inbox", "fizzy-view-pins"]) assert.deepEqual(look(id), [...shape, "background", "muted", undefined, hover], `board: ${id}`);
  for (const lit of ["mine", "inbox", "pins"]) {
    click(tree, `fizzy-view-${lit}`, cx);
    tree = await draw();
    for (const view of ["mine", "inbox", "pins"]) {
      assert.deepEqual(look(`fizzy-view-${view}`), view === lit ? [...shape, "selected", "foreground", true, hover] : [...shape, "background", "muted", undefined, hover], `${lit}: ${view}`);
    }
  }
});

test("the Fizzy button is a pill of the view group, shaped as the views: lit only in the Board view, and a click shows the Board view from Mine, the Inbox and Pins", async () => {
  const { view, cx, draw } = await mount();
  let tree = await draw();
  const look = () => { const b = must(tree, "fizzy-home"); return [b.style.h, b.style.px, b.style.gap, b.style.rounded_full, b.style.flex_none, b.style.items_center, b.style.cursor_pointer, b.style.bg, b.style.text_color, b.hoverStyle.bg]; };
  const shape = [24, 8, 5, true, true, true, true];
  assert.deepEqual(look(), [...shape, "selected", "foreground", "hover"], "lit in the Board view");
  assert.equal(typeof must(tree, "fizzy-home").handlers["on_mouse_down:left"], "function", "the press goes no further, as on the views");
  for (const from of ["mine", "inbox", "pins"]) {
    click(tree, `fizzy-view-${from}`, cx);
    tree = await draw();
    assert.deepEqual(look(), [...shape, "background", "muted", "hover"], `${from}: not lit`);
    click(tree, "fizzy-home", cx);
    tree = await draw();
    assert.equal(view.view, "board", `from ${from}`);
    assert.equal(localStorage.getItem("view"), '"board"');
    assert.deepEqual(rowIds(tree).sort(), [101, 102, 103], `from ${from}: the board's cards`);
    assert.deepEqual(look(), [...shape, "selected", "foreground", "hover"], `from ${from}: lit again`);
  }
  assert.equal(calls.openOverlay.length, 0, "the Fizzy button opens no list");
  for (const id of ["fizzy-view-mine", "fizzy-view-inbox", "fizzy-view-pins"]) assert.equal(must(tree, id).style.bg, "background", `${id} is not lit`);
});

test("with no board yet the Fizzy button still shows the Board view", async () => {
  acct.boards.length = 0;
  const { view, cx, draw } = await mount();
  let tree = await draw();
  click(tree, "fizzy-view-mine", cx);
  tree = await draw();
  click(tree, "fizzy-home", cx);
  tree = await draw();
  assert.equal(view.view, "board");
  assert.equal(must(tree, "fizzy-home").style.bg, "selected");
});

const WIDE_HEADER = { word: "Fizzy", homeTip: undefined, tabPx: 12, gap: 8, refresh: true };
const MIDDLE_HEADER = { word: "", homeTip: "Board", tabPx: 8, gap: 8, refresh: true };
const NARROW_HEADER = { word: "", homeTip: "Board", tabPx: 6, gap: 4, refresh: false };

test("the header has three tiers: 440 px and up spells out Fizzy; 340 to 439 keeps the icon; under 340 leaves Refresh out", async () => {
  const { cx, draw } = await mount();
  let tree = await draw();
  const look = tree => {
    const home = must(tree, "fizzy-home");
    return {
      word: textOf(home), homeTip: home.style.tooltip, tabPx: must(tree, "fizzy-view-mine").style.px, gap: headerOf(tree).style.gap,
      refresh: Boolean(find(tree, "fizzy-refresh")),
    };
  };
  assert.deepEqual(look(tree), MIDDLE_HEADER, "before the panel is measured: the default width is the middle tier");
  for (const [width, expected] of [[520, WIDE_HEADER], [440, WIDE_HEADER], [439, MIDDLE_HEADER], [368, MIDDLE_HEADER], [340, MIDDLE_HEADER], [339, NARROW_HEADER], [280, NARROW_HEADER]]) {
    resize(tree, cx, width);
    tree = await draw();
    assert.deepEqual(look(tree), expected, `${width} px`);
    assert.equal(parentOf(tree, "fizzy-view-mine").style.gap, 2, `${width} px: the gap between the views`);
    if (expected.word) {
      const word = must(tree, "fizzy-home").kids.find(k => textOf(k) === "Fizzy");
      assert.deepEqual([word.style.font_semibold, word.style.flex_none], [true, true], `${width} px: the word is semibold and keeps its width`);
    }
    assert.equal(headerOf(tree).kids.at(-1).kids.at(-1).id, "fizzy-open-settings", `${width} px: the gear is still last`);
    assert.equal(tipOf(tree, "fizzy-home"), expected.homeTip);
    for (const id of ["fizzy-view-mine", "fizzy-view-inbox", "fizzy-view-pins"]) assert.equal(must(tree, id).style.px, expected.tabPx, `${width} px: ${id}`);
  }
});

test("from 560 px the header's left holds the search field alone: Enter searches every board, the results take the list's place under the same header, and Escape, a view or the x close them", async () => {
  const { view, cx, draw } = await mount();
  let tree = await draw();
  resize(tree, cx, 559);
  tree = await draw();
  assert.ok(find(tree, "fizzy-search-open") && !find(tree, "fizzy-search"), "559: the round button");
  resize(tree, cx, 560);
  tree = await draw();
  assert.deepEqual(headerOf(tree).kids[0].kids.map(k => k.id), ["fizzy-search"], "the field itself, no button");
  const box = must(tree, "fizzy-search"), input = all(box, n => n.kind === "input")[0];
  assert.deepEqual([box.style.flex_1, box.style.min_w, input.style.h, input.style.rounded_full, input.style.border_color], [true, 0, 30, true, "input"]);
  assert.deepEqual(iconsIn(tree, "fizzy-search"), ["mods/fizzy/search.svg"]);
  const search = async () => {
    const field = inputOf(tree, "fizzy-search");
    field.edit("login", cx);
    field.submit(cx);
    await cx.settle();
    tree = await draw();
  };
  await search();
  assert.equal(view.search?.q, "login");
  assert.ok(find(tree, "fizzy-search-head"), "the results");
  assert.equal(find(tree, "fizzy-search-back"), null, "the header stays as it is");
  assert.equal(all(must(tree, "fizzy-search"), n => n.kind === "input")[0].style.border_color, "accent", "the field says a search is open");
  assert.deepEqual(["fizzy-home", "fizzy-view-mine"].map(id => must(tree, id).style.bg), ["background", "background"], "no view is lit over the results");
  fire(must(tree, "fizzy-search"), "on_key_down", { key: "escape", modifiers: {} }, cx);
  assert.equal(view.search, null, "Escape");
  await search();
  click(tree, "fizzy-view-mine", cx);
  assert.deepEqual([view.search, view.view], [null, "mine"], "a view");
  await search();
  click(tree, "fizzy-search-clear", cx);
  assert.deepEqual([view.search, view.searchField.value()], [null, ""], "the x, which empties the field");
  await press(cx, "search");
  assert.deepEqual([view.search, view.searchField.focused], [null, true], "the search key only puts the focus in the field");
});

test("the header redraws only when the width crosses 340 or 440, and Refresh stays reachable by its key when the header leaves it out", async () => {
  const { cx, draw } = await mount();
  let tree = await draw();
  resize(tree, cx, 300);
  tree = await draw();
  const quiet = cx.notified;
  resize(tree, cx, 280);
  resize(tree, cx, 339);
  assert.equal(cx.notified, quiet, "within a tier: no redraw");
  resize(tree, cx, 340);
  assert.ok(cx.notified > quiet, "across 340: a redraw");
  const middle = cx.notified;
  resize(tree, cx, 439);
  assert.equal(cx.notified, middle, "340 to 439: no redraw");
  resize(tree, cx, 440);
  assert.ok(cx.notified > middle, "across 440: a redraw");
  resize(tree, cx, 280);
  tree = await draw();
  assert.equal(find(tree, "fizzy-refresh"), null);
  const before = acct.log.length;
  await press(cx, "refresh");
  assert.ok(acct.log.length > before, "the refresh key still reads again");
});

test("the list bar in the board row's look: a round field with a search icon, then on Board the round filters My cards, Golden cards and Pinned cards; no New card", async () => {
  const { cx, draw } = await mount();
  const tree = await draw();
  const bar = must(tree, "fizzy-list-bar");
  assert.deepEqual([bar.style.px, bar.style.py, bar.style.gap, bar.style.bg, bar.style.border_t], [12, 6, 8, undefined, undefined], "the board row's padding, on the panel's own background");
  const input = must(tree, "fizzy-filter").kids[0];
  assert.deepEqual([input.style.h, input.style.rounded_full, input.style.border_1, input.style.pl, input.style.pr], [30, true, true, 32, 14]);
  for (const [id, icon, tip] of [["fizzy-only-mine", "user", "My cards"], ["fizzy-only-golden", "star", "Golden cards"], ["fizzy-only-pinned", "pin", "Pinned cards"]]) {
    const b = must(tree, id);
    assert.deepEqual([b.style.size, b.style.rounded_full, b.style.border_1, b.kids.map(k => k.path), tipOf(tree, id), typeof b.handlers.on_click],
      [30, true, true, [`mods/fizzy/${icon}.svg`], tip, "function"], id);
  }
  assert.equal(find(tree, "fizzy-new"), null, "New card is the lanes' + and the new key");
  inputOf(tree, "fizzy-filter").edit("login", cx);
  const clear = must(await draw(), "fizzy-filter-clear");
  assert.deepEqual([clear.style.top, clear.style.right, clear.style.size, clear.style.rounded_full], [5, 5, 20, true], "the x sits round in the round field");
});

test("the round filters keep the cards they name, and together the cards all of them name; one on is drawn in its color (Golden cards in gold)", async () => {
  acct.pins = [acct.card(102)];
  const { cx, draw } = await mount();
  let tree = await draw();
  const look = id => { const b = must(tree, id); return [b.style.border_color, b.style.bg, b.style.text_color]; };
  const toggle = async id => { click(tree, id, cx); tree = await draw(); };
  for (const id of ["fizzy-only-mine", "fizzy-only-golden", "fizzy-only-pinned"]) assert.deepEqual(look(id), ["input", undefined, "muted"], `${id}: off`);
  await toggle("fizzy-only-golden");
  assert.deepEqual(rowIds(tree), [102], "golden");
  assert.deepEqual(look("fizzy-only-golden"), ["#e5b422", "selected", "#e5b422"]);
  await toggle("fizzy-only-mine");
  assert.deepEqual(rowIds(tree), [], "mine and golden: none is both");
  assert.match(textOf(must(tree, "fizzy-list")), /No cards match/);
  await toggle("fizzy-only-golden");
  assert.deepEqual(rowIds(tree), [101], "mine");
  assert.deepEqual(look("fizzy-only-mine"), ["accent", "selected", "accent"]);
  await toggle("fizzy-only-mine");
  await toggle("fizzy-only-pinned");
  assert.deepEqual(rowIds(tree), [102], "pinned");
  await toggle("fizzy-only-pinned");
  assert.deepEqual(rowIds(tree), [103, 101, 102], "all off: every card");
});

test("the New card picker: 'New card on', the boards, the board shown ticked and highlighted, no Follow row; the arrows move and Enter chooses", async () => {
  const m = await mount(), { cx, draw } = m;
  state.shared["fizzy.board"] = { follow: false, board: "b2", id: "pick" };
  await draw();
  await press(cx, "new");
  const popup = await mountPopup();
  assert.deepEqual(listOf(popup.tree()), ["# New card on", "board-b1", "board-b2"]);
  assert.equal(all(must(popup.tree(), "fizzy-menu-board-b2"), n => n.path === "mods/fizzy/check.svg").length, 1, "the board shown is ticked");
  assert.equal(all(must(popup.tree(), "fizzy-menu-board-b1"), n => n.path === "mods/fizzy/check.svg").length, 0);
  assert.deepEqual([must(popup.tree(), "fizzy-menu-board-b2").style.bg, must(popup.tree(), "fizzy-menu-board-b1").style.bg], ["selected", undefined], "and highlighted, so Enter means 'on this board'");
  fire(must(popup.tree(), "fizzy-menu"), "on_key_down", { key: "up" }, popup.cx);
  assert.equal(must(popup.tree(), "fizzy-menu-board-b1").style.bg, "selected", "the arrow moves it");
  fire(must(popup.tree(), "fizzy-menu"), "on_key_down", { key: "down" }, popup.cx);
  fire(must(popup.tree(), "fizzy-menu"), "on_key_down", { key: "enter" }, popup.cx);
  const choice = state.shared["fizzy.board"];
  assert.deepEqual([choice.follow, choice.board, choice.compose], [false, "b2", true]);
  assert.notEqual(choice.id, "pick");
  assert.equal(calls.order.at(-2), "closeOverlay");
});

test("New card (its key, from Mine) on another board: the panel moves to that board, off the space and kept there, and the card is made on it and opened", async () => {
  const m = await mount(), { view, cx, draw } = m;
  click(await draw(), "fizzy-view-mine", cx);
  await draw();
  await press(cx, "new");
  const tree = await chooseNewCard(m, "b2");
  const made = acct.cards.at(-1).number;
  assert.equal(view.view, "board");
  assert.equal(localStorage.getItem("view"), '"board"');
  assert.deepEqual([view.follow, view.picked, view.board], [false, "b2", "b2"]);
  assert.deepEqual([localStorage.getItem("follow"), localStorage.getItem("board")], ["false", '"b2"']);
  assert.deepEqual(acct.writes(), [["card", "create", "--board", "b2", "--title", "New card"]]);
  assert.deepEqual([view.detail?.number, view.titleInput.focused], [made, true]);
  click(tree, "fizzy-fresh-done", cx);
  const board = await draw();
  assert.equal(boardName(board), "Personal");
  assert.deepEqual(rowIds(board), [201, made], "board b2's cards, the new one with them");
});

test("New card on the board shown while following the space keeps following and the picked board as they were, and makes the card there", async () => {
  acct.yaml["/work/roadmap"] = "board: b1\n";
  localStorage.setItem("board", '"b2"');
  const m = await mount(), { view, draw } = m;
  await draw();
  assert.deepEqual([view.follow, view.picked, view.board], [true, "b2", "b1"], "following the space's board while b2 was picked earlier");
  await newCardOn(m, "b1");
  assert.deepEqual([view.follow, view.picked, view.board], [true, "b2", "b1"], "nothing changed");
  assert.deepEqual([localStorage.getItem("follow"), localStorage.getItem("board")], [null, '"b2"'], "and nothing was kept");
  assert.deepEqual(acct.writes(), [["card", "create", "--board", "b1", "--title", "New card"]]);
  assert.equal(view.detail?.number, acct.cards.at(-1).number);
});

test("New card on another board while following the space turns following off and keeps the pick; the card is made on that board", async () => {
  acct.yaml["/work/roadmap"] = "board: b1\n";
  const m = await mount(), { view, cx, draw } = m;
  await draw();
  assert.equal(view.follow, true);
  const tree = await newCardOn(m, "b2");
  assert.deepEqual([view.follow, view.picked, view.board], [false, "b2", "b2"]);
  assert.deepEqual([localStorage.getItem("follow"), localStorage.getItem("board")], ["false", '"b2"']);
  assert.deepEqual(acct.writes(), [["card", "create", "--board", "b2", "--title", "New card"]]);
  click(tree, "fizzy-fresh-done", cx);
  const board = await draw();
  assert.equal(boardName(board), "Personal");
  assert.equal(must(board, "fizzy-board").kids.length, 1, "and the name no longer says it follows the space");
});

test("the board row (Board view), as Fizzy's head: who can see the board at the left, the name big and bold in the middle between two rules (a click picks another board), Open board at the right; right under the header", async () => {
  acct.boards[0] = { ...acct.boards[0], name: LONG_NAME };
  const { draw } = await mount();
  const tree = await draw();
  const bar = must(tree, "fizzy-board-bar");
  assert.deepEqual(bar.kids.map(k => k.id ?? "rule"), ["fizzy-board-access", "rule", "fizzy-board", "rule", "fizzy-open-board"]);
  for (const rule of [bar.kids[1], bar.kids[3]]) assert.deepEqual([rule.style.flex_1, rule.style.h, rule.style.bg], [true, 1, "border"], "a rule each side");
  const board = must(tree, "fizzy-board"), name = must(tree, "fizzy-board-name");
  assert.deepEqual([name.style.text_size, name.style.font_bold, name.style.truncate, name.style.min_w, textOf(name)], [textPx(17), true, true, 0, LONG_NAME], "cut by the layout, not by the code");
  assert.deepEqual(all(board, n => n.kind === "svg").map(n => n.path), ["mods/fizzy/chevron-down.svg"]);
  assert.equal(tipOf(tree, "fizzy-board"), "Switch board");
  assert.deepEqual([typeof board.handlers.on_click, typeof board.handlers["on_mouse_down:left"], board.hoverStyle], ["function", "function", { bg: "hover" }]);
  for (const [id, icon, tip] of [["fizzy-board-access", "users", "Who can see this board"], ["fizzy-open-board", "external-link", "Open board in Fizzy"]]) {
    const round = must(tree, id);
    assert.deepEqual([round.style.size, round.style.rounded_full, round.style.border_1, round.kids[0].path, tipOf(tree, id), typeof round.handlers.on_click],
      [30, true, true, `mods/fizzy/${icon}.svg`, tip, "function"], id);
  }
  assert.equal(must(tree, "fizzy").kids[1], bar, "right under the header");
});

test("the name says FOLLOWING SPACE under it, and its tooltip 'Following the current space', only while it shows the space's own board", async () => {
  acct.yaml["/work/roadmap"] = "board: b1\n";
  const { cx, draw } = await mount();
  let tree = await draw();
  const under = () => textOf(must(tree, "fizzy-board")).replace(boardName(tree), "").trim();
  assert.equal(under(), "FOLLOWING SPACE");
  assert.equal(tipOf(tree, "fizzy-board"), "Following the current space");
  await press(cx, "board:b2");
  tree = await draw();
  assert.deepEqual([boardName(tree), under(), tipOf(tree, "fizzy-board")], ["Personal", "", "Switch board"], "a board picked: not following");
  await press(cx, "follow");
  tree = await draw();
  assert.deepEqual([boardName(tree), under()], ["Roadmap", "FOLLOWING SPACE"], "following again");
  state.spaces = [space("s1", "work", { active: true, folder: "/work/other" })];
  tree = await draw();
  tree = await draw();
  assert.deepEqual([under(), tipOf(tree, "fizzy-board")], ["", "Switch board"], "following a space that names no board: not its board");
});

test("who can see the board: a popup with Everyone on the team (a switch the panel writes, then reads again) and the people who can see it, which, like its last row, open the board in Fizzy", async () => {
  const { view, cx, draw } = await mount();
  click(await draw(), "fizzy-board-access", cx);
  assert.deepEqual(lastPopup().props.menu, { kind: "access", board: "b1", url: B1.url, all: false, ids: ["u-me", "u-bob"] });
  const popup = await mountPopup();
  assert.deepEqual(listOf(popup.tree()), ["access-all", "-", "# 2 people can see it", "user-u-me", "user-u-bob", "-", "access-fizzy"]);
  assert.equal(textOf(must(popup.tree(), "fizzy-menu-access-all")).includes("Everyone on the team"), true);
  menuClick(popup, "user-u-bob");
  assert.deepEqual(popup.cx.opened, [B1.url], "a person: the board in Fizzy, where access is changed");
  const switcher = await mountPopup();
  menuClick(switcher, "access-all");
  assert.deepEqual(requestOps().at(-1), { kind: "boardForAll", board: "b1", on: true });
  await draw();
  await cx.settle();
  assert.deepEqual(acct.writes().at(-1), ["board", "update", "b1", "--all_access", "true"]);
  assert.equal(view.access.get("b1").all, true, "read again: everyone");
  click(await draw(), "fizzy-board-access", cx);
  const all = await mountPopup();
  assert.deepEqual(listOf(all.tree()).slice(0, 3), ["access-all", "-", "# Everyone can see it"]);
  assert.deepEqual(listOf(all.tree()).filter(id => id.startsWith("user-")), ["user-u-me", "user-u-bob"], "every active person (not the bot, not the one who left)");
});

test("a click anywhere on the select opens the boards list and changes nothing else", async () => {
  const { view, cx, draw } = await mount();
  const tree = await draw();
  click(tree, "fizzy-board", cx);
  assert.deepEqual(lastPopup().props.menu, { kind: "boards", current: "b1", follow: true, spaceBoard: null });
  assert.equal(calls.openOverlay.length, 1);
  await draw();
  assert.equal(view.view, "board");
  assert.equal(find(await draw(), "fizzy-composer"), null);
});

test("with no board the select reads No board in dim and still lists the boards; while the boards load it reads …; Open board is inert without a url", async () => {
  const loading = await mount({ settle: false });
  let tree = drawn(loading.view, loading.cx);
  assert.equal(boardName(tree), "…");
  assert.equal(typeof must(tree, "fizzy-board").handlers.on_click, "function", "live while loading");
  setup();
  acct.boards.length = 0;
  const { cx, draw } = await mount();
  tree = await draw();
  const board = must(tree, "fizzy-board");
  assert.equal(boardName(tree), "No board");
  assert.equal(must(tree, "fizzy-board-name").style.text_color, "dim");
  assert.deepEqual([board.hover, board.style.cursor_pointer, typeof board.handlers.on_click], [true, true, "function"], "live: hover, pointer, click");
  assert.deepEqual(all(board, n => n.kind === "svg").map(n => n.path), ["mods/fizzy/chevron-down.svg"], "the chevron stays");
  for (const id of ["fizzy-open-board", "fizzy-board-access"]) {
    const round = must(tree, id);
    assert.deepEqual([round.style.text_color, round.handlers.on_click, round.hover, round.style.cursor_pointer], ["dim", undefined, false, undefined], `${id}: no board, inert`);
  }
  click(tree, "fizzy-board", cx);
  assert.equal(lastPopup().props.menu.kind, "boards", "the only way to pick one");
});

test("a board chosen in the boards list shows the Board view a moment later, whatever the panel shows by then; Follow current space does as well", async () => {
  acct.yaml["/work/roadmap"] = "board: b1\n";
  const { view, cx, draw } = await mount();
  let tree = await draw();
  click(tree, "fizzy-board", cx);
  const spec = lastPopup();
  await press(cx, "view:mine");
  assert.equal(view.view, "mine");
  menuClick(await mountPopup(spec), "board-b2");
  drawn(view, cx);
  assert.equal(view.view, "mine", "a draw does not act: the view waits for its timer");
  await due(cx);
  assert.equal(view.view, "board");
  tree = await draw();
  assert.deepEqual(rowIds(tree), [201], "board b2's cards");
  assert.equal(boardName(tree), "Personal");
  assert.equal(must(tree, "fizzy-home").style.bg, "selected");
  assert.equal(localStorage.getItem("view"), '"board"');
  assert.equal(find(tree, "fizzy-composer"), null, "the boards list opens no composer");

  click(tree, "fizzy-board", cx);
  const again = lastPopup();
  await press(cx, "view:pins");
  menuClick(await mountPopup(again), "follow");
  tree = await draw();
  assert.equal(view.view, "board", "Follow current space shows the Board view as well");
  assert.equal(boardName(tree), "Roadmap", "the space's board");
});

test("a board chosen in a boards list that was opened before a search closes the search's results", async () => {
  const m = await mount(), { view, cx } = m;
  click(await m.draw(), "fizzy-board", cx);
  const spec = lastPopup();
  assert.ok(find(await searchFor(m, "login"), "fizzy-search-head"));
  menuClick(await mountPopup(spec), "board-b2");
  const tree = await m.draw();
  assert.equal(find(tree, "fizzy-search-head"), null);
  assert.equal(view.search, null);
  assert.equal(boardName(tree), "Personal");
});

test("the board changing because the space changed, or by the key board:<x>, leaves the view alone", async () => {
  const { cx, view, draw } = await mount();
  let tree = await draw();
  click(tree, "fizzy-view-mine", cx);
  await draw();
  acct.yaml["/work/other"] = "board: b2\n";
  state.spaces = [space("s1", "work", { active: true, folder: "/work/other" })];
  tree = await draw();
  tree = await draw();
  assert.equal(view.board, "b2", "following: the new space's board");
  assert.equal(view.view, "mine", "and the view is still Mine");
  await press(cx, "board:b1");
  tree = await draw();
  assert.equal(view.board, "b1");
  assert.equal(view.view, "mine", "the key does not change the view either");
  click(tree, "fizzy-home", cx);
  assert.equal(boardName(await draw()), "Roadmap");
});

test("the keys view:board and view: a saved Board view restores, and view cycles through all four", async () => {
  localStorage.setItem("view", '"board"');
  const { view, cx, draw } = await mount();
  let tree = await draw();
  assert.equal(view.view, "board");
  assert.equal(must(tree, "fizzy-home").style.bg, "selected");
  const seen = [];
  for (let i = 0; i < 4; i++) { await press(cx, "view"); seen.push(view.view); }
  assert.deepEqual(seen, ["mine", "inbox", "pins", "board"]);
  await press(cx, "view:mine");
  await press(cx, "view:board");
  tree = await draw();
  assert.equal(must(tree, "fizzy-home").style.bg, "selected");
  assert.equal(find(tree, "fizzy-view-board"), null);
});

test("New card (its key) from the Inbox puts the Board view behind the new card; the board row's Open board opens the board in Fizzy", async () => {
  const m = await mount(), { view, cx, draw } = m;
  click(await draw(), "fizzy-view-inbox", cx);
  await draw();
  await press(cx, "new");
  let tree = await chooseNewCard(m, "b1");
  assert.equal(view.view, "board");
  assert.ok(find(tree, "fizzy-fresh-bar"));
  click(tree, "fizzy-fresh-done", cx);
  tree = await draw();
  assert.equal(lanesOf(tree)[acct.cards.at(-1).number], "maybe", "in Maybe?");
  click(tree, "fizzy-open-board", cx);
  assert.deepEqual(cx.opened, ["https://app.fizzy.do/111/boards/b1"]);
});

test("every list view draws without acting: the header, the board row and the board's filters where they are, and a board chosen while it shows", async () => {
  const { view, cx, draw } = await mount();
  let tree = await draw();
  for (const id of ["fizzy-view-mine", "fizzy-view-inbox", "fizzy-view-pins", "fizzy-home"]) {
    click(tree, id, cx);
    tree = await draw();
    assert.equal(Boolean(find(tree, "fizzy-board-bar")), id === "fizzy-home", id);
    assert.equal(Boolean(find(tree, "fizzy-only-golden")), id === "fizzy-home", `${id}: the board's filters`);
  }
  resize(tree, cx, 279);
  tree = await draw();
  click(tree, "fizzy-board", cx);
  menuClick(await mountPopup(), "board-b2");
  tree = await draw();
  assert.equal(view.view, "board");
  assert.deepEqual(rowIds(tree), [201]);
});

const SOMEONE_ELSES = { id: "c9", name: "Later", color: { name: "Blue", value: "var(--color-card-1)" } };
const kinds = from => acct.log.slice(from).map(a => a.slice(0, 2).join(" ")).sort();

test("a Board poll reads the open cards and the tray, and nothing else: not the columns, not a folded lane", async () => {
  const { cx, draw } = await mount();
  await draw();
  const before = acct.log.length;
  timer(cx, POLL_VIEW).fn(cx);
  inboxTimer(cx).fn(cx);
  await cx.settle();
  assert.deepEqual(kinds(before), ["card list", "notification tray"]);
  assert.deepEqual(acct.log.slice(before).find(a => a[0] === "card"), ["card", "list", "--board", "b1", "--all"]);
});

test("the columns are read when not known, on Refresh, and when an open card names a column that is not among them; a poll reads the open cards only", async () => {
  const { cx, draw } = await mount();
  let tree = await draw();
  const columnReads = () => acct.asked("column", "list").length;
  assert.equal(columnReads(), 1, "not known yet: read");
  timer(cx, POLL_VIEW).fn(cx);
  await cx.settle();
  assert.equal(columnReads(), 1, "known: a poll leaves them");
  click(tree, "fizzy-refresh", cx);
  tree = await draw();
  assert.equal(columnReads(), 2, "Refresh reads them again");
  acct.columns.b1.splice(4, 0, SOMEONE_ELSES);
  acct.card(103).column = SOMEONE_ELSES;
  timer(cx, POLL_VIEW).fn(cx);
  await cx.settle();
  tree = await draw();
  assert.equal(columnReads(), 3, "a card names a column that is not known: read again");
  assert.deepEqual(sectionIds(tree), ["not-now", "maybe", "c1", "c2", "c9", "done"], "and the new column is a lane");
  assert.equal(lanesOf(tree)[103], "c9");
  timer(cx, POLL_VIEW).fn(cx);
  await cx.settle();
  assert.equal(columnReads(), 3, "now it is known");
});

test("another board's columns are read once when the board is first shown, from the cache never again by a poll", async () => {
  const { cx, draw } = await mount();
  await draw();
  state.shared["fizzy.board"] = { follow: false, board: "b2", id: "pick" };
  await draw();
  assert.deepEqual(acct.asked("column", "list").map(a => a[3]), ["b1", "b2"]);
  timer(cx, POLL_VIEW).fn(cx);
  await cx.settle();
  assert.deepEqual(acct.asked("column", "list").map(a => a[3]), ["b1", "b2"]);
});

test("an unfolded Not Now or Done lane is read on Refresh and after a write, never by the poll; a folded lane is never read", async () => {
  setup({ closed: 20 });
  const { cx, draw } = await mount();
  let tree = await draw();
  const notNowReads = () => fizzyReads("card", "list", "--board", "b1", "--indexed-by", "not_now").length;
  const lanes = () => [notNowReads(), donePages().length];
  assert.deepEqual(lanes(), [0, 0], "folded: not read");
  timer(cx, POLL_VIEW).fn(cx);
  await cx.settle();
  click(tree, "fizzy-refresh", cx);
  tree = await draw();
  assert.deepEqual(lanes(), [0, 0], "folded: not by a poll, not by Refresh");
  click(tree, "fizzy-section-not-now", cx);
  click(tree, "fizzy-section-done", cx);
  tree = await draw();
  assert.deepEqual([notNowReads(), donePages()], [1, ["1", "2"]], "unfolded: read, Done up to the page that says none follows");
  timer(cx, POLL_VIEW).fn(cx);
  await cx.settle();
  assert.deepEqual([notNowReads(), donePages().length], [1, 2], "unfolded lanes are not read by the poll");
  click(tree, "fizzy-refresh", cx);
  tree = await draw();
  assert.deepEqual([notNowReads(), donePages()], [2, ["1", "2", "1", "2"]], "Refresh reads them again, Done from page 1");
  state.shared["fizzy.request"] = { id: "w1", op: { kind: "golden", number: 103, on: true } };
  tree = await draw();
  assert.deepEqual([notNowReads(), donePages().length], [3, 6], "so does a write");
  click(tree, "fizzy-section-not-now", cx);
  await draw();
  state.shared["fizzy.request"] = { id: "w2", op: { kind: "golden", number: 103, on: false } };
  await draw();
  assert.deepEqual([notNowReads(), donePages().length], [3, 8], "a lane folded again is not read after a write, the one still unfolded is");
});

test("an unfolded lane with no data is loaded by the board's read: after a restart, and on switching to a board whose saved fold state has it open", async () => {
  localStorage.setItem("collapsed:b1", JSON.stringify({ "not-now": false }));
  localStorage.setItem("collapsed:b2", JSON.stringify({ done: false }));
  acct.cards.push({ ...acct.card(201), id: "id-202", number: 202, title: "Closed elsewhere", closed: true, board: B2, assignees: [] });
  const { cx, draw } = await mount();
  let tree = await draw();
  assert.equal(lanesOf(tree)[104], "not-now", "Not Now had no data and was unfolded: its cards are there");
  assert.doesNotMatch(textOf(must(tree, "fizzy-list")), /Loading…/);
  assert.equal(fizzyReads("card", "list", "--board", "b1", "--indexed-by", "not_now").length, 1);
  assert.equal(donePages().length, 0, "Done is folded: not read");
  state.shared["fizzy.board"] = { follow: false, board: "b2", id: "pick" };
  tree = await draw();
  assert.equal(lanesOf(tree)[202], "done");
  assert.doesNotMatch(textOf(must(tree, "fizzy-list")), /Loading…/);
  assert.equal(fizzyReads("card", "list", "--board", "b2", "--indexed-by", "closed").length, 1);
  assert.equal(fizzyReads("card", "list", "--board", "b2", "--indexed-by", "not_now").length, 0, "Not Now of that board is folded");
  timer(cx, POLL_VIEW).fn(cx);
  await cx.settle();
  assert.equal(fizzyReads("card", "list", "--board", "b2", "--indexed-by", "closed").length, 1, "once it has data, the poll leaves it");
});

test("a change made in Mine leaves the board's unfolded lanes stale: the Board view reads them when it shows again, folded ones never", async () => {
  setup({ closed: 20 });
  const { cx, draw } = await mount();
  let tree = await draw();
  click(tree, "fizzy-section-done", cx);
  tree = await draw();
  assert.equal(lanesOf(tree)[101], "c1");
  click(tree, "fizzy-view-mine", cx);
  await draw();
  const doneReads = () => donePages().length;
  const before = doneReads();
  state.shared["fizzy.request"] = { id: "w1", op: { kind: "move", number: 101, target: "done" } };
  await draw();
  assert.equal(doneReads(), before, "Mine does not read the board's lanes");
  click(await draw(), "fizzy-home", cx);
  tree = await draw();
  assert.equal(lanesOf(tree)[101], "done", "the card closed in Mine is in the unfolded Done lane");
  assert.equal(fizzyReads("card", "list", "--board", "b1", "--indexed-by", "not_now").length, 0, "Not Now stayed folded: never read");
  const settled = doneReads();
  timer(cx, POLL_VIEW).fn(cx);
  await cx.settle();
  assert.equal(doneReads(), settled, "and the poll leaves it again");
});

test("a lane that failed to unfold shows its cards and loses its error once the board's read gets it", async () => {
  const { cx, draw } = await mount();
  let tree = await draw();
  acct.fail = args => (args.includes("not_now") ? failure("network", "offline") : undefined);
  click(tree, "fizzy-section-not-now", cx);
  tree = await draw();
  assert.ok(find(tree, "fizzy-retry-not-now"), "the unfold failed: the lane says so, with Retry");
  assert.equal(lanesOf(tree)[104], undefined);
  acct.fail = null;
  timer(cx, POLL_VIEW).fn(cx);
  await cx.settle();
  tree = await draw();
  assert.equal(lanesOf(tree)[104], "not-now", "the board's read loaded the lane");
  assert.equal(find(tree, "fizzy-retry-not-now"), null, "and the old error is gone");
});

test("with the Inbox showing the 30 s view poll reads nothing; the unread poll's one tray read is the list, the count and the toasts", async () => {
  localStorage.setItem("view", '"inbox"');
  const { cx, draw } = await mount();
  assert.deepEqual(noteIds(await draw()), ["n1", "n2"]);
  assert.equal(acct.asked("notification", "tray").length, 1, "start: one read");
  const before = acct.log.length;
  timer(cx, POLL_VIEW).fn(cx);
  await cx.settle();
  assert.equal(acct.log.length, before, "the view poll reads nothing");
  acct.notifications.push(note("n3", { created_at: minutesAgo(0) }));
  await pollNow(cx);
  assert.deepEqual(kinds(before), ["notification tray"], "one tray read per 30 s");
  assert.deepEqual(noteIds(await draw()), ["n3", "n1", "n2"], "and it filled the Inbox");
  assert.equal(state.shared["fizzy.unread"], 3);
});

test("opening the Inbox and Refresh in it run the unread poll, once each; in the other views the Inbox is still filled by the poll", async () => {
  const { cx, draw } = await mount();
  let tree = await draw();
  const trays = () => acct.asked("notification", "tray").length;
  assert.equal(trays(), 1);
  acct.notifications.push(note("n3", { created_at: minutesAgo(0) }));
  await pollNow(cx);
  assert.equal(trays(), 2);
  click(tree, "fizzy-view-inbox", cx);
  tree = await draw();
  assert.equal(trays(), 3, "opening it reads the tray once");
  assert.deepEqual(noteIds(tree), ["n3", "n1", "n2"]);
  click(tree, "fizzy-refresh", cx);
  await draw();
  assert.equal(trays(), 4, "Refresh reads it once");
  timer(cx, POLL_VIEW).fn(cx);
  await cx.settle();
  assert.equal(trays(), 4, "the view poll adds none");
});

test("a failed unread poll shows in the Inbox with Retry, and a good one clears it", async () => {
  localStorage.setItem("view", '"inbox"');
  acct.fail = args => (args[0] === "notification" ? failure("network", "offline") : undefined);
  const { cx, draw } = await mount();
  let tree = await draw();
  assert.match(textOf(must(tree, "fizzy-list")), /Can't reach Fizzy/);
  assert.ok(find(tree, "fizzy-retry"));
  acct.fail = null;
  click(tree, "fizzy-retry", cx);
  tree = await draw();
  assert.deepEqual(noteIds(tree), ["n1", "n2"]);
  assert.equal(find(tree, "fizzy-retry"), null);
});

test("marking a note read, or all of them, reads the tray again through the unread poll", async () => {
  const { cx, draw } = await mount();
  click(await draw(), "fizzy-view-inbox", cx);
  let tree = await draw();
  const trays = () => acct.asked("notification", "tray").length;
  const base = trays();
  click(tree, "fizzy-note-n1", cx);
  await cx.settle();
  assert.equal(trays(), base + 1);
  click(await draw(), "fizzy-back", cx);
  click(await draw(), "fizzy-read-all", cx);
  await cx.settle();
  assert.equal(trays(), base + 2);
  assert.deepEqual(noteIds(await draw()), []);
});

test("the pin list is read at start, when a card opens and after a write, not by the poll; the Pins view reads it as the view", async () => {
  const { cx, draw } = await openDetail();
  const pinReads = () => acct.asked("pin", "list").length;
  assert.equal(pinReads(), 2, "at start (the lists mark pinned cards), and opening the card");
  timer(cx, POLL_VIEW).fn(cx);
  await cx.settle();
  timer(cx, POLL_VIEW).fn(cx);
  await cx.settle();
  assert.equal(pinReads(), 2, "polls leave it");
  state.shared["fizzy.request"] = { id: "w1", op: { kind: "golden", number: 101, on: true } };
  await draw();
  assert.equal(pinReads(), 3, "a write reads it again");
  click(must(await draw(), "fizzy-back"), "fizzy-back", cx);
  click(await draw(), "fizzy-view-pins", cx);
  await draw();
  assert.equal(pinReads(), 4, "the Pins view");
  timer(cx, POLL_VIEW).fn(cx);
  await cx.settle();
  assert.equal(pinReads(), 5, "and its poll");
});

test("with no default board, Mine is one boardless card list, grouped by board; every board has an entry, no progress shows, Not Now and closed are left out", async () => {
  acct.config = { account: "111", board: null };
  for (let i = 3; i <= 9; i++) acct.boards.push({ id: `b${i}`, name: `Board ${i}`, url: `u${i}` });
  acct.cards.push({ ...acct.card(201), id: "id-700", number: 700, title: "Parked", postponed: true, assignees: [ME], board: B2 });
  acct.cards.push({ ...acct.card(201), id: "id-701", number: 701, title: "Finished", closed: true, assignees: [ME], board: B2 });
  const { view, cx, draw } = await mount();
  let tree = await draw();
  let release;
  acct.hold = new Promise(resolve => { release = resolve; });
  click(tree, "fizzy-view-mine", cx);
  assert.match(textOf(must(drawn(view, cx), "fizzy-list")), /Loading…/);
  assert.doesNotMatch(textOf(must(drawn(view, cx), "fizzy-list")), /boards/, "no 'Loading N boards'");
  release();
  await cx.settle();
  acct.hold = null;
  tree = await draw();
  const mineReads = acct.asked("card", "list").filter(a => a.includes("--assignee"));
  assert.deepEqual(mineReads, [["card", "list", "--assignee", "u-me", "--all"]], "one call, no --board, no --indexed-by");
  assert.deepEqual([...view.mine.keys()], acct.boards.map(b => b.id), "every known board has an entry");
  assert.deepEqual(view.mine.get("b9"), []);
  assert.deepEqual(rowIds(tree), [101, 201]);
  assert.deepEqual(ids(tree).filter(i => i.startsWith("fizzy-mine-")), ["fizzy-mine-b1", "fizzy-mine-b2"]);
  assert.equal(view.progress, null);
});

test("with no default board, Mine drops the boards that are gone, shows an error with Retry, and a copy that starts on Mine waits for the config, the boards and the person, then asks once", async () => {
  acct.config = { account: "111", board: null };
  localStorage.setItem("view", '"mine"');
  const { view, cx, draw } = await mount();
  let tree = await draw();
  assert.deepEqual(rowIds(tree), [101, 201]);
  assert.equal(acct.asked("card", "list").filter(a => a.includes("--assignee")).length, 1, "asked once, after the config, the boards and the person");
  assert.equal(acct.asked("card", "list", "--board", "b1", "--all").length, 0, "the board's own cards are not read for Mine");
  acct.boards = [B1];
  click(tree, "fizzy-refresh", cx);
  tree = await draw();
  assert.deepEqual([...view.mine.keys()], ["b1"], "a board that is gone is dropped");
  assert.deepEqual(rowIds(tree), [101]);
  acct.fail = args => (args[0] === "card" && args.includes("--assignee") ? failure("network", "offline") : undefined);
  click(tree, "fizzy-refresh", cx);
  tree = await draw();
  assert.match(textOf(must(tree, "fizzy-list")), /Can't reach Fizzy/);
  assert.deepEqual(rowIds(tree), [101], "what was read stays under the message");
  acct.fail = null;
  click(tree, "fizzy-retry", cx);
  tree = await draw();
  assert.equal(find(tree, "fizzy-retry"), null);
  assert.deepEqual(rowIds(tree), [101]);
});

test("with a default board in the CLI, Mine reads each board itself (a boardless list would read only the default board)", async () => {
  const { cx, draw } = await mount();
  click(await draw(), "fizzy-view-mine", cx);
  await draw();
  const mineReads = acct.asked("card", "list").filter(a => a.includes("--assignee"));
  assert.deepEqual(mineReads.map(a => a[3]).sort(), ["b1", "b2"]);
  assert.ok(mineReads.every(a => a[2] === "--board"), "never boardless");
});

test("a request's text does not stay in shared state: the panel sets fizzy.request to null once it has handled it, whichever timer saw it", async () => {
  withAgent();
  const HANDOFF = "Fizzy #101 \"A private title\"";
  const { view, cx, draw } = await mount();
  await draw();
  state.shared["fizzy.request"] = { id: "p1", op: { kind: "paste", address: "t1", text: HANDOFF } };
  drawn(view, cx);
  assert.equal(state.shared["fizzy.request"].id, "p1", "a draw only notes it");
  await due(cx);
  assert.equal(state.shared["fizzy.request"], null, "done by the draw's timer: gone");
  state.shared["fizzy.request"] = { id: "p2", op: { kind: "paste", address: "t1", text: HANDOFF } };
  await tickRequest(cx);
  assert.equal(state.shared["fizzy.request"], null, "done by the 300 ms timer: gone");
  assert.ok(!JSON.stringify(state.shared).includes("A private title"));
  assert.deepEqual(calls.run.filter(([name]) => name === "terminal.paste").length, 2, "both were done");
  state.shared["fizzy.request"] = { id: "p3", op: { kind: "paste", address: "t1", text: HANDOFF } };
  await tickRequest(cx);
  await tickRequest(cx);
  assert.equal(calls.run.filter(([name]) => name === "terminal.paste").length, 3, "and nothing is done twice");
});

test("a request that came in while another was being handled is kept, and done by the next look", async () => {
  const { view, cx, draw } = await mount();
  await draw();
  state.shared["fizzy.request"] = { id: "a", op: { kind: "golden", number: 101, on: true } };
  drawn(view, cx);
  state.shared["fizzy.request"] = { id: "b", op: { kind: "golden", number: 103, on: true } };
  await due(cx);
  assert.equal(state.shared["fizzy.request"]?.id, "b", "the newer one is not wiped by the older one's clean-up");
  await tickRequest(cx);
  assert.deepEqual(acct.writes(), [["card", "golden", "101"], ["card", "golden", "103"]]);
  assert.equal(state.shared["fizzy.request"], null);
});

test("a hand-off chosen in a popup row travels in fizzy.request only until the panel has handled it; no other shared key holds it", async () => {
  withAgent();
  const { cx, draw } = await mount();
  fire(must(await draw(), "fizzy-more-101"), "on_click", {}, cx);
  await cx.settle();
  menuClick(await mountPopup(), "insert");
  assert.equal(state.shared["fizzy.request"].op.text, REF_101, "the popup leaves the text for the panel");
  await draw();
  assert.equal(state.shared["fizzy.request"], null);
  assert.ok(!JSON.stringify(state.shared).includes("Fix the login redirect"), "the card's title is in no shared key");
  assert.equal(calls.run.filter(([name]) => name === "terminal.paste").length, 1, "and the panel did it");
});

test("a card is a plain tile, as Fizzy's: the background, a thin border that strengthens on hover; its number and board sit on a tab in its lane's color at the top left, and the line under the title is in that color too", async () => {
  const { cx, draw } = await mount();
  let tree = await draw();
  const c1 = colorOf(acct.columns.b1.find(c => c.id === "c1"));
  const look = id => { const n = must(tree, id); return [n.style.bg, n.style.border_1, n.style.border_color, n.hoverStyle?.border_color, n.style.rounded, n.style.overflow_hidden]; };
  assert.deepEqual(look("fizzy-card-103"), ["background", true, "border", "input", 8, true]);
  assert.deepEqual(look("fizzy-card-101"), ["background", true, "border", "input", 8, true], "whatever its lane");
  const tab = id => { const n = must(tree, id); return [n.style.bg, n.style.rounded_br, parentOf(tree, id).kids[0] === n]; };
  assert.deepEqual(tab("fizzy-card-head-101"), [c1, 6, true], "In progress: its column's color, first in the card's top line");
  assert.deepEqual(tab("fizzy-card-head-103"), [MAYBE_BLUE, 6, true], "Maybe?: Fizzy's blue");
  assert.equal(must(tree, "fizzy-card-meta-101").style.text_color, c1);
  click(tree, "fizzy-section-done", cx);
  tree = await draw();
  assert.equal(must(tree, "fizzy-card-head-105").style.bg, DONE_GRAY, "a closed card's: Done's light gray");
  const title = must(tree, "fizzy-card-title-101");
  assert.deepEqual([title.style.whitespace_normal, title.style.font_bold, title.style.text_size], [true, true, textPx(13)], "the whole title, bold");
  assert.equal(must(tree, "fizzy-card-meta-101").style.text_size, textPx(10), "the line under it smaller");
});

test("a golden card has the plain border and a faint gold glow under its content, from nothing at the bottom left to the top right, and heads its lane; the rest keep Fizzy's order", async () => {
  acct.cards.push({ ...acct.card(103), id: "id-106", number: 106, title: "Shiny", golden: true }, { ...acct.card(103), id: "id-107", number: 107, title: "Plain" });
  const { draw } = await mount();
  const tree = await draw();
  assert.deepEqual(rowIds(tree).filter(n => lanesOf(tree)[n] === "maybe"), [106, 103, 107], "Fizzy lists 103, 106, 107");
  const golden = must(tree, "fizzy-card-106");
  assert.deepEqual([golden.style.border_1, golden.style.border_color, golden.style.border_2, golden.style.relative], [true, "border", undefined, true]);
  const glow = glowOf(golden);
  assert.equal(golden.kids[0], glow, "under everything else in the card");
  assert.deepEqual([glow.style.absolute, glow.style.top, glow.style.left, glow.style.size_full], [true, 0, 0, true], "the whole card");
  assert.deepEqual(glow.background, { kind: "linear-gradient", angle: 45, from: "#e5b42200", to: "#e5b42238" });
  assert.equal(glowOf(must(tree, "fizzy-card-103")), null);
});

test("a picked card is drawn as picked whatever it is: the selected background and the accent border, a golden one too", async () => {
  const { cx, draw } = await mount();
  const tree = await pick(cx, draw, 102);
  const card = must(tree, "fizzy-card-102");
  assert.deepEqual([card.style.bg, card.style.border_1, card.style.border_color, card.style.border_2], ["selected", true, "accent", undefined]);
  assert.ok(glowOf(card), "and its glow");
});

test("a pinned card shows a pin before its title, in the accent; the pin list read at start is what says so, in every list", async () => {
  acct.pins = [acct.card(101)];
  const { cx, draw } = await mount();
  let tree = await draw();
  const pinIn = id => all(must(tree, id), n => n.path === "mods/fizzy/pin.svg");
  assert.deepEqual(pinIn("fizzy-card-101").map(n => [n.style.size, n.style.text_color]), [[13, "accent"]]);
  assert.equal(pinIn("fizzy-card-103").length, 0);
  const row = parentOf(tree, "fizzy-card-title-101");
  assert.equal(row.kids[0].path, "mods/fizzy/pin.svg", "before the title");
  click(tree, "fizzy-view-mine", cx);
  tree = await draw();
  assert.equal(pinIn("fizzy-card-101").length, 1, "Mine too");
  assert.equal(pinIn("fizzy-card-201").length, 0);
});

test("a lane is a block with a rounded border in its color: its header tinted in the color, with a dot, its name, its count in a pill and +; a press let go anywhere in the block moves the pressed card there", async () => {
  const { cx, draw } = await mount();
  const tree = await draw();
  const c2 = colorOf(acct.columns.b1.find(c => c.id === "c2"));
  const lane = must(tree, "fizzy-lane-c2"), head = must(tree, "fizzy-section-c2");
  assert.deepEqual([lane.style.rounded, lane.style.border_1, lane.style.border_color, lane.style.overflow_hidden], [10, true, `${c2}33`, true]);
  assert.equal(lane.kids[0], head, "the header first");
  assert.deepEqual([head.style.h, head.style.bg, head.hoverStyle.bg], [34, `${c2}26`, `${c2}40`]);
  assert.deepEqual(head.kids.map(k => k.id ?? k.kind), ["svg", "div", "div", "div", "div", "fizzy-add-c2"], "chevron, dot, name, count, spacer, +");
  assert.deepEqual([head.kids[1].style.bg, head.kids[1].style.rounded_full, textOf(head.kids[2]), textOf(head.kids[3]), head.kids[3].style.rounded_full], [c2, true, "Review", "1", true]);
  assert.deepEqual(must(tree, "fizzy-section-not-now").kids[1].style.bg, NOT_NOW_GRAY);
  fire(must(tree, "fizzy-card-101"), "on_mouse_down:left", {}, cx);
  fire(lane, "on_mouse_up:left", {}, cx);
  await cx.settle();
  assert.deepEqual(acct.writes(), [["card", "column", "101", "--column", "c2"]], "let go between its cards: moved there");
  assert.deepEqual(lanesOf(await draw()), { 103: "maybe", 101: "c2", 102: "c2" });
});

const DAY_MS = 86400000;
test("a card shows Fizzy's warning: Closes in Nd (gold) once under a quarter of its board's auto-postpone period is left, Stalled (red) when Fizzy lists it stalled; none otherwise", async () => {
  acct.boards[0] = { ...B1, auto_postpone_period_in_days: 30 };
  acct.card(101).last_active_at = new Date(Date.now() - 25 * DAY_MS).toISOString();
  acct.stalled = [103];
  const { draw } = await mount();
  const tree = await draw();
  const warn = n => { const w = find(tree, `fizzy-card-warn-${n}`); return w && [textOf(w), w.style.text_color, w.style.border_color]; };
  assert.deepEqual(warn(101), ["Closes in 5d", "ansi3", "ansi3"]);
  assert.deepEqual(warn(103), ["Stalled", "blocked", "blocked"]);
  assert.equal(warn(102), null, "active three hours ago, not stalled");
  assert.deepEqual(acct.asked("card", "list", "--board", "b1", "--indexed-by", "stalled"), [["card", "list", "--board", "b1", "--indexed-by", "stalled", "--all"]], "read with the columns");
});

test("the stalled cards are read with the columns (not by every poll), and a failed read only costs their labels", async () => {
  acct.stalled = [103];
  acct.fail = args => (args.includes("stalled") ? failure("network", "offline") : undefined);
  const { cx, draw } = await mount();
  let tree = await draw();
  assert.deepEqual(rowIds(tree), [103, 101, 102], "the board is there");
  assert.equal(find(tree, "fizzy-card-warn-103"), null);
  assert.doesNotMatch(textOf(must(tree, "fizzy-list")), /Can't reach Fizzy/);
  acct.fail = null;
  const stalledReads = () => acct.asked("card", "list", "--board", "b1", "--indexed-by", "stalled").length;
  timer(cx, POLL_VIEW).fn(cx);
  await cx.settle();
  assert.equal(stalledReads(), 1, "a poll leaves them");
  await press(cx, "refresh");
  assert.equal(stalledReads(), 2, "Refresh reads them with the columns");
  assert.equal(textOf(must(await draw(), "fizzy-card-warn-103")), "Stalled");
});

const REACTED = () => [{ id: "r1", content: "👍", reacter: TEAMMATE }, { id: "r2", content: "👍", reacter: ME }, { id: "r3", content: "🎉", reacter: TEAMMATE }];
const NO_BORDER = "#00000000";

test("a comment's reactions are chips, one per emoji with its count, yours outlined in the accent, the people named in the tooltip; read once per comment, again on Refresh; Fizzy's own lines get none", async () => {
  acct.reactions.cm2 = REACTED();
  const { cx, draw, tree } = await openDetail();
  assert.deepEqual(acct.asked("reaction", "list").map(a => a[5]).sort(), ["cm1", "cm2"], "the people's comments, not Fizzy's line");
  const row = must(tree, "fizzy-reactions-cm2");
  assert.deepEqual(row.kids.map(k => k.id), ["fizzy-reaction-cm2-0", "fizzy-reaction-cm2-1", "fizzy-react-cm2"]);
  const chip = id => { const c = must(tree, id); return [textOf(c), c.style.border_color, c.style.bg, c.style.tooltip]; };
  assert.deepEqual(chip("fizzy-reaction-cm2-0"), ["👍 2", "accent", "selected", "Bob, Ada"]);
  assert.deepEqual(chip("fizzy-reaction-cm2-1"), ["🎉 1", NO_BORDER, "raised", "Bob"]);
  assert.deepEqual(must(tree, "fizzy-reactions-cm1").kids.map(k => k.id), ["fizzy-react-cm1"], "none yet: only the button that adds one");
  assert.deepEqual([tipOf(tree, "fizzy-react-cm1"), iconOf(tree, "fizzy-react-cm1")], ["Add reaction", "smile-plus.svg"]);
  timer(cx, POLL_VIEW).fn(cx);
  await cx.settle();
  assert.equal(acct.asked("reaction", "list").length, 2, "a poll leaves them");
  await press(cx, "refresh");
  assert.equal(acct.asked("reaction", "list").length, 4, "Refresh reads them all again");
  await draw();
});

test("a click on a reaction chip takes yours away, or puts yours on, at once, then tells Fizzy; a refusal puts it back and says why", async () => {
  acct.reactions.cm2 = REACTED();
  const { view, cx, draw, tree } = await openDetail();
  const release = holdOn();
  click(tree, "fizzy-reaction-cm2-0", cx);
  let now = drawn(view, cx);
  assert.deepEqual([textOf(must(now, "fizzy-reaction-cm2-0")), must(now, "fizzy-reaction-cm2-0").style.border_color], ["👍 1", NO_BORDER], "yours is gone at once");
  release();
  await cx.settle();
  assert.deepEqual(acct.writes(), [["reaction", "delete", "r2", "--card", "101", "--comment", "cm2"]]);
  click(await draw(), "fizzy-reaction-cm2-1", cx);
  assert.equal(textOf(must(drawn(view, cx), "fizzy-reaction-cm2-1")), "🎉 2");
  await cx.settle();
  assert.deepEqual(acct.writes().at(-1), ["reaction", "create", "--card", "101", "--comment", "cm2", "--content", "🎉"]);
  const made = acct.reactions.cm2.at(-1).id;
  assert.equal(view.reactions.get("cm2").at(-1).id, made, "Fizzy's id is kept, so the next click can take it away");
  click(await draw(), "fizzy-reaction-cm2-1", cx);
  await cx.settle();
  assert.deepEqual(acct.writes().at(-1), ["reaction", "delete", made, "--card", "101", "--comment", "cm2"]);
  acct.fail = args => (args[0] === "reaction" && args[1] !== "list" ? failure("forbidden", "You can't react here") : undefined);
  click(await draw(), "fizzy-reaction-cm2-0", cx);
  await cx.settle();
  assert.equal(textOf(must(await draw(), "fizzy-reaction-cm2-0")), "👍 1", "put back");
  assert.equal(errors().length, 1);
});

test("the smile opens the reactions to add, yours ticked; a choice goes through the panel, which puts yours on", async () => {
  acct.reactions.cm1 = [{ id: "r9", content: "🚀", reacter: ME }];
  const { cx, draw, tree } = await openDetail();
  click(tree, "fizzy-react-cm1", cx);
  assert.deepEqual(lastPopup().props.menu, { kind: "react", number: 101, comment: "cm1", mine: ["🚀"] });
  const popup = await mountPopup();
  assert.equal(all(must(popup.tree(), "fizzy-menu-react-6"), n => n.path === "mods/fizzy/check.svg").length, 1, "🚀 is yours");
  menuClick(popup, "react-0");
  assert.deepEqual(requestOps().at(-1), { kind: "react", number: 101, comment: "cm1", content: "👍" });
  await draw();
  assert.deepEqual(acct.writes(), [["reaction", "create", "--card", "101", "--comment", "cm1", "--content", "👍"]]);
  assert.deepEqual(must(await draw(), "fizzy-reactions-cm1").kids.map(k => textOf(k)), ["🚀 1", "👍 1", ""]);
});

// Fizzy's mention of a person, as a comment or a description holds it (the sgids here are made up).
const mentionOf = (userId, name, sgid = `sgid-${userId}`) =>
  `<action-text-attachment sgid="${sgid}" content-type="application/vnd.actiontext.mention"><img title="${name}" src="/111/users/${userId}/avatar">${name}</action-text-attachment>`;
const mentionOut = sgid => `<action-text-attachment sgid="${sgid}" content-type="application/vnd.actiontext.mention"></action-text-attachment>`;
const BOB_SAYS = { id: "cm8", body: { html: `<div><p>Ping ${mentionOf("u-bob", "Bob")}</p></div>`, plain_text: "Ping @Bob" }, creator: TEAMMATE, created_at: "2026-01-06T10:00:00Z", updated_at: "2026-01-06T10:00:00Z" };
const spans = box => box.tokens().map(t => [box.value().slice(t.range.start, t.range.end), t.token.id]);
// Types `text` at the end of a box a character at a time, as a person does: each one is a change of its own.
const typeIn = (box, text, cx) => { for (const ch of text) box.edit(box.value() + ch, cx); };

test("@ typed where a mention starts in the comment box opens the people picker for it; the choice takes the @'s place as the person's token, a space after it", async () => {
  const { cx, draw, tree } = await openDetail();
  const box = inputOf(tree, "fizzy-comment-input");
  typeIn(box, "me@", cx);
  assert.equal(calls.openOverlay.length, 0, "at the end of a word: no picker");
  box.edit("", cx);
  box.edit("@@", cx);
  assert.equal(calls.openOverlay.length, 0, "pasted, not typed: no picker");
  box.edit("", cx);
  typeIn(box, "Ask @", cx);
  assert.equal(calls.openOverlay.length, 1);
  const spec = lastPopup();
  assert.deepEqual(spec.props.menu, { kind: "mention", target: "comment" });
  const popup = await mountPopup(spec);
  assert.deepEqual(listOf(popup.tree()), ["user-u-me", "user-u-bob"], "the active people, you first");
  menuClick(popup, "user-u-bob");
  assert.deepEqual(requestOps().at(-1), { kind: "mention", target: "comment", user: "u-bob", name: "Bob" });
  await draw();
  assert.equal(box.value(), "Ask @Bob ");
  assert.deepEqual(spans(box), [["@Bob", "user:u-bob"]]);
  assert.equal(box.focused, true);
  assert.deepEqual(acct.writes(), [], "nothing is written");
});

test("a person whose mention id the panel has not learned is sent as plain \"@<name>\", and the panel says it can't notify them yet", async () => {
  const { cx, draw, tree } = await openDetail();
  const box = inputOf(tree, "fizzy-comment-input");
  typeIn(box, "Ask @", cx);
  menuClick(await mountPopup(), "user-u-bob");
  await draw();
  box.edit(`${box.value()}about it`, cx);
  click(await draw(), "fizzy-comment-send", cx);
  await cx.settle();
  assert.deepEqual(acct.writes().at(-1), ["comment", "create", "--card", "101", "--body", "<p>Ask @Bob about it</p>"]);
  assert.equal(calls.notify.find(n => /Can't notify/.test(n.body))?.body, "Can't notify Bob yet: mention them once in Fizzy, and the panel learns how.");
});

test("the mention ids in what the panel reads are learned and kept, the popups told who can be tagged; a learned person, by token or typed as @<name>, is sent as their mention", async () => {
  acct.comments[101].push(BOB_SAYS);
  const { cx, draw, tree } = await openDetail();
  assert.deepEqual(JSON.parse(localStorage.getItem("mentions")), { "u-bob": "sgid-u-bob" });
  assert.deepEqual(state.shared["fizzy.people"].mentionable, ["u-bob"]);
  const box = inputOf(tree, "fizzy-comment-input");
  typeIn(box, "Thanks @", cx);
  const popup = await mountPopup();
  assert.deepEqual(["user-u-me", "user-u-bob"].map(id => must(popup.tree(), `fizzy-menu-${id}`)).map(r => textOf(r).includes("can't tag yet")), [true, false]);
  menuClick(popup, "user-u-bob");
  await draw();
  box.edit(`${box.value()}and @bob again`, cx);
  click(await draw(), "fizzy-comment-send", cx);
  await cx.settle();
  assert.deepEqual(acct.writes().at(-1), ["comment", "create", "--card", "101", "--body", `<p>Thanks ${mentionOut("sgid-u-bob")} and ${mentionOut("sgid-u-bob")} again</p>`]);
  assert.equal(calls.notify.some(n => /Can't notify/.test(n.body)), false);
  state.props = undefined;
  const later = await mount();
  assert.deepEqual(later.view.mentionIds, { "u-bob": "sgid-u-bob" }, "kept between runs");
});

test("# typed where a card reference starts opens the card picker with the cards the panel knows; the choice is the card's token, sent as a link to it", async () => {
  const { cx, draw, tree } = await openDetail();
  const box = inputOf(tree, "fizzy-comment-input");
  typeIn(box, "See #", cx);
  const spec = lastPopup();
  assert.deepEqual([spec.props.menu.kind, spec.props.menu.target], ["cardref", "comment"]);
  assert.deepEqual(spec.props.menu.cards, [101, 102, 103].map(n => ({ number: n, title: acct.card(n).title, board: "Roadmap" })), "the board's open cards");
  menuClick(await mountPopup(spec), "card-102");
  await draw();
  assert.equal(box.value(), "See #102 Write the changelog ");
  assert.deepEqual(spans(box), [["#102 Write the changelog", "card:102"]]);
  click(await draw(), "fizzy-comment-send", cx);
  await cx.settle();
  assert.deepEqual(acct.writes().at(-1), ["comment", "create", "--card", "101", "--body", '<p>See <a href="https://app.fizzy.do/111/cards/102">#102 Write the changelog</a></p>']);
});

test("the pickers take the typing in a field of their own: its words narrow the rows, Enter or Tab takes the highlighted one, once", async () => {
  const { tree, cx } = await openDetail();
  inputOf(tree, "fizzy-comment-input").edit("@", cx);
  const popup = await mountPopup();
  const field = popup.view.tagInput;
  assert.deepEqual([field.options.placeholder, field.focused], ["Search people…", true]);
  field.edit("BO", popup.cx);
  assert.deepEqual(listOf(popup.tree()), ["user-u-bob"]);
  fire(must(popup.tree(), "fizzy-menu"), "on_key_down", { key: "tab" }, popup.cx);
  assert.deepEqual(requestOps(), [{ kind: "mention", target: "comment", user: "u-bob", name: "Bob" }]);
  field.submit(popup.cx);
  fire(must(popup.tree(), "fizzy-menu"), "on_key_down", { key: "enter" }, popup.cx);
  assert.equal(requestOps().length, 1, "Enter reaching the field and the popup chooses once");
  typeIn(inputOf(tree, "fizzy-comment-input"), " #", cx);
  const cards = await mountPopup();
  assert.equal(cards.view.tagInput.options.placeholder, "Card number or title…");
  cards.view.tagInput.edit("changelog", cards.cx);
  assert.deepEqual(listOf(cards.tree()), ["card-102"]);
  cards.view.tagInput.submit(cards.cx);
  assert.deepEqual(requestOps().at(-1), { kind: "cardref", target: "comment", number: 102, title: "Write the changelog" });
});

test("a number the card picker was not handed is looked up once the typing stops (300 ms); the card found can be chosen, a card that isn't there says so", async () => {
  const { tree, cx } = await openDetail();
  inputOf(tree, "fizzy-comment-input").edit("#", cx);
  const popup = await mountPopup();
  const field = popup.view.tagInput;
  field.edit("10", popup.cx);
  field.edit("105", popup.cx);
  const waits = popup.cx.timers.filter(t => t.after && t.ms === 300);
  assert.equal(waits.length, 2, "a wait per keystroke");
  assert.match(textOf(popup.tree()), /Looking up #105…/);
  for (const t of waits) t.fn(popup.cx);
  await popup.cx.settle();
  assert.deepEqual(acct.asked("card", "show", "105"), [["card", "show", "105"]], "only the last wait asks");
  assert.deepEqual(listOf(popup.tree()), ["card-105"]);
  assert.match(textOf(must(popup.tree(), "fizzy-menu-card-105")), /#105 Shipped thing\s+Roadmap/);
  field.edit("999", popup.cx);
  popup.cx.timers.filter(t => t.after && t.ms === 300).at(-1).fn(popup.cx);
  await popup.cx.settle();
  assert.match(textOf(popup.tree()), /Not found in Fizzy/);
  field.edit("101", popup.cx);
  assert.equal(popup.cx.timers.filter(t => t.after && t.ms === 300).length, 3, "a number it was handed is not looked up");
});

test("in the description editor and a comment being edited, @ and # open their pickers for that editor, and the choice goes there", async () => {
  const { cx, draw, tree } = await openDetail();
  click(tree, "fizzy-desc-edit", cx);
  const desc = inputOf(await draw(), "fizzy-desc-input");
  assert.equal(desc.options.placeholder, "Add a description… (@ mention, # card, drop or paste images)");
  typeIn(desc, " @", cx);
  assert.deepEqual(lastPopup().props.menu, { kind: "mention", target: "desc" });
  menuClick(await mountPopup(), "user-u-bob");
  await draw();
  assert.deepEqual(spans(desc), [["@Bob", "user:u-bob"]]);
  click(await draw(), "fizzy-desc-cancel", cx);
  click(await draw(), "fizzy-comment-edit-cm1", cx);
  const edit = inputOf(await draw(), "fizzy-comment-area-cm1");
  typeIn(edit, " #", cx);
  assert.equal(lastPopup().props.menu.target, "commentEdit");
  menuClick(await mountPopup(), "card-103");
  await draw();
  assert.deepEqual(spans(edit), [["#103 Triage me", "card:103"]]);
  click(await draw(), "fizzy-comment-cancel-cm1", cx);
  typeIn(edit, " @", cx);
  menuClick(await mountPopup(), "user-u-bob");
  await draw();
  assert.deepEqual(spans(edit), [["#103 Triage me", "card:103"]], "a choice for an editor that has closed goes nowhere");
});

test("editing a description keeps its mentions and card links as tokens, warns of no loss, and saves them back as they were", async () => {
  acct.card(101).description_html = `<div class="action-text-content"><p>Ask ${mentionOf("u-bob", "Bob")} about <a href="https://app.fizzy.do/111/cards/102">#102 Write the changelog</a></p></div>`;
  const { cx, draw, tree } = await openDetail();
  click(tree, "fizzy-desc-edit", cx);
  let next = await draw();
  const box = inputOf(next, "fizzy-desc-input");
  assert.equal(box.value(), "Ask @Bob about #102 Write the changelog");
  assert.deepEqual(spans(box), [["@Bob", "user:u-bob"], ["#102 Write the changelog", "card:102"]]);
  assert.equal(find(next, "fizzy-desc-lossy"), null);
  box.edit(`${box.value()} today`, cx);
  click(next, "fizzy-desc-save", cx);
  await cx.settle();
  assert.deepEqual(acct.writes(), [["card", "update", "101", "--description",
    `<p>Ask ${mentionOut("sgid-u-bob")} about <a href="https://app.fizzy.do/111/cards/102">#102 Write the changelog</a> today</p>`]], "Bob's mention id was learned from the description itself");
});

test("an editor draws its tokens: a person who can be tagged bold in blue, one who can't yet bold and dim, a card bold in yellow, a file a small muted chip", async () => {
  acct.comments[101].push(BOB_SAYS);
  const { tree } = await openDetail();
  const render = all(must(tree, "fizzy-comment-input"), n => n.kind === "textarea")[0].style.token;
  const look = (id, selected = false) => { const n = nodeOf(render({ token: { id, text: "x" }, selected, line_height: 18 })); return [n.style.font_bold, n.style.text_color, n.style.bg, n.style.h]; };
  assert.deepEqual(look("user:u-bob"), [true, "ansi4", undefined, 18]);
  assert.deepEqual(look("user:u-me"), [true, "dim", undefined, 18]);
  assert.deepEqual(look("card:12"), [true, "ansi3", undefined, 18]);
  assert.deepEqual(look("file:sgid-x"), [undefined, "muted", "raised", 18]);
  assert.equal(look("card:12", true)[2], "selection");
});

test("in a comment a card link is bold in yellow and opens that card in the panel; a mention is bold in blue", async () => {
  acct.comments[101][1].body.html = `<div><p>See <a href="https://app.fizzy.do/111/cards/102">#102 Write the changelog</a>, ${mentionOf("u-bob", "Bob")}</p></div>`;
  const { view, cx, draw, tree } = await openDetail();
  const comment = must(tree, "fizzy-comment-html-cm2");
  const card = pieceOf(comment, "#102"), bob = pieceOf(comment, "@Bob");
  assert.deepEqual([card.style.font_bold, card.style.text_color, card.style.cursor_pointer], [true, "ansi3", true]);
  assert.deepEqual([bob.style.font_bold, bob.style.text_color, bob.style.cursor_pointer], [true, "ansi4", undefined]);
  fire(card, "on_click", {}, cx);
  assert.equal(view.detail.number, 102);
  await cx.settle();
  assert.match(textOf(must(await draw(), "fizzy-title")), /Write the changelog/);
});

// An event of the activity feed whose comment, or card description, holds Fizzy's HTML.
const commented = html => ({ eventable: { body: { html } } });
const described = html => ({ eventable: { description_html: html } });
const QUIET = Array.from({ length: 15 }, (_, i) => commented(`<p>Nothing ${i}</p>`));
async function mentionsPage(m) {
  click(await m.draw(), "fizzy-open-settings", m.cx);
  click(await m.draw(), "fizzy-setting-mentions", m.cx);
  return m.draw();
}

test("Settings opens on a list of its pages, each saying what it is set to now; a click opens the page, which its header names and whose Back returns to the list", async () => {
  seedGroups();
  const m = await mount();
  click(await m.draw(), "fizzy-open-settings", m.cx);
  let tree = await m.draw();
  assert.deepEqual(must(tree, "fizzy-settings").kids.map(k => k.id), ["fizzy-setting-mentions", "fizzy-setting-groups"]);
  const line = id => [textOf(must(tree, `fizzy-setting-${id}`).kids[1].kids[0]), textOf(must(tree, `fizzy-setting-${id}-summary`)), ...iconsIn(tree, `fizzy-setting-${id}`)];
  assert.deepEqual(line("mentions"), ["Mentions", "Can tag 0 of 2 people · Finds new ones by itself", "mods/fizzy/user.svg", "mods/fizzy/chevron-right.svg"]);
  assert.deepEqual(line("groups"), ["Board groups", "1 group", "mods/fizzy/kanban.svg", "mods/fizzy/chevron-right.svg"]);
  assert.deepEqual([textOf(headerOf(tree)).trim(), tipOf(tree, "fizzy-back")], ["Settings", "Back"]);
  click(tree, "fizzy-setting-mentions", m.cx);
  tree = await m.draw();
  assert.deepEqual([textOf(headerOf(tree)).trim(), tipOf(tree, "fizzy-back")], ["Mentions", "Settings"]);
  assert.ok(find(tree, "fizzy-mentions"));
  click(tree, "fizzy-back", m.cx);
  tree = await m.draw();
  assert.ok(find(tree, "fizzy-setting-groups"), "the list again");
  state.shared["fizzy.boardGroups"] = { groups: [], boards: {} };
  assert.equal(textOf(must(await m.draw(), "fizzy-setting-groups-summary")), "No groups");
  assert.deepEqual(savedGroups(), [], "looking saves nothing");
});

test("Settings > Mentions: how many people can be tagged and who not yet; a card's number in its field learns everyone mentioned on that card, and says how many", async () => {
  localStorage.setItem("mentionAuto", "false");
  acct.comments[101].push(BOB_SAYS);
  acct.comments[102] = [{ ...BOB_SAYS, id: "cm7", body: { html: `<p>${mentionOf("u-me", "Ada")}</p>`, plain_text: "@Ada" } }];
  const m = await mount();
  let tree = await mentionsPage(m);
  const block = id => textOf(must(tree, id)).replace(/\s+/g, " ").trim();
  assert.equal(block("fizzy-mentions-status"), "You can tag 0 of 2 people Not yet: Ada, Bob");
  const field = inputOf(tree, "fizzy-mentions-card");
  assert.equal(field.options.placeholder, "Card number");
  field.edit("#101", m.cx);
  const release = holdOn();
  field.submit(m.cx);
  assert.equal(textOf(must(drawn(m.view, m.cx), "fizzy-mentions-note")), "Reading #101…");
  release();
  await m.cx.settle();
  assert.deepEqual([acct.asked("card", "show").at(-1), acct.asked("comment", "list").at(-1)], [["card", "show", "101"], ["comment", "list", "--card", "101", "--all"]]);
  tree = await m.draw();
  assert.equal(block("fizzy-mentions-status"), "You can tag 1 of 2 people Not yet: Ada");
  assert.equal(textOf(must(tree, "fizzy-mentions-note")), "Learned 1 more person");
  field.edit("101", m.cx);
  field.submit(m.cx);
  tree = await m.draw();
  assert.equal(textOf(must(tree, "fizzy-mentions-note")), "No new mentions found", "a plain number does too");
  field.edit("102", m.cx);
  field.submit(m.cx);
  tree = await m.draw();
  assert.equal(block("fizzy-mentions-status"), "You can tag 2 of 2 people Everyone can be tagged with @.");
  const asked = acct.log.length;
  for (const junk of ["", "abc", "-3", "1.5"]) { field.edit(junk, m.cx); field.submit(m.cx); }
  await m.cx.settle();
  assert.equal(acct.log.length, asked, "anything but a card number asks nothing");
});

test("Find mentions reads the activity feed page by page, newest first, until everyone can be tagged or the feed ends; the button says how far it is, and the end what it learned", async () => {
  localStorage.setItem("mentionAuto", "false");
  acct.activity = [...QUIET, commented(`<p>${mentionOf("u-bob", "Bob")}</p>`), ...QUIET, described(`<p>${mentionOf("u-me", "Ada")}</p>`), ...QUIET];
  const m = await mount();
  assert.equal(acct.asked("activity").length, 0, "the switch is off: nothing by itself");
  let tree = await mentionsPage(m);
  assert.equal(textOf(must(tree, "fizzy-mentions-find")).trim(), "Find mentions in Fizzy");
  const release = holdOn();
  click(tree, "fizzy-mentions-find", m.cx);
  assert.equal(textOf(must(drawn(m.view, m.cx), "fizzy-mentions-find")).trim(), "Searching… page 1");
  release();
  await m.cx.settle();
  assert.deepEqual(acct.asked("activity", "list").map(a => a[3]), ["1", "2", "3"], "Ada's mention is on page 3: page 4 is never read");
  tree = await m.draw();
  assert.equal(textOf(must(tree, "fizzy-mentions-note")), "Learned 2 more people");
  assert.equal(textOf(must(tree, "fizzy-mentions-find")).trim(), "Find mentions in Fizzy");
  assert.deepEqual(JSON.parse(localStorage.getItem("mentions")), { "u-bob": "sgid-u-bob", "u-me": "sgid-u-me" });
  // A feed with nothing to learn is read to its end, once.
  setup();
  localStorage.setItem("mentionAuto", "false");
  acct.activity = [...QUIET, ...QUIET];
  const again = await mount();
  click(await mentionsPage(again), "fizzy-mentions-find", again.cx);
  await again.cx.settle();
  assert.deepEqual(acct.asked("activity", "list").map(a => a[3]), ["1", "2"]);
  assert.equal(textOf(must(await again.draw(), "fizzy-mentions-note")), "No new mentions found");
});

test("a Find mentions that fails says why, with a Retry that runs it again", async () => {
  localStorage.setItem("mentionAuto", "false");
  acct.fail = args => (args[0] === "activity" ? failure("network", "offline") : undefined);
  const m = await mount();
  click(await mentionsPage(m), "fizzy-mentions-find", m.cx);
  await m.cx.settle();
  let tree = await m.draw();
  assert.match(textOf(must(tree, "fizzy-mentions-now")), /Can't reach Fizzy/);
  acct.fail = null;
  acct.activity = [commented(`<p>${mentionOf("u-bob", "Bob")}</p>`)];
  click(tree, "fizzy-mentions-retry", m.cx);
  await m.cx.settle();
  tree = await m.draw();
  assert.equal(textOf(must(tree, "fizzy-mentions-note")), "Learned 1 more person");
  assert.equal(find(tree, "fizzy-mentions-retry"), null);
});

test("Find mentions automatically is on by default: while someone can't be tagged, reading the people starts a scan of the activity, at most once a week; the switch turns it off, kept between runs", async () => {
  acct.activity = [commented(`<p>${mentionOf("u-bob", "Bob")}</p>`)];
  const first = await mount();
  assert.deepEqual(acct.asked("activity", "list"), [["activity", "list", "--page", "1"]], "at start");
  assert.deepEqual(first.view.mentionIds, { "u-bob": "sgid-u-bob" });
  assert.deepEqual(state.shared["fizzy.people"].mentionable, ["u-bob"], "the popups are told");
  await mount();
  assert.equal(acct.asked("activity", "list").length, 1, "again within the week: no scan");
  localStorage.setItem("mentionScanAt", String(Date.now() - 8 * DAY_MS));
  const m = await mount();
  assert.equal(acct.asked("activity", "list").length, 2, "a week on, with Ada still untaggable: scanned again");
  let tree = await mentionsPage(m);
  const look = () => { const s = must(tree, "fizzy-mentions-auto-switch"); return [s.style.bg, s.style.justify_end, textOf(parentOf(tree, "fizzy-mentions-auto-switch")).trim()]; };
  assert.deepEqual(look(), ["solid", true, "On"]);
  click(tree, "fizzy-mentions-auto-switch", m.cx);
  tree = await m.draw();
  assert.deepEqual(look(), ["raised", undefined, "Off"]);
  assert.equal(localStorage.getItem("mentionAuto"), "false");
  click(tree, "fizzy-back", m.cx);
  assert.match(textOf(must(await m.draw(), "fizzy-setting-mentions-summary")), /· Manual only$/);
  localStorage.setItem("mentionScanAt", String(Date.now() - 8 * DAY_MS));
  const off = await mount();
  assert.deepEqual([acct.asked("activity", "list").length, off.view.mentionAuto], [2, false], "off: never by itself");
  localStorage.setItem("mentionAuto", "true");
  localStorage.setItem("mentions", JSON.stringify({ "u-me": "sgid-u-me", "u-bob": "sgid-u-bob" }));
  await mount();
  assert.equal(acct.asked("activity", "list").length, 2, "everyone can be tagged: nothing to look for");
});

const picture = (sgid, more = "") => `<action-text-attachment sgid="${sgid}" content-type="image/png" filename="shot.png" filesize="2048" width="800" height="600"${more}></action-text-attachment>`;
const scriptsRun = () => calls.exec.filter(c => c.command === "sh" && [IMAGE_SCRIPT, OPEN_SCRIPT, FREE_NAME_SCRIPT].includes(c.args[1]))
  .map(c => [c.args[1] === IMAGE_SCRIPT ? "image" : c.args[1] === OPEN_SCRIPT ? "open" : "free name", ...c.args.slice(3)]);

test("an image in a description is downloaded once into the panel's files, through the CLI by its place among the card's attachments, and drawn at its own aspect ratio, a box saying Loading image… until then", async () => {
  acct.card(101).description_html = `<div><p>Look</p>${picture("sgid-pic", ' caption="The bug"')}</div>`;
  acct.attachments[101] = ["sgid-other", "sgid-pic"];
  const key = shortHash("sgid-pic"), file = `${key}.png`;
  const { view, cx, draw } = await mount();
  await draw();
  let release;
  const gate = new Promise(resolve => { release = resolve; }), downloads = [], exec = state.exec;
  state.exec = async (command, args, options) => {
    if (args.includes("download")) { downloads.push(args); await gate; }
    return exec(command, args, options);
  };
  click(drawn(view, cx), "fizzy-card-101", cx);
  for (let i = 0; i < 50 && !downloads.length; i++) await tick();
  let box = must(drawn(view, cx), "fizzy-desc-html-1");
  assert.deepEqual([box.style.w, box.style.h, textOf(box)], [290, 218, "shot.png Loading image…"], "a box of its size: as wide as the text (360 - 70), at 800 by 600");
  release();
  await cx.settle();
  assert.deepEqual(acct.asked("card", "attachments"), [
    ["card", "attachments", "show", "101", "--include-comments"],
    ["card", "attachments", "download", "101", "2", "--include-comments", "-o", `${state.appHome}/${FILE_DIR}/${file}`],
  ], "its sgid is the second of the card's");
  assert.deepEqual(execOptions("card").filter(o => o.timeout), [{ cwd: state.home, timeout: FILE_TIMEOUT }], "the download alone may outlast Herdr's 30 s");
  assert.deepEqual(calls.exec.filter(c => c.command === "mkdir").map(c => c.args), [["-p", `${state.appHome}/${FILE_DIR}`]]);
  assert.deepEqual(JSON.parse(localStorage.getItem("files")), { [key]: file }, "kept between runs");
  const tree = await draw();
  box = must(tree, "fizzy-desc-html-1");
  assert.deepEqual(box.kids.map(k => [k.kind, k.path]), [["image", `${FILE_DIR}/${file}`]]);
  assert.deepEqual([box.style.w, box.style.h, box.style.tooltip], [290, 218, "shot.png"]);
  assert.deepEqual(box.dragPaths, [`${state.appHome}/${FILE_DIR}/${file}`], "dragged into a terminal, it drops its file");
  assert.equal(textOf(parentOf(tree, "fizzy-desc-html-1")).trim(), "The bug", "its caption under it");
  click(tree, "fizzy-desc-html-1", cx);
  await cx.settle();
  assert.deepEqual(scriptsRun().at(-1), ["open", "open", `${state.appHome}/${FILE_DIR}/${file}`], "a click opens it in the system's viewer");
  // Read again, and in a new copy: never downloaded twice.
  await press(cx, "refresh");
  state.props = undefined;
  const again = await mount();
  click(await again.draw(), "fizzy-card-101", again.cx);
  await again.draw();
  assert.equal(acct.asked("card", "attachments", "download").length, 1);
});

test("an image that will not download, or is over the size limit, is drawn as a file; Refresh tries a failed one again", async () => {
  acct.card(101).description_html = `<div>${picture("sgid-gone")}${picture("sgid-huge").replace('filesize="2048"', 'filesize="99999999"')}</div>`;
  acct.attachments[101] = ["sgid-huge"];
  const { cx, draw } = await mount();
  click(await draw(), "fizzy-card-101", cx);
  let tree = await draw();
  assert.equal(acct.asked("card", "attachments", "download").length, 0, "the one on the card is too big, the other is not on it");
  for (const id of ["fizzy-desc-html-0", "fizzy-desc-html-1"]) assert.equal(iconOf(tree, id), "paperclip.svg", `${id}: a file`);
  assert.match(textOf(must(tree, "fizzy-desc-html-1")), /shot\.png\s+95\.4 MB/);
  acct.attachments[101] = ["sgid-gone", "sgid-huge"];
  await press(cx, "refresh");
  tree = await draw();
  assert.deepEqual(acct.asked("card", "attachments", "download").map(a => a[4]), ["1"], "Refresh: the failed one again, not the large one");
  assert.equal(must(tree, "fizzy-desc-html-0").kids[0].kind, "image");
});

test("an image from the web in a comment is fetched by its address into the panel's files and drawn; it is never sent to the CLI", async () => {
  acct.comments[101][1].body.html = '<div><p>Like this <img src="https://example.com/cat.png?size=2" alt="Cat"></p></div>';
  const key = shortHash("https://example.com/cat.png?size=2");
  const { tree } = await openDetail();
  assert.deepEqual(scriptsRun(), [["image", "https://example.com/cat.png?size=2", `${state.appHome}/${FILE_DIR}`, key]]);
  assert.equal(acct.asked("card", "attachments").length, 0);
  const box = must(tree, "fizzy-comment-html-cm2-1");
  assert.deepEqual([box.kids[0].kind, box.kids[0].path, box.style.tooltip], ["image", `${FILE_DIR}/${key}.png`, "Cat"]);
});

test("a file that is not an image is a chip with a paperclip, its name and size; a click saves it in Downloads under a name that is free there, and shows it in its folder", async () => {
  acct.card(101).description_html = '<div><action-text-attachment sgid="sgid-doc" content-type="application/pdf" filename="spec.pdf" filesize="3145728"></action-text-attachment>'
    + '<action-text-attachment sgid="sgid-gone" content-type="application/zip" filename="old.zip"></action-text-attachment></div>';
  acct.attachments[101] = ["sgid-doc"];
  const { cx, tree } = await openDetail();
  const chip = must(tree, "fizzy-desc-html-0");
  assert.deepEqual(chip.kids.map(k => (k.kind === "svg" ? k.path : textOf(k))), ["mods/fizzy/paperclip.svg", "spec.pdf", "3.0 MB"]);
  assert.equal(chip.style.tooltip, "Save to Downloads");
  assert.equal(acct.asked("card", "attachments").length, 0, "nothing is downloaded until asked");
  click(tree, "fizzy-desc-html-0", cx);
  await cx.settle();
  const path = `${state.home}/Downloads/spec.pdf`;
  assert.deepEqual(acct.asked("card", "attachments", "download"), [["card", "attachments", "download", "101", "1", "--include-comments", "-o", path]]);
  assert.deepEqual(scriptsRun(), [["free name", `${state.home}/Downloads`, "spec", ".pdf"], ["open", "reveal", path]]);
  assert.equal(calls.notify.at(-1).body, "Saved to Downloads");
  assert.deepEqual(must(tree, "fizzy-desc-html-1").kids.map(k => (k.kind === "svg" ? k.path : textOf(k))), ["mods/fizzy/paperclip.svg", "old.zip"], "no size known: none shown");
  click(tree, "fizzy-desc-html-1", cx);
  await cx.settle();
  assert.equal(errors().at(-1).body, "That file is no longer on the card");
  assert.equal(acct.asked("card", "attachments", "show").length, 2, "the card's list is read again once before it gives up");
  assert.equal(acct.asked("card", "attachments", "download").length, 1);
});

test("files dropped on the comment box are uploaded one after another, each put in as a token at the cursor; the comment carries them as attachments", async () => {
  const { view, cx, draw, tree } = await openDetail();
  const box = inputOf(tree, "fizzy-comment-input");
  box.edit("Here: ", cx);
  fire(must(tree, "fizzy-comment-input"), "on_drop", { paths: [`${state.home}/shot.png`, `${state.home}/spec.pdf`] }, cx);
  assert.equal(textOf(must(drawn(view, cx), "fizzy-uploading-comment")), "Uploading shot.png…");
  await cx.settle();
  assert.deepEqual(acct.asked("upload"), [["upload", "file", `${state.home}/shot.png`], ["upload", "file", `${state.home}/spec.pdf`]]);
  assert.deepEqual(execOptions("upload"), Array(2).fill({ cwd: state.home, timeout: FILE_TIMEOUT }), "an upload may outlast Herdr's 30 s");
  assert.deepEqual(spans(box).map(([text]) => text), ["🖼 shot.png", "📎 spec.pdf"]);
  assert.ok(spans(box).every(([, id]) => /^file:sgid-upload-\d+$/.test(id)));
  assert.equal(box.value(), "Here: 🖼 shot.png 📎 spec.pdf ");
  assert.equal(find(await draw(), "fizzy-uploading-comment"), null);
  click(await draw(), "fizzy-comment-send", cx);
  await cx.settle();
  assert.match(acct.writes().at(-1).at(-1), /^<p>Here: <action-text-attachment sgid="sgid-upload-\d+"><\/action-text-attachment> <action-text-attachment sgid="sgid-upload-\d+"><\/action-text-attachment><\/p>$/);
});

test("a paste with no text puts the clipboard's image in: saved as a PNG, uploaded as a token, and kept as that image's copy; with no image to read it says so", async () => {
  const { view, cx, tree } = await openDetail();
  const box = inputOf(tree, "fizzy-comment-input");
  box.handlers.paste_other({}, cx);
  await cx.settle();
  assert.equal(errors().at(-1).body, "Pasting images isn't supported here: drop the file on the box instead");
  assert.equal(acct.asked("upload").length, 0);
  acct.clipboardImage = true;
  box.handlers.paste_other({}, cx);
  await cx.settle();
  const [[, , pasted]] = acct.asked("upload");
  assert.match(pasted, /\/data\/fizzy\/files\/Pasted image \d{4}-\d\d-\d\d at \d\d\.\d\d\.\d\d\.png$/);
  const [[text, id]] = spans(box);
  assert.match(text, /^🖼 Pasted image .+\.png$/);
  const key = shortHash(id.slice("file:".length));
  assert.deepEqual(calls.exec.filter(c => c.command === "mv").map(c => c.args), [["-f", pasted, `${state.appHome}/${FILE_DIR}/${key}.png`]]);
  assert.equal(view.files[key], `${key}.png`, "the image's copy, so it is not downloaded again");
});
