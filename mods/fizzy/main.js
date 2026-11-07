// Your Fizzy board in the side panel: look at it, work it, and hand cards to your coding agents without leaving
// Herdr. It talks to the local `fizzy` CLI. Right-clicks, the "…" buttons and the pickers open this same mod as a
// popup (props().menu), so the exported class is both the panel and its menus. A popup never writes to Fizzy
// itself: it leaves a request in shared state and the panel, which stays alive, does it.
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea, TextView } from "gpui-base";
import { exec, agents, panes, spaces, focused, knownAgents, theme, shared, setShared, layout, home, appHome, props, run, notify, openOverlay, closeOverlay, nextCommand } from "herdr";
import {
  ICON, POLL_VIEW, POLL_INBOX, REQUEST_EVERY, START_WAIT, READY_WAIT, CONCURRENCY, CARD_PAGE, AGENTS, SEARCH_CAP, parseResult, execFailure, explain, explainSearch, cmd, withJson, laneOf, laneName, moveTo, sections,
  columnOf, fullCard, noteCard,
  filterCards, colorOf, meFrom, refs, textToHtml, htmlToText, htmlForView, textLines, formatted, initials, hue, ago, YAML_SCRIPT, parseYaml, chooseBoard,
  AVATAR_SCRIPT, AVATAR_DIR, AVATAR_TTL, AVATAR_BACKOFF, AVATAR_PARALLEL, AVATAR_EVERY, avatarBase, isAvatarFile, photosIn,
  targetAgent, agentLabel, fizzyVisible, menuRows, menuHeight, FRAME,
  groupsConfig, groupOf, boardGroups, ownHidden, addGroup, renameGroup, setMatch, setGroupHidden, removeGroup, placeBoard, moveGroup, setBoardHidden,
  TOASTS, SEEN_CAP, PENDING_FOR, TOAST_FOR, unreadNotes, oldestFirst, noteToast, noteAction, noteReady,
} from "./lib.js";

// Cards and comments are HTML. TextView draws it; with this off (or no TextView) the plain text is shown instead.
const RICH = true;
// Every hand-off to an agent borrows the clipboard (the terminal pastes from it). Put the old text back a moment later.
const RESTORE_CLIPBOARD = true;
// new-menu's cache of the agents each machine reported last, shown at once while knownAgents asks again.
const KNOWN = "new-menu.agents";
const VIEWS = [["board", "Board"], ["mine", "Mine"], ["inbox", "Inbox"], ["pins", "Pins"]];
const HEADER_VIEWS = VIEWS.filter(([id]) => id !== "board");
// The theme color each avatar hue index draws with.
const AVATARS = ["ansi1", "ansi2", "ansi3", "ansi4", "ansi5", "ansi6", "ansi9", "ansi12"];
// A popup is only as tall as its rows, and never taller than this (the rows scroll).
const MAX_MENU = 560, INPUT_ROW = 40;
// The bottom bar: one line of four buttons, each as high as BAR_BUTTON. Below NARROW px of panel width (its narrowest is
// 280) the buttons drop their icons and keep their labels, so the four still fit in that one line; the header drops
// its "Fizzy" word and tightens its buttons for the same reason.
const BAR_BUTTON = 28, NARROW = 340;
// Transparent, not the background color: a background-colored border would show as a frame inside a highlighted block.
const CLEAR = "#00000000";
// The Done lane is read at most this many pages deep in one go (the CLI's pages are short).
const DONE_PAGES = 40;
const LANELESS = { maybe: true, "not-now": true, done: true };
const WATCH_KEPT = 200;

const why = e => String(e?.message ?? e);
const stop = (_e, cx) => cx.stop_propagation();
// ⌘/Ctrl held with a click or a press.
const cmdHeld = e => Boolean(e?.modifiers?.platform || e?.modifiers?.control);
const unique = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const read = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
};
const keep = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* a full or missing store only costs the cache */ }
};
// The signed-in user as an earlier run read them: { account, id }, or null.
const keptMe = () => {
  const kept = read("me", null);
  return typeof kept?.id === "string" && kept.id ? { account: kept.account ?? null, id: kept.id } : null;
};
const watchEntries = raw => (Array.isArray(raw) ? raw.filter(e => Array.isArray(e) && Number.isInteger(e[0]) && typeof e[1] === "boolean").map(([n, on]) => [n, on]) : []);

// Asks the CLI. Always from the home folder, so that no .fizzy.yaml beside the shell changes what it reads
// (a default board would narrow the boardless Mine read).
async function fizzy(args) {
  let result;
  try { result = await exec("fizzy", withJson(args), { cwd: home() }); }
  catch (e) { throw execFailure(e); }
  return parseResult(result);
}

// A card cut down to what the rows, the menus and the prompts use: the cache and the popups' props stay small.
function slim(card) {
  const column = columnOf(card.column);
  return {
    number: card.number, title: card.title, url: card.url, closed: !!card.closed, postponed: !!card.postponed, golden: !!card.golden, column,
    board: card.board ? { id: card.board.id, name: card.board.name } : undefined,
    tags: (card.tags ?? []).map(t => (typeof t === "string" ? t : t.title)),
    assignees: (card.assignees ?? []).map(u => ({ id: u.id, name: u.name })),
    last_active_at: card.last_active_at, description: String(card.description ?? "").slice(0, 300),
  };
}
// A card whose title and link are known. The stub a card opened by its number shows (openCard) has neither: a
// card is only handed to an agent once it is whole. A board (what the bar hands over when no card is) always is.
const whole = card => card?.kind === "board" || Boolean(card?.url);
const slimColumn = c => ({ id: c.id, name: c.name, kind: c.kind, pseudo: c.pseudo, color: c.color });
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Shared with the popups, which only see shared state and their props: boards, people (users, tags, me).
function sharePeople(patch) {
  const was = shared("fizzy.people") ?? {}, next = { ...was, ...patch };
  if (!sameJson(was, next)) setShared("fizzy.people", next);
}
const people = () => shared("fizzy.people") ?? {};

// The people, shared as the menus use them, and handed back as the CLI listed them (with their photos' addresses). One read
// at a time: whoever asks while it is out gets the same answer.
const usersRead = { pending: null };
function readUsers() {
  usersRead.pending ??= fizzy(cmd.users()).then(raw => {
    const list = raw ?? [];
    sharePeople({ users: list.map(u => ({ id: u.id, name: u.name, role: u.role, active: u.active })) });
    return list;
  }).finally(() => { usersRead.pending = null; });
  return usersRead.pending;
}

// Users and tags are read the first time a card or a menu needs them (tags again, `fresh`, after a card is tagged).
// Answers the user list when this call read it (with their photos' addresses), else null: the panel hands it to `meet`, so
// that photos missed by the read at start are fetched now. A popup ignores it (only the panel fetches photos).
async function loadPeople(fresh = false) {
  const have = people(), patch = {};
  let read = null;
  try {
    if (have.users == null) read = await readUsers();
    if (have.tags == null || fresh) patch.tags = (await fizzy(cmd.tags()) ?? []).map(t => ({ id: t.id, title: t.title }));
  } catch (e) { notify({ title: "Fizzy", body: explain(e), level: "error" }); }
  sharePeople(patch);
  return read;
}

// The place the person is working: the shown space's machine and its first terminal's folder (else where it was made).
function whereNow() {
  const space = spaces().find(s => s.active);
  if (!space) return null;
  const tabs = new Set((space.tabs ?? []).map(t => t.id));
  const folder = panes().find(p => tabs.has(p.tab) && p.cwd)?.cwd || space.folder || (space.machine ? "" : home());
  return { machine: space.machine ?? "", folder };
}

// Nothing to copy (no card): the clipboard is left alone, never emptied.
function copyText(text, cx) {
  if (!text) return false;
  cx.write_to_clipboard(text);
  notify({ title: "Fizzy", body: "Copied", timeout: 1500 });
  return true;
}

// The person's own clipboard while a paste borrows it: `saved` is what was on it before the first paste of a run,
// `pending` how many restores are still waiting, `at` when the last paste began. A second paste inside the
// restore window finds `pending` and leaves `saved` alone (the first card's text is not the person's clipboard).
const clip = { saved: undefined, pending: 0, at: 0 };
const CLIP_WINDOW = 500, CLIP_STALE = 3000;

// Into an agent's input, never submitted (the person presses Enter): Herdr's paste reads the clipboard, so the text goes
// there for a moment. The agent's pane is focused first; `bring`: its space and tab are brought to the front before that
// (Send picks a session that may be anywhere). With no agent to paste into the text is only copied, and `none` says so.
// The hand-offs (copyText, pasteInto, insertText) take the cx of the click, or of the panel.
function pasteInto(text, cx, agent, { bring = false, none = "Copied — no agent here" } = {}) {
  if (!text) return false;
  if (!agent) {
    cx.write_to_clipboard(text);
    notify({ title: "Fizzy", body: none, timeout: 4000 });
    return false;
  }
  // A restore that never ran (its timer went with a closed copy) must not keep the old clipboard for ever.
  if (!clip.pending || Date.now() - clip.at > CLIP_STALE) { clip.saved = cx.read_from_clipboard(); clip.pending = 0; }
  clip.at = Date.now();
  cx.write_to_clipboard(`${text} `);
  if (bring) {
    if (agent.space) run("space.select", { id: agent.space });
    if (agent.tab) run("tab.select", { id: agent.tab });
  }
  run("pane.focus", agent.pane ? { pane: agent.pane } : { terminal: agent.address });
  run("terminal.paste");
  clip.pending++;
  cx.timer.after(CLIP_WINDOW, cx2 => {
    clip.pending = Math.max(0, clip.pending - 1);
    if (!clip.pending && RESTORE_CLIPBOARD && typeof clip.saved === "string") cx2.write_to_clipboard(clip.saved);
  });
  return true;
}

// Insert: the current chat, the agent in view (the focused pane's, else the focused agent block's, else the newest in the tab).
const insertText = (text, cx) => pasteInto(text, cx, targetAgent({ agents: agents(), focused: focused() }));

// Everything the menu rows depend on, read live (the caller adds what it looks up itself).
function live(extra) {
  const p = people();
  return { agents: agents(), focused: focused(), boards: shared("fizzy.boards") ?? [], groups: shared("fizzy.boardGroups"), users: p.users, tags: p.tags, me: p.me, ...extra };
}

// The height a popup asks for, which is the most it can be. Rows that arrive after it opens (agents being asked,
// people being read) need room, and past MAX_MENU the rows scroll. The popup works this out again to know its most.
function menuSize(menu) {
  const rows = menuRows(menu, live({ known: [], checking: true }));
  const spare = menu.kind === "start" ? AGENTS - 1 : menu.kind === "users" || menu.kind === "tags" ? 8 : 0;
  return Math.min(MAX_MENU, menuHeight(rows, spare) + (menu.kind === "tags" ? INPUT_ROW : 0));
}

function openMenu(menu, width = menu.kind === "agents" ? 320 : 260) {
  openOverlay({ mod: "fizzy", kind: "popup", width, height: menuSize(menu), props: { menu } });
}

// A popup's request to the panel (a write, or a hand-off that needs the panel's long-lived cx).
const request = op => setShared("fizzy.request", { id: unique(), op });

// What choosing a popup row does. Writes and the hand-offs go through the panel: this popup closes at once and its
// own tasks and timers go with it (the panel pastes, and waits for a new session to come up).
function perform(act, cx) {
  if (act.request) request(act.request);
  else if ("insert" in act) request({ kind: "insert", text: act.insert });
  else if (act.paste) request({ kind: "paste", address: act.paste.address, text: act.paste.text });
  else if (act.start) request({ kind: "start", name: act.start.name, argv: act.start.argv, text: act.start.text, agent: act.start.agent });
  else if ("copy" in act) copyText(act.copy, cx);
  else if (act.open) cx.open_url(act.open);
  else if (act.choose) setShared("fizzy.board", { follow: act.choose.follow, board: act.choose.board, id: unique() });
  else if (act.menu) openMenu(act.menu);
}

// The color of a card's lane: a real column's; Maybe?, Not Now and Done have none.
const laneColor = card => (laneOf(card) in LANELESS ? null : colorOf(card.column));
const now = () => Date.now();

// Moves a local copy of a card where `target` puts it, before Fizzy has said so.
function relane(card, target, columns) {
  if (target === "done") { card.closed = true; return; }
  card.closed = false;
  card.postponed = target === "not-now";
  const column = target === "not-now" || target === "maybe" ? null : (columns ?? []).find(c => c.id === target);
  card.column = column ? { id: column.id, name: column.name, color: column.color } : null;
}

function toggleIn(list, same, item) {
  return list.some(same) ? list.filter(x => !same(x)) : [...list, item];
}

export default class Fizzy extends View {
  init(_props, cx) {
    const menu = props()?.menu;
    if (menu) return this.initMenu(menu, cx);
    const view = read("view", "board");
    this.view = VIEWS.some(([id]) => id === view) ? view : "board";
    this.follow = read("follow", true) !== false;
    this.picked = read("board", null);
    this.boards = read("boards", null);
    // `fallback`: the CLI's default board as the last start read it; no board is chosen before one start has (`configKnown`).
    // `account`: the CLI's (null: none), undefined until `config show` answers. `me`: the signed-in user's id in it, null until
    // then (see accountIs); `meAccount`: the account `me` was read for.
    const config = read("config", null);
    this.fallback = config?.board ?? null; this.configKnown = config != null;
    this.account = undefined; this.me = null; this.meAccount = undefined;
    this.yamls = new Map(); // "machine\0folder" -> { at, board }: the board a folder's .fizzy.yaml names
    this.board = null;
    this.columns = new Map(); this.cards = new Map(); this.lazy = new Map(); this.collapsed = {};
    this.mine = new Map(); this.progress = null;
    this.inbox = null; this.pins = null; // the Inbox: the unread notifications only (newest first)
    // The ids of the notifications that were already announced (kept, newest last). A copy that starts with none has
    // nothing to compare with: its first poll only learns what is there (`seeded`), so a fresh install never floods.
    const kept = read("seenNotes", []);
    this.seen = Array.isArray(kept) ? kept.slice(-SEEN_CAP) : [];
    this.seeded = this.seen.length > 0;
    // A toast that had to bring the panel up before its card can open: { number, id, until, before }.
    this.pendingNote = null;
    this.errors = {};
    this.busy = new Set(); this.again = new Map(); // key -> the task to run once more when the read in flight ends
    this.reading = new Map(); // card number -> its `card show` in flight (shared by whoever asks meanwhile)
    this.selected = new Set();
    this.onlyMine = false;
    this.detail = null; this.editing = null; this.armedComment = null;
    // Fizzy tells no one whether a card is watched: this is only what the panel set itself (card number -> on), newest last.
    this.watching = new Map(watchEntries(read("watching", [])).slice(-WATCH_KEPT));
    this.activityOpen = false; // the card's Activity group (Fizzy's own lines): folded until opened, kept for the session
    // What is being edited in the detail view (`editing`: "title", "desc", "step" or "comment"): the step's or comment's id.
    this.editId = null;
    this.pressed = null; this.composer = null; this.composerMore = false; this.ticks = 0;
    this.search = null; // a search of every board: { q, found: Map(board id -> cards), count (cards found), error, waiting }
    clip.saved = undefined; clip.pending = 0; // a new copy has none of the old copy's restores to wait for
    this.unread = Number(shared("fizzy.unread") ?? 0);
    // What the popups sent that was already there when this copy started is not asked of it again.
    this.handled = shared("fizzy.request")?.id ?? null;
    this.choiceSeen = shared("fizzy.board")?.id ?? null;
    this.shown = fizzyVisible(layout());
    // The session Start is waiting for: { name, text, agent, before (the addresses that ran before it), at, found: { address, at } }.
    // One at a time: a newer Start replaces it. Looked at by the request timer (see takeStart), never by a draw.
    this.starting = null;
    this.narrow = false; // the panel is narrower than NARROW px: the bar's buttons drop their icons, the header its word
    // Profile photos: { [user id]: { file, at } } is kept between runs, `paths` is what is drawn from it ({ [user id]: image path }),
    // `wanted` the users still to fetch (id -> photo address), `fetching` the ones being fetched, `failedAt` when a failed one may
    // be tried again. Only this panel fetches (see takeAvatars); popups read the paths from shared state.
    const index = read("avatars", {});
    this.photos = {};
    if (index && typeof index === "object") for (const [id, p] of Object.entries(index)) if (isAvatarFile(p?.file) && Number.isFinite(p.at)) this.photos[id] = { file: p.file, at: p.at };
    this.wanted = new Map(); this.fetching = new Set(); this.failedAt = new Map(); this.unshared = false;
    this.syncPaths(); this.shareAvatars();

    // Input states are made here and in handlers, never in render.
    this.filter = InputState.new({ placeholder: "Filter cards…" });
    // Other words are another search: the results of the old ones go.
    this.filter.on("change", (_e, cx) => {
      if (this.search && this.filter.value().trim() !== this.search.q) this.search = null;
      cx.notify();
    });
    this.composerInput = InputState.new({ placeholder: "New card title" });
    this.composerInput.on("submit", (_e, cx) => this.createCard(cx));
    this.composerDesc = TextareaState.new({ placeholder: "Description (optional)", rows: 4 });
    this.stepInput = InputState.new({ placeholder: "Add a step" });
    this.stepInput.on("submit", (_e, cx) => this.addStep(cx));
    this.commentArea = TextareaState.new({ placeholder: "Write a comment…", rows: 3 });
    // Settings: shown or not, the new-group field open, the one name or rule being changed in place ({ id, field: "name" | "match" }),
    // and the group whose delete has been asked for once. The groups themselves are shared state (`fizzy.boardGroups`).
    // `drag`: a row picked up with ⌘/Ctrl held, { kind: "group" | "board", id, over: the block under the pointer that takes it ({ to }: a group's id,
    // null for No group) or null }. `folds`: the ids of the folded groups; `foldNone`: No group is folded. Both are kept.
    this.settingsOpen = false; this.composing = false; this.groupEdit = null; this.groupArmed = null; this.drag = null;
    const folded = read("folds", null);
    this.folds = new Set(Array.isArray(folded?.ids) ? folded.ids.filter(id => typeof id === "string") : []);
    this.foldNone = folded?.none === true;
    this.groupNew = InputState.new({ placeholder: "New group" });
    this.groupNew.on("submit", (_e, cx) => this.newGroup(cx));

    if (this.boards) this.shareBoards();
    this.loadConfig(cx); // and with the account, the person
    this.fetchBoards(cx);
    this.pollUnread(cx);
    this.loadUsers(cx); // the people's photos are fetched once their list is in (and again, once a day: see below)
    this.spaceBoard(cx); // the space's board is asked now, so it is likely known by the first draw
    // The board's own read follows once its board is known (syncBoard); the other views read now, the Inbox's being the unread poll above.
    if (this.view !== "board" && this.view !== "inbox") this.refreshList(cx);
    // Every view but the Inbox is read again now and then, only while it shows and nothing is being typed into a card.
    cx.timer.every(POLL_VIEW, cx => { if (fizzyVisible(layout())) this.poll(cx); });
    // The unread notifications are asked even while the panel is hidden (the Inbox's list, the toasts, and fizzy.unread for other mods).
    cx.timer.every(POLL_INBOX, cx => this.pollUnread(cx));
    // A hidden copy is never drawn, so render cannot see the panel go away. Note it here, so the first draw
    // after it shows again knows it is back and reads again.
    cx.timer.every(1000, () => { if (!fizzyVisible(layout())) this.shown = false; });
    // A popup's request is also looked for on a timer: a popup that was left open when the panel was hidden (a hidden
    // copy is not drawn) has no draw to hand its request to, and must not wait until the panel shows again.
    // The same timer looks for a toast's click that had to bring the panel up first, for the new session that Start
    // is waiting for, and for photos to fetch (never a draw's work).
    cx.timer.every(REQUEST_EVERY, cx => { this.takeRequest(cx); this.takePending(cx); this.takeStart(cx); this.takeAvatars(cx); });
    // The people are read again every day: new people, and photos older than a week are fetched again.
    cx.timer.every(AVATAR_EVERY, cx => this.loadUsers(cx));
    // Key commands ("<key>": "fizzy.<command>" in keys.json) and Herdr's `fizzy.<command>` run: panel copies only.
    // Herdr delivers a command to shown copies only, so none comes while the panel is hidden.
    cx.spawn(async cx => {
      for (;;) {
        const text = await nextCommand();
        try { this.command(String(text), cx); }
        catch (e) { notify({ title: "Fizzy", body: why(e), level: "error" }); }
        cx.notify();
      }
    });
  }

  // One read per key at a time. Asked again while one is out, it runs once more when that one ends: a write may
  // have landed after the first began. `task` gets the cx of its own task.
  // The run that waits is the newest one asked for: its closure is the one that knows what is on screen now.
  load(key, cx, task) {
    if (this.busy.has(key)) { this.again.set(key, task); return; }
    this.busy.add(key);
    cx.spawn(async cx => {
      try { await task(cx); }
      finally {
        this.busy.delete(key);
        cx.notify();
        const next = this.again.get(key);
        if (next) { this.again.delete(key); this.load(key, cx, next); }
      }
    });
  }

  // A task for an event handler's work: the handler's own cx ends with the handler, so what has to wait for
  // the CLI runs in a task with a cx of its own. A failure is told to the person.
  job(cx, body) {
    return cx.spawn(async cx => {
      try { await body(cx); }
      catch (e) { notify({ title: "Fizzy", body: explain(e), level: "error" }); }
    });
  }

  // The board `fizzy` itself would use (the fallback) and its account, from `config show`, never from the CLI's files. Read at
  // start and on Refresh, which also reads the person again (`fresh`); when `config show` fails, the last start's answer stands.
  loadConfig(cx, fresh = false) {
    this.load("config", cx, async cx => {
      let found = read("config", null) ?? {};
      try {
        found = (await fizzy(cmd.config())) ?? {};
        keep("config", { board: found.board ?? null, account: found.account ?? null });
      } catch { /* the last start's answer, if there is one */ }
      this.fallback = found.board ?? null; this.configKnown = true;
      this.accountIs(found.account ?? null, cx, fresh);
    });
  }

  // The account is known. `me` is never another account's: one read for another account is dropped at once, and the one kept
  // from an earlier run is used only for the account it was read for. It is read again when none fits, and when `fresh`.
  accountIs(account, cx, fresh) {
    this.account = account;
    if (this.meAccount !== account) {
      const kept = keptMe();
      this.meIs(kept?.account === account ? kept.id : null, cx);
    }
    if (fresh || !this.me) this.fetchMe(cx);
  }

  meIs(id, cx) {
    const changed = id !== this.me;
    this.me = id; this.meAccount = id ? this.account : undefined;
    if ((people().me ?? null) !== id) sharePeople({ me: id });
    if (changed && id && this.view === "mine") this.loadMine(cx); // Mine needs the person: it waited for them
  }

  fetchBoards(cx) {
    this.load("boards", cx, async cx => {
      try {
        this.boards = ((await fizzy(cmd.boards())) ?? []).map(b => ({ id: b.id, name: b.name, url: b.url }));
        this.errors.boards = null;
        keep("boards", this.boards);
        this.shareBoards();
        if (this.view === "mine") this.loadMine(cx); // Mine needs the boards: it waited for them
      } catch (e) { this.errors.boards = e; }
    });
  }

  shareBoards() {
    const boards = this.boards.map(b => ({ id: b.id, name: b.name }));
    if (!sameJson(shared("fizzy.boards"), boards)) setShared("fizzy.boards", boards);
  }

  // `identity show`'s own id is the login's: assignees and authors carry the account's user, which meFrom finds.
  fetchMe(cx) {
    if (this.account === undefined) return; // the config's arrival asks
    this.load("me", cx, async cx => {
      try {
        const id = meFrom(await fizzy(cmd.me()), this.account);
        keep("me", id ? { account: this.account, id } : null);
        this.meIs(id, cx);
      } catch (e) {
        this.errors.me = e;
        if (!this.me && this.view === "mine") this.errors.mine = e; // Mine cannot start without the person
      }
    });
  }

  // The people list, read (once at start, then daily) so that their photos are known. A failure costs nothing: the initials stay.
  loadUsers(cx) {
    this.load("users", cx, async () => {
      try { this.meet(await readUsers()); } catch { /* the next menu or card reads them again (and meets them), else tomorrow */ }
    });
  }

  // Notes the users in what the CLI answered whose photo is missing or older than AVATAR_TTL. Nothing is fetched here: a draw,
  // a read, anyone may call it. The photos are fetched by takeAvatars.
  meet(data) {
    for (const { id, url } of photosIn(data)) if (this.photoDue(id)) this.wanted.set(id, url);
  }

  // Does this user's photo need fetching now? Not while one is being fetched for them, nor within AVATAR_BACKOFF of a failure.
  photoDue(id) {
    if (this.fetching.has(id) || (this.failedAt.get(id) ?? 0) > now()) return false;
    const have = this.photos[id];
    return !have || now() - have.at > AVATAR_TTL;
  }

  // Called by the request timer (and when a fetch ends): starts the photos that are wanted, AVATAR_PARALLEL at a time, each user
  // once. When the last of a batch is done the shared map is brought up to date, once for all of them.
  takeAvatars(cx) {
    for (const [id, url] of this.wanted) {
      if (this.fetching.size >= AVATAR_PARALLEL) break;
      this.wanted.delete(id);
      if (this.photoDue(id)) this.fetchPhoto(id, url, cx);
    }
    if (this.unshared && !this.fetching.size && !this.wanted.size) { this.unshared = false; this.shareAvatars(); }
  }

  // One photo, by AVATAR_SCRIPT: it prints the new file's name, and deletes the user's older files.
  fetchPhoto(id, url, cx) {
    const base = avatarBase(id, now());
    this.fetching.add(id);
    cx.spawn(async cx => {
      let file = null;
      try {
        const r = await exec("sh", ["-c", AVATAR_SCRIPT, "fizzy", url, `${appHome()}/${AVATAR_DIR}`, base]);
        const name = String(r?.stdout ?? "").trim().split(/\r?\n/).pop();
        if (r?.code === 0 && isAvatarFile(name) && name.startsWith(`${base}.`)) file = name;
      } catch { /* no curl, or it would not run: the initials stay */ }
      this.fetching.delete(id);
      if (file) {
        this.photos[id] = { file, at: now() };
        this.failedAt.delete(id);
        keep("avatars", this.photos);
        this.syncPaths();
        this.unshared = true; // the popups hear of it when the batch ends (takeAvatars)
      } else this.failedAt.set(id, now() + AVATAR_BACKOFF);
      this.takeAvatars(cx);
      cx.notify();
    });
  }

  // What the panel draws from (`paths`), as the photos on disk are now.
  syncPaths() {
    this.paths = Object.fromEntries(Object.entries(this.photos).map(([id, p]) => [id, `${AVATAR_DIR}/${p.file}`]));
  }

  // What the popups draw from: set only when it changed (every mod redraws on a change).
  shareAvatars() {
    if (!sameJson(shared("fizzy.avatars") ?? {}, this.paths)) setShared("fizzy.avatars", this.paths);
  }

  // The unread count, shared as fizzy.unread for other mods; set only when it changed (every mod redraws on a change).
  noteUnread(list) {
    const n = list.filter(x => !x.read).length;
    this.unread = n;
    if (Number(shared("fizzy.unread") ?? 0) !== n) setShared("fizzy.unread", n);
  }

  // The unread notifications, every POLL_INBOX: the Inbox's list, the count, and a toast for each new one. The one
  // tray read serves all three, so no view reads it again.
  pollUnread(cx) {
    this.load("unread", cx, async () => {
      let list;
      try { list = (await fizzy(cmd.inbox())) ?? []; } catch (e) { this.errors.inbox = e; return; /* fizzy.unread keeps its last value */ }
      this.errors.inbox = null;
      this.inbox = unreadNotes(list);
      this.noteUnread(list);
      this.meet(list);
      this.announce(list);
    });
  }

  // A toast for each unread notification not seen before (oldest first, three at most: more than that, the three
  // newest and one "N more"). The first poll of a copy with nothing seen only learns what is there.
  announce(unread) {
    const seen = new Set(this.seen), fresh = oldestFirst(unread.filter(n => !n.read && n.id != null && !seen.has(n.id)));
    const seeding = !this.seeded;
    this.seeded = true;
    if (!fresh.length) return;
    this.markSeen(fresh.map(n => n.id));
    if (seeding) return;
    for (const note of fresh.slice(-TOASTS)) this.toastNote(note);
    if (fresh.length > TOASTS) notify({ title: "Fizzy", body: `${fresh.length - TOASTS} more in Fizzy`, level: "info", timeout: TOAST_FOR });
  }

  // Notifications that are not news: announced, or touched in the panel (marked read or unread), so a toast
  // never announces one the person has handled. Kept at SEEN_CAP, the newest last, and persisted.
  markSeen(ids) {
    const have = new Set(this.seen), add = [...new Set(ids)].filter(id => id != null && !have.has(id));
    if (!add.length) return;
    this.seen = [...this.seen, ...add].slice(-SEEN_CAP);
    keep("seenNotes", this.seen);
  }

  // Posts one notification's toast; its click opens the card in the panel (see noteAction).
  toastNote(note) {
    const { action, before } = noteAction(layout(), note);
    // Only a toast that has to bring the panel up leaves a wait, and the newest such toast wins. One that opens at once
    // or has no card (no action) leaves an earlier toast's wait alone.
    if (before) this.pendingNote = { number: note.card.number, id: note.id, until: Date.now() + PENDING_FOR, before };
    notify({ ...noteToast(note), level: "info", timeout: TOAST_FOR, ...(action ? { action } : {}) });
  }

  // A toast's click that had to bring the panel up: once the layout shows Fizzy (it did not when the toast was posted),
  // the card opens and its notification is read. A click that never came expires.
  takePending(cx) {
    const p = this.pendingNote;
    if (!p) return;
    if (Date.now() > p.until) { this.pendingNote = null; return; }
    const root = layout(), ready = noteReady(root, p.before);
    if (!ready) return;
    this.pendingNote = null;
    try {
      if (ready === "show") run("layout.show", { id: "panel" });
      this.openCard(p.number, null, cx);
      this.readNote(p.id, cx);
    } catch (e) { notify({ title: "Fizzy", body: why(e), level: "error" }); }
  }

  // Marks a notification read because its card was opened from its toast. The Inbox's own copy of it, when it is
  // there, goes through markRead (a refusal puts it back); either way the unread count is read again afterwards.
  readNote(id, cx) {
    const note = this.inbox?.find(n => n.id === id);
    if (note) { this.markRead(note, cx); return; }
    this.job(cx, async cx => {
      try { await fizzy(cmd.read(id)); }
      catch (e) { notify({ title: "Fizzy", body: explain(e), level: "error" }); }
      this.pollUnread(cx);
    });
  }

  // Where a space's folder points (its .fizzy.yaml, found by walking up), asked once a minute per place.
  spaceBoard(cx) {
    const at = whereNow();
    if (!at?.folder) return null;
    const key = `${at.machine}\0${at.folder}`, hit = this.yamls.get(key);
    if (!hit || (!hit.loading && Date.now() - hit.at > 60000)) {
      this.yamls.set(key, { ...hit, at: Date.now(), loading: true });
      cx.spawn(async cx => {
        let board = null;
        try {
          const r = await exec("sh", ["-c", YAML_SCRIPT, "fizzy", at.folder], { on: at.machine || null });
          if (r.code === 0) board = parseYaml(r.stdout).board ?? null;
        } catch { /* a machine that does not answer has no board of its own */ }
        this.yamls.set(key, { at: Date.now(), board, answered: true });
        cx.notify();
      });
    }
    // undefined: not answered yet (null: answered, the folder names no board).
    return hit?.answered ? hit.board : undefined;
  }

  // The board shown follows the space (when asked to), else the pick, else the CLI's own default.
  syncBoard(cx) {
    const choice = shared("fizzy.board");
    if (choice?.id && choice.id !== this.choiceSeen) {
      this.choiceSeen = choice.id;
      this.follow = choice.follow !== false;
      if (choice.board) this.picked = choice.board;
      keep("follow", this.follow);
      keep("board", this.picked);
      // A draw does not act: the view changes a moment later, on a timer. In the Board view the board's read is already on
      // its way (switchBoard), so only search results are left.
      cx.timer.after(1, cx => { if (this.view !== "board" || this.search) this.setView("board", cx); });
    }
    const space = this.spaceBoard(cx);
    // Following, the space's own answer is waited for: reading the default board meanwhile would be wasted
    // (and the panel would flash it).
    if (space === undefined && this.follow) return;
    if (!this.configKnown) return;
    const next = chooseBoard({ boards: this.boards ?? [], follow: this.follow, spaceBoard: space ?? null, picked: this.picked, fallback: this.fallback });
    if (next !== this.board) this.switchBoard(next, cx);
  }

  switchBoard(next, cx) {
    this.board = next;
    this.selected.clear(); this.composer = null; this.pressed = null; this.errors.board = null;
    if (!next) return;
    this.collapsed = read(`collapsed:${next}`, {});
    const cached = this.cards.has(next) ? null : read(`data:${next}`, null);
    if (cached) { this.columns.set(next, cached.columns ?? []); this.cards.set(next, cached.open ?? []); }
    if (this.view === "board") this.loadBoard(cx);
  }

  lazyOf(board) {
    if (!this.lazy.has(board)) this.lazy.set(board, { notNow: null, done: null, stale: false, page: 0, end: false, shown: CARD_PAGE, errors: {} });
    return this.lazy.get(board);
  }

  // The Done lane page by page. Pages up to `upto` are read again (a refresh); after that, until `want` cards are in hand. The
  // lane ends at a page that says none follows, or at an empty page (a page past the end says one does).
  async doneCards(board, from, want, upto = 0) {
    const seen = new Set((from?.cards ?? []).map(c => c.number)), cards = [...(from?.cards ?? [])];
    let page = from?.page ?? 0, end = false;
    while (page < DONE_PAGES && (page < upto || cards.length < want)) {
      const { cards: found, more } = (await fizzy(cmd.done(board, page + 1))) ?? {};
      if (!found?.length) { end = true; break; }
      page++;
      this.meet(found);
      for (const c of found) if (!seen.has(c.number)) { seen.add(c.number); cards.push(slim(c)); }
      if (!more) { end = true; break; }
    }
    return { cards, page, end };
  }

  unfolded(kind) {
    return !this.collapsedNow({ key: kind, kind });
  }

  // The board's open cards. The columns are read when they are not known yet or `columns` asks (Refresh), and when an open card
  // names one that is not among them. An unfolded Not Now or Done lane is read when it has no data yet or is stale (Refresh or a
  // write came since it was read, see refreshAll); a folded lane never is.
  loadBoard(cx, { columns = false } = {}) {
    const board = this.board;
    if (!board) return;
    this.load(`board:${board}`, cx, async () => {
      try {
        const lazy = this.lazyOf(board), known = this.columns.get(board), wantColumns = columns || !known, stale = lazy.stale;
        lazy.stale = false;
        const [listed, open, notNow, done] = await Promise.all([
          wantColumns ? fizzy(cmd.columns(board)) : null, fizzy(cmd.open(board)),
          this.unfolded("not-now") && (stale || !lazy.notNow) ? fizzy(cmd.notNow(board)) : null,
          this.unfolded("done") && (stale || !lazy.done) ? this.doneCards(board, null, lazy.shown, lazy.page) : null,
        ]);
        let read = wantColumns ? listed ?? [] : null;
        if (!read && (open ?? []).some(c => c.column?.id && !known.some(k => k.id === c.column.id))) read = (await fizzy(cmd.columns(board))) ?? [];
        this.meet([open, notNow]);
        if (notNow) { lazy.notNow = notNow.map(slim); lazy.errors["not-now"] = null; }
        if (done) { Object.assign(lazy, { done: done.cards, page: done.page, end: done.end }); lazy.errors.done = null; }
        if (read) this.columns.set(board, read.map(slimColumn));
        this.cards.set(board, (open ?? []).map(slim));
        keep(`data:${board}`, { columns: this.columns.get(board), open: this.cards.get(board) });
        if (this.board === board) { this.errors.board = null; this.prune(); }
      } catch (e) { if (this.board === board) this.errors.board = e; }
    });
  }

  // Not Now and Done are read each time they are unfolded.
  loadLane(kind, cx) {
    const board = this.board;
    if (!board) return;
    const lazy = this.lazyOf(board);
    this.load(`lane:${kind}:${board}`, cx, async () => {
      try {
        if (kind === "done") {
          const d = await this.doneCards(board, null, lazy.shown);
          Object.assign(lazy, { done: d.cards, page: d.page, end: d.end });
        } else {
          const cards = (await fizzy(cmd.notNow(board))) ?? [];
          this.meet(cards);
          lazy.notNow = cards.map(slim);
        }
        lazy.errors[kind] = null;
      } catch (e) { lazy.errors[kind] = e; }
    });
  }

  // "Show more": another page's worth of Done cards, read after the ones already here.
  moreDone(cx) {
    const board = this.board, lazy = this.lazyOf(board);
    lazy.shown += CARD_PAGE;
    if (lazy.done.length >= lazy.shown || lazy.end) { cx.notify(); return; }
    this.load(`lane:more:${board}`, cx, async () => {
      try {
        const d = await this.doneCards(board, { cards: lazy.done, page: lazy.page }, lazy.shown);
        Object.assign(lazy, { done: d.cards, page: d.page, end: d.end });
      } catch (e) { lazy.errors.done = e; }
    });
  }

  // Cards assigned to the person on every board. With no default board in the CLI that is one boardless `card list`; with
  // one, a boardless list would read that board only, so each board is read, CONCURRENCY at a time. (The person is known only
  // once `config show` has answered, so `fallback` is settled when this reads.)
  loadMine(cx) {
    if (!this.me) { this.fetchMe(cx); return; }
    const me = this.me, boards = this.boards ?? [];
    // With no boards (not read yet, or the account has none) there is nothing to ask, so no read is started: an await
    // on nothing ends in the microtask right after the draw that asked, and its notify would follow that draw at once.
    // The boards' arrival asks again (fetchBoards). What was held for boards that are gone is dropped, and told a
    // moment later by a timer (this may be a draw's own call, and a draw only looks).
    if (!boards.length) {
      if (this.boards && (this.mine.size || this.errors.mine)) {
        this.mine.clear(); this.errors.mine = null; this.prune();
        cx.timer.after(1, cx => cx.notify());
      }
      return;
    }
    this.load("mine", cx, async cx => {
      if (!this.fallback) { await this.mineAtOnce(me); return; }
      const failures = [];
      let next = 0;
      this.progress = { done: 0, total: boards.length };
      const worker = async () => {
        for (let b = boards[next++]; b; b = boards[next++]) {
          try {
            const cards = (await fizzy(cmd.mine(b.id, me))) ?? [];
            this.meet(cards);
            this.mine.set(b.id, cards.map(slim));
          }
          catch (e) { failures.push(e); }
          this.progress.done++;
          cx.notify();
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, boards.length) }, worker));
      // The boards as they are now (they may have been read again while this ran), not as this run began.
      for (const id of [...this.mine.keys()]) if (!(this.boards ?? boards).some(b => b.id === id)) this.mine.delete(id);
      this.errors.mine = boards.length && failures.length === boards.length ? failures[0] : null;
      this.progress = null;
      this.prune();
    });
  }

  async mineAtOnce(me) {
    try {
      const cards = (await fizzy(cmd.mineAll(me))) ?? [];
      this.meet(cards);
      const mine = new Map((this.boards ?? []).map(b => [b.id, []]));
      for (const card of cards.map(slim)) mine.get(card.board?.id)?.push(card);
      this.mine = mine;
      this.errors.mine = null;
      this.prune();
    } catch (e) { this.errors.mine = e; }
  }

  // The filter's words on every board and in comments: one `fizzy search`, its cards grouped by board (the filter itself
  // only sees the cards already read). Words that change while it runs drop what it found.
  searchAll(cx) {
    const q = this.filter.value().trim();
    if (!q || !(this.boards ?? []).length) return;
    const hunt = { q, found: new Map(), count: 0, error: null, waiting: true };
    this.search = hunt;
    cx.notify();
    this.load("search", cx, async () => {
      try {
        const cards = (await fizzy(cmd.search(q))) ?? [];
        this.meet(cards);
        if (this.search !== hunt) return;
        for (const card of cards.map(slim)) hunt.found.set(card.board?.id, [...(hunt.found.get(card.board?.id) ?? []), card]);
        hunt.count = cards.length;
      } catch (e) { hunt.error = e; }
      hunt.waiting = false;
    });
  }

  closeSearch(cx) {
    this.search = null;
    cx.notify();
  }

  loadPins(cx) {
    this.load("pins", cx, async () => {
      try {
        const raw = (await fizzy(cmd.pins())) ?? [];
        this.meet(raw);
        this.pins = raw.map(p => slim(p.card ?? p));
        this.errors.pins = null;
        this.prune();
      } catch (e) { this.errors.pins = e; }
    });
  }

  // A card read whole. One `card show` per card at a time: the detail's read and a hand-off that needs the same
  // card meanwhile (`open:<n>` then `copy`) share it.
  readCard(number) {
    let read = this.reading.get(number);
    if (!read) {
      read = fizzy(cmd.card(number)).then(card => { const full = fullCard(card); this.meet(full); return full; }).finally(() => this.reading.delete(number));
      this.reading.set(number, read);
    }
    return read;
  }

  // The open card and its comments, asked together, and (`pins`) the pin list, which is where its pin state comes from: the
  // poll leaves it alone.
  loadCard(cx, pins = true) {
    const d = this.detail;
    if (!d) return;
    this.load(`card:${d.number}`, cx, async () => {
      try {
        const [card, comments] = await Promise.all([this.readCard(d.number), fizzy(cmd.comments(d.number))]);
        this.meet(comments);
        if (this.detail !== d) return;
        d.card = card; d.comments = comments ?? []; d.error = null;
      } catch (e) { if (this.detail === d) d.error = e; }
    });
    if (pins) this.loadPins(cx);
  }

  // `fresh.columns`: the Board view reads the columns again, which a poll leaves alone (see loadBoard).
  refreshList(cx, fresh) {
    if (this.view === "board") this.loadBoard(cx, fresh);
    else if (this.view === "mine") this.loadMine(cx);
    else if (this.view === "inbox") this.pollUnread(cx);
    else this.loadPins(cx);
  }

  // `lanes`: a change or a Refresh leaves every lane read so far stale, to be read where it is unfolded: with the board's next read.
  refreshAll(cx, fresh) {
    if (fresh?.lanes) for (const lazy of this.lazy.values()) lazy.stale = true;
    this.refreshList(cx, fresh);
    if (this.detail) this.loadCard(cx, this.view !== "pins");
  }

  // The poll: the card when one is open, else the list; nothing while a title, description, step or comment is edited.
  // Mine is read every other time on the timer; `force`: at once. The Inbox is not read here: the unread poll fills it.
  poll(cx, force = false) {
    if (this.editing) return;
    if (this.detail) this.loadCard(cx, false);
    else if (this.view !== "inbox" && (this.view !== "mine" || force || ++this.ticks % 2 === 0)) this.refreshList(cx);
  }

  // Refresh and Retry: the boards too (a new one may have been made), the config and the person (the account may have
  // changed), then whatever shows, columns and unfolded lanes included.
  retry(cx) {
    this.fetchBoards(cx);
    this.loadConfig(cx, true);
    this.refreshAll(cx, { columns: true, lanes: true });
    cx.notify();
  }

  // Selected cards that left the lists (moved, closed elsewhere, deleted) leave the selection.
  prune() {
    for (const n of [...this.selected]) if (!this.find(n)) this.selected.delete(n);
  }

  held(number) {
    const lists = [...this.cards.values(), ...[...this.lazy.values()].flatMap(l => [l.notNow, l.done]), ...this.mine.values(), this.pins, ...(this.search?.found.values() ?? [])];
    const out = [];
    for (const list of lists) for (const c of list ?? []) if (c.number === number) out.push(c);
    if (this.detail?.number === number) out.push(...[this.detail.summary, this.detail.card].filter(Boolean));
    return [...new Set(out)];
  }

  find(number) {
    return this.held(number)[0] ?? null;
  }

  patch(number, fn) {
    for (const c of this.held(number)) fn(c);
  }

  pinOf(number) {
    return this.pins ? this.pins.some(p => p.number === number) : null;
  }

  watchOf(number) {
    return this.watching.get(number);
  }

  rememberWatch(number, on) {
    this.watching.delete(number);
    if (on !== undefined) this.watching.set(number, on);
    while (this.watching.size > WATCH_KEPT) this.watching.delete(this.watching.keys().next().value);
    keep("watching", [...this.watching]);
  }

  // Fizzy may start watching a card for someone who comments on it or takes it, so a remembered "not watching" is forgotten.
  unsureWatch(number) {
    if (this.watching.get(number) === false) this.rememberWatch(number, undefined);
  }

  // A card that left (deleted, or moved to another board): gone from every list, and from the screen.
  forget(number) {
    const cut = list => list?.filter(c => c.number !== number) ?? list;
    for (const [b, list] of this.cards) this.cards.set(b, cut(list));
    for (const lazy of this.lazy.values()) { lazy.notNow = cut(lazy.notNow); lazy.done = cut(lazy.done); }
    for (const [b, list] of this.mine) this.mine.set(b, cut(list));
    this.pins = cut(this.pins);
    for (const [b, list] of this.search?.found ?? []) this.search.found.set(b, cut(list));
    this.selected.delete(number);
    if (this.detail?.number === number) { this.detail = null; this.editing = null; }
  }

  // A card's columns, read when a card of another board (Mine, Pins) needs its menu.
  async columnsFor(board) {
    if (!this.columns.has(board)) this.columns.set(board, ((await fizzy(cmd.columns(board))) ?? []).map(slimColumn));
    return this.columns.get(board);
  }

  // Runs the commands in order, tells the person when one fails, and always reads again afterwards (that is also
  // how an optimistic change that did not happen goes away). A promise: `cx` is the one of a task (see job), and
  // an event handler starts it there, with `this.job(cx, cx => this.write(...))`.
  async write(lists, cx, refresh = true) {
    try { for (const argv of lists) await fizzy(argv); }
    catch (e) { notify({ title: "Fizzy", body: explain(e), level: "error" }); }
    if (refresh) this.refreshAll(cx, { lanes: true });
  }

  // `known`: the card as it is, when the caller has just read it. Called from an event handler or a timer, with
  // that one's cx: the changes shown at once are made here, the commands run in a task of their own.
  apply(op, cx, known = null) {
    const n = op.number, card = known ?? (n == null ? null : this.find(n));
    const later = (...lists) => this.job(cx, cx => this.write(lists, cx));
    switch (op.kind) {
      case "insert": return insertText(op.text, cx);
      // The Send popup's choice: that session comes to the front, and the text is pasted into it.
      case "paste": {
        const to = agents().find(a => a.address === op.address);
        if (!to) { notify({ title: "Fizzy", body: "That session is gone", level: "info", timeout: 3000 }); return null; }
        return pasteInto(op.text, cx, to, { bring: true });
      }
      // The Start popup's choice: a new tab with that agent (no first message), then the text goes in once it is up.
      case "start": return this.beginStart(op, cx);
      case "move": {
        // A card that no list holds (it just left them) is looked at first: where it is decides what has to be done.
        if (!card) return this.job(cx, async cx => { this.apply(op, cx, slim(await fizzy(cmd.card(n)))); });
        const lists = moveTo(card, op.target);
        if (!lists.length) return null;
        this.patch(n, c => relane(c, op.target, this.columns.get(c.board?.id ?? this.board)));
        cx.notify();
        return later(...lists);
      }
      case "golden":
        this.patch(n, c => { c.golden = op.on; });
        cx.notify();
        return later(cmd.golden(n, op.on));
      case "pin": {
        if (this.pins) this.pins = [...(op.on && card ? [slim(card)] : []), ...this.pins.filter(p => p.number !== n)];
        cx.notify();
        return this.job(cx, async cx => {
          await this.write([cmd.pin(n, op.on)], cx);
          if (this.pins && this.view !== "pins" && !this.detail) this.loadPins(cx);
        });
      }
      case "watch": {
        const before = this.watchOf(n);
        this.rememberWatch(n, op.on);
        cx.notify();
        return this.job(cx, async cx => {
          try {
            await fizzy(cmd.watch(n, op.on));
            if (this.detail?.number !== n) notify({ title: "Fizzy", body: `${op.on ? "Watching" : "No longer watching"} #${n}`, timeout: 1500 });
          } catch (e) {
            if (this.watchOf(n) === op.on) this.rememberWatch(n, before);
            notify({ title: "Fizzy", body: explain(e), level: "error" });
            cx.notify();
          }
        });
      }
      case "reopen":
        this.patch(n, c => { c.closed = false; });
        cx.notify();
        return later(cmd.reopen(n));
      case "selfAssign": {
        const name = people().users?.find(u => u.id === this.me)?.name ?? "me";
        if (this.me) this.patch(n, c => { c.assignees = toggleIn(c.assignees ?? [], u => u.id === this.me, { id: this.me, name }); });
        this.unsureWatch(n);
        cx.notify();
        return later(cmd.selfAssign(n));
      }
      case "assign": {
        const u = people().users?.find(x => x.id === op.user);
        if (u) this.patch(n, c => { c.assignees = toggleIn(c.assignees ?? [], a => a.id === u.id, { id: u.id, name: u.name }); });
        if (op.user === this.me) this.unsureWatch(n);
        cx.notify();
        return later(cmd.assign(n, op.user));
      }
      case "tag": {
        this.patch(n, c => { c.tags = toggleIn(c.tags ?? [], t => t === op.name, op.name); });
        cx.notify();
        // A new tag exists afterwards: the menus' list of tags is read again.
        return this.job(cx, async cx => {
          await this.write([cmd.tag(n, op.name)], cx);
          this.meet(await loadPeople(true));
        });
      }
      case "moveBoard": {
        this.forget(n);
        cx.notify();
        return later(cmd.moveBoard(n, op.board));
      }
      case "remove": {
        this.forget(n);
        cx.notify();
        return later(cmd.remove(n));
      }
      default: return null;
    }
  }

  setView(view, cx) {
    this.view = view;
    keep("view", view);
    this.selected.clear(); this.composer = null; this.search = null;
    this.refreshList(cx);
    cx.notify();
  }

  toggleSelect(number, cx) {
    if (!this.selected.delete(number)) this.selected.add(number);
    cx.notify();
  }

  clickCard(card, e, cx) {
    if (cmdHeld(e)) this.toggleSelect(card.number, cx);
    else this.openCard(card.number, card, cx);
  }

  // Mouse released over a lane (its header, or one of its cards): the card that was pressed goes there.
  drop(lane, cx) {
    const from = this.pressed;
    this.pressed = null;
    if (from && lane && from.lane !== lane) this.apply({ kind: "move", number: from.number, target: lane }, cx);
  }

  collapsedNow(section) {
    return this.collapsed[section.key] ?? (section.kind === "not-now" || section.kind === "done");
  }

  toggleSection(section, cx) {
    const now = !this.collapsedNow(section);
    this.collapsed = { ...this.collapsed, [section.key]: now };
    keep(`collapsed:${this.board}`, this.collapsed);
    if (!now && (section.kind === "not-now" || section.kind === "done")) this.loadLane(section.kind, cx);
    cx.notify();
  }

  // The composer under a lane's header. Lanes that are folded open up for it.
  openComposer(key, cx) {
    if (this.view !== "board") this.setView("board", cx);
    this.search = null; // the results of a search of every board hide the lanes, and with them the composer
    this.composer = key;
    this.collapsed = { ...this.collapsed, [key]: false };
    this.composerInput.set_value("");
    this.composerDesc.set_value("");
    this.composerMore = false;
    this.composerInput.focus();
    cx.timer.after(200, () => this.composerInput.focus());
    cx.notify();
  }

  closeComposer(cx) {
    this.composer = null;
    cx.notify();
  }

  // The composer's pencil: the description box opens under the title.
  toggleComposerMore(cx) {
    this.composerMore = !this.composerMore;
    if (this.composerMore) this.composerDesc.focus();
    else this.composerInput.focus();
    cx.notify();
  }

  // A card made in a real column is made in Maybe? and moved: the CLI cannot say where a new card goes. The
  // composer stays open and empty for the next one. The description box counts while it is open.
  createCard(cx) {
    const title = this.composerInput.value().trim(), board = this.board, key = this.composer;
    if (!title || !board || !key) return null;
    const html = this.composerMore ? textToHtml(this.composerDesc.value()) : "";
    this.composerInput.set_value("");
    this.composerDesc.set_value("");
    const column = key !== "maybe" && key !== "not-now" && key !== "done" ? key : null;
    return cx.spawn(async cx => {
      try {
        const made = await fizzy(cmd.create(board, title, html));
        if (column) {
          // The result names the new card; failing that, it is the newest card with that title.
          let number = made?.number;
          if (number == null) number = Math.max(0, ...((await fizzy(cmd.open(board))) ?? []).filter(c => c.title === title).map(c => c.number)) || null;
          if (number != null) await fizzy(cmd.column(number, column));
        }
      } catch (e) { notify({ title: "Fizzy", body: explain(e), level: "error" }); }
      this.refreshAll(cx, { lanes: true });
    });
  }

  // Runs `open` with the card's board's columns: at once when they are known, else once they are read (a card
  // of another board, from Mine or Pins).
  withColumns(card, cx, open) {
    const board = card.board?.id ?? this.board, known = this.columns.get(board);
    if (known) { open(known); return; }
    cx.spawn(async () => {
      try { open(await this.columnsFor(board)); }
      catch (e) { notify({ title: "Fizzy", body: explain(e), level: "error" }); }
    });
  }

  // The cards, each whole: one that is only a stub is read first (it throws when a read fails).
  loaded(list) {
    return Promise.all(list.map(async c => (whole(c) ? c : slim(await this.readCard(c.number)))));
  }

  // What the hand-offs act on: the open card (a stub until it is read), else the picked cards (in number order), else, in the
  // Board view, the board being shown (one item, { kind: "board", id, name, url }: its reference is a board's, see boardRef).
  // In Mine, Inbox and Pins with nothing open or picked there is nothing.
  subject() {
    const d = this.detail;
    if (d) return [slim(d.card ?? d.summary)];
    const picks = this.picks();
    if (picks.length || this.view !== "board") return picks;
    const board = this.boards?.find(b => b.id === this.board);
    return board ? [{ kind: "board", id: board.id, name: board.name, url: board.url }] : [];
  }

  // Hands cards (or the board, see subject) to an agent, as the bar's buttons do. Nothing is ever submitted: the person presses Enter. kind is
  //   "insert"  pasted into the current chat (copied, with a word, when there is no agent here)
  //   "send"    opens the popup of the running sessions: the one picked is brought to the front and gets the paste
  //   "start"   opens the popup of the agents to start: the one picked starts in a new tab (named after the card or board) and gets the paste once it is up
  //   "copy"    the reference to the clipboard
  // With nothing to hand over nothing happens. A card that is not whole yet (a stub: `open:<n>`, a notification) is read first, in a
  // task; if that fails the error is told and nothing is handed over.
  handOff(kind, list, cx) {
    if (!list.length) return null;
    const go = (cards, cx) => {
      switch (kind) {
        case "insert": return insertText(refs(cards), cx);
        case "copy": return copyText(refs(cards), cx);
        case "send": return openMenu({ kind: "agents", cards });
        case "start": return openMenu({ kind: "start", cards });
        default: return null;
      }
    };
    if (list.every(whole)) { go(list, cx); return null; }
    return this.job(cx, async cx => go(await this.loaded(list), cx));
  }

  // Start's choice: a new tab with that agent, named after the card, with no first message. The session it makes is not
  // known yet: the addresses that run now are remembered, and takeStart looks for the one that is new.
  beginStart(op, cx) {
    if (!op.text || !Array.isArray(op.argv)) return null;
    const before = new Set(agents().map(a => a.address));
    run("tab.new", { name: op.name, argv: op.argv });
    this.starting = { name: op.name, text: op.text, agent: op.agent || "the agent", before, at: now(), found: null };
    return null;
  }

  // Called by the request timer. Once the new session is up and ready for input (idle, or READY_WAIT after it appeared)
  // the text is pasted into it; if none shows within START_WAIT the text is only copied and the person is told.
  takeStart(cx) {
    const s = this.starting;
    if (!s) return;
    // Only a session that is new AND sits in the tab this start named is the one: another agent that starts meanwhile
    // (or the session of a start this one replaced) is not this start's, whatever order they appear in.
    const found = agents().find(a => !s.before.has(a.address) && a.tab_name === s.name);
    if (!found) {
      s.found = null;
      if (now() - s.at < START_WAIT) return;
      this.starting = null;
      cx.write_to_clipboard(s.text);
      notify({ title: "Fizzy", body: `Started ${s.agent} — the reference is on your clipboard`, timeout: 4000 });
      return;
    }
    if (s.found?.address !== found.address) s.found = { address: found.address, at: now() };
    if (found.status !== "idle" && now() - s.found.at < READY_WAIT) return;
    this.starting = null;
    try { pasteInto(s.text, cx, found, { bring: true }); }
    catch (e) { notify({ title: "Fizzy", body: why(e), level: "error" }); }
  }

  // The card's menu. A stub card is read first: its hand-off rows carry its title and link, and its board's
  // columns are the right ones.
  cardMenu(card, cx) {
    if (whole(card)) return this.showCardMenu(card, cx);
    return this.job(cx, async cx => this.showCardMenu(slim(await this.readCard(card.number)), cx));
  }

  showCardMenu(card, cx) {
    // The people and tags the menu's sub-menus list are read now, so they are there when one opens.
    cx.spawn(async () => { this.meet(await loadPeople()); });
    // `to`: where its Insert row goes (the agent in view), for the row's hint.
    const target = targetAgent({ agents: agents(), focused: focused() }), to = target ? agentLabel(target) : null;
    this.withColumns(card, cx, columns => {
      const pinned = this.pinOf(card.number), watching = this.watchOf(card.number);
      openMenu({ kind: "card", card: slim(card), columns, to, ...(pinned == null ? {} : { pinned }), ...(watching === undefined ? {} : { watching }) });
    });
  }

  // Runs `fn` with the open card where it needs the card's own board (the lanes, the ⋯ menu): the read card, else the list's copy
  // when it knows its board, else once the card is read (a note's stub has no board id, a card opened by its number has no board).
  withCard(cx, fn) {
    const d = this.detail, c = d.card ?? (d.summary.board?.id ? d.summary : null);
    return c ? fn(c, cx) : this.job(cx, async cx => fn(slim(await this.readCard(d.number)), cx));
  }

  boardsMenu(cx) {
    openMenu({ kind: "boards", current: this.board, follow: this.follow, spaceBoard: this.spaceBoard(cx) });
  }

  // The picked cards (⌘/Ctrl-click), by number.
  picks() {
    return [...this.selected].sort((a, b) => a - b).map(n => this.find(n)).filter(Boolean).map(slim);
  }

  openCard(number, summary, cx) {
    this.leaveSettings();
    this.detail = { number, summary: summary ?? this.find(number) ?? { number, title: `#${number}` }, card: null, comments: null, error: null };
    this.editing = null; this.armedComment = null;
    this.stepInput.set_value("");
    this.commentArea.set_value("");
    cx.spawn(async () => { this.meet(await loadPeople()); });
    this.loadCard(cx);
    cx.notify();
  }

  goBack(cx) {
    this.detail = null; this.editing = null; this.armedComment = null;
    this.leaveSettings();
    cx.notify();
  }

  groups() {
    return groupsConfig(shared("fizzy.boardGroups"));
  }

  // Every change is kept at once, and only when it changed (every mod redraws on a change).
  saveGroups(next, cx) {
    if (!sameJson(this.groups(), next)) setShared("fizzy.boardGroups", next);
    cx.notify();
    return null;
  }

  openSettings(cx) {
    this.detail = null; this.editing = null; this.armedComment = null;
    this.leaveSettings();
    this.settingsOpen = true;
    cx.notify();
    return null;
  }

  leaveSettings() {
    this.settingsOpen = false; this.composing = false; this.groupEdit = null; this.groupArmed = null; this.drag = null;
  }

  keepFolds() {
    keep("folds", { ids: [...this.folds], none: this.foldNone });
  }

  foldGroup(id, cx) {
    if (!this.folds.delete(id)) this.folds.add(id);
    this.groupArmed = null;
    this.keepFolds();
    cx.notify();
  }

  foldNoGroup(cx) {
    this.foldNone = !this.foldNone;
    this.groupArmed = null;
    this.keepFolds();
    cx.notify();
  }

  disarm(cx) {
    if (this.groupArmed === null) return;
    this.groupArmed = null;
    cx.notify();
  }

  openGroupComposer(cx) {
    if (!this.composing) this.groupNew.set_value("");
    this.composing = true; this.groupEdit = null; this.groupArmed = null;
    this.groupNew.focus();
    cx.timer.after(200, () => this.groupNew.focus());
    cx.notify();
  }

  closeGroupComposer(cx) {
    this.composing = false;
    this.groupNew.set_value("");
    cx.notify();
  }

  // A group's name or rule: click it, change it in place, Enter saves, the x (or Escape) leaves it as it was. An empty rule is no rule;
  // an empty name is not taken.
  editGroup(id, field, cx) {
    const group = this.groups().groups.find(g => g.id === id);
    if (!group) return;
    this.groupInput = InputState.new({ value: group[field] ?? "", ...(field === "match" ? { placeholder: "Names containing…" } : {}) });
    this.groupInput.on("submit", (_e, cx) => this.saveGroup(cx));
    this.groupEdit = { id, field }; this.groupArmed = null; this.composing = false;
    this.groupInput.focus();
    cx.timer.after(200, () => this.groupInput.focus());
    cx.notify();
  }

  saveGroup(cx) {
    const edit = this.groupEdit;
    this.groupEdit = null;
    if (!edit) { cx.notify(); return; }
    const config = this.groups(), text = this.groupInput.value();
    this.saveGroups(edit.field === "name" ? renameGroup(config, edit.id, text) : setMatch(config, edit.id, text), cx);
  }

  cancelGroupEdit(cx) {
    this.groupEdit = null;
    cx.notify();
  }

  newGroup(cx) {
    const name = this.groupNew.value().trim();
    if (!name) return;
    const next = addGroup(this.groups(), name);
    this.composing = false;
    this.groupNew.set_value("");
    if (this.folds.delete(next.groups[0].id)) this.keepFolds();
    this.saveGroups(next, cx);
  }

  // Two clicks: the first only asks. A deleted group's id can be given to the next new group, so its fold goes with it.
  dropGroup(id, cx) {
    if (this.groupArmed !== id) { this.groupArmed = id; cx.notify(); return; }
    this.groupArmed = null;
    if (this.groupEdit?.id === id) this.groupEdit = null;
    if (this.folds.delete(id)) this.keepFolds();
    this.saveGroups(removeGroup(this.groups(), id), cx);
  }

  toggleGroup(id, cx) {
    const config = this.groups(), group = config.groups.find(g => g.id === id);
    this.groupArmed = null;
    if (group) this.saveGroups(setGroupHidden(config, id, !group.hidden), cx);
  }

  toggleBoard(id, cx) {
    const config = this.groups();
    this.groupArmed = null;
    this.saveGroups(setBoardHidden(config, id, !ownHidden(id, config)), cx);
  }

  // ⌘/Ctrl-drag in Settings: a left press with ⌘/Ctrl held on a group's header or a board's row picks it up; letting go over a block
  // drops it there (see dropOn), letting go anywhere else, pressing outside the panel or leaving Settings ends it with nothing changed.
  // Without ⌘/Ctrl a press is only a press (and ends a drag that was left behind).
  pickRow(kind, id, e, cx) {
    this.disarm(cx);
    if (!cmdHeld(e)) { this.endDrag(cx); return; }
    this.drag = { kind, id, over: null };
    cx.notify();
  }

  endDrag(cx) {
    if (!this.drag) return;
    this.drag = null;
    cx.notify();
  }

  // A press on a button inside a row (the eye, the bin, a field's row): it is not a press on the row, and it ends a drag that was left
  // behind (a row picked up and let go away from the panel). Without that, the release after this click would reach the block and
  // drop the old row there.
  pressButton(_e, cx) {
    cx.stop_propagation();
    this.endDrag(cx);
  }

  blockOf(boardId) {
    const board = (this.boards ?? []).find(b => b.id === boardId);
    return board ? (groupOf(board, this.groups())?.id ?? null) : undefined;
  }

  takes(to) {
    const d = this.drag;
    if (!d) return false;
    return d.kind === "board" ? to !== this.blockOf(d.id) : to !== null && to !== d.id;
  }

  // The pointer enters or leaves a block. Only while something is dragged does that change anything; leaving a block that is not the
  // target changes nothing, so entering the next block before leaving the last one never ends with no target.
  hoverBlock(to, hovered, cx) {
    const d = this.drag;
    if (!d) return;
    const was = d.over, here = was !== null && was.to === to;
    let next = was;
    if (hovered) next = this.takes(to) ? (here ? was : { to }) : null;
    else if (here) next = null;
    if (next === was) return;
    d.over = next;
    cx.notify();
  }

  // Which edge of the group's block the line is drawn at while a group is dragged over it: the top when the dragged group sits after it
  // (it lands before), the bottom when it sits before it (it lands after), as moveGroup does.
  lineAt(id) {
    const d = this.drag;
    if (d?.kind !== "group" || d.over?.to !== id) return null;
    const groups = this.groups().groups, from = groups.findIndex(g => g.id === d.id), at = groups.findIndex(g => g.id === id);
    if (from < 0 || at < 0 || from === at) return null;
    return from > at ? "top" : "bottom";
  }

  dropOn(to, cx) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const config = this.groups();
    let next = config;
    if (d.kind === "group") {
      if (to !== null) next = moveGroup(config, d.id, to);
    } else {
      const board = (this.boards ?? []).find(b => b.id === d.id);
      if (board && to !== (groupOf(board, config)?.id ?? null)) next = placeBoard(config, board, to);
    }
    this.saveGroups(next, cx);
  }

  editTitle(cx) {
    const c = this.detail.card ?? this.detail.summary;
    this.titleInput = InputState.new({ value: c.title ?? "" });
    this.titleInput.on("submit", (_e, cx) => this.saveTitle(cx));
    this.editing = "title";
    this.titleInput.focus();
    cx.timer.after(200, () => this.titleInput.focus());
    cx.notify();
  }

  saveTitle(cx) {
    const d = this.detail, title = this.titleInput.value().trim(), was = (d.card ?? d.summary).title;
    this.editing = null;
    cx.notify();
    if (!title || title === was) return null;
    this.patch(d.number, c => { c.title = title; });
    return this.job(cx, cx => this.write([cmd.update(d.number, { title })], cx));
  }

  editDescription(cx) {
    const c = this.detail.card;
    if (!c) return;
    this.descArea = TextareaState.new({ value: c.description_html ? htmlToText(c.description_html) : c.description ?? "", rows: 8 });
    this.editing = "desc";
    this.descArea.focus();
    cx.timer.after(200, () => this.descArea.focus());
    cx.notify();
  }

  saveDescription(cx) {
    const d = this.detail, text = this.descArea.value(), html = textToHtml(text);
    this.editing = null;
    this.patch(d.number, c => { c.description = text; if ("description_html" in c) c.description_html = html; });
    cx.notify();
    return this.job(cx, cx => this.write([cmd.update(d.number, { html })], cx));
  }

  toggleStep(step, cx) {
    step.completed = !step.completed;
    cx.notify();
    const n = this.detail.number;
    return this.job(cx, cx => this.write([cmd.step(n, step.id, step.completed)], cx));
  }

  dropStep(step, cx) {
    const d = this.detail;
    d.card.steps = d.card.steps.filter(s => s.id !== step.id);
    cx.notify();
    return this.job(cx, cx => this.write([cmd.dropStep(d.number, step.id)], cx));
  }

  addStep(cx) {
    const text = this.stepInput.value().trim(), d = this.detail;
    if (!text || !d) return null;
    this.stepInput.set_value("");
    return this.job(cx, cx => this.write([cmd.addStep(d.number, text)], cx));
  }

  // A step's text: click it, change it in place, Enter saves, the x (or Escape) leaves it as it was.
  editStep(step, cx) {
    this.stepEdit = InputState.new({ value: step.content ?? "" });
    this.stepEdit.on("submit", (_e, cx) => this.saveStep(cx));
    this.editing = "step"; this.editId = step.id;
    this.stepEdit.focus();
    cx.timer.after(200, () => this.stepEdit.focus());
    cx.notify();
  }

  saveStep(cx) {
    const d = this.detail, id = this.editId, text = this.stepEdit.value().trim(), step = d?.card?.steps?.find(s => s.id === id);
    this.editing = null; this.editId = null;
    cx.notify();
    if (!step || !text || text === step.content) return null;
    step.content = text;
    return this.job(cx, cx => this.write([cmd.editStep(d.number, id, text)], cx));
  }

  cancelEdit(cx) {
    this.editing = null; this.editId = null;
    cx.notify();
  }

  sendComment(cx) {
    const text = this.commentArea.value().trim(), d = this.detail;
    if (!text || !d) return null;
    this.commentArea.set_value("");
    this.unsureWatch(d.number);
    return this.job(cx, cx => this.write([cmd.comment(d.number, textToHtml(text))], cx));
  }

  // The person's own comment, as plain text in a box: Save sends it back as HTML.
  editComment(comment, cx) {
    this.commentEdit = TextareaState.new({ value: htmlToText(comment.body?.html ?? "") || comment.body?.plain_text || "", rows: 4 });
    this.editing = "comment"; this.editId = comment.id; this.armedComment = null;
    this.commentEdit.focus();
    cx.timer.after(200, () => this.commentEdit.focus());
    cx.notify();
  }

  saveComment(cx) {
    const d = this.detail, id = this.editId, text = this.commentEdit.value().trim(), comment = d?.comments?.find(c => c.id === id);
    this.editing = null; this.editId = null;
    cx.notify();
    if (!comment || !text || text === (htmlToText(comment.body?.html ?? "") || comment.body?.plain_text || "")) return null;
    const html = textToHtml(text);
    comment.body = { ...comment.body, html, plain_text: text };
    return this.job(cx, cx => this.write([cmd.editComment(d.number, id, html)], cx));
  }

  dropComment(comment, cx) {
    // Two clicks: the first only asks.
    if (this.armedComment !== comment.id) { this.armedComment = comment.id; cx.notify(); return null; }
    this.armedComment = null;
    this.detail.comments = this.detail.comments.filter(c => c.id !== comment.id);
    cx.notify();
    const n = this.detail.number;
    return this.job(cx, cx => this.write([cmd.dropComment(n, comment.id)], cx));
  }

  disarmComment(cx) {
    if (this.armedComment === null) return;
    this.armedComment = null;
    cx.notify();
  }

  // Marks one note read: it leaves the Inbox at once, Fizzy's answer follows. A refusal puts it back, and either way
  // the inbox and the unread count are read again.
  markRead(note, cx) {
    this.inbox = (this.inbox ?? []).filter(n => n !== note);
    this.markSeen([note.id]); // touched here: the next poll must not announce it as new
    this.noteUnread(this.inbox);
    cx.notify();
    return this.job(cx, async cx => {
      try { await fizzy(cmd.read(note.id)); }
      catch (e) {
        if (!this.inbox?.some(n => n.id === note.id)) this.inbox = unreadNotes([...(this.inbox ?? []), note]);
        this.noteUnread(this.inbox);
        notify({ title: "Fizzy", body: explain(e), level: "error" });
      }
      this.pollUnread(cx);
    });
  }

  openNote(note, cx) {
    this.markRead(note, cx);
    const c = noteCard(note);
    if (!c) return;
    const stub = { number: c.number, title: c.title, url: c.url, closed: !!c.closed, postponed: !!c.postponed, column: columnOf(c.column), board: c.board_name ? { id: null, name: c.board_name } : undefined };
    this.openCard(c.number, this.find(c.number) ?? stub, cx);
  }

  readAll(cx) {
    const was = this.inbox; // null while the Inbox is still loading: nothing to empty or to put back
    if (was) this.inbox = [];
    this.markSeen((was ?? []).map(n => n.id));
    this.noteUnread([]);
    cx.notify();
    return this.job(cx, async cx => {
      try { await fizzy(cmd.readAll()); }
      catch (e) {
        if (was) this.inbox = was;
        this.noteUnread(was ?? []);
        notify({ title: "Fizzy", body: explain(e), level: "error" });
      }
      this.pollUnread(cx);
    });
  }

  // What a key ("<key>": "fizzy.<command>" in keys.json) or `run fizzy.<command>` sends: "name" or "name:arg"
  // (a space does as well). A command that is not known, or has an argument that fits nothing, is ignored.
  command(text, cx) {
    const m = /^\s*([A-Za-z]+)(?:[:\s]\s*([\s\S]*?))?\s*$/.exec(text);
    if (!m) return;
    const name = m[1].toLowerCase(), arg = (m[2] ?? "").trim();
    const d = this.detail;
    const boards = this.boards ?? [];
    switch (name) {
      case "refresh": this.retry(cx); break;
      case "view": {
        const at = VIEWS.findIndex(([id]) => id === this.view), pick = arg ? VIEWS.find(([id]) => id === arg.toLowerCase()) : VIEWS[(at + 1) % VIEWS.length];
        if (!pick) break;
        this.goBack(cx);
        this.setView(pick[0], cx);
        break;
      }
      case "board": {
        const lower = arg.toLowerCase(), b = boards.find(x => x.id === arg) ?? boards.find(x => x.name === arg) ?? boards.find(x => x.name.toLowerCase() === lower);
        if (!b) break;
        this.follow = false; this.picked = b.id;
        keep("follow", false); keep("board", b.id);
        break;
      }
      case "follow": this.follow = true; keep("follow", true); break;
      // `open:<number>`, or `open:<number>:<notification id>` (a toast's click): the card opens, and that notification is read.
      case "open": {
        const [num, noteId] = arg.split(/[:\s]+/), n = Number(num);
        if (!Number.isInteger(n) || n <= 0) break;
        this.pendingNote = null; // the person has asked for a card: an older toast's wait is over
        this.openCard(n, null, cx);
        if (noteId) this.readNote(noteId, cx);
        break;
      }
      case "back": if (d || this.settingsOpen) this.goBack(cx); else this.search = null; break;
      case "settings": this.openSettings(cx); break;
      // As the bar's buttons: the open card, else the selection, else (Board view) the board. send and start open their popups of sessions and agents.
      case "insert": case "copy": case "send": case "start": this.handOff(name, this.subject(), cx); break;
      case "new":
        if (!this.board) break;
        this.goBack(cx); this.search = null;
        this.openComposer("maybe", cx);
        break;
      case "filter":
        this.goBack(cx);
        if (this.view === "inbox") this.setView("board", cx); // the Inbox has no filter
        this.filter.focus();
        cx.timer.after(200, () => this.filter.focus());
        break;
      // A card that no list holds gets its menu from a stub, which cardMenu reads first.
      case "menu": {
        const n = Number(arg), card = this.find(n) ?? (Number.isInteger(n) && n > 0 ? { number: n } : null);
        if (card) this.cardMenu(card, cx);
        break;
      }
      default: break;
    }
  }

  iconButton(t, id, icon, action, enabled = true, tip = null, size = 26) {
    return div().id(id).size(size).flex_none().flex().items_center().justify_center().rounded(6)
      .text_color(enabled ? t.muted : t.dim).on_mouse_down("left", (e, cx) => this.pressButton(e, cx))
      .when(enabled, el => el.hover(s => s.bg(t.hover).text_color(t.foreground)).cursor_pointer().on_click(action))
      .when(Boolean(tip), el => el.tooltip(tip))
      .child(svg(icon).size(14));
  }

  // state: "on" | "off" | "unknown" (not known, still clickable) | "inert" (not known, does nothing).
  toggleButton(t, id, icon, state, tip, action, onColor = t.accent) {
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6)
      .text_color(state === "on" ? onColor : state === "off" ? t.muted : t.dim)
      .when(state === "on", el => el.bg(t.selected))
      .on_mouse_down("left", (e, cx) => this.pressButton(e, cx))
      .when(state !== "inert", el => el.cursor_pointer().tooltip(tip).on_click(action)
        .hover(s => (state === "on" ? s.bg(t.hover) : s.bg(t.hover).text_color(t.foreground))))
      .child(svg(icon).size(14));
  }

  textButton(t, id, icon, label, action, primary = false) {
    return h_flex().id(id).h(30).px(10).gap(6).flex_none().items_center().rounded(7).cursor_pointer().text_size(12).font_medium()
      .bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground)
      .hover(s => s.opacity(0.88)).on_mouse_down("left", stop).on_click(action)
      .when(Boolean(icon), el => el.child(svg(icon).size(13).flex_none()))
      .child(label);
  }

  // The photo a user has in the cache (a path as image() takes it), else null. The panel knows its own; a popup reads the shared map.
  photoPath(user) {
    const id = user?.id ?? people().users?.find(u => u.name === user?.name)?.id; // a creator that comes with no id: found by name
    return (id != null && (this.paths ?? shared("fizzy.avatars"))?.[id]) || null;
  }

  // A person: their photo, round, when it is cached; else a circle with their initials (the color is steady per person).
  avatar(t, user, size = 16) {
    const path = this.photoPath(user);
    if (path) return image(path).size(size).flex_none().rounded_full();
    return div().size(size).flex_none().flex().items_center().justify_center().rounded_full().bg(t[AVATARS[hue(user.id ?? user.name)]])
      .text_size(size > 18 ? 11 : 9).font_medium().text_color(t.background).child(initials(user.name));
  }

  chip(t, text, extra = {}) {
    return div().flex_none().max_w(extra.max ?? 110).truncate().px(6).py(1).rounded(5).bg(t.raised).text_size(11).text_color(t.muted).child(text);
  }

  // A dim line of text, with Retry under an error.
  // `again`: what Retry does (else everything is read again); `id`: its id, when there can be several.
  status(t, text, cx, error = false, again = null, id = "fizzy-retry") {
    return v_flex().flex_none()
      .child(div().p(8).text_size(12).text_color(t.dim).whitespace_normal().child(text))
      .when(error, el => el.child(h_flex().id(id).h(28).flex_none().mx(8).px(8).gap(7).items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => (again ? again(cx) : this.retry(cx)))
        .child(svg(ICON("refresh")).size(14).flex_none().text_color(t.muted)).child("Retry")));
  }

  // An agent's icon as the agents popup draws it: a tinted one follows the text color, the others are images.
  agentIcon(t, program, size = 14) {
    const path = program?.icon ?? "icons/agent.svg";
    return program?.tint ? svg(path).size(size).flex_none().text_color(t.muted) : image(path).size(size).flex_none();
  }

  header(t, cx) {
    if (this.settingsOpen) {
      return h_flex().h(42).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border)
        .child(this.iconButton(t, "fizzy-back", ICON("arrow-left"), (_e, cx) => this.goBack(cx), true, "Back"))
        .child(div().flex_1().min_w(0).truncate().font_semibold().child("Settings"));
    }
    if (this.detail) {
      const d = this.detail, c = d.card ?? d.summary, n = d.number, board = c.board?.name ?? "";
      const pinned = this.pinOf(n), watching = this.watchOf(n), golden = c.golden;
      return h_flex().h(42).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border)
        .child(this.iconButton(t, "fizzy-back", ICON("arrow-left"), (_e, cx) => this.goBack(cx), true, "Back"))
        .child(div().id("fizzy-detail-number").flex_none().text_size(12).text_color(t.dim).child(`#${n}`))
        .child(div().id("fizzy-detail-board").flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).when(Boolean(board), el => el.tooltip(board)).child(board))
        .child(h_flex().flex_none().gap(2)
          .child(this.toggleButton(t, "fizzy-pin", ICON("pin"), pinned == null ? "inert" : pinned ? "on" : "off", pinned ? "Unpin" : "Pin",
            (_e, cx) => this.apply({ kind: "pin", number: n, on: !pinned }, cx)))
          .child(this.toggleButton(t, "fizzy-watch", ICON(watching === false ? "eye-off" : "eye"), watching === undefined ? "unknown" : watching ? "on" : "off", watching ? "Unwatch" : "Watch",
            (_e, cx) => this.apply({ kind: "watch", number: n, on: watching !== true }, cx)))
          .child(this.toggleButton(t, "fizzy-golden", ICON("star"), typeof golden === "boolean" ? (golden ? "on" : "off") : "inert", golden ? "Remove golden" : "Mark golden",
            (_e, cx) => this.apply({ kind: "golden", number: n, on: !golden }, cx), t.ansi3)))
        .child(h_flex().flex_none().gap(2)
          .when(!this.narrow, el => el.child(this.iconButton(t, "fizzy-act-open", ICON("external-link"), (_e, cx) => cx.open_url(c.url), Boolean(c.url), "Open in Fizzy")))
          .child(this.iconButton(t, "fizzy-card-menu", ICON("more"), (_e, cx) => this.withCard(cx, (card, cx) => this.showCardMenu(card, cx)), true, "More")));
    }
    return h_flex().h(42).flex_none().px(10).gap(8).items_center().border_b(1).border_color(t.border)
      .child(this.homeButton(t))
      .child(h_flex().flex_none().gap(3).children(HEADER_VIEWS.map(([id, label]) => this.viewButton(t, id, label))))
      .child(div().flex_1())
      .child(h_flex().flex_none().gap(2)
        .child(this.iconButton(t, "fizzy-refresh", ICON("refresh"), (_e, cx) => this.retry(cx), true, "Refresh"))
        .child(this.iconButton(t, "fizzy-open-settings", ICON("settings"), (_e, cx) => this.openSettings(cx), true, "Settings")));
  }

  homeButton(t) {
    const shown = this.view === "board";
    return h_flex().id("fizzy-home").h(26).px(this.narrow ? 6 : 8).gap(6).flex_none().items_center().rounded(6).cursor_pointer()
      .bg(shown ? t.selected : t.background).text_color(shown ? t.foreground : t.muted)
      .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
      .on_click((_e, cx) => this.setView("board", cx))
      .when(this.narrow, el => el.tooltip("Board"))
      .child(svg(ICON("kanban")).size(14).flex_none())
      .when(!this.narrow, el => el.child(div().flex_none().font_semibold().child("Fizzy")));
  }

  viewButton(t, id, label) {
    return h_flex().id(`fizzy-view-${id}`).h(26).px(this.narrow ? 6 : 8).gap(5).flex_none().items_center().rounded(6).cursor_pointer().text_size(12)
      .bg(this.view === id ? t.selected : t.background).text_color(this.view === id ? t.foreground : t.muted)
      .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
      .on_click((_e, cx) => this.setView(id, cx))
      .child(label)
      .when(id === "inbox" && this.unread > 0, el => el.child(div().min_w(16).h(16).px(4).flex().items_center().justify_center().rounded_full().bg(t.accent).text_size(10).text_color(t.accent_foreground).child(String(this.unread))));
  }

  boardBar(t) {
    const current = this.boards?.find(b => b.id === this.board);
    return h_flex().id("fizzy-board-bar").h(34).flex_none().px(10).gap(6).items_center()
      .child(h_flex().id("fizzy-board").h(26).min_w(0).px(8).gap(6).items_center().rounded(6).bg(t.raised).text_size(12)
        .text_color(this.board ? t.muted : t.dim).cursor_pointer().hover(s => s.bg(t.hover).text_color(t.foreground)).on_mouse_down("left", stop)
        .on_click((_e, cx) => this.boardsMenu(cx))
        .child(div().min_w(0).truncate().child(current?.name ?? (this.boards ? "No board" : "…")))
        .child(svg(ICON("chevron-down")).size(12).flex_none().text_color(t.dim)))
      .child(div().flex_1())
      .child(h_flex().flex_none().gap(2)
        .child(this.iconButton(t, "fizzy-new", ICON("plus"), (_e, cx) => this.openComposer("maybe", cx), Boolean(this.board), "New card"))
        .child(this.iconButton(t, "fizzy-open-board", ICON("external-link"), (_e, cx) => cx.open_url(current.url), Boolean(current?.url), "Open board in Fizzy")));
  }

  filterRow(t) {
    return h_flex().h(36).flex_none().px(10).gap(6).items_center()
      .child(div().id("fizzy-filter").flex_1().min_w(0).child(Input.new(this.filter).h(28).px(8).rounded(7).border_1().border_color(t.input).bg(t.background).text_size(12).text_color(t.foreground)))
      .when(this.view === "board", el => el.child(h_flex().id("fizzy-only-mine").h(28).px(9).flex_none().items_center().rounded(7).cursor_pointer().text_size(12)
        .border_1().border_color(this.onlyMine ? t.accent : t.input).bg(this.onlyMine ? t.selected : t.background).text_color(this.onlyMine ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click((_e, cx) => { this.onlyMine = !this.onlyMine; cx.notify(); })
        .child("Me")));
  }

  // A card's row: two lines, a bar in its lane's color, quick buttons at the right.
  cardRow(t, card, lane, color) {
    const n = card.number, picked = this.selected.has(n);
    const quick = (id, icon, tip, action) => div().id(id).size(22).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer().text_color(t.dim)
      .hover(s => s.bg(t.selected).text_color(t.foreground)).tooltip(tip)
      .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); action(cx); })
      .child(svg(icon).size(13));
    const tags = card.tags ?? [], who = card.assignees ?? [];
    return h_flex().id(`fizzy-card-${n}`).h(46).flex_none().px(8).gap(8).items_center().rounded(7).cursor_pointer()
      .when(picked, el => el.bg(t.selected)).hover(s => s.bg(t.hover))
      .on_mouse_down("left", () => { this.pressed = { number: n, lane }; })
      .on_mouse_up("left", (_e, cx) => this.drop(lane, cx))
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.cardMenu(card, cx); })
      .on_click((e, cx) => this.clickCard(card, e, cx))
      .child(div().w(3).h(30).flex_none().rounded(2).bg(color ?? t.border))
      .child(v_flex().flex_1().min_w(0).gap(3)
        .child(h_flex().gap(6).items_center().min_w(0)
          .when(card.golden, el => el.child(svg(ICON("star")).size(12).flex_none().text_color(t.ansi3)))
          .child(div().flex_none().text_size(11).text_color(t.dim).child(`#${n}`))
          .child(div().id(`fizzy-card-title-${n}`).flex_1().min_w(0).truncate().tooltip(card.title ?? "").child(card.title ?? ""))
          .child(quick(`fizzy-insert-${n}`, ICON("insert"), "Insert in chat", cx => this.handOff("insert", [slim(card)], cx)))
          .child(quick(`fizzy-more-${n}`, ICON("more"), "More", cx => this.cardMenu(card, cx))))
        .child(h_flex().gap(5).items_center().min_w(0).overflow_hidden().text_size(11).text_color(t.dim)
          .children(tags.slice(0, 3).map(tag => this.chip(t, tag, { max: 90 })))
          .when(tags.length > 3, el => el.child(div().flex_none().child(`+${tags.length - 3}`)))
          .children(who.slice(0, 3).map(u => this.avatar(t, u)))
          .child(div().flex_1())
          .child(div().flex_none().child(ago(card.last_active_at, now())))));
  }

  sectionHeader(t, section, count) {
    const closed = this.collapsedNow(section), addable = section.kind === "column" || section.kind === "maybe";
    return h_flex().id(`fizzy-section-${section.key}`).h(28).flex_none().px(8).gap(7).items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
      // A press here starts no drag, and ends a stale one (a card pressed earlier and released away from the panel).
      .on_mouse_down("left", () => { this.pressed = null; })
      .on_click((_e, cx) => this.toggleSection(section, cx))
      .on_mouse_up("left", (_e, cx) => this.drop(section.key, cx))
      .child(svg(ICON(closed ? "chevron-right" : "chevron-down")).size(12).flex_none().text_color(t.dim))
      .child(div().size(8).flex_none().rounded_full().bg(section.color ?? t.dim))
      .child(div().flex_1().min_w(0).truncate().font_medium().child(section.name))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(count == null ? "" : String(count)))
      .when(addable, el => el.child(div().id(`fizzy-add-${section.key}`).size(22).flex_none().flex().items_center().justify_center().rounded(5).text_color(t.dim)
        .hover(s => s.bg(t.selected).text_color(t.foreground)).tooltip("New card here")
        .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); this.openComposer(section.key, cx); })
        .child(svg(ICON("plus")).size(13))));
  }

  composerRow(t) {
    return v_flex().id("fizzy-composer").flex_none().mx(8).my(2).gap(6)
      .on_key_down((e, cx) => { if (e.key === "escape") this.closeComposer(cx); })
      .child(h_flex().gap(6).items_center()
        .child(div().flex_1().min_w(0).child(Input.new(this.composerInput).h(28).px(8).rounded(7).border_1().border_color(t.accent).bg(t.background).text_size(12).text_color(t.foreground)))
        .child(div().id("fizzy-composer-more").size(26).flex_none().flex().items_center().justify_center().rounded(6)
          .text_color(this.composerMore ? t.foreground : t.muted).when(this.composerMore, el => el.bg(t.selected))
          .hover(s => s.bg(t.hover).text_color(t.foreground)).cursor_pointer().tooltip("Add a description")
          .on_mouse_down("left", stop).on_click((_e, cx) => this.toggleComposerMore(cx))
          .child(svg(ICON("pencil")).size(14)))
        .child(this.iconButton(t, "fizzy-composer-cancel", ICON("x"), (_e, cx) => this.closeComposer(cx), true, "Cancel")))
      .when(this.composerMore, el => el.child(div().id("fizzy-composer-desc").w_full()
        .child(Textarea.new(this.composerDesc).w_full().px(8).py(6).rounded(7).border_1().border_color(t.input).bg(t.background).text_size(12).text_color(t.foreground))));
  }

  // The words in the filter, taken to every board: the row that starts that, under the list.
  searchRow(t, query) {
    return h_flex().id("fizzy-search-all").h(30).flex_none().mt(4).px(8).gap(7).items_center().rounded(7).cursor_pointer().text_size(12).text_color(t.muted)
      .hover(s => s.bg(t.hover)).on_click((_e, cx) => this.searchAll(cx))
      .child(svg(ICON("search")).size(13).flex_none())
      .child(div().flex_1().min_w(0).truncate().child(`Search all boards for “${query.trim()}”`));
  }

  boardList(t, cx) {
    const board = this.board, columns = board ? this.columns.get(board) : null;
    if (!board) return [this.status(t, this.errors.boards ? explain(this.errors.boards) : this.boards ? "No boards" : "Loading…", cx, Boolean(this.errors.boards))];
    if (!columns) return [this.status(t, this.errors.board ? explain(this.errors.board) : "Loading…", cx, Boolean(this.errors.board))];
    const lazy = this.lazyOf(board), query = this.filter.value(), out = [];
    const filtering = Boolean(query.trim()) || this.onlyMine;
    // A failed read keeps what was read before on screen, under the message.
    if (this.errors.board) out.push(this.status(t, explain(this.errors.board), cx, true));
    let total = 0;
    for (const section of sections(columns, this.cards.get(board) ?? [], { notNow: lazy.notNow ?? undefined, done: lazy.done ?? undefined })) {
      const loaded = section.kind === "not-now" ? Boolean(lazy.notNow) : section.kind === "done" ? Boolean(lazy.done) : true;
      const cards = filterCards(section.cards, query, { mine: this.onlyMine, me: this.me });
      const closed = this.collapsedNow(section);
      out.push(this.sectionHeader(t, section, loaded ? cards.length : null));
      if (closed) continue;
      if (this.composer === section.key) out.push(this.composerRow(t));
      const shown = section.kind === "done" ? cards.slice(0, lazy.shown) : cards;
      total += shown.length;
      for (const card of shown) out.push(this.cardRow(t, card, section.key, section.color ?? laneColor(card)));
      const onDemand = section.kind === "done" || section.kind === "not-now";
      if (onDemand && lazy.errors[section.kind]) out.push(this.status(t, explain(lazy.errors[section.kind]), cx, true, cx => this.loadLane(section.kind, cx), `fizzy-retry-${section.key}`));
      else if (onDemand && !loaded) out.push(this.status(t, "Loading…", cx));
      if (section.kind === "done" && loaded && (!lazy.end || cards.length > lazy.shown)) {
        out.push(h_flex().id("fizzy-more-done").h(28).flex_none().mx(8).px(8).items_center().rounded(7).cursor_pointer().text_size(12).text_color(t.muted)
          .hover(s => s.bg(t.hover)).on_click((_e, cx) => this.moreDone(cx)).child("Show more"));
      }
    }
    if (!total) out.push(this.status(t, filtering ? "No cards match" : "No cards", cx));
    if (query.trim()) out.push(this.searchRow(t, query));
    return out;
  }

  mineList(t, cx) {
    const query = this.filter.value(), out = [];
    if (this.errors.mine) out.push(this.status(t, explain(this.errors.mine), cx, true));
    let total = 0;
    for (const board of this.boards ?? []) {
      const cards = filterCards(this.mine.get(board.id) ?? [], query);
      if (!cards.length) continue;
      total += cards.length;
      out.push(h_flex().id(`fizzy-mine-${board.id}`).h(26).flex_none().px(8).items_center().font_medium().text_size(12).text_color(t.muted).child(div().min_w(0).truncate().child(board.name)));
      for (const card of cards) out.push(this.cardRow(t, card, null, laneColor(card)));
    }
    const left = this.progress ? this.progress.total - this.progress.done : 0;
    if (this.progress) out.push(this.status(t, `Loading ${left} board${left === 1 ? "" : "s"}…`, cx));
    else if (!total && !this.errors.mine) out.push(this.status(t, query.trim() ? "No cards match" : this.me && !this.busy.has("mine") && !this.busy.has("boards") ? "No cards" : "Loading…", cx));
    if (query.trim()) out.push(this.searchRow(t, query));
    return out;
  }

  // What the search of every board found: a section per board, the cards as everywhere else.
  searchList(t, cx) {
    const hunt = this.search, out = [];
    out.push(h_flex().id("fizzy-search-head").h(30).flex_none().px(8).gap(6).items_center().text_size(12).text_color(t.muted)
      .child(svg(ICON("search")).size(13).flex_none())
      .child(div().flex_1().min_w(0).truncate().child(`Results for “${hunt.q}”`))
      .child(this.iconButton(t, "fizzy-search-close", ICON("x"), (_e, cx) => this.closeSearch(cx), true, "Back to the list")));
    if (hunt.error) out.push(this.status(t, explainSearch(hunt.error), cx, true, cx => this.searchAll(cx), "fizzy-search-retry"));
    let total = 0;
    for (const board of this.boards ?? []) {
      const cards = hunt.found.get(board.id) ?? [];
      if (!cards.length) continue;
      total += cards.length;
      out.push(h_flex().id(`fizzy-search-board-${board.id}`).h(26).flex_none().px(8).items_center().font_medium().text_size(12).text_color(t.muted).child(div().min_w(0).truncate().child(board.name)));
      for (const card of cards) out.push(this.cardRow(t, card, null, laneColor(card)));
    }
    if (hunt.waiting) out.push(this.status(t, "Searching…", cx));
    else if (!total && !hunt.error) out.push(this.status(t, "No cards found", cx));
    if (hunt.count === SEARCH_CAP) out.push(this.status(t, `Fizzy shows its ${SEARCH_CAP} newest matches. Add words to narrow it.`, cx));
    return out;
  }

  pinList(t, cx) {
    const out = this.errors.pins ? [this.status(t, explain(this.errors.pins), cx, true)] : [];
    if (!this.pins) return this.errors.pins ? out : [this.status(t, "Loading…", cx)];
    const cards = filterCards(this.pins, this.filter.value());
    for (const c of cards) out.push(this.cardRow(t, c, null, laneColor(c)));
    if (!cards.length) out.push(this.status(t, this.pins.length ? "No cards match" : "No pinned cards", cx));
    return out;
  }

  inboxList(t, cx) {
    const out = this.errors.inbox ? [this.status(t, explain(this.errors.inbox), cx, true)] : [];
    out.push(h_flex().h(30).flex_none().px(4).gap(6).items_center()
      .child(h_flex().id("fizzy-read-all").h(24).px(8).gap(5).items_center().rounded(6).cursor_pointer().text_size(12).text_color(t.muted).hover(s => s.bg(t.hover))
        .on_click((_e, cx) => this.readAll(cx)).child(svg(ICON("check")).size(13).flex_none()).child("Mark all read")));
    if (!this.inbox) { if (!this.errors.inbox) out.push(this.status(t, "Loading…", cx)); return out; }
    // Only what's new: the unread notifications, newest first. A note marked read leaves the list.
    if (!this.inbox.length) out.push(this.status(t, "You're all caught up", cx));
    for (const note of this.inbox) {
      const meta = [noteCard(note) ? `#${note.card.number}` : null, note.card?.board_name, note.creator?.name, ago(note.created_at, now())].filter(Boolean).join(" · ");
      out.push(v_flex().id(`fizzy-note-${note.id}`).flex_none().px(8).py(6).gap(2).rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => this.openNote(note, cx))
        .child(h_flex().gap(6).items_center()
          .child(div().size(7).flex_none().rounded_full().bg(t.accent))
          .when(Boolean(note.creator), el => el.child(this.avatar(t, note.creator, 16)))
          .child(div().flex_1().min_w(0).truncate().font_semibold().child(note.title ?? "")))
        .child(div().whitespace_normal().text_size(12).text_color(t.dim).child(note.body ?? ""))
        .child(div().min_w(0).truncate().text_size(11).text_color(t.dim).child(meta)));
    }
    return out;
  }

  // One of the bar's four buttons: an icon (left out when the panel is narrow), a label, and, for the two that open a menu,
  // a small chevron after the label. `action` null: the button is dim and inert (no hover, no tooltip). The label is what
  // gives way when the room runs out.
  barButton(t, id, icon, label, action, menu = false) {
    const on = Boolean(action);
    return h_flex().id(id).h(BAR_BUTTON).flex_1().min_w(0).px(6).gap(4).items_center().justify_center().overflow_hidden().rounded(7).text_size(12).font_medium()
      .bg(t.raised).text_color(on ? t.foreground : t.dim)
      .when(on, el => el.cursor_pointer().hover(s => s.bg(t.hover)).on_mouse_down("left", stop).on_click(action))
      .when(!this.narrow, el => el.child(svg(icon).size(13).flex_none()))
      .child(div().min_w(0).truncate().child(label))
      .when(menu, el => el.child(svg(ICON("chevron-down")).size(11).flex_none()));
  }

  // The bar at the foot of every view and of the card view: one line, four buttons, nothing else. They act on the open
  // card, else on the picked cards (⌘/Ctrl-click), else, in the Board view, on the board shown; with none of them they are
  // dim and inert. Nothing here ever submits:
  //   Insert   pastes into the current chat
  //   Send ▾   opens the running sessions; the one picked is brought to the front and gets the paste
  //   Start ▾  opens the agents to start; the one picked starts in a new tab and gets the paste once it is up
  //   Copy     copies the reference
  handBar(t) {
    const has = this.subject().length > 0;
    const act = kind => (has ? (_e, cx) => this.handOff(kind, this.subject(), cx) : null);
    return h_flex().id("fizzy-bar").flex_none().p(6).gap(4).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(12)
      .child(this.barButton(t, "fizzy-bar-insert", ICON("insert"), "Insert", act("insert")))
      .child(this.barButton(t, "fizzy-bar-send", ICON("send"), "Send", act("send"), true))
      .child(this.barButton(t, "fizzy-bar-start", ICON("bot"), "Start", act("start"), true))
      .child(this.barButton(t, "fizzy-bar-copy", ICON("copy"), "Copy", act("copy")));
  }

  // GPUI gives a click to every handler on the path: stop it here, or the header the button sits in folds as well.
  rowButton(t, id, icon, action, tip, strong = false) {
    return div().id(id).size(22).flex_none().flex().items_center().justify_center().rounded(5).text_color(strong ? t.muted : t.dim)
      .on_mouse_down("left", (e, cx) => this.pressButton(e, cx))
      .on_click((e, cx) => { cx.stop_propagation(); action(e, cx); })
      .when(!this.drag, el => el.cursor_pointer().hover(s => s.bg(t.selected).text_color(t.foreground)))
      .tooltip(tip)
      .child(svg(icon).size(13));
  }

  emptyRow(t, id) {
    return div().id(id).h(28).flex_none().pl(32).flex().items_center().text_size(12).text_color(t.dim)
      .on_mouse_down("left", (_e, cx) => this.endDrag(cx))
      .child("No boards");
  }

  fieldRow(t, row, input, fieldId, cancelId, cancel) {
    return row
      .on_mouse_down("left", (e, cx) => this.pressButton(e, cx))
      .on_key_down((e, cx) => { if (e.key === "escape") cancel(cx); })
      .child(div().id(fieldId).flex_1().min_w(0).child(Input.new(input).h(28).px(8).rounded(7).border_1().border_color(t.accent).bg(t.background).text_size(12).text_color(t.foreground)))
      .child(this.rowButton(t, cancelId, ICON("x"), (_e, cx) => cancel(cx), "Cancel"));
  }

  groupComposerRow(t) {
    return this.fieldRow(t, h_flex().id("fizzy-group-new-row").min_h(32).flex_none().pl(2).pr(8).gap(6).items_center(),
      this.groupNew, "fizzy-group-new", "fizzy-group-new-cancel", cx => this.closeGroupComposer(cx));
  }

  renameRow(t, g, open) {
    const row = h_flex().id(`fizzy-group-rename-${g.id}`).min_h(32).flex_none().px(8).gap(6).items_center().rounded(7).border_1().border_color(CLEAR)
      .child(svg(ICON(open ? "chevron-down" : "chevron-right")).size(12).flex_none().text_color(t.dim));
    return this.fieldRow(t, row, this.groupInput, `fizzy-group-input-${g.id}`, `fizzy-group-cancel-${g.id}`, cx => this.cancelGroupEdit(cx));
  }

  ruleField(t, g) {
    return this.fieldRow(t, h_flex().id(`fizzy-group-match-edit-${g.id}`).min_h(32).flex_none().pl(23).pr(8).gap(6).items_center(),
      this.groupInput, `fizzy-group-match-input-${g.id}`, `fizzy-group-match-cancel-${g.id}`, cx => this.cancelGroupEdit(cx));
  }

  groupHeader(t, g, count) {
    const dragging = Boolean(this.drag), picked = this.drag?.kind === "group" && this.drag.id === g.id, armed = this.groupArmed === g.id;
    const rule = g.match ? (this.narrow ? `“${g.match}”` : `contains “${g.match}”`) : "No rule";
    const bin = armed
      ? h_flex().id(`fizzy-group-del-${g.id}`).h(22).px(6).flex_none().items_center().rounded(5).text_size(11).text_color(t.blocked)
        .on_mouse_down("left", (e, cx) => this.pressButton(e, cx))
        .on_click((_e, cx) => { cx.stop_propagation(); this.dropGroup(g.id, cx); })
        .when(!dragging, el => el.cursor_pointer().hover(s => s.bg(t.selected)))
        .child("Delete?")
      : this.rowButton(t, `fizzy-group-del-${g.id}`, ICON("trash"), (_e, cx) => this.dropGroup(g.id, cx), "Delete");
    return h_flex().id(`fizzy-group-head-${g.id}`).h(28).flex_none().px(8).gap(6).items_center().rounded(7).border_1().border_color(picked ? t.accent : CLEAR)
      .when(picked, el => el.bg(t.raised))
      .when(!dragging, el => el.cursor_pointer().hover(s => s.bg(t.hover)))
      .on_mouse_down("left", (e, cx) => this.pickRow("group", g.id, e, cx))
      .on_click((e, cx) => { if (!cmdHeld(e)) this.foldGroup(g.id, cx); })
      .child(svg(ICON(this.folds.has(g.id) ? "chevron-right" : "chevron-down")).size(12).flex_none().text_color(t.dim))
      .child(h_flex().id(`fizzy-group-name-${g.id}`).h(22).px(5).rounded(5).min_w(0).items_center().font_medium().text_color(g.hidden ? t.dim : t.foreground)
        .when(!dragging, el => el.cursor_pointer().hover(s => s.bg(t.selected)))
        .tooltip("Rename")
        .on_click((e, cx) => { if (cmdHeld(e)) return; cx.stop_propagation(); this.editGroup(g.id, "name", cx); })
        .child(div().min_w(0).truncate().child(g.name)))
      .child(h_flex().id(`fizzy-group-match-${g.id}`).h(22).px(5).rounded(5).min_w(0).flex_shrink(4).items_center().text_size(11).text_color(t.dim)
        .when(!dragging, el => el.cursor_pointer().hover(s => s.bg(t.selected)))
        .on_click((e, cx) => { if (cmdHeld(e)) return; cx.stop_propagation(); this.editGroup(g.id, "match", cx); })
        .child(div().min_w(0).truncate().child(rule)))
      .child(div().flex_1())
      .child(div().id(`fizzy-group-count-${g.id}`).flex_none().text_size(11).text_color(t.dim).child(count == null ? "" : String(count)))
      .child(h_flex().flex_none().gap(2)
        .child(bin)
        .child(this.rowButton(t, `fizzy-group-hide-${g.id}`, ICON(g.hidden ? "eye-off" : "eye"), (_e, cx) => this.toggleGroup(g.id, cx), g.hidden ? "Show" : "Hide", g.hidden)));
  }

  boardRow(t, b, config) {
    const hidden = ownHidden(b.id, config), dim = hidden || Boolean(groupOf(b, config)?.hidden);
    const picked = this.drag?.kind === "board" && this.drag.id === b.id;
    return h_flex().id(`fizzy-board-row-${b.id}`).h(28).flex_none().pl(31).pr(8).gap(6).items_center().rounded(7).border_1().border_color(picked ? t.accent : CLEAR)
      .when(picked, el => el.bg(t.raised))
      .when(!this.drag, el => el.hover(s => s.bg(t.hover)))
      .on_mouse_down("left", (e, cx) => this.pickRow("board", b.id, e, cx))
      .child(div().id(`fizzy-board-name-${b.id}`).flex_1().min_w(0).truncate().tooltip(b.name).text_color(dim ? t.dim : t.foreground).child(b.name))
      .child(this.rowButton(t, `fizzy-board-hide-${b.id}`, ICON(hidden ? "eye-off" : "eye"), (_e, cx) => this.toggleBoard(b.id, cx), hidden ? "Show" : "Hide", hidden));
  }

  // `boards` is null while the boards are not known.
  groupBlock(t, g, boards, config) {
    const field = this.groupEdit?.id === g.id ? this.groupEdit.field : null, open = !this.folds.has(g.id), line = this.lineAt(g.id);
    return v_flex().id(`fizzy-group-${g.id}`).relative().flex_none().rounded(7)
      .when(this.drag?.kind === "board" && this.drag.over?.to === g.id, el => el.bg(t.selected))
      .on_hover((hovered, cx) => this.hoverBlock(g.id, hovered, cx))
      .on_mouse_up("left", (_e, cx) => this.dropOn(g.id, cx))
      .when(Boolean(line), el => el.child(div().id(`fizzy-group-line-${g.id}`).absolute().left(8).right(8).h(2).rounded(1).bg(t.accent)
        .when(line === "top", l => l.top(-2))
        .when(line === "bottom", l => l.bottom(-2))
        .on_mouse_down("left", (_e, cx) => this.endDrag(cx))))
      .child(field === "name" ? this.renameRow(t, g, open) : this.groupHeader(t, g, boards?.length))
      .when(field === "match", el => el.child(this.ruleField(t, g)))
      .when(open && Boolean(boards), el => el.children(boards.length
        ? boards.map(b => this.boardRow(t, b, config))
        : [this.emptyRow(t, `fizzy-group-empty-${g.id}`)]));
  }

  noGroupBlock(t, boards, config) {
    const dragging = Boolean(this.drag), open = !this.foldNone;
    return v_flex().id("fizzy-nogroup").relative().flex_none().rounded(7)
      .when(this.drag?.kind === "board" && this.drag.over?.to === null, el => el.bg(t.selected))
      .on_hover((hovered, cx) => this.hoverBlock(null, hovered, cx))
      .on_mouse_up("left", (_e, cx) => this.dropOn(null, cx))
      .child(h_flex().id("fizzy-nogroup-head").h(28).flex_none().px(8).gap(6).items_center().rounded(7).border_1().border_color(CLEAR)
        .when(!dragging, el => el.cursor_pointer().hover(s => s.bg(t.hover)))
        .on_mouse_down("left", (_e, cx) => this.endDrag(cx))
        .on_click((e, cx) => { if (!cmdHeld(e)) this.foldNoGroup(cx); })
        .child(svg(ICON(open ? "chevron-down" : "chevron-right")).size(12).flex_none().text_color(t.dim))
        .child(div().px(5).font_medium().text_color(t.muted).child("No group"))
        .child(div().flex_1())
        .child(div().id("fizzy-nogroup-count").flex_none().text_size(11).text_color(t.dim).child(boards ? String(boards.length) : ""))
        .child(div().w(46).flex_none()))
      .when(open && Boolean(boards), el => el.children(boards.length
        ? boards.map(b => this.boardRow(t, b, config))
        : [this.emptyRow(t, "fizzy-nogroup-empty")]));
  }

  settingsView(t, cx) {
    const config = this.groups(), known = Boolean(this.boards);
    const { ungrouped, groups } = boardGroups(this.boards ?? [], config, true);
    const section = v_flex().id("fizzy-settings-groups").flex_none().gap(2)
      .child(h_flex().id("fizzy-settings-groups-head").h(30).flex_none().pl(8).pr(8).gap(6).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(12).font_medium().text_color(t.muted).child("Board groups"))
        .child(this.rowButton(t, "fizzy-groups-add", ICON("plus"), (_e, cx) => this.openGroupComposer(cx), "New group")))
      .when(this.composing, el => el.child(this.groupComposerRow(t)));
    for (const { group, boards } of groups) section.child(this.groupBlock(t, group, known ? boards : null, config));
    section.child(this.noGroupBlock(t, known ? ungrouped : null, config));
    if (!known) section.child(this.status(t, this.errors.boards ? explain(this.errors.boards) : "Loading…", cx, Boolean(this.errors.boards)));
    return v_flex().id("fizzy-settings").flex_1().min_h(0).overflow_y_scrollbar().p(6).pb(14).gap(12)
      .when(Boolean(this.drag), el => el.cursor_grabbing())
      .child(section);
  }

  // `open` null: the card is a notification's stub, which doesn't carry this field, so the line shows no values and does nothing.
  pickerRow(t, id, label, items, empty, open) {
    return h_flex().id(id).min_h(30).flex_none().px(8).py(3).gap(8).items_start().rounded(7)
      .when(Boolean(open), el => el.cursor_pointer().hover(s => s.bg(t.hover))
        .on_mouse_down("left", (e, cx) => this.pressButton(e, cx)).on_click((_e, cx) => open(cx)))
      .child(div().w(52).h(24).flex_none().flex().items_center().text_size(12).text_color(t.dim).child(label))
      .child(h_flex().flex_1().min_w(0).min_h(24).flex_wrap().gap(4).items_center()
        .children(!open ? [] : items.length ? items : [div().h(24).flex().items_center().text_size(12).text_color(t.dim).child(empty)]))
      .child(div().w(22).h(24).flex_none().flex().items_center().justify_center().text_color(t.dim).child(svg(ICON("chevron-down")).size(12)));
  }

  sectionHead(t, id, label, count, action = null) {
    return h_flex().id(`${id}-head`).h(30).flex_none().px(8).gap(6).items_center()
      .child(div().flex_none().text_size(12).font_medium().text_color(t.muted).child(label))
      .when(Boolean(count), el => el.child(div().id(`${id}-count`).flex_none().text_size(11).text_color(t.dim).child(count)))
      .child(div().flex_1())
      .when(Boolean(action), el => el.child(action));
  }

  detailView(t, cx) {
    const d = this.detail, c = d.card ?? d.summary, full = d.card;
    const read = Boolean(full && d.comments);
    const bare = !read && (Boolean(d.error) || (!full && !whole(d.summary)));
    const body = v_flex().id("fizzy-detail").flex_1().min_h(0).overflow_y_scrollbar().p(6).pb(14).gap(12);
    if (!bare) body.child(this.cardTop(t, c)).child(this.cardMeta(t, c));
    if (!read || d.error) body.child(this.status(t, d.error ? explain(d.error) : "Loading…", cx, Boolean(d.error)));
    if (read) body.child(this.descSection(t, full)).child(this.stepsSection(t, full)).child(this.commentsSection(t, d));
    return body;
  }

  cardTop(t, c) {
    const color = laneColor(c);
    const editing = this.editing === "title";
    const title = editing
      ? h_flex().id("fizzy-title-edit").min_h(38).flex_1().min_w(0).gap(6).items_center()
        .on_mouse_down("left", (e, cx) => this.pressButton(e, cx))
        .on_key_down((e, cx) => { if (e.key === "escape") this.cancelEdit(cx); })
        .child(div().id("fizzy-title-input").flex_1().min_w(0).child(Input.new(this.titleInput).h(34).px(7).rounded(7).border_1().border_color(t.accent).bg(t.background).text_size(15).text_color(t.foreground)))
        .child(this.rowButton(t, "fizzy-title-cancel", ICON("x"), (_e, cx) => this.cancelEdit(cx), "Cancel"))
      : div().id("fizzy-title").flex_1().min_w(0).px(8).py(4).rounded(7).text_size(15).font_semibold().whitespace_normal().text_color(t.foreground).cursor_pointer()
        .hover(s => s.bg(t.hover)).on_click((_e, cx) => this.editTitle(cx)).child(c.title ?? "");
    return h_flex().id("fizzy-detail-top").flex_none().gap(8).items_start()
      .child(title)
      .child(h_flex().id("fizzy-lane").h(26).mt(editing ? 6 : 2).mr(8).px(8).gap(6).flex_none().items_center().rounded(6).bg(t.raised).cursor_pointer().text_size(12).hover(s => s.bg(t.hover))
        .on_mouse_down("left", (e, cx) => this.pressButton(e, cx))
        .on_click((_e, cx) => this.withCard(cx, (card, cx) => this.laneMenu(card, cx)))
        .child(div().size(8).flex_none().rounded_full().bg(color ?? t.dim)).child(div().min_w(0).max_w(this.narrow ? 96 : 140).truncate().child(laneName(c)))
        .child(svg(ICON("chevron-down")).size(12).flex_none().text_color(t.dim)));
  }

  cardMeta(t, c) {
    const person = u => h_flex().h(24).pr(6).gap(6).items_center().child(this.avatar(t, u, 20)).child(div().min_w(0).max_w(160).truncate().child(u.name));
    const tag = name => div().h(24).flex().items_center().child(this.chip(t, name, { max: 160 }));
    const picker = (known, kind) => (known ? () => openMenu({ kind, card: slim(c) }) : null);
    return v_flex().id("fizzy-detail-meta").flex_none().gap(2)
      .child(this.pickerRow(t, "fizzy-people", "People", (c.assignees ?? []).map(person), "Nobody", picker(Array.isArray(c.assignees), "users")))
      .child(this.pickerRow(t, "fizzy-tags", "Tags", (c.tags ?? []).map(tag), "No tags", picker(Array.isArray(c.tags), "tags")));
  }

  // Description: Fizzy's own HTML, or its plain text; editing is plain text and says so when that loses formatting.
  descSection(t, full) {
    const text = full.description?.trim() || htmlToText(full.description_html ?? "");
    const editing = this.editing === "desc";
    const shown = editing
      ? v_flex().id("fizzy-desc-editor").flex_none().gap(6)
        .on_key_down((e, cx) => { if (e.key === "escape") this.cancelEdit(cx); })
        .child(div().id("fizzy-desc-input").w_full().child(Textarea.new(this.descArea).w_full().px(7).py(6).rounded(7).border_1().border_color(t.accent).bg(t.background).text_size(13).text_color(t.foreground)))
        .when(formatted(full.description_html), el => el.child(div().id("fizzy-desc-lossy").px(8).text_size(11).text_color(t.muted).whitespace_normal().child("Saving keeps only the text: formatting is lost.")))
        .child(h_flex().justify_end().gap(6)
          .child(this.textButton(t, "fizzy-desc-cancel", null, "Cancel", (_e, cx) => this.cancelEdit(cx)))
          .child(this.textButton(t, "fizzy-desc-save", null, "Save", (_e, cx) => this.saveDescription(cx), true)))
      : div().px(8).w_full().child(!text ? div().id("fizzy-desc-empty").text_size(12).text_color(t.dim).child("No description")
        : RICH && TextView && full.description_html ? TextView.html("fizzy-desc-html", htmlForView(full.description_html)).selectable().on_link_click((url, cx) => cx.open_url(url))
        : this.plainLines("fizzy-desc-text", text));
    return v_flex().id("fizzy-desc").flex_none().gap(2)
      .child(this.sectionHead(t, "fizzy-desc", "Description", "", editing ? null : this.rowButton(t, "fizzy-desc-edit", ICON("pencil"), (_e, cx) => this.editDescription(cx), "Edit")))
      .child(shown);
  }

  // Ticking a step shows at once; Fizzy's answer (or its refusal) follows.
  stepsSection(t, full) {
    const steps = full.steps ?? [], done = steps.filter(s => s.completed).length;
    const section = v_flex().id("fizzy-steps").flex_none()
      .child(this.sectionHead(t, "fizzy-steps", "Steps", steps.length ? `${done}/${steps.length}` : ""));
    for (const s of steps) {
      section.child(this.editing === "step" && this.editId === s.id
        ? this.fieldRow(t, h_flex().id(`fizzy-step-edit-${s.id}`).min_h(32).flex_none().pl(34).pr(8).gap(6).items_center(),
          this.stepEdit, `fizzy-step-input-${s.id}`, `fizzy-step-cancel-${s.id}`, cx => this.cancelEdit(cx))
        : h_flex().id(`fizzy-step-${s.id}`).min_h(28).flex_none().px(8).py(3).gap(8).items_start()
          .child(div().id(`fizzy-step-check-${s.id}`).size(22).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer().hover(x => x.bg(t.selected))
            .on_mouse_down("left", (e, cx) => this.pressButton(e, cx)).on_click((_e, cx) => this.toggleStep(s, cx))
            .child(div().size(16).flex_none().flex().items_center().justify_center().rounded(4).border_1().border_color(s.completed ? t.accent : t.input)
              .when(s.completed, el => el.bg(t.accent).child(svg(ICON("check")).size(11).text_color(t.accent_foreground)))))
          .child(div().id(`fizzy-step-text-${s.id}`).flex_1().min_w(0).px(5).py(3).rounded(5).whitespace_normal().cursor_pointer().hover(x => x.bg(t.hover))
            .when(s.completed, el => el.line_through().text_color(t.dim))
            .on_mouse_down("left", (e, cx) => this.pressButton(e, cx)).on_click((_e, cx) => this.editStep(s, cx)).child(s.content ?? ""))
          .child(this.rowButton(t, `fizzy-step-del-${s.id}`, ICON("trash"), (_e, cx) => this.dropStep(s, cx), "Delete")));
    }
    return section.child(h_flex().id("fizzy-step-new-row").min_h(32).flex_none().pl(8).pr(8).gap(4).items_center()
      .child(div().size(22).flex_none().flex().items_center().justify_center().text_color(t.dim).child(svg(ICON("plus")).size(13)))
      .child(div().id("fizzy-step-input").flex_1().min_w(0).child(Input.new(this.stepInput).h(28).px(8).rounded(7).border_1().border_color(t.input).bg(t.background).text_size(12).text_color(t.foreground))));
  }

  // Comments, oldest first. Most of what the CLI lists is Fizzy's own activity (creator role "system": "Ada moved this
  // to Not Now"): it would bury what people wrote, so it sits in one folded group after the comments.
  commentsSection(t, d) {
    const everything = [...d.comments].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const comments = everything.filter(cm => cm.creator?.role !== "system"), activity = everything.filter(cm => cm.creator?.role === "system");
    const section = v_flex().id("fizzy-comments").flex_none().gap(2)
      .child(this.sectionHead(t, "fizzy-comments", "Comments", comments.length ? String(comments.length) : ""));
    if (!comments.length) section.child(div().id("fizzy-comments-empty").h(28).flex_none().px(8).flex().items_center().text_size(12).text_color(t.dim).child("No comments"));
    for (const cm of comments) section.child(this.commentBlock(t, cm));
    if (activity.length) {
      section.child(h_flex().id("fizzy-activity").h(28).flex_none().px(8).gap(6).items_center().rounded(7).cursor_pointer().text_size(12).text_color(t.muted)
        .hover(s => s.bg(t.hover)).on_mouse_down("left", (e, cx) => this.pressButton(e, cx))
        .on_click((_e, cx) => { this.activityOpen = !this.activityOpen; cx.notify(); })
        .child(svg(ICON(this.activityOpen ? "chevron-down" : "chevron-right")).size(12).flex_none().text_color(t.dim))
        .child("Activity")
        .child(div().id("fizzy-activity-count").text_size(11).text_color(t.dim).child(String(activity.length))));
      if (this.activityOpen) {
        for (const cm of activity) section.child(div().id(`fizzy-activity-${cm.id}`).flex_none().pl(26).pr(8).py(2).text_size(11).text_color(t.dim).whitespace_normal().child(`${cm.body?.plain_text ?? ""} · ${ago(cm.created_at, now())}`));
      }
    }
    return section.child(v_flex().id("fizzy-comment-new").flex_none().pt(6).gap(6)
      .child(div().id("fizzy-comment-input").w_full().child(Textarea.new(this.commentArea).w_full().px(7).py(6).rounded(7).border_1().border_color(t.input).bg(t.background).text_size(13).text_color(t.foreground)))
      .child(h_flex().justify_end().child(this.textButton(t, "fizzy-comment-send", ICON("send"), "Comment", (_e, cx) => this.sendComment(cx), true))));
  }

  commentBlock(t, cm) {
    const who = cm.creator ?? { name: "?" }, binId = `fizzy-comment-del-${cm.id}`;
    const own = Boolean(this.me) && who.id === this.me, editing = this.editing === "comment" && this.editId === cm.id;
    const bin = this.armedComment === cm.id
      ? h_flex().id(binId).h(22).px(6).flex_none().items_center().rounded(5).cursor_pointer().text_size(11).text_color(t.blocked).hover(s => s.bg(t.selected))
        .on_mouse_down("left", (e, cx) => this.pressButton(e, cx)).on_mouse_down_out((_e, cx) => this.disarmComment(cx))
        .on_click((_e, cx) => { cx.stop_propagation(); this.dropComment(cm, cx); })
        .child("Delete?")
      : this.rowButton(t, binId, ICON("trash"), (_e, cx) => this.dropComment(cm, cx), "Delete");
    return v_flex().id(`fizzy-comment-${cm.id}`).flex_none().px(8).py(6).gap(4)
      .when(editing, el => el.on_key_down((e, cx) => { if (e.key === "escape") this.cancelEdit(cx); }))
      .child(h_flex().h(24).gap(6).items_center()
        .child(this.avatar(t, who, 20))
        .child(div().min_w(0).truncate().font_medium().child(who.name ?? ""))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(ago(cm.created_at, now())))
        .child(div().flex_1())
        .when(own && !editing, el => el.child(this.rowButton(t, `fizzy-comment-edit-${cm.id}`, ICON("pencil"), (_e, cx) => this.editComment(cm, cx), "Edit")).child(bin)))
      .child(editing
        ? v_flex().id(`fizzy-comment-editor-${cm.id}`).pl(17).gap(6)
          .child(div().id(`fizzy-comment-area-${cm.id}`).w_full().child(Textarea.new(this.commentEdit).w_full().px(8).py(6).rounded(7).border_1().border_color(t.accent).bg(t.background).text_size(13).text_color(t.foreground)))
          .when(formatted(cm.body?.html), el => el.child(div().id(`fizzy-comment-lossy-${cm.id}`).px(9).text_size(11).text_color(t.muted).whitespace_normal().child("Saving keeps only the text: formatting is lost.")))
          .child(h_flex().justify_end().gap(6)
            .child(this.textButton(t, `fizzy-comment-cancel-${cm.id}`, null, "Cancel", (_e, cx) => this.cancelEdit(cx)))
            .child(this.textButton(t, `fizzy-comment-save-${cm.id}`, null, "Save", (_e, cx) => this.saveComment(cx), true)))
        : div().pl(26).w_full().child(RICH && TextView && cm.body?.html
          ? TextView.html(`fizzy-comment-html-${cm.id}`, htmlForView(cm.body.html)).selectable().on_link_click((url, cx) => cx.open_url(url))
          : this.plainLines(`fizzy-comment-text-${cm.id}`, cm.body?.plain_text)));
  }

  plainLines(id, text) {
    return v_flex().id(id).w_full().text_size(13)
      .children(textLines(text).map(line => (line ? div().whitespace_normal().child(line) : div().h(6).flex_none())));
  }

  // The lanes a card can move to, for the detail view's chip.
  laneMenu(card, cx) {
    this.withColumns(card, cx, columns => openMenu({ kind: "lanes", card: slim(card), columns }));
  }

  // A popup's request is noticed here (the panel is alive whenever a popup it opened is), by a draw or by the
  // timer made in init. A draw is no place to act: cx.notify() throws in it, and a task starts its body at once.
  // So a draw only notes it (`drawing`), and it is done a moment later by a timer, which is not a draw; the
  // timer itself acts at once. A request is noted once, whichever of them sees it first.
  takeRequest(cx, drawing = false) {
    const req = shared("fizzy.request");
    if (!req?.id || req.id === this.handled) return;
    this.handled = req.id;
    if (drawing) cx.timer.after(1, cx => this.doRequest(req, cx));
    else this.doRequest(req, cx);
  }

  // The request's text (a hand-off) must not stay in shared state, which Herdr keeps in a file anyone can read.
  doRequest({ id, op }, cx) {
    try { this.apply(op, cx); }
    catch (e) { notify({ title: "Fizzy", body: why(e), level: "error" }); }
    if (shared("fizzy.request")?.id === id) setShared("fizzy.request", null);
  }

  listFor(t, cx) {
    if (this.search && (this.view === "board" || this.view === "mine")) return this.searchList(t, cx);
    if (this.view === "board") return this.boardList(t, cx);
    if (this.view === "mine") return this.mineList(t, cx);
    if (this.view === "inbox") return this.inboxList(t, cx);
    return this.pinList(t, cx);
  }

  renderPanel(cx) {
    const shown = fizzyVisible(layout()), became = shown && !this.shown;
    this.shown = shown;
    this.syncBoard(cx);
    this.takeRequest(cx, true);
    if (became) this.poll(cx, true);
    const t = theme(), d = this.detail;
    return v_flex().id("fizzy").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      // The panel's width: the bar's buttons drop their icons in a narrow one.
      .on_size_change((size, cx) => { const narrow = size.width < NARROW; if (narrow !== this.narrow) { this.narrow = narrow; cx.notify(); } })
      .on_mouse_up("left", (_e, cx) => { this.pressed = null; this.endDrag(cx); })
      // A card pressed and let go away from the panel (dragged into a terminal) is not held for ever: the next
      // press outside the panel, or on a lane header, forgets it. A row dragged in Settings goes the same way.
      .on_mouse_down_out((_e, cx) => { this.pressed = null; this.endDrag(cx); this.disarm(cx); })
      .child(this.header(t, cx))
      .when(this.settingsOpen, el => el.child(this.settingsView(t, cx)))
      .when(!this.settingsOpen && Boolean(d), el => el.child(this.detailView(t, cx)))
      .when(!this.settingsOpen && !d, el => el
        .child(this.boardBar(t))
        .when(this.view !== "inbox", el => el.child(this.filterRow(t)))
        .child(v_flex().id("fizzy-list").flex_1().min_h(0).overflow_y_scrollbar().p(6).children(this.listFor(t, cx))))
      .when(!this.settingsOpen, el => el.child(this.handBar(t)));
  }

  initMenu(menu, cx) {
    this.menu = menu; this.at = 0; this.armed = null;
    this.most = menuSize(menu) - FRAME; // the popup's inside, as asked for when it opened
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.known = []; this.failed = false; this.checking = false;
    if (menu.kind === "start") {
      // An agent starts in the shown space, so it is asked of that space's machine.
      const machine = whereNow()?.machine ?? "";
      this.known = shared(KNOWN)?.[machine] ?? [];
      this.checking = true;
      cx.spawn(async cx => {
        try {
          this.known = await knownAgents({ on: machine || null });
          setShared(KNOWN, { ...shared(KNOWN), [machine]: this.known });
        } catch { this.failed = true; }
        this.checking = false;
        cx.notify();
      });
    }
    // Normally the panel read them when the card opened; a popup that finds them missing reads them itself.
    if ((menu.kind === "users" && people().users == null) || (menu.kind === "tags" && people().tags == null)) {
      cx.spawn(async cx => { await loadPeople(); cx.notify(); });
    }
    if (menu.kind === "tags") {
      this.tagInput = InputState.new({ placeholder: "New tag…" });
      this.tagInput.on("submit", (_e, cx) => this.newTag(cx));
    }
  }

  newTag(cx) {
    const name = this.tagInput.value().trim();
    if (!name) return;
    closeOverlay(props().overlay);
    perform({ request: { kind: "tag", number: this.menu.card.number, name } }, cx);
  }

  choose(pick, i, cx) {
    const r = pick[i];
    if (!r) return;
    // A two-step row only asks: the popup stays, with that row armed.
    if (r.act.arm) { this.armed = r.act.arm; cx.notify(); return; }
    closeOverlay(props().overlay);
    perform(r.act, cx);
  }

  item(t, r, pick) {
    if (r.type === "sep") return div().h(1).mx(7).my(4).bg(t.border);
    if (r.type === "label") return div().px(9).pt(8).pb(4).text_size(11).text_color(t.dim).child(r.label);
    if (r.type === "note") return div().h(31).px(9).items_center().flex().text_color(t.dim).child(r.label);
    const i = pick.indexOf(r), a = r.agent, tone = r.danger ? t.blocked : t.foreground;
    // A person's row leads with their photo; the tick that says they are assigned follows the label.
    const icon = r.user ? this.avatar(t, r.user, 16)
      : r.checked ? svg(ICON("check")).size(14).flex_none().text_color(tone)
      : a ? this.agentIcon(t, a)
      : r.color ? div().w(14).flex_none().flex().items_center().justify_center().child(div().size(8).rounded_full().bg(r.color))
      : r.icon ? svg(r.icon).size(14).flex_none().text_color(r.danger ? t.blocked : t.muted) : div().w(14).flex_none();
    return h_flex().id(`fizzy-menu-${r.id}`).h(31).flex_none().px(8).gap(9).rounded(7).items_center().text_color(tone)
      .when(i === this.at, el => el.bg(t.selected)).hover(s => s.bg(t.selected))
      .on_click((_e, cx) => this.choose(pick, i, cx))
      .child(icon).child(div().flex_1().min_w(0).truncate().child(r.label))
      .child(div().max_w(96).truncate().text_size(11).text_color(t.dim).child(r.hint ?? ""))
      .when(Boolean(r.user && r.checked), el => el.child(svg(ICON("check")).size(14).flex_none().text_color(tone)));
  }

  renderMenu() {
    const t = theme(), rows = menuRows(this.menu, live({ known: this.known, checking: this.checking, failed: this.failed, armed: this.armed }));
    const pick = rows.filter(r => r.type === "row");
    // Rows arrive after the popup opens (agents, people): the highlight stays on its row.
    const kept = pick.findIndex(r => r.id === this.atId);
    this.at = kept >= 0 ? kept : Math.max(0, Math.min(this.at, pick.length - 1));
    this.atId = pick[this.at]?.id;
    // A popup is as tall as its content, up to the height it asked for. The list scrolls, and a scroll area has
    // no height of its own: left to its content the column is just its padding, an empty strip. So the column is
    // as tall as its rows (at most the popup's inside) and the list fills it, scrolling if the rows outgrow it.
    const tags = this.menu.kind === "tags";
    return v_flex().id("fizzy-menu").track_focus(this.handle).w_full().h(Math.min(menuHeight(rows) + (tags ? INPUT_ROW : 0) - FRAME, this.most)).min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "escape") return closeOverlay(props().overlay);
        if (!pick.length) return;
        if (e.key === "down") this.at = (this.at + 1) % pick.length;
        else if (e.key === "up") this.at = (this.at + pick.length - 1) % pick.length;
        else if (e.key === "enter") return this.choose(pick, this.at, cx);
        else return;
        this.atId = pick[this.at]?.id;
        cx.notify();
      })
      .when(tags, el => el.child(div().id("fizzy-menu-newtag").flex_none().px(3).pb(5)
        .child(Input.new(this.tagInput).h(28).px(8).rounded(7).border_1().border_color(t.input).bg(t.background).text_size(12).text_color(t.foreground))))
      .child(v_flex().id("fizzy-menu-list").flex_1().min_h(0).overflow_y_scrollbar().children(rows.map(r => this.item(t, r, pick))));
  }

  render(cx) {
    return this.menu ? this.renderMenu() : this.renderPanel(cx);
  }
}
