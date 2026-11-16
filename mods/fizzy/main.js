// Your Fizzy board in the side panel: look at it, work it, and hand cards to your coding agents without leaving
// Herdr. It talks to the local `fizzy` CLI. Right-clicks, the "…" buttons and the pickers open this same mod as a
// popup (props().menu), so the exported class is both the panel and its menus. A popup never writes to Fizzy
// itself: it leaves a request in shared state and the panel, which stays alive, does it.
import { View, div, svg, image, PathBuilder, Background } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea, TextView } from "gpui-base";
import { exec, checking, agents, panes, spaces, focused, knownAgents, theme, shared, setShared, layout, home, appHome, props, run, notify, openOverlay, closeOverlay, nextCommand } from "herdr";
import { textPx } from "./text.js";
import {
  ICON, POLL_VIEW, POLL_INBOX, REQUEST_EVERY, START_WAIT, READY_WAIT, CONCURRENCY, CARD_PAGE, AGENTS, SEARCH_CAP, parseResult, execFailure, explain, explainSearch, cmd, withJson, laneOf, laneName, moveTo, sections,
  columnOf, fullCard, noteCard, inactivity, reorderColumns, daysAgo, LABEL_FONT, labelFile, labelBox, labelSvg,
  filterCards, colorOf, meFrom, refs, textToHtml, htmlToText, htmlToContent, htmlForView, richLines, textLines, formatted, mentionsIn, mentionsOf, typedAt,
  personToken, cardToken, cardUrl, initials, hue, ago, YAML_SCRIPT, parseYaml, chooseBoard,
  AVATAR_SCRIPT, AVATAR_DIR, AVATAR_TTL, AVATAR_BACKOFF, AVATAR_PARALLEL, AVATAR_EVERY, avatarBase, isAvatarFile, photosIn,
  FILE_DIR, FILE_PARALLEL, IMAGE_MAX, FILE_DAYS, FILE_TIMEOUT, IMAGE_SCRIPT, CLIP_SCRIPT, OPEN_SCRIPT, FREE_NAME_SCRIPT, isCachedFile, isMarkdownName, shortHash, fileToken, fileSize,
  WRITE_SCRIPT, cardFile, cardMarkdown,
  targetAgent, agentLabel, fizzyVisible, menuRows, menuHeight, FRAME, activePeople,
  groupsConfig, groupOf, boardGroups, ownHidden, addGroup, renameGroup, setMatch, setGroupHidden, removeGroup, placeBoard, placeBoardAt, listedBoards, moveGroup, setBoardHidden,
  TOASTS, SEEN_CAP, PENDING_FOR, TOAST_FOR, unreadNotes, oldestFirst, noteToast, noteAction, noteReady,
} from "./lib.js";

// Descriptions and comments are HTML, drawn by richText; with this off the plain text is shown instead.
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
// The popups with a field over their rows: Tags (a new tag's name), and the pickers, whose field narrows their rows and takes
// Enter itself: Mention (the people by name) and Card reference (the cards by number or title).
const PICKERS = new Set(["mention", "cardref"]);
const FIELD_MENUS = new Set(["tags", ...PICKERS]);
// The most cards a "#" popup is handed, and how long (ms) after the typing stops it looks up a number it was not handed.
const CARD_REFS = 300, LOOKUP_DELAY = 300;
// The bottom bars: one line of controls, each as high as BAR_BUTTON. Below NARROW px of panel width (its narrowest is
// 280) the hand-off buttons drop their icons and keep their labels, My cards and New card shrink to their icons, and
// the header drops Refresh (an Inbox badge leaves no room for it), so each still fits in one line. Below WIDE px the
// header tightens its buttons and gaps and drops its "Fizzy" word, which at 340 would leave under 1 px beside a
// three-digit badge.
const BAR_BUTTON = 28, NARROW = 340, WIDE = 440;
// Transparent, not the background color: a background-colored border would show as a frame inside a highlighted block.
const CLEAR = "#00000000";
// The Done lane is read at most this many pages deep in one go (the CLI's pages are short).
const DONE_PAGES = 40;
// Find mentions reads at most this many activity pages (15 events each). On its own the panel runs it while someone can't be
// tagged yet, at most once per MENTION_SCAN_EVERY ms.
const MENTION_SCAN_PAGES = 40, MENTION_SCAN_EVERY = 7 * 86400000;
// Settings opens on this list; each entry opens a page of its own.
const SETTINGS = [{ id: "mentions", title: "Mentions", icon: "user" }, { id: "groups", title: "Board groups", icon: "kanban" }];
// The lanes Fizzy gives no column color: Maybe? in Fizzy's own blue, Not Now gray, Done a muted gray (as Fizzy's); a
// column whose color is not known is gray too.
const LANE_COLORS = { maybe: "#4f8ef7", "not-now": "#8a8f98", done: "#9aa0aa" }, NO_COLOR = "#8a8f98";
// A golden card's glow, as Fizzy's: a faint gold from nothing at the bottom left to the top right. Elements take a
// gradient only through window.paint_path, so it is a layer under the card's content.
const GOLD = "#e5b422";
const CARD_SHAPE = PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();
const GOLD_GLOW = Background.linear_gradient(45, `${GOLD}00`, `${GOLD}38`);
// The title a card New card makes carries until its own is saved (Fizzy requires one).
const NEW_TITLE = "New card";
const EDITOR_HINT = "(@ mention, # card, drop or paste images)";
// How much narrower than the panel the description's and the comments' text is (px): their padding, and the scrollbar.
const DESC_INSET = 40, COMMENT_INSET = 66;
// A lane's color at a given opacity (two hex digits): the tints behind its header and its cards, and their borders.
const tint = (color, alpha) => `${color}${alpha}`;
// Text on a lane's color (a card's tab): dark, as Fizzy's, which reads on every lane color in a light theme and a dark one.
const ON_LANE = "#15171c";
const WATCH_KEPT = 200;
// Fizzy's side-by-side columns from SIDE_BY_SIDE px of panel width (narrower, the lanes stack), two of them open at once from
// TWO_OPEN px (each then gets about 300 px). An open column is at most OPEN_MAX px wide: with room to spare the columns stay
// together in the middle, as Fizzy's. A folded column is FOLDED px wide; its pill is FOLDED px tall and PILL_STEP px
// taller for each one the lane holds, at most PILL_MAX, its color (Not Now's and Done's PILL_GRAY) fading from `top` to
// `foot` down its length, over a line at `line` (alphas): PILL, or PILL_LIT, brighter, under the pointer.
const SIDE_BY_SIDE = 480, TWO_OPEN = 760, OPEN_MAX = 380, FOLDED = 36, PILL_STEP = 28, PILL_MAX = 480, PILL_GRAY = "#8a8f98";
const PILL = { top: "b3", foot: "1a", line: "4d" }, PILL_LIT = { top: "e6", foot: "33", line: "80" };
// The pill's outline, FOLDED px wide and `height` tall, round at both ends (a circle at its smallest).
const pillShape = height => {
  const r = FOLDED / 2;
  return PathBuilder.fill().move_to(0, r).arc_to(r, r, 0, false, true, FOLDED, r)
    .line_to(FOLDED, height - r).arc_to(r, r, 0, false, true, 0, height - r).close().build();
};
// Step progress and comment counts are read COUNT_PARALLEL cards at a time (two commands each), and kept for COUNTS_KEPT cards.
const COUNT_PARALLEL = 3, COUNTS_KEPT = 400;

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
// Kept counts, [[number, at, done, total, comments]] -> Map entries (see `counts` in init).
const orNull = v => (Number.isInteger(v) && v >= 0 ? v : null);
const countEntries = raw => (Array.isArray(raw) ? raw : []).filter(e => Array.isArray(e) && Number.isInteger(e[0]) && typeof e[1] === "string")
  .slice(-COUNTS_KEPT).map(([n, at, done, total, comments]) => [n, { at, done: orNull(done), total: orNull(total), comments: orNull(comments) }]);

// Asks the CLI. Always from the home folder, so that no .fizzy.yaml beside the shell changes what it reads
// (a default board would narrow the boardless Mine read).
// `timeout` (ms) replaces Herdr's 30 s limit, which a file upload or download on a slow link can outlast.
async function fizzy(args, { timeout } = {}) {
  let result;
  try { result = await exec("fizzy", withJson(args), timeout ? { cwd: home(), timeout } : { cwd: home() }); }
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
    creator: card.creator ? { id: card.creator.id, name: card.creator.name } : undefined, created_at: card.created_at,
    last_active_at: card.last_active_at, description: String(card.description ?? "").slice(0, 300),
  };
}
// A card whose title and link are known. The stub a card opened by its number shows (openCard) has neither: a
// card is only handed to an agent once it is whole. A board (what the bar hands over when no card is) always is.
const whole = card => card?.kind === "board" || Boolean(card?.url);
const slimColumn = c => ({ id: c.id, name: c.name, kind: c.kind, pseudo: c.pseudo, color: c.color });
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Shared with the popups, which only see shared state and their props: boards, people (users, tags, me, mentionable: the ids of
// the users the panel can mention; their mention ids stay in the panel).
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

const MARKDOWN_MOD = "herdr-inline-markdown";
// Mods can't import each other, so this follows herdr-inline-markdown's openMarkdown with place "pane", and reads its registry
// of which pane shows which file (pane id -> "machine:path"): the file's pane in the focused tab gets the focus, else a pane
// splits right of the focused one; with no pane to open beside, the file gets a tab of its own.
function showMarkdown(file) {
  const all = panes(), f = focused(), known = shared(`${MARKDOWN_MOD}.panes`) ?? {};
  const anchor = all.find(p => p.pane === f?.pane) ?? all.find(p => p.tab === f?.tab);
  const open = anchor && all.find(p => p.tab === anchor.tab && p.mod === MARKDOWN_MOD && known[p.pane] === `:${file}`);
  if (open) run("pane.focus", { pane: open.pane });
  else if (anchor) run("pane.split", { direction: "right", pane: anchor.pane, mod: MARKDOWN_MOD, props: { file } });
  else run("tab.new", { name: file.split("/").pop(), mod: MARKDOWN_MOD, props: { file } });
}

// Everything the menu rows depend on, read live (the caller adds what it looks up itself).
function live(extra) {
  const p = people();
  return { agents: agents(), focused: focused(), boards: shared("fizzy.boards") ?? [], groups: shared("fizzy.boardGroups"), users: p.users, tags: p.tags, me: p.me, mentionable: p.mentionable, ...extra };
}

// The height a popup asks for, which is the most it can be. Rows that arrive after it opens (agents being asked,
// people being read) need room, and past MAX_MENU the rows scroll. The popup works this out again to know its most.
function menuSize(menu) {
  const rows = menuRows(menu, live({ known: [], checking: true }));
  const spare = menu.kind === "start" ? AGENTS - 1 : ["users", "tags", "mention", "cardref"].includes(menu.kind) ? 8 : 0;
  return Math.min(MAX_MENU, menuHeight(rows, spare) + (FIELD_MENUS.has(menu.kind) ? INPUT_ROW : 0));
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
  else if (act.choose) setShared("fizzy.board", { ...act.choose, id: unique() });
  else if (act.menu) openMenu(act.menu);
}

// The color of a card's lane: a real column's; Maybe?, Not Now and Done have none.
const laneColor = card => LANE_COLORS[laneOf(card)] ?? colorOf(card.column) ?? NO_COLOR;
const sectionColor = section => section.color ?? LANE_COLORS[section.key] ?? NO_COLOR;
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
    this.stalled = new Map(); // board id -> the numbers of the cards Fizzy lists as stalled
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
    // `fresh`: the number of the card New card just made, while it is open (its foot offers Discard); `creating`: its create is on its way.
    this.pressed = null; this.fresh = null; this.creating = false; this.ticks = 0;
    // The search of every board, open in the header (null: closed): { q (null until Enter), found: Map(board id -> cards), count (cards found), error, waiting }
    this.search = null;
    clip.saved = undefined; clip.pending = 0; // a new copy has none of the old copy's restores to wait for
    this.unread = Number(shared("fizzy.unread") ?? 0);
    // What the popups sent that was already there when this copy started is not asked of it again.
    this.handled = shared("fizzy.request")?.id ?? null;
    this.choiceSeen = shared("fizzy.board")?.id ?? null;
    this.shown = fizzyVisible(layout());
    // The session Start is waiting for: { name, text, agent, before (the addresses that ran before it), at, found: { address, at } }.
    // One at a time: a newer Start replaces it. Looked at by the request timer (see takeStart), never by a draw.
    this.starting = null;
    this.narrow = false; this.wide = false; // the panel is narrower than NARROW px, or at least WIDE px (the default width is neither)
    // Profile photos: { [user id]: { file, at } } is kept between runs, `paths` is what is drawn from it ({ [user id]: image path }),
    // `wanted` the users still to fetch (id -> photo address), `fetching` the ones being fetched, `failedAt` when a failed one may
    // be tried again. Only this panel fetches (see takeAvatars); popups read the paths from shared state.
    const index = read("avatars", {});
    this.photos = {};
    if (index && typeof index === "object") for (const [id, p] of Object.entries(index)) if (isAvatarFile(p?.file) && Number.isFinite(p.at)) this.photos[id] = { file: p.file, at: p.at };
    this.wanted = new Map(); this.fetching = new Set(); this.failedAt = new Map(); this.unshared = false;
    this.syncPaths(); this.shareAvatars();
    // User id -> mention id (sgid), learned from the mentions in what the panel reads: no command lists them, and one can't be made.
    const learned = read("mentions", {});
    this.mentionIds = Object.fromEntries(Object.entries(learned && typeof learned === "object" ? learned : {}).filter(([, sgid]) => typeof sgid === "string"));
    sharePeople({ mentionable: Object.keys(this.mentionIds) });
    // The look for mention ids under way or last done (Settings shows it): { busy: "feed" | "card" | null, page, card, note, error, retry }.
    this.mentionScan = null;
    this.mentionCard = InputState.new({ placeholder: "Card number" });
    this.mentionCard.on("submit", (_e, cx) => this.learnFromCard(cx));
    // Comment id -> its reactions ([{ id, content, reacter: { id, name } }]), read once per comment (again on Refresh).
    this.reactions = new Map();
    // The images of descriptions and comments: { [key]: file name in FILE_DIR } is kept between runs (key: see fileOf in lib.js).
    // `fileWanted`: the ones still to download (key -> { number, file }), `fileBusy` those downloading, `fileFailed` those that
    // failed (drawn as files). `attachmentLists`: card number -> its attachments' sgids, read when one is downloaded.
    // `uploading`: editor ("comment", "commentEdit", "desc") -> the name of the file it is uploading. `savedMarkdown`: key -> the
    // path of its copy in Downloads.
    const files = read("files", {});
    this.files = {};
    if (files && typeof files === "object") for (const [key, file] of Object.entries(files)) if (isCachedFile(file) && file.startsWith(`${key}.`)) this.files[key] = file;
    this.fileWanted = new Map(); this.fileBusy = new Set(); this.fileFailed = new Set(); this.attachmentLists = new Map(); this.uploading = new Map(); this.savedMarkdown = new Map();
    this.width = null; // the panel's, in px, once drawn
    // Side by side, the open columns of each board (board id -> lane keys, the last opened last); Maybe? when none is kept.
    const opened = read("openColumns", {});
    this.openCols = opened && typeof opened === "object" && !Array.isArray(opened) ? opened : {};
    this.hoverCol = null; // the folded column under the pointer (see hoverColumn)
    // A card's step progress and comment count: card number -> { at: the last_active_at they were read for, done, total, comments }
    // (null where the read failed). Kept between runs; read again only for a card that changed (see wantCounts).
    this.counts = new Map(countEntries(read("counts", [])));
    this.countWanted = new Map(); this.countBusy = new Set();
    this.access = new Map(); // board id -> who can see it: { all, ids, watching } (see JQ.accesses)
    // The folded columns' names as SVG files (see labelSvg): the ones written this run, wanted by a draw, being written.
    this.labels = new Set(); this.labelWanted = new Set(); this.labelBusy = new Set();

    // Input states are made here and in handlers, never in render.
    // The Board view's filter, and the one Mine and Pins share: each list filters as it is typed into.
    this.boardFilter = InputState.new({ placeholder: "Filter this board…" });
    this.filter = InputState.new({ placeholder: "Filter cards…" });
    for (const field of [this.boardFilter, this.filter]) field.on("change", (_e, cx) => cx.notify());
    this.searchField = InputState.new({ placeholder: "Search all boards, or #number…" });
    // `#1222` pasted in (more than one character arriving at once) opens that card at once; typed, it opens on Enter, so
    // "#1" on the way to "#1222" opens nothing.
    this.searchLength = 0;
    this.searchField.on("change", (_e, cx) => {
      const length = this.searchField.value().length, pasted = length - this.searchLength > 1;
      this.searchLength = length;
      if (!(pasted && this.jumpToCard(cx))) cx.notify(); // the clear button shows only while it has words
    });
    this.searchField.on("submit", (_e, cx) => { if (!this.jumpToCard(cx)) this.searchAll(cx); });
    this.stepInput = InputState.new({ placeholder: "Add a step" });
    this.stepInput.on("submit", (_e, cx) => this.addStep(cx));
    this.commentArea = TextareaState.new({ placeholder: `Write a comment… ${EDITOR_HINT}`, rows: 3 });
    this.watchRefs(this.commentArea, "comment");
    // The "@" or "#" just typed in an editor, which the choice in the popup it opened replaces: { field, index }.
    this.typing = null;
    // Settings: shown or not, the new-group field open, the one name or rule being changed in place ({ id, field: "name" | "match" }),
    // and the group whose delete has been asked for once. The groups themselves are shared state (`fizzy.boardGroups`).
    // `drag`: a row picked up with ⌘/Ctrl held, { kind: "group" | "board", id, over: the block under the pointer that takes it ({ to }: a group's id,
    // null for No group) or null }. `folds`: the ids of the folded groups; `foldNone`: No group is folded. Both are kept.
    this.settingsOpen = false; this.settingsPage = null; this.composing = false; this.groupEdit = null; this.groupArmed = null; this.drag = null;
    this.mentionAuto = read("mentionAuto", true) !== false; // Settings > Mentions: the background scan for people who can't be tagged yet
    const folded = read("folds", null);
    this.folds = new Set(Array.isArray(folded?.ids) ? folded.ids.filter(id => typeof id === "string") : []);
    this.foldNone = folded?.none === true;
    this.groupNew = InputState.new({ placeholder: "New group" });
    this.groupNew.on("submit", (_e, cx) => this.newGroup(cx));
    // `herdr-app check` runs init for real: no Fizzy reads, downloads or timers there.
    if (checking()) return;

    if (this.boards) this.shareBoards();
    this.loadConfig(cx); // and with the account, the person
    this.fetchBoards(cx);
    this.pollUnread(cx);
    this.loadUsers(cx); // the people's photos are fetched once their list is in (and again, once a day: see below)
    this.loadPins(cx); // the lists mark pinned cards, and it is the Pins view's own read
    this.pruneFiles(cx);
    this.spaceBoard(cx); // the space's board is asked now, so it is likely known by the first draw
    // The board's own read follows once its board is known (syncBoard); Mine reads now, the Inbox's read being the unread poll above.
    if (this.view === "mine") this.refreshList(cx);
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
    // is waiting for, and for photos, card counts and column labels to fetch or write (never a draw's work).
    cx.timer.every(REQUEST_EVERY, cx => { this.takeRequest(cx); this.takePending(cx); this.takeStart(cx); this.takeAvatars(cx); this.takeLabels(cx); this.takeCounts(cx); });
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
        this.boards = ((await fizzy(cmd.boards())) ?? []).map(b => ({ id: b.id, name: b.name, url: b.url, period: b.auto_postpone_period_in_days }));
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

  // The people list, read (once at start, then daily) so that their photos are known, and whom the panel can't tag yet.
  // A failure costs nothing: the initials stay.
  loadUsers(cx) {
    this.load("users", cx, async cx => {
      try { this.meet(await readUsers()); } catch { return; /* the next menu or card reads them again (and meets them), else tomorrow */ }
      if (this.mentionAuto && this.untaggable().length && now() - (Number(read("mentionScanAt", 0)) || 0) >= MENTION_SCAN_EVERY) this.findMentions(cx);
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
      if (!(choice.compose && choice.board === this.board)) {
        this.follow = choice.follow !== false;
        if (choice.board) this.picked = choice.board;
        keep("follow", this.follow);
        keep("board", this.picked);
      }
      // A draw does not act: the view changes a moment later, on a timer. In the Board view the board's read is already on
      // its way (switchBoard), so only search results are left.
      cx.timer.after(1, cx => {
        if (choice.compose) { this.goBack(cx); this.newCard("maybe", cx); }
        else if (this.view !== "board" || this.search) this.setView("board", cx);
      });
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
    this.selected.clear(); this.pressed = null; this.errors.board = null;
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
    return this.sideBySide() ? this.openKeys(this.board).includes(kind) : !this.collapsedNow({ key: kind, kind });
  }

  // The board's open cards. The columns are read when they are not known yet or `columns` asks (Refresh), and when an open card
  // names one that is not among them. An unfolded Not Now or Done lane is read when it has no data yet or is stale (Refresh or a
  // write came since it was read, see refreshAll); a folded lane never is.
  loadBoard(cx, { columns = false } = {}) {
    const board = this.board;
    if (!board) return;
    this.load(`board:${board}`, cx, async cx => {
      try {
        const lazy = this.lazyOf(board), known = this.columns.get(board), wantColumns = columns || !known, stale = lazy.stale;
        lazy.stale = false;
        // The stalled cards and who can see and watch the board change slowly: they are read with the columns, and a failure
        // only costs what shows them.
        const [listed, open, notNow, done, stalled, access] = await Promise.all([
          wantColumns ? fizzy(cmd.columns(board)) : null, fizzy(cmd.open(board)),
          this.unfolded("not-now") && (stale || !lazy.notNow) ? fizzy(cmd.notNow(board)) : null,
          this.unfolded("done") && (stale || !lazy.done) ? this.doneCards(board, null, lazy.shown, lazy.page) : null,
          wantColumns ? fizzy(cmd.stalled(board)).catch(() => null) : null,
          wantColumns ? fizzy(cmd.accesses(board)).catch(() => null) : null,
        ]);
        if (stalled) this.stalled.set(board, new Set(stalled));
        if (access) this.access.set(board, access);
        let read = wantColumns ? listed ?? [] : null;
        if (!read && (open ?? []).some(c => c.column?.id && !known.some(k => k.id === c.column.id))) read = (await fizzy(cmd.columns(board))) ?? [];
        this.meet([open, notNow]);
        if (notNow) { lazy.notNow = notNow.map(slim); lazy.errors["not-now"] = null; }
        if (done) { Object.assign(lazy, { done: done.cards, page: done.page, end: done.end }); lazy.errors.done = null; }
        if (read) this.columns.set(board, read.map(slimColumn));
        this.cards.set(board, (open ?? []).map(slim));
        keep(`data:${board}`, { columns: this.columns.get(board), open: this.cards.get(board) });
        if (this.board === board) { this.errors.board = null; this.prune(); }
        this.wantCounts([...this.cards.get(board), ...(notNow ? lazy.notNow : []), ...(done ? lazy.done : [])]);
      } catch (e) { if (this.board === board) this.errors.board = e; }
    });
  }

  // Not Now and Done are read each time they are unfolded.
  loadLane(kind, cx) {
    const board = this.board;
    if (!board) return;
    const lazy = this.lazyOf(board);
    this.load(`lane:${kind}:${board}`, cx, async cx => {
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
        this.wantCounts(kind === "done" ? lazy.done : lazy.notNow);
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

  // The search field's words on every board and in comments: one `fizzy search`, its cards grouped by board. It runs on
  // Enter only, as the CLI allows 300 searches an hour, shared with the agents. A newer search, or closing it, drops what it found.
  searchAll(cx) {
    const q = this.searchField.value().trim();
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

  // The search field holding only `#<number>`: the search closes and that card opens, from any board. False when it holds anything else.
  jumpToCard(cx) {
    const n = Number(/^\s*#(\d+)\s*$/.exec(this.searchField.value())?.[1]);
    if (!n) return false;
    this.search = null;
    this.searchField.set_value("");
    this.searchLength = 0;
    this.openCard(n, null, cx);
    return true;
  }

  // The header turns into the search field, its results replace the list of any view. The field keeps its words.
  openSearch(cx) {
    this.goBack(cx);
    this.search ??= { q: null, found: new Map(), count: 0, error: null, waiting: false };
    this.searchField.focus();
    cx.timer.after(200, () => this.searchField.focus());
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
      read = fizzy(cmd.card(number)).then(card => {
        const full = fullCard(card);
        this.meet(full);
        this.learnMentions([full?.description_html]);
        return full;
      }).finally(() => this.reading.delete(number));
      this.reading.set(number, read);
    }
    return read;
  }

  // The open card and its comments, asked together, then the reactions of the comments not read yet (`reactions`: all of them
  // again), and (`pins`) the pin list, which is where its pin state comes from: the poll leaves it alone.
  loadCard(cx, pins = true, reactions = false) {
    const d = this.detail;
    if (!d) return;
    this.load(`card:${d.number}`, cx, async cx => {
      try {
        const [card, comments] = await Promise.all([this.readCard(d.number), fizzy(cmd.comments(d.number))]);
        this.meet(comments);
        this.learnMentions((comments ?? []).map(cm => cm.body?.html));
        if (this.detail !== d) return;
        d.card = card; d.comments = comments ?? []; d.error = null;
        if (card?.last_active_at) this.setCounts(d.number, card.last_active_at, card.steps, d.comments.length);
        this.loadReactions(d.number, d.comments, reactions, cx);
        this.wantImages(d.number, [card?.description_html, ...d.comments.map(cm => cm.body?.html)], cx);
      } catch (e) { if (this.detail === d) d.error = e; }
    });
    if (pins) this.loadPins(cx);
  }

  // The images in a card's description and comments that are not on disk yet are downloaded, FILE_PARALLEL at a time. One that
  // failed, or is over IMAGE_MAX, is left alone: it is drawn as a file.
  wantImages(number, htmls, cx) {
    for (const html of htmls) {
      for (const { file } of richLines(html)) {
        if (!file?.image || file.size > IMAGE_MAX || this.files[file.key] || this.fileBusy.has(file.key) || this.fileFailed.has(file.key)) continue;
        this.fileWanted.set(file.key, { number, file });
      }
    }
    this.takeFiles(cx);
  }

  // Fizzy's card lists have no step progress or comment count: each card's are read with `card show` and `comment list`, only
  // when none are kept for the card as it is now (its last_active_at). The request timer starts them, COUNT_PARALLEL cards at a time.
  wantCounts(cards) {
    for (const c of cards ?? []) {
      if (c?.last_active_at && this.counts.get(c.number)?.at !== c.last_active_at && !this.countBusy.has(c.number)) this.countWanted.set(c.number, c.last_active_at);
    }
  }

  takeCounts(cx) {
    for (const [n, at] of this.countWanted) {
      if (this.countBusy.size >= COUNT_PARALLEL) break;
      this.countWanted.delete(n);
      this.countBusy.add(n);
      cx.spawn(async cx => {
        try {
          const [card, comments] = await Promise.all([this.readCard(n), fizzy(cmd.commentCount(n))]);
          this.setCounts(n, card?.last_active_at ?? at, card?.steps, comments);
        } catch { this.setCounts(n, at, null, null); } // not read again until the card changes
        this.countBusy.delete(n);
        this.takeCounts(cx);
        cx.notify();
      });
    }
  }

  setCounts(n, at, steps, comments) {
    const done = Array.isArray(steps) ? steps.filter(s => s.completed).length : null;
    this.counts.delete(n);
    this.counts.set(n, { at, done, total: Array.isArray(steps) ? steps.length : null, comments: orNull(comments) });
    while (this.counts.size > COUNTS_KEPT) this.counts.delete(this.counts.keys().next().value);
    keep("counts", [...this.counts].map(([k, v]) => [k, v.at, v.done, v.total, v.comments]));
  }

  sideBySide() {
    return (this.width ?? 0) >= SIDE_BY_SIDE;
  }

  // A board's open columns side by side, the last opened last: as many as fit (two from TWO_OPEN px, else one).
  openKeys(board) {
    const kept = this.openCols[board];
    const keys = Array.isArray(kept) && kept.length ? kept : ["maybe"];
    return keys.slice(-((this.width ?? 0) >= TWO_OPEN ? 2 : 1));
  }

  // A folded column opens (the one opened longest ago folds when no more fit); an open one folds, unless it is the only one.
  toggleColumn(section, cx) {
    const board = this.board, open = this.openKeys(board);
    let next;
    if (open.includes(section.key)) {
      if (open.length === 1) return;
      next = open.filter(k => k !== section.key);
    } else next = [...open, section.key];
    this.openCols = { ...this.openCols, [board]: next };
    keep("openColumns", this.openCols);
    if (!open.includes(section.key) && (section.kind === "not-now" || section.kind === "done")) this.loadLane(section.kind, cx);
    cx.notify();
  }

  // Side by side at last (the board's first read can come before the panel's width is known): an open Not Now or Done not
  // read yet is read now.
  loadOpenLanes(cx) {
    if (!this.board) return;
    const lazy = this.lazyOf(this.board), open = this.openKeys(this.board);
    if (open.includes("not-now") && !lazy.notNow) this.loadLane("not-now", cx);
    if (open.includes("done") && !lazy.done) this.loadLane("done", cx);
  }

  // Watching a board for new cards, or not: shown at once, then who can see and watch it is read again.
  toggleWatching(cx) {
    const board = this.board, me = this.me, access = this.access.get(board), ids = access?.watching ?? [];
    if (!board || !me || !access) return null;
    const on = !ids.includes(me);
    return this.changeAccess(board, { ...access, watching: on ? [...ids, me] : ids.filter(id => id !== me) }, cmd.watchBoard(board, on), cx);
  }

  // Access's Everyone on the team: every member of the team can see the board, or only the people given it.
  setBoardForAll(board, on, cx) {
    const access = this.access.get(board);
    return access ? this.changeAccess(board, { ...access, all: on }, cmd.boardForAll(board, on), cx) : null;
  }

  // Who can see and watch a board, changed: shown at once, then written, then read again (which undoes what did not happen).
  changeAccess(board, shown, argv, cx) {
    this.access.set(board, shown);
    cx.notify();
    return this.job(cx, async cx => {
      try { await fizzy(argv); }
      catch (e) { notify({ title: "Fizzy", body: explain(e), level: "error" }); }
      const read = await fizzy(cmd.accesses(board)).catch(() => null);
      if (read) this.access.set(board, read);
      cx.notify();
    });
  }

  // Who can see the board shown, in a popup (accessRows).
  accessMenu() {
    const board = this.boards?.find(b => b.id === this.board), access = this.access.get(this.board);
    if (board && access) openMenu({ kind: "access", board: board.id, url: board.url, all: access.all, ids: access.ids });
  }

  // A folded column's name as an SVG file, once it is written (a draw asks for it, the request timer writes it); else null.
  label(text) {
    if (this.labels.has(text)) return labelFile(text);
    this.labelWanted.add(text);
    return null;
  }

  takeLabels(cx) {
    for (const text of this.labelWanted) {
      this.labelWanted.delete(text);
      if (this.labels.has(text) || this.labelBusy.has(text)) continue;
      this.labelBusy.add(text);
      cx.spawn(async cx => {
        const r = await exec("sh", ["-c", WRITE_SCRIPT, "fizzy", `${appHome()}/${labelFile(text)}`, labelSvg(text)]).catch(() => null);
        if (r?.code !== 0) return; // left busy: not tried again this run, and the column shows its count alone
        this.labelBusy.delete(text);
        this.labels.add(text);
        cx.notify();
      });
    }
  }

  // Everything in FILE_DIR saved over FILE_DAYS days ago is deleted at start, and its images forgotten: a card shown again
  // downloads them again.
  pruneFiles(cx) {
    cx.spawn(async () => {
      let r;
      try { r = await exec("find", [`${appHome()}/${FILE_DIR}`, "-mindepth", "1", "-mtime", `+${FILE_DAYS}`, "-print", "-delete"]); } catch { return; }
      const gone = new Set(String(r?.stdout ?? "").split("\n").map(path => path.slice(path.lastIndexOf("/") + 1)));
      const kept = Object.entries(this.files).filter(([, name]) => !gone.has(name));
      if (kept.length === Object.keys(this.files).length) return;
      this.files = Object.fromEntries(kept);
      keep("files", this.files);
    });
  }

  takeFiles(cx) {
    for (const [key, want] of this.fileWanted) {
      if (this.fileBusy.size >= FILE_PARALLEL) break;
      this.fileWanted.delete(key);
      if (!this.files[key] && !this.fileBusy.has(key)) this.fetchImage(want, cx);
    }
  }

  // One image into FILE_DIR, named by its key: an attachment through the CLI (it needs Fizzy's login), one from the web with curl.
  fetchImage({ number, file }, cx) {
    const dir = `${appHome()}/${FILE_DIR}`;
    this.fileBusy.add(file.key);
    cx.spawn(async cx => {
      let name = null;
      try {
        if (file.remote) {
          const r = await exec("sh", ["-c", IMAGE_SCRIPT, "fizzy", file.url, dir, file.key]);
          const printed = String(r?.stdout ?? "").trim();
          if (r?.code === 0 && isCachedFile(printed) && printed.startsWith(`${file.key}.`)) name = printed;
        } else {
          const index = await this.attachmentIndex(number, file.sgid);
          await exec("mkdir", ["-p", dir]);
          if (index) {
            await fizzy(cmd.download(number, index, `${dir}/${file.key}.${file.ext}`), { timeout: FILE_TIMEOUT });
            name = `${file.key}.${file.ext}`;
          }
        }
      } catch { /* drawn as a file */ }
      this.fileBusy.delete(file.key);
      if (name) { this.files[file.key] = name; keep("files", this.files); }
      else this.fileFailed.add(file.key);
      this.takeFiles(cx);
      cx.notify();
    });
  }

  // An attachment's place in the card's list of them (its description's first, then its comments'), counted from 1 as
  // `card attachments download` takes it; null when it is not there. The list is read once, and again when it lacks the sgid.
  async attachmentIndex(number, sgid) {
    const at = list => { const i = list.indexOf(sgid); return i < 0 ? null : i + 1; };
    const first = this.attachmentList(number), found = at(await first);
    if (found) return found;
    if (this.attachmentLists.get(number) === first) this.attachmentLists.delete(number);
    return at(await this.attachmentList(number));
  }

  // Read once and shared by whoever asks while it is out; a failed read is forgotten.
  attachmentList(number) {
    let list = this.attachmentLists.get(number);
    if (!list) {
      list = fizzy(cmd.attachments(number)).then(sgids => sgids ?? []);
      this.attachmentLists.set(number, list);
      list.catch(() => { if (this.attachmentLists.get(number) === list) this.attachmentLists.delete(number); });
    }
    return list;
  }

  // A file's click: it is saved in Downloads under its own name (" (2)" and so on when that is taken), and shown in its folder;
  // a markdown file opens beside the focused pane instead, and its copy there opens again on the next click while it exists.
  // A file with no sgid (an image from the web that would not load) opens in the browser.
  saveFile(file, cx) {
    const number = this.detail?.number;
    if (!file.sgid) return file.url ? this.openLink(file.url, cx) : null;
    const markdown = isMarkdownName(file.filename);
    return this.job(cx, async () => {
      const saved = markdown && this.savedMarkdown.get(file.key);
      if (saved && (await exec("test", ["-s", saved]))?.code === 0) return showMarkdown(saved);
      const index = await this.attachmentIndex(number, file.sgid);
      if (!index) throw "That file is no longer on the card";
      const name = file.filename.replace(/\//g, "_").replace(/^\.+$/, "") || "attachment", dot = name.lastIndexOf(".");
      const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
      const r = await exec("sh", ["-c", FREE_NAME_SCRIPT, "fizzy", `${home()}/Downloads`, base, ext]);
      const path = r?.code === 0 ? String(r.stdout ?? "") : "";
      if (!path) throw "Couldn't save the file to Downloads";
      await fizzy(cmd.download(number, index, path), { timeout: FILE_TIMEOUT });
      if (markdown) {
        this.savedMarkdown.set(file.key, path);
        showMarkdown(path);
      } else await exec("sh", ["-c", OPEN_SCRIPT, "fizzy", "reveal", path]);
      notify({ title: "Fizzy", body: "Saved to Downloads", level: "info" });
    });
  }

  openFile(path, cx) {
    return this.job(cx, async () => { await exec("sh", ["-c", OPEN_SCRIPT, "fizzy", "open", path]); });
  }

  // Files dropped on an editor are uploaded one after another, each put in at the cursor as a token.
  attach(field, target, paths, cx) {
    const files = (paths ?? []).filter(p => typeof p === "string" && p);
    if (!files.length) return null;
    return this.job(cx, async cx => { for (const path of files) await this.upload(field, target, path, cx); });
  }

  // Uploads one file and puts its token in `field` while that editor is still open; answers the attachment's sgid. `target`
  // names the editor, as in watchRefs.
  async upload(field, target, path, cx) {
    const name = path.split("/").pop();
    this.uploading.set(target, name);
    cx.notify();
    try {
      const sgid = (await fizzy(cmd.upload(path), { timeout: FILE_TIMEOUT }))?.attachable_sgid;
      if (!sgid) throw `Fizzy took ${name} but gave nothing to embed it with`;
      if (this.editorOpen(field)) { field.replace_with_token(fileToken(sgid, name)); field.replace(" "); }
      return sgid;
    } finally {
      this.uploading.delete(target);
      cx.notify();
    }
  }

  editorOpen(field) {
    return field === this.commentArea || (field === this.descArea && this.editing === "desc") || (field === this.commentEdit && this.editing === "comment");
  }

  // A paste with no text: the clipboard's image is saved as a PNG in FILE_DIR and uploaded, and stays there as that image's copy.
  pasteImage(field, target, cx) {
    return this.job(cx, async cx => {
      const dir = `${appHome()}/${FILE_DIR}`, at = new Date(), two = n => String(n).padStart(2, "0");
      const path = `${dir}/Pasted image ${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} at ${two(at.getHours())}.${two(at.getMinutes())}.${two(at.getSeconds())}.png`;
      let saved = null;
      try {
        await exec("mkdir", ["-p", dir]);
        saved = await exec("sh", ["-c", CLIP_SCRIPT, "fizzy", path]);
      } catch { /* no shell: as below */ }
      if (saved?.code !== 0) throw "Pasting images isn't supported here: drop the file on the box instead";
      let sgid = null;
      try { sgid = await this.upload(field, target, path, cx); }
      finally {
        const key = sgid && shortHash(sgid);
        const kept = key ? await exec("mv", ["-f", path, `${dir}/${key}.png`]).catch(() => null) : null;
        if (kept?.code === 0) { this.files[key] = `${key}.png`; keep("files", this.files); }
        else exec("rm", ["-f", path]).catch(() => {});
      }
    });
  }

  // The reactions of the people's comments (not Fizzy's own lines), CONCURRENCY at a time. A read that fails leaves that comment
  // with none, and it is not asked again until Refresh.
  loadReactions(number, comments, fresh, cx) {
    this.load(`reactions:${number}`, cx, async cx => {
      const todo = comments.filter(cm => cm.creator?.role !== "system" && (fresh || !this.reactions.has(cm.id)));
      let next = 0;
      const worker = async () => {
        for (let cm = todo[next++]; cm; cm = todo[next++]) {
          try { this.reactions.set(cm.id, (await fizzy(cmd.reactions(number, cm.id))) ?? []); }
          catch { this.reactions.set(cm.id, this.reactions.get(cm.id) ?? []); }
          cx.notify();
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
    });
  }

  // The mention ids in Fizzy's HTML (a description, comments) that the panel has not learned yet.
  learnMentions(htmls) {
    let learned = false;
    for (const html of htmls) {
      for (const { user, sgid } of mentionsIn(html)) if (!this.mentionIds[user]) { this.mentionIds[user] = sgid; learned = true; }
    }
    if (!learned) return;
    keep("mentions", this.mentionIds);
    sharePeople({ mentionable: Object.keys(this.mentionIds) });
  }

  // The active people the panel has no mention id for (nobody while the people are not known).
  untaggable() {
    return activePeople(people().users ?? [], this.me).filter(u => !this.mentionIds[u.id]);
  }

  // One look for mention ids at a time; a second ask while one runs does nothing. `body` learns from what it reads.
  scanMentions(cx, scan, body) {
    if (this.mentionScan?.busy) return;
    const s = this.mentionScan = { page: 0, card: null, note: null, error: null, ...scan };
    const before = Object.keys(this.mentionIds).length;
    cx.spawn(async cx => {
      try {
        await body(s, cx);
        const learned = Object.keys(this.mentionIds).length - before;
        s.note = learned ? `Learned ${learned} more ${learned === 1 ? "person" : "people"}` : "No new mentions found";
      } catch (e) { s.error = e; }
      finally { s.busy = null; cx.notify(); }
    });
    cx.notify();
  }

  // The activity feed, newest first, until everyone can be tagged, the feed ends, or MENTION_SCAN_PAGES pages were read.
  findMentions(cx) {
    if (this.mentionScan?.busy) return;
    keep("mentionScanAt", now());
    this.scanMentions(cx, { busy: "feed", retry: cx => this.findMentions(cx) }, async (s, cx) => {
      for (s.page = 1; s.page <= MENTION_SCAN_PAGES; s.page++) {
        if (people().users && !this.untaggable().length) return;
        cx.notify();
        const { html, more } = (await fizzy(cmd.activity(s.page))) ?? {};
        this.learnMentions(html ?? []);
        if (!more) return;
      }
    });
  }

  // A card's description and comments: "#12" or "12" from the Settings field, or the number Retry asks again.
  learnFromCard(cx, number = Number(this.mentionCard.value().trim().replace(/^#/, ""))) {
    if (!Number.isInteger(number) || number <= 0) return;
    this.scanMentions(cx, { busy: "card", card: number, retry: cx => this.learnFromCard(cx, number) }, async () => {
      const [card, comments] = await Promise.all([this.readCard(number), fizzy(cmd.comments(number))]);
      this.learnMentions([card?.description_html, ...(comments ?? []).map(cm => cm.body?.html)]);
    });
  }

  // `fresh.columns`: the Board view reads the columns again, which a poll leaves alone (see loadBoard).
  refreshList(cx, fresh) {
    if (this.view === "board") this.loadBoard(cx, fresh);
    else if (this.view === "mine") this.loadMine(cx);
    else if (this.view === "inbox") this.pollUnread(cx);
    else this.loadPins(cx);
  }

  // `lanes`: a change or a Refresh leaves every lane read so far stale, to be read where it is unfolded: with the board's next read.
  // `reactions`: the open card's reactions are read again.
  refreshAll(cx, fresh) {
    if (fresh?.lanes) for (const lazy of this.lazy.values()) lazy.stale = true;
    this.refreshList(cx, fresh);
    if (this.detail) this.loadCard(cx, this.view !== "pins", Boolean(fresh?.reactions));
  }

  // The poll: the card when one is open, else the list; nothing while a title, description, step or comment is edited.
  // Mine is read every other time on the timer; `force`: at once. The Inbox is not read here: the unread poll fills it.
  poll(cx, force = false) {
    if (this.editing) return;
    if (this.detail) this.loadCard(cx, false);
    else if (this.view !== "inbox" && (this.view !== "mine" || force || ++this.ticks % 2 === 0)) this.refreshList(cx);
  }

  // Refresh and Retry: the boards too (a new one may have been made), the config and the person (the account may have
  // changed), then whatever shows, columns, unfolded lanes and reactions included, and the images that would not download.
  retry(cx) {
    this.fileFailed.clear();
    this.fetchBoards(cx);
    this.loadConfig(cx, true);
    this.refreshAll(cx, { columns: true, lanes: true, reactions: true });
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
      // A tab bar's `search:fizzy` (⌘K): it shows the page, and the search opens here, whether the panel was shown or not.
      case "search": this.openSearch(cx); cx.notify(); return null;
      case "boardForAll": return this.setBoardForAll(op.board, Boolean(op.on), cx);
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
      case "react": return this.toggleReaction(n, op.comment, op.content, cx);
      // The Mention or Card popup's choice goes into the editor it was opened from, while that editor is still open.
      case "mention": case "cardref": {
        const field = { comment: this.detail && this.commentArea, commentEdit: this.editing === "comment" && this.commentEdit, desc: this.editing === "desc" && this.descArea }[op.target];
        if (!field) return null;
        if (op.kind === "mention") this.putToken(field, personToken(op.user, op.name), "@");
        else this.putToken(field, cardToken(op.number, op.title), "#");
        field.focus();
        cx.timer.after(200, () => field.focus());
        cx.notify();
        return null;
      }
      default: return null;
    }
  }

  setView(view, cx) {
    this.view = view;
    keep("view", view);
    this.selected.clear(); this.search = null;
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

  // Mouse released over a lane (its header, or one of its cards): the card that was pressed goes there, or the column whose
  // header was pressed takes that column's place.
  drop(lane, cx) {
    const from = this.pressed;
    this.pressed = null;
    if (!from || !lane) return;
    if (from.column) this.moveColumn(from.column, lane, cx);
    else if (from.lane !== lane) this.apply({ kind: "move", number: from.number, target: lane }, cx);
  }

  // The lanes take their new order at once; Fizzy moves the column one place at a time, and the columns are read again after.
  moveColumn(id, target, cx) {
    const board = this.board, moved = reorderColumns(this.columns.get(board) ?? [], id, target);
    if (!moved) return null;
    this.columns.set(board, moved.columns);
    cx.notify();
    return this.job(cx, async cx => {
      await this.write(moved.steps, cx, false);
      this.loadBoard(cx, { columns: true });
    });
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

  // New card, in lane `key` of the board shown: Fizzy's API publishes a card the moment it is made (it has no drafts), so
  // the card is made at once under a stand-in title and opens in the card page with its title being written, for
  // everything else at once; Discard, at its foot, deletes it again. In a real column it is made in Maybe? and moved:
  // the CLI cannot say where a new card goes.
  newCard(key, cx) {
    const board = this.board;
    if (!board || this.creating) return null;
    if (this.view !== "board") this.setView("board", cx);
    this.search = null;
    const column = key !== "maybe" && key !== "not-now" && key !== "done" ? key : null;
    this.creating = true;
    cx.notify();
    return cx.spawn(async cx => {
      try {
        const made = await fizzy(cmd.create(board, NEW_TITLE));
        // The result names the new card; failing that, it is the newest card with that title.
        let number = made?.number;
        if (number == null) number = Math.max(0, ...((await fizzy(cmd.open(board))) ?? []).filter(c => c.title === NEW_TITLE).map(c => c.number)) || null;
        if (column && number != null) await fizzy(cmd.column(number, column));
        if (number != null) {
          this.openCard(number, made?.url ? slim(made) : null, cx);
          this.fresh = number;
          this.editTitle(cx, "");
        }
      } catch (e) { notify({ title: "Fizzy", body: explain(e), level: "error" }); }
      this.creating = false;
      this.refreshAll(cx, { lanes: true });
      cx.notify();
    });
  }

  // The fresh card's Discard: it goes from Fizzy, and the page closes.
  discardFresh(cx) {
    const n = this.fresh;
    if (n == null) return;
    this.goBack(cx);
    this.apply({ kind: "remove", number: n }, cx);
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

  newCardMenu() {
    openMenu({ kind: "newCard", current: this.board });
  }

  // The picked cards (⌘/Ctrl-click), by number.
  picks() {
    return this.pickedNumbers().map(n => this.find(n)).filter(Boolean).map(slim);
  }

  pickedNumbers() {
    return [...this.selected].sort((a, b) => a - b);
  }

  // What a drag of these cards into a terminal takes: the fullest copy held of each (the open card's own read has its steps).
  dragged(numbers) {
    return numbers.map(n => (this.detail?.number === n && this.detail.card) || this.find(n)).filter(Boolean);
  }

  // A drag source for terminals: the cards' files, dropped as their paths. They are written at the press (see writeCardFiles).
  dragCards(el, cards) {
    return cards.length ? el.drag_paths(cards.map(c => `${appHome()}/${cardFile(c)}`)) : el;
  }

  // Each card's file, written at the press that may start a drag, so it is there before any drop.
  writeCardFiles(cards, cx) {
    for (const card of cards) {
      cx.spawn(async () => {
        const r = await exec("sh", ["-c", WRITE_SCRIPT, "fizzy", `${appHome()}/${cardFile(card)}`, cardMarkdown(card)]).catch(() => null);
        if (r?.code !== 0) notify({ title: "Fizzy", body: `Couldn't write #${card.number}'s file to drag`, level: "error" });
      });
    }
  }

  openCard(number, summary, cx) {
    this.leaveSettings();
    this.detail = { number, summary: summary ?? this.find(number) ?? { number, title: `#${number}` }, card: null, comments: null, error: null };
    this.editing = null; this.armedComment = null; this.fresh = null;
    this.stepInput.set_value("");
    this.commentArea.set_value("");
    cx.spawn(async () => { this.meet(await loadPeople()); });
    this.loadCard(cx);
    cx.notify();
  }

  goBack(cx) {
    this.detail = null; this.editing = null; this.armedComment = null; this.fresh = null;
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
    this.settingsOpen = false; this.settingsPage = null; this.composing = false; this.groupEdit = null; this.groupArmed = null; this.drag = null;
  }

  // Back in Settings: from a setting's own page to the list of settings, from the list out of Settings.
  settingsBack(cx) {
    if (!this.settingsPage) return this.goBack(cx);
    this.settingsPage = null; this.composing = false; this.groupEdit = null; this.groupArmed = null; this.drag = null;
    cx.notify();
    return null;
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

  // The board row a dragged board is over (not its own): letting go there puts the board beside it (see rowLine).
  hoverRow(id, hovered, cx) {
    const d = this.drag;
    if (d?.kind !== "board") return;
    const was = d.row ?? null, next = hovered ? (id === d.id ? null : id) : was === id ? null : was;
    if (next === was) return;
    d.row = next;
    cx.notify();
  }

  // Which edge of the row the line is drawn at while a board is dragged over it, as placeBoardAt lands it.
  rowLine(id) {
    const d = this.drag;
    if (d?.kind !== "board" || d.row !== id) return null;
    const ids = listedBoards(this.boards ?? [], this.groups()).map(b => b.id), from = ids.indexOf(d.id), at = ids.indexOf(id);
    if (from < 0 || at < 0 || from === at) return null;
    return from > at ? "top" : "bottom";
  }

  // A board let go over another board's row lands beside it; a group goes on to the block around the row.
  dropRow(target, cx) {
    const d = this.drag;
    if (d?.kind !== "board") return;
    cx.stop_propagation();
    this.drag = null;
    const board = (this.boards ?? []).find(b => b.id === d.id), config = this.groups();
    this.saveGroups(board ? placeBoardAt(config, this.boards, board, target) : config, cx);
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

  // `value`: what the field starts with (a fresh card's starts empty, its stand-in title staying until one is saved).
  editTitle(cx, value) {
    const c = this.detail.card ?? this.detail.summary;
    this.titleInput = InputState.new({ value: value ?? c.title ?? "", placeholder: "Card title" });
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
    this.descArea = TextareaState.new({ rows: 8, placeholder: `Add a description… ${EDITOR_HINT}` });
    this.descArea.set_value(c.description_html ? htmlToContent(c.description_html, people().users) : c.description ?? "");
    this.watchRefs(this.descArea, "desc");
    this.editing = "desc";
    this.descArea.focus();
    cx.timer.after(200, () => this.descArea.focus());
    cx.notify();
  }

  saveDescription(cx) {
    const d = this.detail, text = this.descArea.value(), html = this.toHtml(this.descArea.content());
    this.editing = null;
    this.patch(d.number, c => { c.description = text; if ("description_html" in c) c.description_html = html; });
    cx.notify();
    return this.job(cx, cx => this.write([cmd.update(d.number, { html })], cx));
  }

  // The people as textToHtml takes them, each with the mention id the panel has learned for them, if any.
  mentionPeople() {
    return (people().users ?? []).filter(u => u.role !== "system").map(u => ({ id: u.id, name: u.name, sgid: this.mentionIds[u.id] }));
  }

  // An editor's content as the HTML to save: a person's token (or "@<name>" typed) is their mention, a card's token a link to
  // it. A person whose mention id is not learned yet stays text, and says so.
  toHtml({ text, tokens }) {
    const all = this.mentionPeople(), named = new Set(tokens.map(s => /^user:(.+)$/.exec(s.token.id)?.[1]));
    const missing = [...mentionsOf(text, all), ...all.filter(p => named.has(p.id))].filter(p => !p.sgid).map(p => p.name);
    if (missing.length) notify({ title: "Fizzy", body: `Can't notify ${[...new Set(missing)].join(", ")} yet: mention them once in Fizzy, and the panel learns how.`, level: "info" });
    return textToHtml(text, all, tokens, n => cardUrl(this.detail?.card?.url, n));
  }

  // An "@" or "#" typed where a mention or a card reference starts opens the people or the cards picker for this editor
  // (`target`: "comment", "commentEdit" or "desc", see apply); a paste with no text puts in the clipboard's image.
  watchRefs(field, target) {
    field.on("paste_other", (_e, cx) => this.pasteImage(field, target, cx));
    let was = field.content().text;
    field.on("change", () => {
      const now = field.content().text, at = typedAt(was, now);
      was = now;
      if (at < 0) return;
      this.typing = { field, index: at };
      openMenu(now[at] === "#" ? { kind: "cardref", target, cards: this.knownCards() } : { kind: "mention", target });
    });
  }

  // The token takes the place of the "@" or "#" (`mark`) that opened the popup, when it is still there, else goes in at the
  // cursor; a space follows it.
  putToken(field, token, mark) {
    const at = this.typing?.field === field ? this.typing.index : -1;
    this.typing = null;
    if (at >= 0 && field.content().text[at] === mark) {
      field.replace_range_with_token({ start: at, end: at + 1 }, token);
      const end = field.tokens().find(s => s.range.start === at)?.range.end;
      if (end != null) field.set_selected_range({ start: end, end });
    } else field.replace_with_token(token);
    field.replace(" ");
  }

  // The cards a "#" popup offers: the board shown (its Not Now and Done lanes as far as read), Mine, Pins and the search's.
  knownCards() {
    const lazy = this.lazy.get(this.board), out = new Map();
    for (const list of [this.cards.get(this.board), lazy?.notNow, lazy?.done, ...this.mine.values(), this.pins, ...(this.search?.found.values() ?? [])]) {
      for (const c of list ?? []) if (out.size < CARD_REFS && !out.has(c.number)) out.set(c.number, { number: c.number, title: c.title, board: c.board?.name });
    }
    return [...out.values()];
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
    const html = this.toHtml(this.commentArea.content());
    this.commentArea.set_value("");
    this.unsureWatch(d.number);
    return this.job(cx, cx => this.write([cmd.comment(d.number, html)], cx));
  }

  commentText(comment) {
    return htmlToText(comment.body?.html ?? "", people().users) || comment.body?.plain_text || "";
  }

  // The person's own comment, as text in a box (people and cards as tokens): Save sends it back as HTML.
  editComment(comment, cx) {
    const content = htmlToContent(comment.body?.html ?? "", people().users);
    this.commentEdit = TextareaState.new({ rows: 4, placeholder: `Write a comment… ${EDITOR_HINT}` });
    this.commentEdit.set_value(content.text ? content : comment.body?.plain_text ?? "");
    this.watchRefs(this.commentEdit, "commentEdit");
    this.editing = "comment"; this.editId = comment.id; this.armedComment = null;
    this.commentEdit.focus();
    cx.timer.after(200, () => this.commentEdit.focus());
    cx.notify();
  }

  saveComment(cx) {
    const d = this.detail, id = this.editId, text = this.commentEdit.value().trim(), comment = d?.comments?.find(c => c.id === id);
    this.editing = null; this.editId = null;
    cx.notify();
    if (!comment || !text || text === this.commentText(comment)) return null;
    const html = this.toHtml(this.commentEdit.content());
    comment.body = { ...comment.body, html, plain_text: text };
    return this.job(cx, cx => this.write([cmd.editComment(d.number, id, html)], cx));
  }

  // Your reaction with that emoji on a comment: shown (or taken away) at once, put back when Fizzy refuses.
  toggleReaction(number, comment, content, cx) {
    const was = this.reactions.get(comment) ?? [], own = was.find(r => r.content === content && this.ownReaction(r));
    const added = own ? null : { id: null, content, reacter: { id: this.me, name: people().users?.find(u => u.id === this.me)?.name ?? "" } };
    this.reactions.set(comment, own ? was.filter(r => r !== own) : [...was, added]);
    cx.notify();
    return this.job(cx, async cx => {
      try {
        if (own) await fizzy(cmd.unreact(number, comment, own.id));
        else {
          const made = await fizzy(cmd.react(number, comment, content));
          if (made?.id) added.id = made.id;
          else this.reactions.set(comment, (await fizzy(cmd.reactions(number, comment))) ?? []);
        }
      } catch (e) {
        this.reactions.set(comment, was);
        notify({ title: "Fizzy", body: explain(e), level: "error" });
      }
      cx.notify();
    });
  }

  ownReaction(r) {
    return Boolean(this.me) && r.reacter?.id === this.me;
  }

  reactMenu(cm) {
    const mine = (this.reactions.get(cm.id) ?? []).filter(r => this.ownReaction(r)).map(r => r.content);
    openMenu({ kind: "react", number: this.detail.number, comment: cm.id, mine });
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
      case "back": if (this.settingsOpen) this.settingsBack(cx); else if (d) this.goBack(cx); else this.search = null; break;
      case "settings": this.openSettings(cx); break;
      // As the bar's buttons: the open card, else the selection, else (Board view) the board. send and start open their popups of sessions and agents.
      case "insert": case "copy": case "send": case "start": this.handOff(name, this.subject(), cx); break;
      case "new": if (this.board) this.newCardMenu(); break;
      case "search": this.openSearch(cx); break;
      // The filter sits in the list's bottom bar, which the search and picked cards take the place of.
      case "filter": {
        this.goBack(cx);
        this.search = null; this.selected.clear();
        if (this.view === "inbox") this.setView("board", cx); // the Inbox has no filter
        const field = this.filterOf(this.view);
        field.focus();
        cx.timer.after(200, () => field.focus());
        break;
      }
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
    return h_flex().id(id).h(30).px(10).gap(6).flex_none().items_center().rounded(7).cursor_pointer().text_size(textPx(12)).font_medium()
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
    return div().flex_none().max_w(extra.max ?? 110).truncate().px(6).py(1).rounded(5).bg(extra.bg ?? t.raised).text_size(textPx(11)).text_color(t.muted).child(text);
  }

  // A dim line of text, with Retry under an error.
  // `again`: what Retry does (else everything is read again); `id`: its id, when there can be several.
  status(t, text, cx, error = false, again = null, id = "fizzy-retry") {
    return v_flex().flex_none()
      .child(div().p(8).text_size(textPx(12)).text_color(t.dim).whitespace_normal().child(text))
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
      const page = SETTINGS.find(s => s.id === this.settingsPage);
      return h_flex().h(42).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border)
        .child(this.iconButton(t, "fizzy-back", ICON("arrow-left"), (_e, cx) => this.settingsBack(cx), true, page ? "Settings" : "Back"))
        .child(div().flex_1().min_w(0).truncate().font_semibold().child(page?.title ?? "Settings"));
    }
    if (this.detail) {
      const d = this.detail, c = d.card ?? d.summary, n = d.number, board = c.board?.name ?? "";
      const pinned = this.pinOf(n), watching = this.watchOf(n), golden = c.golden;
      return h_flex().h(42).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border)
        .child(this.iconButton(t, "fizzy-back", ICON("arrow-left"), (_e, cx) => this.goBack(cx), true, "Back"))
        .child(div().id("fizzy-detail-number").flex_none().text_size(textPx(12)).text_color(t.dim).child(`#${n}`))
        .child(div().id("fizzy-detail-board").flex_1().min_w(0).truncate().text_size(textPx(12)).text_color(t.dim).when(Boolean(board), el => el.tooltip(board)).child(board))
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
    if (this.search) {
      const field = this.searchField;
      return h_flex().h(42).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border)
        .on_key_down((e, cx) => { if (e.key === "escape") this.closeSearch(cx); })
        .child(this.iconButton(t, "fizzy-search-back", ICON("arrow-left"), (_e, cx) => this.closeSearch(cx), true, "Back"))
        .child(div().id("fizzy-search").relative().flex_1().min_w(0)
          .child(Input.new(field).h(BAR_BUTTON).pl(8).pr(field.value() ? 28 : 8).rounded(7).border_1().border_color(t.accent).bg(t.background).text_size(textPx(12)).text_color(t.foreground))
          .when(field.value() !== "", el => el.child(this.clearButton(t, "fizzy-search-clear", cx => { field.set_value(""); this.searchLength = 0; this.closeSearch(cx); }))));
    }
    return h_flex().h(42).flex_none().px(10).gap(this.wide ? 8 : 6).items_center().border_b(1).border_color(t.border)
      .child(this.homeButton(t))
      .child(h_flex().flex_none().gap(this.wide ? 3 : 2).children(HEADER_VIEWS.map(([id, label]) => this.viewButton(t, id, label))))
      .child(div().flex_1())
      .child(h_flex().flex_none().gap(2)
        .child(this.iconButton(t, "fizzy-search-open", ICON("search"), (_e, cx) => this.openSearch(cx), true, "Search all boards"))
        .when(!this.narrow, el => el.child(this.iconButton(t, "fizzy-refresh", ICON("refresh"), (_e, cx) => this.retry(cx), true, "Refresh")))
        .child(this.iconButton(t, "fizzy-open-settings", ICON("settings"), (_e, cx) => this.openSettings(cx), true, "Settings")));
  }

  homeButton(t) {
    const shown = this.view === "board";
    return h_flex().id("fizzy-home").h(26).px(this.wide ? 8 : 6).gap(6).flex_none().items_center().rounded(6).cursor_pointer()
      .bg(shown ? t.selected : t.background).text_color(shown ? t.foreground : t.muted)
      .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
      .on_click((_e, cx) => this.setView("board", cx))
      .when(!this.wide, el => el.tooltip("Board"))
      .child(svg(ICON("kanban")).size(14).flex_none())
      .when(this.wide, el => el.child(div().flex_none().font_semibold().child("Fizzy")));
  }

  newCardButton(t) {
    const enabled = Boolean(this.board), label = !this.narrow;
    return h_flex().id("fizzy-new").h(BAR_BUTTON).flex_none().gap(5).items_center().justify_center().rounded(7).text_size(textPx(12)).font_medium()
      .bg(enabled ? t.solid : t.raised).text_color(enabled ? t.solid_foreground : t.dim)
      .when(label, el => el.px(10))
      .when(!label, el => el.w(BAR_BUTTON).tooltip("New card"))
      .on_mouse_down("left", stop)
      .when(enabled, el => el.hover(s => s.opacity(0.88)).cursor_pointer().on_click(() => this.newCardMenu()))
      .child(svg(ICON("plus")).size(13).flex_none())
      .when(label, el => el.child("New card"));
  }

  mineToggle(t) {
    const on = this.onlyMine, label = !this.narrow;
    return h_flex().id("fizzy-only-mine").h(BAR_BUTTON).flex_none().gap(5).items_center().justify_center().rounded(7).cursor_pointer().text_size(textPx(12))
      .border_1().border_color(on ? t.accent : t.input).bg(on ? t.selected : t.background).text_color(on ? t.foreground : t.muted)
      .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
      .on_click((_e, cx) => { this.onlyMine = !on; cx.notify(); })
      .when(label, el => el.px(8))
      .when(!label, el => el.w(BAR_BUTTON).tooltip("My cards"))
      .child(svg(ICON("user")).size(13).flex_none())
      .when(label, el => el.child("My cards"));
  }

  viewButton(t, id, label) {
    return h_flex().id(`fizzy-view-${id}`).h(26).px(this.wide ? 8 : 6).gap(5).flex_none().items_center().rounded(6).cursor_pointer().text_size(textPx(12))
      .bg(this.view === id ? t.selected : t.background).text_color(this.view === id ? t.foreground : t.muted)
      .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
      .on_click((_e, cx) => this.setView(id, cx))
      .child(label)
      .when(id === "inbox" && this.unread > 0, el => el.child(div().min_w(16).h(16).px(4).flex().items_center().justify_center().rounded_full().bg(t.accent).text_size(textPx(10)).text_color(t.accent_foreground).child(String(this.unread))));
  }

  // The board row, as Fizzy's head: the board's name in the middle between two rules (a click picks another board; "following
  // space" under it while the space's own board is followed), who can see the board at the left, Open in Fizzy at the right.
  boardBar(t, cx) {
    const current = this.boards?.find(b => b.id === this.board);
    const following = Boolean(this.follow && this.board && this.spaceBoard(cx) === this.board);
    const round = (id, icon, tip, action) => div().id(id).size(30).flex_none().flex().items_center().justify_center().rounded_full()
      .border_1().border_color(t.input).text_color(action ? t.muted : t.dim).tooltip(tip).on_mouse_down("left", stop)
      .when(Boolean(action), el => el.cursor_pointer().hover(s => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => action(cx)))
      .child(svg(ICON(icon)).size(14).flex_none());
    const rule = () => div().flex_1().min_w(8).h(1).bg(t.border);
    return h_flex().id("fizzy-board-bar").flex_none().px(12).py(6).gap(10).items_center()
      .child(round("fizzy-board-access", "users", "Who can see this board", current && this.access.has(current.id) ? () => this.accessMenu() : null))
      .child(rule())
      .child(v_flex().id("fizzy-board").min_w(0).px(8).py(2).items_center().rounded(8).cursor_pointer().hover(s => s.bg(t.hover))
        .on_mouse_down("left", stop).on_click((_e, cx) => this.boardsMenu(cx))
        .tooltip(following ? "Following the current space" : "Switch board")
        .child(h_flex().min_w(0).max_w_full().gap(6).items_center()
          .child(div().id("fizzy-board-name").min_w(0).truncate().text_size(textPx(17)).font_bold().text_color(this.board ? t.foreground : t.dim).child(current?.name ?? (this.boards ? "No board" : "…")))
          .child(svg(ICON("chevron-down")).size(12).flex_none().text_color(t.dim)))
        .when(following, el => el.child(div().text_size(textPx(10)).font_medium().text_color(t.dim).child("FOLLOWING SPACE"))))
      .child(rule())
      .child(round("fizzy-open-board", "external-link", "Open board in Fizzy", current?.url ? cx => cx.open_url(current.url) : null));
  }

  filterOf(view) {
    return view === "board" ? this.boardFilter : this.filter;
  }

  // The x at the right end inside a field with words: one click empties it.
  clearButton(t, id, clear) {
    return div().id(id).absolute().right(4).top(4).size(20).flex().items_center().justify_center().rounded(5).cursor_pointer().text_color(t.dim)
      .hover(s => s.bg(t.hover).text_color(t.foreground)).tooltip("Clear")
      .on_mouse_down("left", stop).on_click((_e, cx) => clear(cx))
      .child(svg(ICON("x")).size(12));
  }

  // The foot of the Board, Mine and Pins lists while nothing is picked: the filter, and in the Board view My cards and New card.
  listBar(t) {
    const field = this.filterOf(this.view), words = field.value() !== "";
    return h_flex().id("fizzy-list-bar").flex_none().p(6).gap(6).items_center().bg(t.chrome).border_t(1).border_color(t.border)
      .child(div().id("fizzy-filter").relative().flex_1().min_w(0)
        .child(Input.new(field).h(BAR_BUTTON).pl(28).pr(words ? 28 : 8).rounded(7).border_1().border_color(t.input).bg(t.background).text_size(textPx(12)).text_color(t.foreground))
        .child(svg(ICON("search")).absolute().left(9).top(7).size(14).text_color(t.dim))
        .when(words, el => el.child(this.clearButton(t, "fizzy-filter-clear", cx => { field.set_value(""); field.focus(); cx.notify(); }))))
      .when(this.view === "board", el => el.child(this.mineToggle(t)).child(this.newCardButton(t)));
  }

  // A card as Fizzy draws it. A head line: its number | its board on a tab in its lane's `color` at the card's top left (in a
  // list that mixes lanes, its lane named too), then its step progress, Fizzy's inactivity warning, ↵ and ⋯. Its title in
  // bold (a pin before it when pinned), its tags, then, in the lane's color, who made it and when, when it last changed and
  // who it is assigned to, with their photos, and its comment count. A faint gold glow when golden, an accent border when picked.
  // Dragged, it is the card (every picked card, when it is one of them): onto another lane it moves there, into a terminal
  // it drops its file.
  cardRow(t, card, lane, color) {
    const n = card.number, picked = this.selected.has(n), dragged = picked ? this.dragged(this.pickedNumbers()) : [card];
    const quick = (id, icon, tip, action) => div().id(id).size(22).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer().text_color(t.dim)
      .hover(s => s.bg(t.selected).text_color(t.foreground)).tooltip(tip)
      .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); action(cx); })
      .child(svg(icon).size(13));
    const tags = card.tags ?? [], who = card.assignees ?? [], board = card.board?.id ?? this.board;
    const boardName = card.board?.name ?? this.boards?.find(b => b.id === board)?.name ?? "";
    const warn = inactivity(card, { period: this.boards?.find(b => b.id === board)?.period, stalled: Boolean(this.stalled.get(board)?.has(n)), now: now() });
    const warnColor = warn?.kind === "closing" ? t.ansi3 : t.blocked;
    const counts = this.counts.get(n), steps = counts?.total > 0 ? counts : null, comments = counts?.comments ?? 0;
    const added = card.created_at ? daysAgo(card.created_at, now()) : "", changed = daysAgo(card.last_active_at, now());
    const upper = text => String(text ?? "").toUpperCase();
    const ruled = el => el.pb(2).border_b(1).border_color(t.border);
    const line = (id, icon, text) => h_flex().id(id).min_w(0).gap(4).items_center()
      .when(Boolean(icon), el => el.child(svg(ICON(icon)).size(10).flex_none())).child(div().min_w(0).truncate().child(text));
    const head = h_flex().id(`fizzy-card-head-${n}`).min_w(0).gap(7).items_center().px(9).py(4).rounded_br(6).bg(color)
      .text_size(textPx(11)).font_semibold().text_color(ON_LANE)
      .child(div().flex_none().child(String(n)))
      .when(Boolean(boardName), el => el.child(div().w(1).h(11).flex_none().bg(tint(ON_LANE, "59")))
        .child(div().min_w(0).truncate().child(upper(boardName))));
    return this.dragCards(v_flex().id(`fizzy-card-${n}`), dragged).relative().flex_none().rounded(8).overflow_hidden().cursor_pointer()
      .bg(picked ? t.selected : t.background)
      .border_1().border_color(picked ? t.accent : t.border).hover(s => s.border_color(t.input))
      .when(Boolean(card.golden), el => el.child(window.paint_path(CARD_SHAPE, GOLD_GLOW).absolute().top(0).left(0).size_full()))
      .on_mouse_down("left", (_e, cx) => { this.pressed = { number: n, lane }; this.writeCardFiles(dragged, cx); })
      .on_mouse_up("left", (_e, cx) => this.drop(lane, cx))
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.cardMenu(card, cx); })
      .on_click((e, cx) => this.clickCard(card, e, cx))
      .child(h_flex().gap(6).items_start().min_w(0)
        .child(head)
        .child(h_flex().flex_1().min_w(0).gap(6).items_center().pt(3).pr(5)
          .when(lane == null, el => el.child(h_flex().id(`fizzy-card-lane-${n}`).flex_none().gap(4).items_center().text_size(textPx(10)).font_medium().text_color(color)
            .child(div().size(6).rounded_full().bg(color)).child(upper(laneName(card)))))
          .child(div().flex_1())
          .when(Boolean(steps), el => el.child(h_flex().id(`fizzy-card-steps-${n}`).flex_none().gap(4).items_center().text_size(textPx(11)).font_medium()
            .child(svg(ICON("circle-check")).size(12).flex_none().text_color(steps.done === steps.total ? t.done : color)).child(`${steps.done}/${steps.total}`)))
          .when(Boolean(warn), el => el.child(div().id(`fizzy-card-warn-${n}`).h(16).px(5).flex_none().flex().items_center().rounded(4)
            .border_1().border_color(warnColor).text_color(warnColor).text_size(textPx(10)).font_medium().child(warn.label)))
          .child(h_flex().flex_none().gap(1)
            .child(quick(`fizzy-insert-${n}`, ICON("insert"), "Insert in chat", cx => this.handOff("insert", [slim(card)], cx)))
            .child(quick(`fizzy-more-${n}`, ICON("more"), "More", cx => this.cardMenu(card, cx))))))
      .child(v_flex().gap(7).px(11).pt(6).pb(10)
        .child(h_flex().gap(6).items_start().min_w(0)
          .when(Boolean(this.pinOf(n)), el => el.child(svg(ICON("pin")).size(13).mt(2).flex_none().text_color(t.accent)))
          .child(div().id(`fizzy-card-title-${n}`).flex_1().min_w(0).whitespace_normal().font_bold().text_size(textPx(13)).child(card.title ?? "")))
        .when(tags.length > 0, el => el.child(h_flex().gap(4).items_center().min_w(0).overflow_hidden()
          .children(tags.slice(0, 3).map(tag => this.chip(t, `#${tag}`, { max: 150 })))
          .when(tags.length > 3, el => el.child(div().flex_none().text_size(textPx(11)).text_color(t.dim).child(`+${tags.length - 3}`)))))
        .child(h_flex().id(`fizzy-card-meta-${n}`).gap(7).items_center().min_w(0).text_size(textPx(10)).text_color(color)
          .when(Boolean(card.creator), el => el.child(this.avatar(t, card.creator, 20)))
          .child(v_flex().min_w(0).gap(2)
            .child(ruled(line(`fizzy-card-added-${n}`, null, upper(added ? `added ${added}` : "added"))))
            .child(line(`fizzy-card-creator-${n}`, null, upper(card.creator?.name ?? ""))))
          .child(div().w(1).h(26).flex_none().bg(t.border))
          .child(v_flex().min_w(0).gap(2)
            .child(ruled(line(`fizzy-card-changed-${n}`, "refresh", upper(changed))))
            .child(line(`fizzy-card-assigned-${n}`, "arrow-right", who.length ? upper(who.map(u => u.name).join(", ")) : "")))
          .when(who.length > 0, el => el.child(h_flex().id(`fizzy-card-people-${n}`).flex_none().gap(2).children(who.slice(0, 2).map(u => this.avatar(t, u, 20)))))
          .child(div().flex_1())
          .when(comments > 0, el => el.child(h_flex().id(`fizzy-card-comments-${n}`).flex_none().gap(4).items_center().text_size(textPx(11)).text_color(t.foreground)
            .child(svg(ICON("message-square-text")).size(14).flex_none().text_color(color)).child(String(comments))))));
  }

  // A lane's header: its color as a dot and a tint behind the row; its name, its count in a pill, and + for a new card.
  sectionHeader(t, section, count, closed) {
    const addable = section.kind === "column" || section.kind === "maybe", color = sectionColor(section);
    return h_flex().id(`fizzy-section-${section.key}`).h(34).flex_none().pl(10).pr(6).gap(8).items_center().cursor_pointer()
      .bg(tint(color, "26")).hover(s => s.bg(tint(color, "40")))
      // A press on a column's header picks the column up (let go over another column, it moves there); any press here ends a
      // stale drag (a card pressed earlier and released away from the panel).
      .on_mouse_down("left", () => { this.pressed = section.kind === "column" ? { column: section.key } : null; })
      .on_click((_e, cx) => this.toggleSection(section, cx))
      .on_mouse_up("left", (_e, cx) => this.drop(section.key, cx))
      .child(svg(ICON(closed ? "chevron-right" : "chevron-down")).size(12).flex_none().text_color(t.dim))
      .child(div().size(9).flex_none().rounded_full().bg(color))
      .child(div().min_w(0).truncate().font_semibold().text_size(textPx(12)).child(section.name))
      .when(count != null, el => el.child(div().h(18).min_w(18).px(6).flex_none().flex().items_center().justify_center().rounded_full()
        .bg(t.raised).text_size(textPx(11)).text_color(t.muted).child(String(count))))
      .child(div().flex_1())
      .when(addable, el => el.child(div().id(`fizzy-add-${section.key}`).size(22).flex_none().flex().items_center().justify_center().rounded(5).text_color(t.dim)
        .hover(s => s.bg(t.selected).text_color(t.foreground)).tooltip("New card here")
        .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); this.newCard(section.key, cx); })
        .child(svg(ICON("plus")).size(13))));
  }

  // The foot of a card New card just made: Discard deletes it, Done keeps it and goes back to the list.
  freshBar(t) {
    return h_flex().id("fizzy-fresh-bar").flex_none().p(6).gap(6).items_center().bg(t.chrome).border_t(1).border_color(t.border)
      .child(this.textButton(t, "fizzy-fresh-discard", ICON("trash"), "Discard", (_e, cx) => this.discardFresh(cx)))
      .child(div().flex_1())
      .child(this.textButton(t, "fizzy-fresh-done", ICON("check"), "Done", (_e, cx) => this.goBack(cx), true));
  }

  boardList(t, cx) {
    const board = this.board, columns = board ? this.columns.get(board) : null;
    if (!board) return [this.status(t, this.errors.boards ? explain(this.errors.boards) : this.boards ? "No boards" : "Loading…", cx, Boolean(this.errors.boards))];
    if (!columns) return [this.status(t, this.errors.board ? explain(this.errors.board) : "Loading…", cx, Boolean(this.errors.board))];
    const lazy = this.lazyOf(board), query = this.boardFilter.value(), out = [];
    const filtering = Boolean(query.trim()) || this.onlyMine;
    // A failed read keeps what was read before on screen, under the message.
    if (this.errors.board) out.push(this.status(t, explain(this.errors.board), cx, true));
    let total = 0;
    for (const section of this.boardSections(board)) {
      const { loaded, cards, shown } = this.laneCards(section, lazy, query);
      // A filter shows every lane that holds a match, folded or not; the fold kept for the lane is left as it is.
      const closed = this.collapsedNow(section) && !(filtering && cards.length);
      // Each lane is a block: a press let go anywhere in it, between its cards too, moves the card pressed there.
      const color = sectionColor(section);
      const lane = v_flex().id(`fizzy-lane-${section.key}`).flex_none().rounded(10).overflow_hidden().border_1().border_color(tint(color, "33"))
        .on_mouse_up("left", (_e, cx) => this.drop(section.key, cx))
        .child(this.sectionHeader(t, section, loaded ? cards.length : null, closed));
      out.push(lane);
      if (closed) continue;
      total += shown.length;
      const body = [
        ...(section.kind === "maybe" ? [this.watchBox(t)] : []),
        ...shown.map(card => this.cardRow(t, card, section.key, color)),
        ...this.laneFoot(t, section, cards, loaded, lazy, cx),
      ];
      lane.child(v_flex().px(6).pt(2).pb(6).gap(6).children(body));
    }
    if (!total) out.push(this.status(t, filtering ? "No cards match" : "No cards", cx));
    return out;
  }

  boardSections(board) {
    const lazy = this.lazyOf(board);
    return sections(this.columns.get(board) ?? [], this.cards.get(board) ?? [], { notNow: lazy.notNow ?? undefined, done: lazy.done ?? undefined });
  }

  // A lane's cards as the filter leaves them, golden first, the rest in Fizzy's order (the sort is stable); `shown`: Done's first
  // pages only. `loaded`: Not Now and Done are read only when they show.
  laneCards(section, lazy, query) {
    const loaded = section.kind === "not-now" ? Boolean(lazy.notNow) : section.kind === "done" ? Boolean(lazy.done) : true;
    const cards = filterCards(section.cards, query, { mine: this.onlyMine, me: this.me }).sort((a, b) => Number(Boolean(b.golden)) - Number(Boolean(a.golden)));
    return { loaded, cards, shown: section.kind === "done" ? cards.slice(0, lazy.shown) : cards };
  }

  // Under a lane's cards: Not Now's or Done's read failing (with Retry) or under way, and Done's Show more.
  laneFoot(t, section, cards, loaded, lazy, cx) {
    const out = [], onDemand = section.kind === "done" || section.kind === "not-now";
    if (onDemand && lazy.errors[section.kind]) out.push(this.status(t, explain(lazy.errors[section.kind]), cx, true, cx => this.loadLane(section.kind, cx), `fizzy-retry-${section.key}`));
    else if (onDemand && !loaded) out.push(this.status(t, "Loading…", cx));
    if (section.kind === "done" && loaded && (!lazy.end || cards.length > lazy.shown)) {
      out.push(h_flex().id("fizzy-more-done").h(28).flex_none().px(8).items_center().rounded(7).cursor_pointer().text_size(textPx(12)).text_color(t.muted)
        .hover(s => s.bg(t.hover)).on_click((_e, cx) => this.moreDone(cx)).child("Show more"));
    }
    return out;
  }

  // Fizzy's board: the columns side by side in the board's order, Not Now first and Done last. A folded column is a narrow pill
  // (its count, its name read top to bottom); a click opens it, as many open at once as fit (openKeys), each scrolling on its
  // own. A card let go anywhere over a column moves there; a column's head or pill let go over another column moves that column.
  boardColumns(t, cx) {
    const board = this.board;
    if (!board || !this.columns.get(board)) return v_flex().id("fizzy-list").flex_1().min_h(0).p(8).gap(8).children(this.boardList(t, cx));
    const lazy = this.lazyOf(board), query = this.boardFilter.value(), lanes = this.boardSections(board);
    const kept = this.openKeys(board).filter(key => lanes.some(s => s.key === key)), open = kept.length ? kept : ["maybe"];
    return v_flex().id("fizzy-board").flex_1().min_h(0)
      .when(Boolean(this.errors.board), el => el.child(this.status(t, explain(this.errors.board), cx, true)))
      .child(h_flex().id("fizzy-columns").flex_1().min_h(0).items_stretch().justify_center().gap(8).p(8)
        .children(lanes.map(section => {
          const { loaded, cards, shown } = this.laneCards(section, lazy, query);
          return open.includes(section.key)
            ? this.openColumn(t, section, { cards, shown, loaded, lazy }, cx)
            : this.foldedColumn(t, section, loaded ? cards.length : null);
        })));
  }

  openColumn(t, section, { cards, shown, loaded, lazy }, cx) {
    const color = sectionColor(section), addable = section.kind === "column" || section.kind === "maybe";
    const body = [
      ...(section.kind === "maybe" ? [this.watchBox(t)] : []),
      ...shown.map(card => this.cardRow(t, card, section.key, color)),
      ...this.laneFoot(t, section, cards, loaded, lazy, cx),
    ];
    if (loaded && !shown.length && section.kind !== "maybe") body.push(this.status(t, this.boardFilter.value().trim() || this.onlyMine ? "No cards match" : "No cards", cx));
    return v_flex().id(`fizzy-col-${section.key}`).flex_1().min_w(0).max_w(OPEN_MAX).min_h(0).gap(6)
      .on_mouse_up("left", (_e, cx) => this.drop(section.key, cx))
      .child(h_flex().id(`fizzy-col-head-${section.key}`).h(30).flex_none().gap(8).px(8).items_center().justify_center().rounded(7)
        .when(this.openKeys(this.board).length > 1, el => el.cursor_pointer().hover(s => s.bg(t.hover)))
        .on_mouse_down("left", () => { this.pressed = section.kind === "column" ? { column: section.key } : null; })
        .on_click((_e, cx) => this.toggleColumn(section, cx))
        .on_mouse_up("left", (_e, cx) => this.drop(section.key, cx))
        .when(section.kind !== "done", el => el.child(div().size(10).flex_none().rounded_full().bg(color)))
        .child(div().min_w(0).truncate().text_size(textPx(13)).font_semibold().child(section.name.toUpperCase()))
        .when(addable, el => el.child(div().id(`fizzy-add-${section.key}`).size(22).flex_none().flex().items_center().justify_center().rounded(5).text_color(t.dim)
          .hover(s => s.bg(t.selected).text_color(t.foreground)).tooltip("New card here")
          .on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); this.newCard(section.key, cx); })
          .child(svg(ICON("plus")).size(13)))))
      .child(v_flex().id(`fizzy-col-cards-${section.key}`).flex_1().min_h(0).overflow_y_scrollbar().gap(8).pr(4).children(body));
  }

  // A folded lane as Fizzy draws it: a pill in its color (Not Now's and Done's gray) fading downwards, taller the more
  // cards it holds (a circle when it holds none; as tall as it gets while Not Now or Done is not read), with its count at
  // the top and its name read top to bottom; under it all, a faint line from below the name to the board's foot.
  foldedColumn(t, section, count) {
    const base = section.kind === "not-now" || section.kind === "done" ? PILL_GRAY : sectionColor(section);
    const text = section.name.toUpperCase(), label = this.label(text), [w, h] = labelBox(text);
    const height = count == null ? PILL_MAX : Math.min(FOLDED + count * PILL_STEP, PILL_MAX);
    const lineTop = Math.round(10 + textPx(13) * 1.4 + 8 + textPx(h) + 6), look = this.hoverCol === section.key ? PILL_LIT : PILL;
    return v_flex().id(`fizzy-col-${section.key}`).relative().w(FOLDED).flex_none().items_center().gap(8).pt(10).overflow_hidden()
      .cursor_pointer().tooltip(section.name)
      .on_hover((hovered, cx) => this.hoverColumn(section.key, hovered, cx))
      .on_mouse_down("left", () => { this.pressed = section.kind === "column" ? { column: section.key } : null; })
      .on_click((_e, cx) => this.toggleColumn(section, cx))
      .on_mouse_up("left", (_e, cx) => this.drop(section.key, cx))
      .child(div().id(`fizzy-col-line-${section.key}`).absolute().top(lineTop).bottom(0).left(FOLDED / 2).w(1).bg(tint(base, look.line)))
      .child(window.paint_path(pillShape(height), Background.linear_gradient(180, tint(base, look.top), tint(base, look.foot)))
        .absolute().top(0).left(0).w(FOLDED).h(height))
      .child(div().id(`fizzy-col-count-${section.key}`).text_size(textPx(13)).font_semibold().child(count == null ? "" : String(count)))
      .when(Boolean(label), el => el.child(svg(label).w(textPx(w)).h(textPx(h)).flex_none().text_color(t.foreground)));
  }

  // The folded column under the pointer, drawn brighter. Leaving a column that is not the lit one changes nothing, so
  // entering the next before leaving the last never ends with none lit.
  hoverColumn(key, hovered, cx) {
    const next = hovered ? key : this.hoverCol === key ? null : this.hoverCol;
    if (next === this.hoverCol) return;
    this.hoverCol = next;
    cx.notify();
  }

  // The head of Maybe?, as Fizzy's: Add a card, then who watches the board for new cards, and a button to watch it or stop.
  watchBox(t) {
    const ids = this.access.get(this.board)?.watching, me = this.me, watching = Boolean(me && ids?.includes(me));
    const users = people().users ?? [], watchers = (ids ?? []).map(id => users.find(u => u.id === id)).filter(Boolean);
    return v_flex().id("fizzy-watch").flex_none().items_center().gap(10).px(12).py(14).rounded(8).border_1().border_color(t.border)
      .child(h_flex().id("fizzy-watch-add").h(30).px(14).gap(6).items_center().rounded_full().cursor_pointer().bg(t.solid).text_color(t.solid_foreground)
        .text_size(textPx(13)).font_semibold().hover(s => s.opacity(0.88)).on_mouse_down("left", stop)
        .on_click((_e, cx) => this.newCard("maybe", cx))
        .child(svg(ICON("plus")).size(14).flex_none()).child("Add a card"))
      .when(ids != null, el => el
        .child(h_flex().w_full().gap(8).items_center()
          .child(div().flex_1().h(1).bg(t.border))
          .child(div().flex_none().text_size(textPx(11)).font_semibold().text_color(t.muted).child(watchers.length ? "WATCHING FOR NEW CARDS" : "NOBODY WATCHES FOR NEW CARDS"))
          .child(div().flex_1().h(1).bg(t.border)))
        .when(watchers.length > 0, el => el.child(h_flex().id("fizzy-watchers").gap(4).items_center().justify_center()
          .children(watchers.slice(0, 8).map(u => this.avatar(t, u, 28)))
          .when(watchers.length > 8, el => el.child(div().text_size(textPx(11)).text_color(t.muted).child(`+${watchers.length - 8}`)))))
        .when(Boolean(me), el => el.child(h_flex().id("fizzy-watch-toggle").h(26).px(8).gap(6).items_center().rounded(6).cursor_pointer()
          .text_size(textPx(12)).font_semibold().text_color(t.accent).hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
          .on_click((_e, cx) => this.toggleWatching(cx))
          .child(svg(ICON(watching ? "bell-off" : "bell")).size(14).flex_none()).child(watching ? "STOP WATCHING" : "WATCH FOR NEW CARDS"))));
  }

  mineList(t, cx) {
    const query = this.filter.value(), out = [];
    if (this.errors.mine) out.push(this.status(t, explain(this.errors.mine), cx, true));
    let total = 0;
    for (const board of this.boards ?? []) {
      const cards = filterCards(this.mine.get(board.id) ?? [], query);
      if (!cards.length) continue;
      total += cards.length;
      out.push(h_flex().id(`fizzy-mine-${board.id}`).h(26).flex_none().px(8).items_center().font_medium().text_size(textPx(12)).text_color(t.muted).child(div().min_w(0).truncate().child(board.name)));
      for (const card of cards) out.push(this.cardRow(t, card, null, laneColor(card)));
    }
    const left = this.progress ? this.progress.total - this.progress.done : 0;
    if (this.progress) out.push(this.status(t, `Loading ${left} board${left === 1 ? "" : "s"}…`, cx));
    else if (!total && !this.errors.mine) out.push(this.status(t, query.trim() ? "No cards match" : this.me && !this.busy.has("mine") && !this.busy.has("boards") ? "No cards" : "Loading…", cx));
    return out;
  }

  // What the search of every board found: a section per board, the cards as everywhere else.
  searchList(t, cx) {
    const hunt = this.search, out = [];
    if (hunt.q == null) return [this.status(t, "Press Enter to search every board, comments included.", cx)];
    out.push(h_flex().id("fizzy-search-head").h(30).flex_none().px(8).gap(6).items_center().text_size(textPx(12)).text_color(t.muted)
      .child(svg(ICON("search")).size(13).flex_none())
      .child(div().flex_1().min_w(0).truncate().child(`Results for “${hunt.q}”`)));
    if (hunt.error) out.push(this.status(t, explainSearch(hunt.error), cx, true, cx => this.searchAll(cx), "fizzy-search-retry"));
    let total = 0;
    for (const board of this.boards ?? []) {
      const cards = hunt.found.get(board.id) ?? [];
      if (!cards.length) continue;
      total += cards.length;
      out.push(h_flex().id(`fizzy-search-board-${board.id}`).h(26).flex_none().px(8).items_center().font_medium().text_size(textPx(12)).text_color(t.muted).child(div().min_w(0).truncate().child(board.name)));
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
      .child(h_flex().id("fizzy-read-all").h(24).px(8).gap(5).items_center().rounded(6).cursor_pointer().text_size(textPx(12)).text_color(t.muted).hover(s => s.bg(t.hover))
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
        .child(div().whitespace_normal().text_size(textPx(12)).text_color(t.dim).child(note.body ?? ""))
        .child(div().min_w(0).truncate().text_size(textPx(11)).text_color(t.dim).child(meta)));
    }
    return out;
  }

  // One of the bar's four buttons: an icon (left out when the panel is narrow), a label, and, for the two that open a menu,
  // a small chevron after the label. `action` null: the button is dim and inert (no hover, no tooltip). The label is what
  // gives way when the room runs out.
  barButton(t, id, icon, label, action, menu = false) {
    const on = Boolean(action);
    return h_flex().id(id).h(BAR_BUTTON).flex_1().min_w(0).px(6).gap(4).items_center().justify_center().overflow_hidden().rounded(7).text_size(textPx(12)).font_medium()
      .bg(t.raised).text_color(on ? t.foreground : t.dim)
      .when(on, el => el.cursor_pointer().hover(s => s.bg(t.hover)).on_mouse_down("left", stop).on_click(action))
      .when(!this.narrow, el => el.child(svg(icon).size(13).flex_none()))
      .child(div().min_w(0).truncate().child(label))
      .when(menu, el => el.child(svg(ICON("chevron-down")).size(11).flex_none()));
  }

  // The bar at the foot of the card view, and of a list with cards picked (⌘/Ctrl-click): one line, four buttons, nothing
  // else. They act on the open card, else on the picked cards. Nothing here ever submits:
  //   Insert   pastes into the current chat; dragged into a terminal, it drops the cards' files there (dragCards)
  //   Send ▾   opens the running sessions; the one picked is brought to the front and gets the paste
  //   Start ▾  opens the agents to start; the one picked starts in a new tab and gets the paste once it is up
  //   Copy     copies the reference
  handBar(t) {
    const subject = this.subject(), has = subject.length > 0;
    const act = kind => (has ? (_e, cx) => this.handOff(kind, this.subject(), cx) : null);
    const cards = this.dragged(subject.filter(c => c.kind !== "board").map(c => c.number));
    return h_flex().id("fizzy-bar").flex_none().p(6).gap(4).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(textPx(12))
      .child(this.dragCards(this.barButton(t, "fizzy-bar-insert", ICON("insert"), "Insert", act("insert")), cards)
        .when(cards.length > 0, el => el.on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.writeCardFiles(cards, cx); })))
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
    return div().id(id).h(28).flex_none().pl(32).flex().items_center().text_size(textPx(12)).text_color(t.dim)
      .on_mouse_down("left", (_e, cx) => this.endDrag(cx))
      .child("No boards");
  }

  fieldRow(t, row, input, fieldId, cancelId, cancel) {
    return row
      .on_mouse_down("left", (e, cx) => this.pressButton(e, cx))
      .on_key_down((e, cx) => { if (e.key === "escape") cancel(cx); })
      .child(div().id(fieldId).flex_1().min_w(0).child(Input.new(input).h(28).px(8).rounded(7).border_1().border_color(t.accent).bg(t.background).text_size(textPx(12)).text_color(t.foreground)))
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
      ? h_flex().id(`fizzy-group-del-${g.id}`).h(22).px(6).flex_none().items_center().rounded(5).text_size(textPx(11)).text_color(t.blocked)
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
      .child(h_flex().id(`fizzy-group-match-${g.id}`).h(22).px(5).rounded(5).min_w(0).flex_shrink(4).items_center().text_size(textPx(11)).text_color(t.dim)
        .when(!dragging, el => el.cursor_pointer().hover(s => s.bg(t.selected)))
        .on_click((e, cx) => { if (cmdHeld(e)) return; cx.stop_propagation(); this.editGroup(g.id, "match", cx); })
        .child(div().min_w(0).truncate().child(rule)))
      .child(div().flex_1())
      .child(div().id(`fizzy-group-count-${g.id}`).flex_none().text_size(textPx(11)).text_color(t.dim).child(count == null ? "" : String(count)))
      .child(h_flex().flex_none().gap(2)
        .child(bin)
        .child(this.rowButton(t, `fizzy-group-hide-${g.id}`, ICON(g.hidden ? "eye-off" : "eye"), (_e, cx) => this.toggleGroup(g.id, cx), g.hidden ? "Show" : "Hide", g.hidden)));
  }

  boardRow(t, b, config) {
    const hidden = ownHidden(b.id, config), dim = hidden || Boolean(groupOf(b, config)?.hidden);
    const picked = this.drag?.kind === "board" && this.drag.id === b.id, line = this.rowLine(b.id);
    return h_flex().id(`fizzy-board-row-${b.id}`).relative().h(28).flex_none().pl(31).pr(8).gap(6).items_center().rounded(7).border_1().border_color(picked ? t.accent : CLEAR)
      .when(picked, el => el.bg(t.raised))
      .when(!this.drag, el => el.hover(s => s.bg(t.hover)))
      .on_mouse_down("left", (e, cx) => this.pickRow("board", b.id, e, cx))
      .on_hover((hovered, cx) => this.hoverRow(b.id, hovered, cx))
      .on_mouse_up("left", (_e, cx) => this.dropRow(b, cx))
      .when(Boolean(line), el => el.child(div().id(`fizzy-board-line-${b.id}`).absolute().left(8).right(8).h(2).rounded(1).bg(t.accent)
        .when(line === "top", l => l.top(-2))
        .when(line === "bottom", l => l.bottom(-2))))
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
        .child(div().id("fizzy-nogroup-count").flex_none().text_size(textPx(11)).text_color(t.dim).child(boards ? String(boards.length) : ""))
        .child(div().w(46).flex_none()))
      .when(open && Boolean(boards), el => el.children(boards.length
        ? boards.map(b => this.boardRow(t, b, config))
        : [this.emptyRow(t, "fizzy-nogroup-empty")]));
  }

  // Settings: the list of settings, each with what it is set to now; a click opens that setting's page.
  settingsView(t, cx) {
    const body = v_flex().id("fizzy-settings").flex_1().min_h(0).overflow_y_scrollbar().p(10).pb(14).gap(8)
      .when(Boolean(this.drag), el => el.cursor_grabbing());
    if (this.settingsPage === "mentions") return body.child(this.mentionsPage(t, cx));
    if (this.settingsPage === "groups") return body.child(this.groupsPage(t, cx));
    return body.children(SETTINGS.map(s => h_flex().id(`fizzy-setting-${s.id}`).min_h(52).flex_none().px(12).py(8).gap(12).items_center()
      .rounded(9).border_1().border_color(t.border).bg(t.surface).cursor_pointer().hover(st => st.border_color(t.input))
      .on_click((_e, cx) => { this.settingsPage = s.id; cx.notify(); })
      .child(div().size(30).flex_none().flex().items_center().justify_center().rounded(8).bg(t.background).text_color(t.muted).child(svg(ICON(s.icon)).size(15)))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().font_medium().child(s.title))
        .child(div().id(`fizzy-setting-${s.id}-summary`).min_w(0).truncate().text_size(textPx(12)).text_color(t.dim).child(this.settingSummary(s.id))))
      .child(svg(ICON("chevron-right")).size(14).flex_none().text_color(t.dim))));
  }

  // What a setting is set to, for its line in the list.
  settingSummary(id) {
    if (id === "groups") {
      const n = this.groups().groups.length;
      return n ? `${n} group${n === 1 ? "" : "s"}` : "No groups";
    }
    const users = people().users;
    if (!users) return "Loading people…";
    const total = activePeople(users, this.me).length, can = total - this.untaggable().length;
    return `Can tag ${can} of ${total} people · ${this.mentionAuto ? "Finds new ones by itself" : "Manual only"}`;
  }

  groupsPage(t, cx) {
    const config = this.groups(), known = Boolean(this.boards);
    const { ungrouped, groups } = boardGroups(this.boards ?? [], config, true);
    const section = v_flex().id("fizzy-settings-groups").flex_none().gap(2)
      .child(h_flex().id("fizzy-settings-groups-head").min_h(30).flex_none().pl(8).pr(8).gap(6).items_center()
        .child(div().flex_1().min_w(0).text_size(textPx(12)).text_color(t.dim).whitespace_normal().child("Groups sort the board dropdown. The eye hides a board or a group from it."))
        .child(this.rowButton(t, "fizzy-groups-add", ICON("plus"), (_e, cx) => this.openGroupComposer(cx), "New group")))
      .when(this.composing, el => el.child(this.groupComposerRow(t)));
    for (const { group, boards } of groups) section.child(this.groupBlock(t, group, known ? boards : null, config));
    section.child(this.noGroupBlock(t, known ? ungrouped : null, config));
    if (!known) section.child(this.status(t, this.errors.boards ? explain(this.errors.boards) : "Loading…", cx, Boolean(this.errors.boards)));
    return section;
  }

  // A block of the Mentions page: a title, what it says, and its controls.
  settingBlock(t, id, title, note, ...controls) {
    return v_flex().id(id).flex_none().p(12).gap(8).rounded(9).border_1().border_color(t.border).bg(t.surface)
      .child(div().font_medium().child(title))
      .when(Boolean(note), el => el.child(div().text_size(textPx(12)).text_color(t.dim).whitespace_normal().child(note)))
      .children(controls.filter(Boolean));
  }

  // An on/off switch: `solid` and its knob at the right when on.
  switchView(t, id, on, toggle) {
    return h_flex().id(id).w(34).h(20).flex_none().px(2).items_center().rounded_full().cursor_pointer()
      .bg(on ? t.solid : t.raised).when(on, el => el.justify_end())
      .on_mouse_down("left", stop).on_click((_e, cx) => toggle(cx))
      .child(div().size(16).rounded_full().bg(on ? t.solid_foreground : t.muted));
  }

  mentionsPage(t, cx) {
    const users = people().users, scan = this.mentionScan, missing = this.untaggable();
    const total = users ? activePeople(users, this.me).length : 0;
    const dim = (id, text) => div().id(id).text_size(textPx(12)).text_color(t.dim).whitespace_normal().child(text);
    const outcome = scan?.error ? this.status(t, explain(scan.error), cx, true, scan.retry, "fizzy-mentions-retry")
      : scan?.busy === "card" ? dim("fizzy-mentions-note", `Reading #${scan.card}…`)
      : scan?.note && !scan.busy ? dim("fizzy-mentions-note", scan.note) : null;
    return v_flex().id("fizzy-mentions").flex_none().gap(10)
      .child(this.settingBlock(t, "fizzy-mentions-status", users ? `You can tag ${total - missing.length} of ${total} people` : "Loading people…",
        missing.length ? `Not yet: ${missing.map(u => u.name).join(", ")}` : users ? "Everyone can be tagged with @." : null))
      .child(this.settingBlock(t, "fizzy-mentions-auto", "Find mentions automatically",
        "While someone can't be tagged, the panel reads Fizzy's recent activity in the background, at most once a week, and learns them from mentions made there.",
        h_flex().gap(10).items_center()
          .child(this.switchView(t, "fizzy-mentions-auto-switch", this.mentionAuto, cx => { this.mentionAuto = !this.mentionAuto; keep("mentionAuto", this.mentionAuto); cx.notify(); }))
          .child(div().text_size(textPx(12)).text_color(this.mentionAuto ? t.foreground : t.dim).child(this.mentionAuto ? "On" : "Off"))))
      .child(this.settingBlock(t, "fizzy-mentions-now", "Find mentions now", "Reads up to 600 recent events across your boards, once.",
        h_flex().child(this.textButton(t, "fizzy-mentions-find", ICON("search"), scan?.busy === "feed" ? `Searching… page ${scan.page}` : "Find mentions in Fizzy", (_e, cx) => this.findMentions(cx))),
        outcome))
      .child(this.settingBlock(t, "fizzy-mentions-card-block", "Learn from a card",
        "Fizzy lets the panel tag only people it has seen tagged before. To teach it everyone at once: in Fizzy, post one comment on any card that @-mentions each person, then enter that card's number here and press Enter.",
        h_flex().id("fizzy-mentions-card-row").gap(8).items_center()
          .child(div().flex_none().text_size(textPx(13)).text_color(t.dim).child("#"))
          .child(div().id("fizzy-mentions-card").w(140).flex_none().child(Input.new(this.mentionCard).h(28).px(8).rounded(7).border_1().border_color(t.input).bg(t.background).text_size(textPx(12)).text_color(t.foreground)))));
  }

  // `open` null: the card is a notification's stub, which doesn't carry this field, so the line shows no values and does nothing.
  pickerRow(t, id, label, items, empty, open) {
    return h_flex().id(id).min_h(30).flex_none().px(8).py(3).gap(8).items_start().rounded(7)
      .when(Boolean(open), el => el.cursor_pointer().hover(s => s.bg(t.hover))
        .on_mouse_down("left", (e, cx) => this.pressButton(e, cx)).on_click((_e, cx) => open(cx)))
      .child(div().w(52).h(24).flex_none().flex().items_center().text_size(textPx(12)).text_color(t.dim).child(label))
      .child(h_flex().flex_1().min_w(0).min_h(24).flex_wrap().gap(4).items_center()
        .children(!open ? [] : items.length ? items : [div().h(24).flex().items_center().text_size(textPx(12)).text_color(t.dim).child(empty)]))
      .child(div().w(22).h(24).flex_none().flex().items_center().justify_center().text_color(t.dim).child(svg(ICON("chevron-down")).size(12)));
  }

  sectionHead(t, id, label, count, action = null) {
    return h_flex().id(`${id}-head`).h(30).flex_none().px(8).gap(6).items_center()
      .child(div().flex_none().text_size(textPx(12)).font_medium().text_color(t.muted).child(label))
      .when(Boolean(count), el => el.child(div().id(`${id}-count`).flex_none().text_size(textPx(11)).text_color(t.dim).child(count)))
      .child(div().flex_1())
      .when(Boolean(action), el => el.child(action));
  }

  detailView(base, cx) {
    const t = { ...base, mono: cx.theme?.()?.typography?.mono }; // the code font, for richText
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
        .child(div().id("fizzy-title-input").flex_1().min_w(0).child(Input.new(this.titleInput).h(34).px(7).rounded(7).border_1().border_color(t.accent).bg(t.background).text_size(textPx(15)).text_color(t.foreground)))
        .child(this.rowButton(t, "fizzy-title-cancel", ICON("x"), (_e, cx) => this.cancelEdit(cx), "Cancel"))
      : div().id("fizzy-title").flex_1().min_w(0).px(8).py(4).rounded(7).text_size(textPx(15)).font_semibold().whitespace_normal().text_color(t.foreground).cursor_pointer()
        .hover(s => s.bg(t.hover)).on_click((_e, cx) => this.editTitle(cx)).child(c.title ?? "");
    return h_flex().id("fizzy-detail-top").flex_none().gap(8).items_start()
      .child(title)
      .child(h_flex().id("fizzy-lane").h(26).mt(editing ? 6 : 2).mr(8).px(8).gap(6).flex_none().items_center().rounded(6).bg(t.raised).cursor_pointer().text_size(textPx(12)).hover(s => s.bg(t.hover))
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

  // Description: Fizzy's own HTML, or its plain text; editing is text with people and cards as tokens, and says so when that
  // loses formatting.
  descSection(t, full) {
    const text = full.description?.trim() || htmlToText(full.description_html ?? "");
    const editing = this.editing === "desc";
    const shown = editing
      ? v_flex().id("fizzy-desc-editor").flex_none().gap(6)
        .on_key_down((e, cx) => { if (e.key === "escape") this.cancelEdit(cx); })
        .child(div().id("fizzy-desc-input").w_full().on_drop((e, cx) => this.attach(this.descArea, "desc", e.paths, cx))
          .child(Textarea.new(this.descArea).w_full().px(7).py(6).rounded(7).border_1().border_color(t.accent).bg(t.background).text_size(textPx(13)).text_color(t.foreground).token(this.tokenView(t))))
        .when(this.uploading.has("desc"), el => el.child(this.uploadNote(t, "desc")))
        .when(formatted(full.description_html), el => el.child(div().id("fizzy-desc-lossy").px(8).text_size(textPx(11)).text_color(t.muted).whitespace_normal().child("Saving keeps only the text: formatting is lost.")))
        .child(h_flex().justify_end().gap(6)
          .child(this.textButton(t, "fizzy-desc-cancel", null, "Cancel", (_e, cx) => this.cancelEdit(cx)))
          .child(this.textButton(t, "fizzy-desc-save", null, "Save", (_e, cx) => this.saveDescription(cx), true)))
      : div().px(8).w_full().child(!text ? div().id("fizzy-desc-empty").text_size(textPx(12)).text_color(t.dim).child("No description")
        : RICH && full.description_html ? this.richView(t, "fizzy-desc-html", full.description_html, DESC_INSET)
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
      .child(div().id("fizzy-step-input").flex_1().min_w(0).child(Input.new(this.stepInput).h(28).px(8).rounded(7).border_1().border_color(t.input).bg(t.background).text_size(textPx(12)).text_color(t.foreground))));
  }

  // Comments, oldest first. Most of what the CLI lists is Fizzy's own activity (creator role "system": "Ada moved this
  // to Not Now"): it would bury what people wrote, so it sits in one folded group after the comments.
  commentsSection(t, d) {
    const everything = [...d.comments].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const comments = everything.filter(cm => cm.creator?.role !== "system"), activity = everything.filter(cm => cm.creator?.role === "system");
    const section = v_flex().id("fizzy-comments").flex_none().gap(2)
      .child(this.sectionHead(t, "fizzy-comments", "Comments", comments.length ? String(comments.length) : ""));
    if (!comments.length) section.child(div().id("fizzy-comments-empty").h(28).flex_none().px(8).flex().items_center().text_size(textPx(12)).text_color(t.dim).child("No comments"));
    for (const cm of comments) section.child(this.commentBlock(t, cm));
    if (activity.length) {
      section.child(h_flex().id("fizzy-activity").h(28).flex_none().px(8).gap(6).items_center().rounded(7).cursor_pointer().text_size(textPx(12)).text_color(t.muted)
        .hover(s => s.bg(t.hover)).on_mouse_down("left", (e, cx) => this.pressButton(e, cx))
        .on_click((_e, cx) => { this.activityOpen = !this.activityOpen; cx.notify(); })
        .child(svg(ICON(this.activityOpen ? "chevron-down" : "chevron-right")).size(12).flex_none().text_color(t.dim))
        .child("Activity")
        .child(div().id("fizzy-activity-count").text_size(textPx(11)).text_color(t.dim).child(String(activity.length))));
      if (this.activityOpen) {
        for (const cm of activity) section.child(div().id(`fizzy-activity-${cm.id}`).flex_none().pl(26).pr(8).py(2).text_size(textPx(11)).text_color(t.dim).whitespace_normal().child(`${cm.body?.plain_text ?? ""} · ${ago(cm.created_at, now())}`));
      }
    }
    return section.child(v_flex().id("fizzy-comment-new").flex_none().pt(6).gap(6)
      .child(div().id("fizzy-comment-input").w_full().on_drop((e, cx) => this.attach(this.commentArea, "comment", e.paths, cx))
        .child(Textarea.new(this.commentArea).w_full().px(7).py(6).rounded(7).border_1().border_color(t.input).bg(t.background).text_size(textPx(13)).text_color(t.foreground).token(this.tokenView(t))))
      .when(this.uploading.has("comment"), el => el.child(this.uploadNote(t, "comment")))
      .child(h_flex().justify_end().gap(6)
        .child(this.textButton(t, "fizzy-comment-send", ICON("send"), "Comment", (_e, cx) => this.sendComment(cx), true))));
  }

  commentBlock(t, cm) {
    const who = cm.creator ?? { name: "?" }, binId = `fizzy-comment-del-${cm.id}`;
    const own = Boolean(this.me) && who.id === this.me, editing = this.editing === "comment" && this.editId === cm.id;
    const bin = this.armedComment === cm.id
      ? h_flex().id(binId).h(22).px(6).flex_none().items_center().rounded(5).cursor_pointer().text_size(textPx(11)).text_color(t.blocked).hover(s => s.bg(t.selected))
        .on_mouse_down("left", (e, cx) => this.pressButton(e, cx)).on_mouse_down_out((_e, cx) => this.disarmComment(cx))
        .on_click((_e, cx) => { cx.stop_propagation(); this.dropComment(cm, cx); })
        .child("Delete?")
      : this.rowButton(t, binId, ICON("trash"), (_e, cx) => this.dropComment(cm, cx), "Delete");
    return v_flex().id(`fizzy-comment-${cm.id}`).flex_none().px(8).py(6).gap(4)
      .when(editing, el => el.on_key_down((e, cx) => { if (e.key === "escape") this.cancelEdit(cx); }))
      .child(h_flex().h(24).gap(6).items_center()
        .child(this.avatar(t, who, 20))
        .child(div().min_w(0).truncate().font_medium().child(who.name ?? ""))
        .child(div().flex_none().text_size(textPx(11)).text_color(t.dim).child(ago(cm.created_at, now())))
        .child(div().flex_1())
        .when(own && !editing, el => el.child(this.rowButton(t, `fizzy-comment-edit-${cm.id}`, ICON("pencil"), (_e, cx) => this.editComment(cm, cx), "Edit")).child(bin)))
      .child(editing
        ? v_flex().id(`fizzy-comment-editor-${cm.id}`).pl(17).gap(6)
          .child(div().id(`fizzy-comment-area-${cm.id}`).w_full().on_drop((e, cx) => this.attach(this.commentEdit, "commentEdit", e.paths, cx))
            .child(Textarea.new(this.commentEdit).w_full().px(8).py(6).rounded(7).border_1().border_color(t.accent).bg(t.background).text_size(textPx(13)).text_color(t.foreground).token(this.tokenView(t))))
          .when(this.uploading.has("commentEdit"), el => el.child(this.uploadNote(t, "commentEdit")))
          .when(formatted(cm.body?.html), el => el.child(div().id(`fizzy-comment-lossy-${cm.id}`).px(9).text_size(textPx(11)).text_color(t.muted).whitespace_normal().child("Saving keeps only the text: formatting is lost.")))
          .child(h_flex().justify_end().gap(6)
            .child(this.textButton(t, `fizzy-comment-cancel-${cm.id}`, null, "Cancel", (_e, cx) => this.cancelEdit(cx)))
            .child(this.textButton(t, `fizzy-comment-save-${cm.id}`, null, "Save", (_e, cx) => this.saveComment(cx), true)))
        : div().pl(26).w_full().child(RICH && cm.body?.html
          ? this.richView(t, `fizzy-comment-html-${cm.id}`, cm.body.html, COMMENT_INSET)
          : this.plainLines(`fizzy-comment-text-${cm.id}`, cm.body?.plain_text)))
      .when(!editing && this.reactions.has(cm.id), el => el.child(this.reactionsRow(t, cm)));
  }

  // One chip per emoji with its count, yours outlined; a click on one toggles yours. Then the button that adds one.
  reactionsRow(t, cm) {
    const by = new Map();
    for (const r of this.reactions.get(cm.id)) by.set(r.content, [...(by.get(r.content) ?? []), r]);
    const chip = ([content, list], i) => {
      const mine = list.some(r => this.ownReaction(r)), names = list.map(r => r.reacter?.name).filter(Boolean).join(", ");
      return h_flex().id(`fizzy-reaction-${cm.id}-${i}`).h(22).px(7).gap(4).flex_none().items_center().rounded(11).text_size(textPx(12)).cursor_pointer()
        .border_1().border_color(mine ? t.accent : CLEAR).bg(mine ? t.selected : t.raised).hover(s => s.bg(t.hover))
        .when(Boolean(names), el => el.tooltip(names))
        .on_mouse_down("left", (e, cx) => this.pressButton(e, cx))
        .on_click((_e, cx) => this.toggleReaction(this.detail.number, cm.id, content, cx))
        .child(content).child(div().text_color(t.muted).child(String(list.length)));
    };
    return h_flex().id(`fizzy-reactions-${cm.id}`).pl(26).flex_wrap().gap(4).items_center()
      .children([...by].map(chip))
      .child(this.rowButton(t, `fizzy-react-${cm.id}`, ICON("smile-plus"), () => this.reactMenu(cm), "Add reaction"));
  }

  plainLines(id, text) {
    return v_flex().id(id).w_full().text_size(textPx(13))
      .children(textLines(text).map(line => (line ? div().whitespace_normal().child(line) : div().h(6).flex_none())));
  }

  // TextView can't color text, so the panel draws Fizzy's HTML itself; TextView only draws what that fails on.
  // `inset`: how much narrower than the panel the text is, which no image is drawn wider than.
  richView(t, id, html, inset) {
    try { return this.richText(t, id, html, inset); }
    catch { return TextView.html(id, htmlForView(html)).selectable().on_link_click((url, cx) => cx.open_url(url)); }
  }

  richText(t, id, html, inset) {
    const column = Math.max(120, (this.width ?? 360) - inset);
    return v_flex().id(id).w_full().text_size(textPx(13))
      .children(richLines(html, people().users).map((line, i) => (line.file
        ? this.richFile(t, `${id}-${i}`, line.file, column, i > 0)
        : this.richLine(t, `${id}-${i}`, line, i > 0 && line.gap))));
  }

  // An image at its own aspect ratio, as wide as it is but no wider than `column`, with its caption; until it is on disk, a box of
  // its size. Any other file, an image over IMAGE_MAX and one that would not download is a file.
  richFile(t, id, f, column, gap) {
    const file = !f.image || f.size > IMAGE_MAX || this.fileFailed.has(f.key);
    return v_flex().w_full().gap(4).items_start().when(gap, el => el.mt(8))
      .child(file ? this.fileChip(t, id, f, column) : this.imageBox(t, id, f, column))
      .when(Boolean(f.caption), el => el.child(div().text_size(textPx(12)).text_color(t.muted).whitespace_normal().child(f.caption)));
  }

  imageBox(t, id, f, column) {
    const w = Math.round(Math.min(f.width || column, column));
    const h = Math.max(24, Math.round(f.width && f.height ? (w * f.height) / f.width : w * 0.6));
    const frame = div().id(id).w(w).h(h).flex_none().rounded(6).border_1().border_color(t.border).overflow_hidden();
    const cached = this.files[f.key];
    if (!cached) {
      return frame.flex().flex_col().items_center().justify_center().gap(2).px(8).bg(t.raised).text_size(textPx(12)).text_color(t.dim)
        .child(div().max_w(w - 16).truncate().child(f.filename)).child("Loading image…");
    }
    const path = `${FILE_DIR}/${cached}`;
    return frame.cursor_pointer().tooltip(f.filename).drag_paths([`${appHome()}/${path}`])
      .on_mouse_down("left", (e, cx) => this.pressButton(e, cx))
      .on_click((_e, cx) => this.openFile(`${appHome()}/${path}`, cx))
      .child(image(path).size_full().rounded(6));
  }

  // A paperclip, the file's name and size; a click saves it in Downloads (see saveFile).
  fileChip(t, id, f, column) {
    const size = fileSize(f.size);
    const tip = !f.sgid ? "Open in the browser" : isMarkdownName(f.filename) ? "Save to Downloads and open beside" : "Save to Downloads";
    return h_flex().id(id).h(30).max_w(column).px(8).gap(6).flex_none().items_center().rounded(6).border_1().border_color(t.border).bg(t.raised)
      .cursor_pointer().hover(s => s.bg(t.hover)).tooltip(tip)
      .on_mouse_down("left", (e, cx) => this.pressButton(e, cx))
      .on_click((_e, cx) => this.saveFile(f, cx))
      .child(svg(ICON("paperclip")).size(13).flex_none().text_color(t.muted))
      .child(div().min_w(0).truncate().child(f.filename))
      .when(Boolean(size), el => el.child(div().flex_none().text_size(textPx(11)).text_color(t.dim).child(size)));
  }

  uploadNote(t, target) {
    return div().id(`fizzy-uploading-${target}`).px(8).text_size(textPx(11)).text_color(t.muted).truncate().child(`Uploading ${this.uploading.get(target)}…`);
  }

  // A line wraps between its words: each word is a piece of its own, its spaces kept at its end (non-breaking, so they keep their width).
  richLine(t, id, line, gap) {
    const pieces = [];
    for (const run of line.runs) {
      for (const [word] of run.text.matchAll(/\s+|\S+/g)) {
        const space = /^\s/.test(word), text = space ? word.replace(/\s/g, " ") : word;
        if (space && pieces.length) pieces.at(-1).text += text;
        else pieces.push({ ...run, text });
      }
    }
    const listed = line.depth > 0;
    return h_flex().id(id).w_full().min_w(0).items_start()
      .pl(Math.max(0, line.depth - 1) * 20 + (line.quote ? 8 : 0))
      .when(gap, el => el.mt(8))
      .when(line.quote, el => el.border_l(2).border_color(t.border).text_color(t.muted))
      .when(listed, el => el.child(div().w(20).flex_none().text_color(t.dim).child(line.marker ?? "")))
      .child(h_flex().flex_1().min_w(0).flex_wrap().children(pieces.map((p, k) => this.richPiece(t, `${id}-${k}`, p))));
  }

  // A mention bold in blue, a card reference bold in yellow (a click opens the card here), a link underlined (a click opens the browser).
  richPiece(t, id, p) {
    const color = { mention: t.ansi4, card: t.ansi3, link: t.accent }[p.kind];
    return div().min_w(0)
      .when(p.bold || p.kind === "mention" || p.kind === "card", el => el.font_bold())
      .when(p.italic, el => el.italic())
      .when(Boolean(p.code && t.mono), el => el.font_family(t.mono))
      .when(Boolean(color), el => el.text_color(color))
      .when(p.kind === "link", el => el.underline())
      .when(p.kind === "card", el => el.id(id).cursor_pointer().on_click((_e, cx) => this.openCard(p.number, null, cx)))
      .when(p.kind === "link" && Boolean(p.href), el => el.id(id).cursor_pointer().on_click((_e, cx) => this.openLink(p.href, cx)))
      .child(p.text);
  }

  // A link's address, made whole with Fizzy's own host when it is a path; only web addresses open.
  openLink(href, cx) {
    const host = /^https?:\/\/[^/]+/.exec(this.detail?.card?.url ?? "")?.[0] ?? "";
    const url = href.startsWith("/") ? host + href : href;
    if (/^https?:\/\//i.test(url)) cx.open_url(url);
  }

  // How an editor draws its tokens: a person bold in blue, a card bold in yellow, a file a small muted chip.
  // A person whose mention id the panel has not learned is dim: saving keeps them as plain text, and nobody is told.
  tokenView(t) {
    const tagged = id => Boolean(this.mentionIds[id.slice("user:".length)]);
    return ({ token, selected, line_height }) => {
      const file = token.id.startsWith("file:");
      return div().px(file ? 5 : 2).flex().items_center()
        .when(file, el => el.rounded(4).bg(t.raised).text_size(textPx(12)).text_color(t.muted))
        .when(!file, el => el.text_size(textPx(13)).font_bold().text_color(token.id.startsWith("card:") ? t.ansi3 : tagged(token.id) ? t.ansi4 : t.dim))
        .when(line_height > 0, el => el.h(line_height))
        .when(selected, el => el.bg(t.selection))
        .child(token.text);
    };
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
    if (this.search) return this.searchList(t, cx);
    if (this.view === "board") return this.boardList(t, cx);
    if (this.view === "mine") return this.mineList(t, cx);
    if (this.view === "inbox") return this.inboxList(t, cx);
    return this.pinList(t, cx);
  }

  renderPanel(cx) {
    const shown = fizzyVisible(layout()), became = shown && !this.shown;
    this.shown = shown;
    if (!checking()) {
      this.syncBoard(cx);
      this.takeRequest(cx, true);
      if (became) this.poll(cx, true);
    }
    const t = theme(), d = this.detail, picking = this.selected.size > 0;
    const lists = !this.settingsOpen && !d, fresh = Boolean(d) && this.fresh === d.number;
    return v_flex().id("fizzy").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(textPx(13))
      .on_size_change((size, cx) => {
        const layoutNow = () => [this.narrow, this.wide, this.sideBySide(), this.board ? this.openKeys(this.board).length : 0].join();
        const was = layoutNow(), wasSide = this.sideBySide();
        this.width = size.width;
        this.narrow = size.width < NARROW; this.wide = size.width >= WIDE;
        if (layoutNow() === was) return;
        if (this.sideBySide() && !wasSide) this.loadOpenLanes(cx);
        cx.notify();
      })
      .on_mouse_up("left", (_e, cx) => { this.pressed = null; this.endDrag(cx); })
      // A card pressed and let go away from the panel (dragged into a terminal) is not held for ever: the next
      // press outside the panel, or on a lane header, forgets it. A row dragged in Settings goes the same way.
      .on_mouse_down_out((_e, cx) => { this.pressed = null; this.endDrag(cx); this.disarm(cx); })
      .child(this.header(t, cx))
      .when(this.settingsOpen, el => el.child(this.settingsView(t, cx)))
      .when(!this.settingsOpen && Boolean(d), el => el.child(this.detailView(t, cx)))
      .when(lists, el => el
        .when(this.view === "board" && !this.search, el => el.child(this.boardBar(t, cx)))
        .child(this.view === "board" && !this.search && this.sideBySide()
          ? this.boardColumns(t, cx)
          : v_flex().id("fizzy-list").flex_1().min_h(0).overflow_y_scrollbar().p(8).gap(8).children(this.listFor(t, cx))))
      .when(!this.settingsOpen && fresh, el => el.child(this.freshBar(t)))
      .when(!this.settingsOpen && !fresh && (Boolean(d) || (lists && picking)), el => el.child(this.handBar(t)))
      .when(lists && !picking && !this.search && this.view !== "inbox", el => el.child(this.listBar(t)));
  }

  initMenu(menu, cx) {
    this.menu = menu; this.at = 0; this.armed = null;
    this.most = menuSize(menu) - FRAME; // the popup's inside, as asked for when it opened
    this.handle = cx.focus_handle();
    this.handle.focus();
    if (menu.kind === "newCard") this.atId = `board-${menu.current}`;
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
    if (((menu.kind === "users" || menu.kind === "mention") && people().users == null) || (menu.kind === "tags" && people().tags == null)) {
      cx.spawn(async cx => { await loadPeople(); cx.notify(); });
    }
    if (menu.kind === "tags") {
      this.tagInput = InputState.new({ placeholder: "New tag…" });
      this.tagInput.on("submit", (_e, cx) => this.newTag(cx));
    }
    // Typing goes on in the popup: the words narrow the people or the cards, Enter takes the one highlighted.
    if (PICKERS.has(menu.kind)) {
      this.looked = null; this.lookups = 0;
      this.tagInput = InputState.new({ placeholder: menu.kind === "mention" ? "Search people…" : "Card number or title…" });
      this.tagInput.on("change", (_e, cx) => { if (menu.kind === "cardref") this.lookUpLater(cx); cx.notify(); });
      this.tagInput.on("submit", (_e, cx) => this.choose(this.pick ?? [], this.at, cx));
      this.tagInput.focus();
      cx.timer.after(200, () => this.tagInput.focus());
    }
  }

  // A number typed in the Card popup that no card it was handed has is looked up once (`looked`, see cardRefRows), LOOKUP_DELAY ms
  // after the typing stops.
  lookUpLater(cx) {
    const n = Number(/^\s*#?(\d+)\s*$/.exec(this.tagInput.value())?.[1]), asked = ++this.lookups;
    if (!n || this.looked?.number === n || this.menu.cards?.some(c => c.number === n)) return;
    cx.timer.after(LOOKUP_DELAY, cx => {
      if (asked !== this.lookups) return;
      cx.spawn(async cx => {
        try {
          const card = await fizzy(cmd.card(n));
          this.looked = { number: n, title: card?.title ?? "", board: card?.board?.name };
        } catch (e) { this.looked = { number: n, error: explain(e) }; }
        cx.notify();
      });
    });
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
    // Once only: Enter reaches both a picker's field (its submit) and the popup.
    if (this.chosen) return;
    this.chosen = true;
    closeOverlay(props().overlay);
    perform(r.act, cx);
  }

  item(t, r, pick) {
    if (r.type === "sep") return div().h(1).mx(7).my(4).bg(t.border);
    if (r.type === "label") return div().px(9).pt(8).pb(4).text_size(textPx(11)).text_color(t.dim).child(r.label);
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
      .child(div().max_w(96).truncate().text_size(textPx(11)).text_color(t.dim).child(r.hint ?? ""))
      .when(Boolean(r.user && r.checked), el => el.child(svg(ICON("check")).size(14).flex_none().text_color(tone)));
  }

  renderMenu() {
    const picker = PICKERS.has(this.menu.kind), query = picker ? this.tagInput.value() : "";
    const t = theme(), rows = menuRows(this.menu, live({ known: this.known, checking: this.checking, failed: this.failed, armed: this.armed, query, looked: this.looked }));
    const pick = rows.filter(r => r.type === "row");
    this.pick = pick;
    // Rows arrive after the popup opens (agents, people): the highlight stays on its row.
    const kept = pick.findIndex(r => r.id === this.atId);
    this.at = kept >= 0 ? kept : Math.max(0, Math.min(this.at, pick.length - 1));
    this.atId = pick[this.at]?.id;
    // A popup is as tall as its content, up to the height it asked for. The list scrolls, and a scroll area has
    // no height of its own: left to its content the column is just its padding, an empty strip. So the column is
    // as tall as its rows (at most the popup's inside) and the list fills it, scrolling if the rows outgrow it.
    const tags = FIELD_MENUS.has(this.menu.kind);
    return v_flex().id("fizzy-menu").track_focus(this.handle).w_full().h(Math.min(menuHeight(rows) + (tags ? INPUT_ROW : 0) - FRAME, this.most)).min_h(0).p(5).bg(t.popover).text_size(textPx(12.8))
      .on_key_down((e, cx) => {
        if (e.key === "escape") return closeOverlay(props().overlay);
        if (!pick.length) return;
        if (e.key === "down") this.at = (this.at + 1) % pick.length;
        else if (e.key === "up") this.at = (this.at + pick.length - 1) % pick.length;
        else if (e.key === "enter" || (picker && e.key === "tab")) return this.choose(pick, this.at, cx);
        else return;
        this.atId = pick[this.at]?.id;
        cx.notify();
      })
      .when(tags, el => el.child(div().id("fizzy-menu-newtag").flex_none().px(3).pb(5)
        .child(Input.new(this.tagInput).h(28).px(8).rounded(7).border_1().border_color(t.input).bg(t.background).text_size(textPx(12)).text_color(t.foreground))))
      .child(v_flex().id("fizzy-menu-list").flex_1().min_h(0).overflow_y_scrollbar().children(rows.map(r => this.item(t, r, pick))));
  }

  render(cx) {
    return this.menu ? this.renderMenu() : this.renderPanel(cx);
  }
}
