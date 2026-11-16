// Pure helpers for the Fizzy panel and its menus. No imports from herdr or gpui-*: node tests load this file as it is.

export const ICON = name => `mods/fizzy/${name}.svg`;
// How often (ms) the visible view and the unread notifications are asked again, and how many reads run side by side.
export const POLL_VIEW = 30000, POLL_INBOX = 30000, CONCURRENCY = 6;
// Notifications: how many toasts one poll posts at most, how many seen ids are kept, how long a toast's click
// is waited for when it had to bring the panel up first (ms), and how long a toast stays.
export const TOASTS = 3, SEEN_CAP = 300, PENDING_FOR = 60000, TOAST_FOR = 8000;
// How often a panel looks for a popup's request when no draw does (a hidden panel is not drawn).
export const REQUEST_EVERY = 300;
// "Start new session": how long (ms) a new session is waited for before the reference is only copied, and how long a
// session that has appeared but is not idle yet is waited for before the reference is pasted anyway.
export const START_WAIT = 30000, READY_WAIT = 3000;
// The menus' measures (px): a row, a dim label, a separator, the padding, the frame.
export const ROW = 31, LABEL = 28, SEP = 9, PAD = 10, FRAME = 2;
// The Done lane shows this many cards before "Show more".
export const CARD_PAGE = 50;
// Installed agents offered in the "start" menu.
export const AGENTS = 6;
// Profile photos: where they are cached (under the app's folder, as image() takes a path), how long one is kept before it
// is fetched again, how long a photo that failed is left alone, how many are fetched at once, and how often the people are
// read again (ms).
export const AVATAR_DIR = "data/fizzy/avatars", AVATAR_TTL = 7 * 86400000, AVATAR_BACKOFF = 3600000, AVATAR_PARALLEL = 4, AVATAR_EVERY = 86400000;
// The images in descriptions and comments: where they are cached (under the app's folder too), how many are downloaded at once,
// and the largest one downloaded (bytes); a larger one is shown as a file. FILE_TIMEOUT: how long one upload or download may take (ms).
export const FILE_DIR = "data/fizzy/files", FILE_PARALLEL = 3, IMAGE_MAX = 15 * 1048576, FILE_DAYS = 7, FILE_TIMEOUT = 5 * 60000;

// `code` is the CLI's own ("auth_required", "not_found", "network", "forbidden", "rate_limit", "api_error", "usage"), or
// ours: "MISSING" (the program would not start), "TIMEOUT" (Herdr stopped it) and "PARSE" (stdout was not the JSON
// envelope).
export class FizzyError extends Error {
  constructor(message, code = "ERROR") {
    super(message);
    this.name = "FizzyError";
    this.code = code;
  }
}

// A warning printed ahead of the CLI's JSON must not hide it.
function readJson(text) {
  const s = String(text ?? "").trim();
  if (!s) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    const from = s.indexOf("{"), to = s.lastIndexOf("}");
    if (from < 0 || to <= from) return undefined;
    try {
      return JSON.parse(s.slice(from, to + 1));
    } catch {
      return undefined;
    }
  }
}

// An exec result -> the envelope's data (null when it has none, as writes often don't). Throws FizzyError. A failure is
// { ok: false, error, code }, whatever the exit code.
export function parseResult({ stdout, stderr }) {
  const body = readJson(stdout);
  if (body && typeof body === "object" && !Array.isArray(body)) {
    if (body.ok === false) {
      const message = typeof body.error === "string" && body.error ? body.error : "Fizzy reported an error";
      throw new FizzyError(message, typeof body.code === "string" && body.code ? body.code : "ERROR");
    }
    if (body.ok === true) return body.data ?? null;
  }
  throw new FizzyError(String(stderr ?? "").trim() || "Fizzy returned something unreadable", "PARSE");
}

// Why exec rejected. Herdr stops a program at its time limit with "<program> took longer than 30 s and was stopped";
// any other rejection is a program that would not start.
export function execFailure(error) {
  const message = String(error?.message ?? error);
  return new FizzyError(message, /took longer than/.test(message) ? "TIMEOUT" : "MISSING");
}

// What to tell the person about an error.
export function explain(error) {
  if (typeof error === "string") return error;
  switch (error?.code) {
    case "auth_required": return "Not signed in to Fizzy: run `fizzy setup` in a terminal";
    case "network": return "Can't reach Fizzy";
    case "not_found": return "Not found in Fizzy: it was deleted, or you can't see it";
    case "forbidden": return "Fizzy doesn't let you do that";
    case "rate_limit": return "Fizzy is busy: try again in a minute";
    case "MISSING": return "The fizzy CLI isn't installed (or not on PATH)";
    case "TIMEOUT": return "Fizzy took too long to answer";
    default: return error?.message || "Something went wrong with Fizzy";
  }
}

export const SEARCH_CAP = 15;
export function explainSearch(error) {
  if (error?.code === "TIMEOUT" || error?.code === "rate_limit") {
    return "Fizzy didn't answer the search. Its search limit (300 an hour, shared with your agents) may be used up. Try again later.";
  }
  return explain(error);
}

// --jq projections: an answer cut down to the envelope's `ok` and the fields the panel reads. A failure's envelope passes
// --jq untouched, so parseResult reads both alike.
const COLUMN_JQ = '(.column | if type == "object" then {id, name, color} else null end)';
const CARD_JQ = `{number, title, url, closed, postponed, golden, column: ${COLUMN_JQ}, board: (.board | if type == "object" then {id, name} else null end), tags: (.tags // []), assignees: [(.assignees // [])[] | {id, name, avatar_url}], last_active_at, description: ((.description // "") | .[0:300])}`;
const NOTE_JQ = `{id, title, body, read, created_at, creator: (.creator | if type == "object" then {id, name, avatar_url} else null end), card: (.card | if type == "object" then {number, title, url, closed, postponed, board_name, column: ${COLUMN_JQ}} else null end)}`;
export const JQ = {
  cards: `{ok, data: [(.data // [])[] | ${CARD_JQ}]}`,
  // A Done page, and whether a page follows: the last page says none; a page past the end still says one does.
  page: `{ok, data: {cards: [(.data // [])[] | ${CARD_JQ}], more: (.context.pagination.has_next // false)}}`,
  notes: `{ok, data: [(.data // [])[] | ${NOTE_JQ}]}`,
  numbers: "{ok, data: [(.data // [])[] | .number]}",
  config: "{ok, data: (.data | {account, board})}",
  reactions: "{ok, data: [(.data // [])[] | {id, content, reacter: {id: .reacter.id, name: .reacter.name}}]}",
  // An activity page cut down to the comments and descriptions that hold a mention, and whether a page follows.
  mentions: '{ok, data: {html: [(.data // [])[] | .eventable | ((.body.html? // ""), (.description_html? // ""))] | map(select(contains("vnd.actiontext.mention"))) | unique, more: (.context.pagination.has_next // false)}}',
  // A card's attachments as their sgids, in the order `card attachments download` numbers them (from 1).
  attachments: "{ok, data: [(.data // [])[] | .sgid]}",
};

// The argv after "fizzy" for each command; withJson adds the --json. Every flag here but --jq, which
// every command takes and only `fizzy --help` lists, is one `fizzy <command> --help` lists.
export const cmd = {
  boards: () => ["board", "list", "--all"],
  columns: board => ["column", "list", "--board", board],
  open: board => ["card", "list", "--board", board, "--all", "--jq", JQ.cards],
  stalled: board => ["card", "list", "--board", board, "--indexed-by", "stalled", "--all", "--jq", JQ.numbers],
  notNow: board => ["card", "list", "--board", board, "--indexed-by", "not_now", "--all", "--jq", JQ.cards],
  done: (board, page = 1) => ["card", "list", "--board", board, "--indexed-by", "closed", "--page", String(page), "--jq", JQ.page],
  mine: (board, me) => ["card", "list", "--board", board, "--assignee", me, "--all", "--jq", JQ.cards],
  mineAll: me => ["card", "list", "--assignee", me, "--all", "--jq", JQ.cards],
  search: q => ["search", "--jq", JQ.cards, "--", String(q ?? "").replace(/^\s*#?/, "").trim()],
  card: n => ["card", "show", String(n)],
  comments: n => ["comment", "list", "--card", String(n), "--all"],
  users: () => ["user", "list", "--all"],
  tags: () => ["tag", "list", "--all"],
  pins: () => ["pin", "list", "--jq", JQ.cards],
  inbox: () => ["notification", "tray", "--jq", JQ.notes],
  me: () => ["identity", "show"],
  activity: page => ["activity", "list", "--page", String(page), "--jq", JQ.mentions],
  config: () => ["config", "show", "--jq", JQ.config],
  create: (board, title, html = "") => ["card", "create", "--board", board, "--title", title, ...(html ? ["--description", html] : [])],
  // The CLI leaves the description as it is when --description is empty, so an emptied one is sent as an empty paragraph.
  update: (n, { title, html } = {}) => ["card", "update", String(n), ...(title != null ? ["--title", title] : []), ...(html != null ? ["--description", html || "<p></p>"] : [])],
  column: (n, column) => ["card", "column", String(n), "--column", column],
  shiftColumn: (id, right) => ["column", right ? "move-right" : "move-left", id],
  postpone: n => ["card", "postpone", String(n)],
  untriage: n => ["card", "untriage", String(n)],
  close: n => ["card", "close", String(n)],
  reopen: n => ["card", "reopen", String(n)],
  golden: (n, on) => ["card", on ? "golden" : "ungolden", String(n)],
  pin: (n, on) => ["card", on ? "pin" : "unpin", String(n)],
  watch: (n, on) => ["card", on ? "watch" : "unwatch", String(n)],
  selfAssign: n => ["card", "self-assign", String(n)],
  assign: (n, user) => ["card", "assign", String(n), "--user", user],
  tag: (n, name) => ["card", "tag", String(n), "--tag", name],
  moveBoard: (n, board) => ["card", "move", String(n), "--to", board],
  remove: n => ["card", "delete", String(n)],
  addStep: (n, content) => ["step", "create", "--card", String(n), "--content", content],
  step: (n, id, done) => ["step", "update", id, "--card", String(n), done ? "--completed" : "--not_completed"],
  editStep: (n, id, content) => ["step", "update", id, "--card", String(n), "--content", content],
  dropStep: (n, id) => ["step", "delete", id, "--card", String(n)],
  comment: (n, html) => ["comment", "create", "--card", String(n), "--body", html],
  editComment: (n, id, html) => ["comment", "update", id, "--card", String(n), "--body", html],
  dropComment: (n, id) => ["comment", "delete", id, "--card", String(n)],
  reactions: (n, comment) => ["reaction", "list", "--card", String(n), "--comment", comment, "--jq", JQ.reactions],
  react: (n, comment, content) => ["reaction", "create", "--card", String(n), "--comment", comment, "--content", content],
  unreact: (n, comment, id) => ["reaction", "delete", id, "--card", String(n), "--comment", comment],
  read: id => ["notification", "read", id],
  readAll: () => ["notification", "read-all"],
  attachments: n => ["card", "attachments", "show", String(n), "--include-comments", "--jq", JQ.attachments],
  download: (n, index, path) => ["card", "attachments", "download", String(n), String(index), "--include-comments", "-o", path],
  upload: path => ["upload", "file", path],
};

// What runs: a builder's argv with --json last, or before a `--` separator (one that follows a value: `--title --` is a title), so the answer is the JSON envelope.
export function withJson(args) {
  const at = args.findIndex((a, i) => a === "--" && !String(args[i - 1]).startsWith("-"));
  return at < 0 ? [...args, "--json"] : [...args.slice(0, at), "--json", ...args.slice(at)];
}

const idOf = x => (x && typeof x === "object" ? x.id : x);

// A card is in exactly one lane: "done" (closed), "not-now" (postponed), "maybe" (no column), else its column's id.
export function laneOf(card) {
  if (card?.closed) return "done";
  if (card?.postponed) return "not-now";
  return idOf(card?.column) || "maybe";
}

const LANE_NAMES = { maybe: "Maybe?", "not-now": "Not Now", done: "Done" };
// The lane's name for people: the column's, or Maybe? / Not Now / Done.
export function laneName(card) {
  const lane = laneOf(card);
  return LANE_NAMES[lane] ?? card?.column?.name ?? lane;
}

// A card's column ({ id, name, color }), or null for none, which Fizzy gives as null, no key, or an empty column (id "").
// A lane's own id (maybe, not-now, done) as a card's column is kept: moveTo must not take a closed card's for none.
export function columnOf(column) {
  return column && typeof column === "object" && column.id ? { id: column.id, name: column.name, color: column.color } : null;
}

// A `card show` answer with the empty lists and texts Fizzy leaves out put back, and its column as columnOf gives it.
export function fullCard(card) {
  if (!card || typeof card !== "object") return card;
  return {
    ...card, column: columnOf(card.column), assignees: card.assignees ?? [], tags: card.tags ?? [], steps: card.steps ?? [],
    description: card.description ?? "", description_html: card.description_html ?? "",
  };
}

// Column `id` dragged onto column `target`: { columns, steps }, the board's columns in their new order (it takes the target's
// place: before it when it moves left, after it when it moves right) and the CLI's one-place moves that get it there. Maybe?,
// Not Now and Done keep their places; null when nothing moves.
export function reorderColumns(columns, id, target) {
  const real = columns.filter(c => !c.pseudo);
  const from = real.findIndex(c => c.id === id), to = real.findIndex(c => c.id === target);
  if (from < 0 || to < 0 || from === to) return null;
  const moved = [...real];
  moved.splice(to, 0, ...moved.splice(from, 1));
  let next = 0;
  return {
    columns: columns.map(c => (c.pseudo ? c : moved[next++])),
    steps: Array.from({ length: Math.abs(to - from) }, () => cmd.shiftColumn(id, to > from)),
  };
}

// The argv lists (in order) that move `card` to lane `target`. Same lane: none. A closed card is reopened first;
// Fizzy puts a reopened card back in its last column (Maybe? when it had none), so no second move when that is
// where the card is headed.
export function moveTo(card, target) {
  const from = laneOf(card), n = card.number;
  if (from === target) return [];
  if (target === "done") return [cmd.close(n)];
  const out = [];
  if (from === "done") {
    out.push(cmd.reopen(n));
    if (target === (idOf(card.column) || "maybe")) return out;
  }
  out.push(target === "not-now" ? cmd.postpone(n) : target === "maybe" ? cmd.untriage(n) : cmd.column(n, target));
  return out;
}

// Fizzy's named colors, as hex. Column colors come as { name: "Aqua", value: "var(--color-card-5)" }.
const COLORS = {
  blue: "#4b73e6", gray: "#8a8f98", tan: "#b69a7a", yellow: "#e5b422", lime: "#8cc63f", aqua: "#2fbfbf",
  violet: "#7c5ce6", purple: "#a855c7", pink: "#e8579f", red: "#e5484d", orange: "#f08a24", green: "#3fa65b",
};
const COLOR_VARS = { default: "blue", 1: "gray", 2: "tan", 3: "yellow", 4: "lime", 5: "aqua", 6: "violet", 7: "purple", 8: "pink" };
// A column (or a color's name) -> "#rrggbb", or null when it has no color or an unknown one.
export function colorOf(column) {
  const color = typeof column === "string" ? { name: column } : column?.color;
  const byName = COLORS[String(color?.name ?? "").trim().toLowerCase()];
  if (byName) return byName;
  const slot = /--color-card-(default|\d+)\b/.exec(String(color?.value ?? ""))?.[1];
  return COLORS[COLOR_VARS[slot]] ?? null;
}

const PSEUDO = { maybe: "Maybe?", "not-now": "Not Now", done: "Done" };
const KIND_OF_ID = { maybe: "maybe", "not-now": "not-now", done: "done" };
const KIND = { triage: "maybe", not_now: "not-now", closed: "done" };

// `column list` -> lanes in its order, each { key, id, name, kind, color, cards: [] }. A pseudo lane the list lacks
// is added: Maybe? first, Not Now and Done last. Pseudo lanes' key and id are always maybe / not-now / done.
export function lanes(columns) {
  const seen = new Set(), out = [];
  for (const c of columns ?? []) {
    if (!c?.id || seen.has(c.id)) continue;
    seen.add(c.id);
    const kind = KIND[c.kind] ?? (c.pseudo ? KIND_OF_ID[c.id] : null) ?? "column";
    const key = kind === "column" ? c.id : kind;
    if (kind !== "column" && out.some(l => l.key === key)) continue;
    out.push({ key, id: key, name: c.name || PSEUDO[key] || c.id, kind, color: kind === "column" ? colorOf(c) : null, cards: [] });
  }
  const lane = key => ({ key, id: key, name: PSEUDO[key], kind: key, color: null, cards: [] });
  if (!out.some(l => l.kind === "maybe")) out.unshift(lane("maybe"));
  for (const key of ["not-now", "done"]) if (!out.some(l => l.kind === key)) out.push(lane(key));
  return out;
}

// The board's lanes with their cards: `open` is the open-cards list, `extra.notNow` / `extra.done` the lanes loaded
// on demand (their cards replace the same numbers in `open`). Every card lands in one lane; one whose column is
// not in `columns` (it was deleted, or the list is stale) lands in Maybe?.
export function sections(columns, open, extra = {}) {
  const out = lanes(columns), by = new Map(out.map(s => [s.key, s]));
  const seen = new Set();
  for (const card of [...(extra?.notNow ?? []), ...(extra?.done ?? []), ...(open ?? [])]) {
    if (seen.has(card.number)) continue;
    seen.add(card.number);
    (by.get(laneOf(card)) ?? by.get("maybe")).cards.push(card);
  }
  return out;
}

const tagTitle = t => (typeof t === "string" ? t : t?.title);
// Cards whose words all appear (case does not matter) in the title, "#<number>", tags, assignees' names, column
// name or description. `mine`: only cards assigned to `me` (a user id); with no `me` known none qualifies.
export function filterCards(cards, query, { mine = false, me = null } = {}) {
  const words = String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean), meId = idOf(me);
  return (cards ?? []).filter(c => {
    if (mine && !(meId && (c.assignees ?? []).some(u => u.id === meId))) return false;
    if (!words.length) return true;
    const hay = [c.title, `#${c.number}`, ...(c.tags ?? []).map(tagTitle), ...(c.assignees ?? []).map(u => u.name), c.column?.name, c.description]
      .filter(Boolean).join("\n").toLowerCase();
    return words.every(w => hay.includes(w));
  });
}

// The person's own user id out of `identity show` (its top-level id is the login's, not the user's: assignees
// carry the account user's). `account` is the slug, with or without its leading slash.
export function meFrom(identity, account) {
  const accounts = identity?.accounts ?? [], slug = s => String(s ?? "").replace(/^\//, "");
  const found = account ? accounts.find(a => slug(a.slug) === slug(account)) : null;
  return (found ?? accounts[0])?.user?.id ?? null;
}

const flat = s => String(s ?? "").replace(/\s+/g, " ").trim();

// A reference is what a hand-off puts in an agent's input (never submitted: the person presses Enter).
// One line: Fizzy board "Roadmap" (https://app.fizzy.do/111/boards/00000000000000000000000b1)
export function boardRef(board) {
  return `Fizzy board "${flat(board.name)}"${board.url ? ` (${board.url})` : ""}`;
}

// What the bar hands over is a card, or (in the Board view with no card open or picked) the board shown: { kind: "board", id, name, url }.
// One line: Fizzy #4242 "Fix the login redirect" (https://app.fizzy.do/111/cards/4242)
export function ref(card) {
  if (card?.kind === "board") return boardRef(card);
  return `Fizzy #${card.number} "${flat(card.title)}"${card.url ? ` (${card.url})` : ""}`;
}
export const refs = cards => (cards ?? []).map(ref).join("\n");

// A tab's name for "Start new session": "#4242 Fix the login redirect…" (a board: its name), cut at 32 characters.
export function tabName(card) {
  const chars = [...(card?.kind === "board" ? flat(card.name) : `#${card.number} ${flat(card.title)}`.trim())];
  return chars.length > 32 ? `${chars.slice(0, 31).join("").trimEnd()}…` : chars.join("");
}

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = s => s.replace(/[&<>"']/g, c => ESCAPES[c]);

const MENTION_TYPE = "application/vnd.actiontext.mention";
// An attachment in Fizzy's rich text: [1] its attributes, [2] what Fizzy put inside. A mention's inside is the person's photo,
// <img title="<name>" src="/<account>/users/<user id>/avatar">, and their first name.
const ATTACHMENT = /<action-text-attachment\b([^>]*)>([\s\S]*?)<\/action-text-attachment\s*>/gi;
// Fizzy draws an attachment as a <figure> inside it. In a paragraph the figure can't stay there, so Fizzy's HTML closes the
// paragraph before it: the attachment comes out empty, its figure (image, name, size, Download) after it, then an empty <p></p>.
const PUSHED_FIGURE = /(<action-text-attachment\b[^>]*>\s*<\/action-text-attachment\s*>\s*<\/p\s*>)\s*<figure\b[^>]*>[\s\S]*?<\/figure\s*>(?:\s*<p>\s*<\/p\s*>)?/gi;
const withoutPushedFigures = html => String(html ?? "").replace(PUSHED_FIGURE, "$1");
const attrOf = (attrs, name) => new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`, "i").exec(attrs)?.[1];

// A mention's { sgid, user }, or null for any other attachment. The user id is in the photo's address, else in the sgid, whose
// part before "--" is base64 JSON naming gid://…/User/<user id>.
function mentionOf(attrs, inner) {
  if (attrOf(attrs, "content-type") !== MENTION_TYPE) return null;
  const sgid = decode(attrOf(attrs, "sgid") ?? "");
  if (!sgid) return null;
  let user = /\/users\/([A-Za-z0-9_-]+)\/avatar\b/.exec(inner)?.[1];
  if (!user) {
    try { user = /\/User\/([A-Za-z0-9_-]+)/.exec(atob(sgid.split("--")[0]))?.[1]; } catch { /* no base64 in it: no user */ }
  }
  return { sgid, user: user ?? null };
}

// The mentions in Fizzy's HTML whose person is known: [{ user, sgid }].
export function mentionsIn(html) {
  return [...String(html ?? "").matchAll(ATTACHMENT)].map(m => mentionOf(m[1], m[2])).filter(m => m?.user);
}

// A mention's person's name: the photo's title, else the people list's, else what Fizzy wrote inside it (the first name).
function mentionName(found, inner, users) {
  const title = attrOf(/<img\b[^>]*>/i.exec(inner)?.[0] ?? "", "title");
  return flat(title ? decode(title) : (users ?? []).find(u => u.id === found.user)?.name || decode(inner.replace(/<[^>]*>/g, "")));
}

const mentionHtml = sgid => `<action-text-attachment sgid="${escapeHtml(sgid)}" content-type="${MENTION_TYPE}"></action-text-attachment>`;
const attachmentHtml = sgid => `<action-text-attachment sgid="${escapeHtml(sgid)}"></action-text-attachment>`;

// A short steady name for a string (an attachment's sgid, an image's address): 16 hex digits.
export function shortHash(s) {
  let a = 0x811c9dc5, b = 0x9747b28c;
  for (const ch of String(s ?? "")) {
    const c = ch.codePointAt(0);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

// The images Herdr draws, by content type, and their cached copy's extension.
const IMAGE_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg", "image/bmp": "bmp" };
const IMAGE_NAME = /\.(?:png|jpe?g|gif|webp|svg|bmp|heic|heif|avif|tiff?)$/i;
// Is this a file name the image cache can hold: shortHash's and an extension of IMAGE_TYPES?
export const isCachedFile = name => typeof name === "string" && /^[0-9a-f]{16}\.(?:png|jpg|gif|webp|svg|bmp)$/.test(name);
// The extensions herdr-inline-markdown opens (its MARKDOWN_EXT).
export const isMarkdownName = name => /\.(?:md|markdown|mdown|mkd|mkdn|mdx)$/i.test(String(name ?? ""));

// A file in Fizzy's rich text, out of an attachment's attributes (or an <img>'s, with its `src` as `url`): { key, sgid, url,
// filename, type, size, width, height, caption, image, ext, remote }, or null for Fizzy's own kinds of attachment and a link
// to a page. `key` names its cached copy; `image`: it is drawn; `ext`: the cached copy's extension, which a remote image (an
// address on the web, no sgid) only gets once it is fetched.
function fileOf(attrs, url = decode(attrOf(attrs, "url") ?? "")) {
  const value = name => decode(attrOf(attrs, name) ?? "");
  const sgid = value("sgid"), type = value("content-type").toLowerCase(), remote = !sgid && /^https?:\/\//i.test(url);
  if (/^application\/vnd\.actiontext\./.test(type) || !(sgid || url) || (remote && type && !type.startsWith("image"))) return null;
  const number = name => Number(value(name)) || null, ext = remote ? null : IMAGE_TYPES[type] ?? null;
  return {
    key: shortHash(sgid || url), sgid: sgid || null, url: url || null, type,
    filename: flat(value("filename") || value("alt") || (remote ? url.split(/[?#]/)[0].split("/").pop() : "")) || "attachment",
    size: number("filesize"), width: number("width"), height: number("height"), caption: flat(value("caption")),
    image: remote || Boolean(ext), ext, remote,
  };
}

// The token a text box shows an attachment as; textToHtml writes it back as that attachment. `type`: its content type, if known.
export function fileToken(sgid, filename, type = "") {
  const label = flat(filename) || "attachment";
  return { id: `file:${sgid}`, text: `${/^image\//i.test(type) || IMAGE_NAME.test(label) ? "🖼" : "📎"} ${label}`, label };
}

// "820 KB", "3.4 MB"; "" when the size isn't known.
export function fileSize(bytes) {
  if (!(bytes > 0)) return "";
  return bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
}

// A link in Fizzy's rich text: [1] its attributes, [2] its text. One whose path is /<account>/cards/<n> is a card reference.
const LINK = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
const linkedCard = attrs => {
  const n = /^(?:https?:\/\/[^/]+)?\/[^/?#]+\/cards\/(\d+)\/?(?:[?#]|$)/i.exec(decode(attrOf(attrs, "href") ?? ""))?.[1];
  return n ? Number(n) : null;
};
const linkText = inner => decode(inner.replace(/<[^>]*>/g, ""));

// "#<n> <title>". `text` is the title, or a link's text, which already starts with the number when Fizzy's picker wrote it.
function cardLabel(n, text) {
  const t = flat(text);
  if (new RegExp(`^#${n}(?!\\d)`).test(t)) return t;
  return t && !/^https?:\/\//i.test(t) ? `#${n} ${t}` : `#${n}`;
}

// The tokens a text box shows a person and a card reference as.
export const personToken = (id, name) => ({ id: `user:${id}`, text: `@${flat(name)}`, label: flat(name) });
export function cardToken(number, text) {
  const label = cardLabel(number, text);
  return { id: `card:${number}`, text: label, label };
}

// A card's address, made from another card's of the same account (`base`), or null when `base` is not a card's.
export function cardUrl(base, n) {
  const m = /^(https?:\/\/[^?#]*\/cards\/)\d+\/?$/.exec(String(base ?? ""));
  return m ? `${m[1]}${n}` : null;
}

// Private-use characters stand in for tokens while the text around them is converted; any the text brings itself are dropped.
const SLOT = /(\d+)/g;
const slotFree = s => s.replace(/[]/g, "");

const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// "@<name>" for the people's names, each written by `form`: the longest name that fits first, any case, not inside a word.
// [1] is what comes before the "@", [2] the name; `by` finds the person by that name in lower case.
function atNames(people, form) {
  const by = new Map();
  for (const p of people ?? []) if (p?.name) by.set(form(p.name).toLowerCase(), p);
  if (!by.size) return null;
  const names = [...by.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|");
  return { by, at: new RegExp(`(^|[^\\p{L}\\p{N}_])@(${names})(?![\\p{L}\\p{N}_])`, "giu") };
}

// The people ([{ name }]) that `text` names as "@<name>".
export function mentionsOf(text, people) {
  const found = atNames(people, name => name);
  if (!found) return [];
  return [...new Set([...String(text ?? "").matchAll(found.at)].map(m => found.by.get(m[2].toLowerCase())).filter(Boolean))];
}

// Escaped text -> the same with each "@<name>" of a person who has an sgid as their mention.
function mentioning(people) {
  const found = atNames(people, escapeHtml);
  if (!found) return html => html;
  return html => html.replace(found.at, (whole, before, name) => {
    const sgid = found.by.get(name.toLowerCase())?.sgid;
    return sgid ? `${before}${mentionHtml(sgid)}` : whole;
  });
}

// A text box's token as HTML: a person ("user:<id>") is their mention when `people` has their sgid, a card ("card:<n>") a link
// to `hrefOf(n)`, a file ("file:<sgid>") its attachment; else null, and its text stays text.
function tokenHtml({ id, text }, people, hrefOf) {
  if (String(id).startsWith("file:")) return attachmentHtml(String(id).slice("file:".length));
  const [kind, key] = String(id).split(":");
  const sgid = kind === "user" ? people.find(p => p.id === key)?.sgid : null;
  if (sgid) return mentionHtml(sgid);
  const href = kind === "card" ? hrefOf(Number(key)) : null;
  return href ? `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>` : null;
}

const BULLET_LINE = /^[ \t]*[•*-][ \t]+(\S.*)$/;

function paragraphHtml(paragraph, mention) {
  const runs = [];
  for (const line of paragraph.split("\n")) {
    const item = BULLET_LINE.exec(line), list = Boolean(item), last = runs.at(-1);
    if (last?.list === list) last.lines.push(item ? item[1] : line);
    else runs.push({ list, lines: [item ? item[1] : line] });
  }
  const html = text => mention(escapeHtml(text));
  return runs.map(({ list, lines }) => list
    ? `<ul>${lines.map(l => `<li>${html(l.trimEnd())}</li>`).join("")}</ul>`
    : `<p>${lines.map(l => html(l)).join("<br>")}</p>`).join("");
}

// What the person typed -> the HTML Fizzy takes: blank lines split paragraphs, a single line break is <br>, a run of
// lines starting "• ", "- " or "* " is a list. `people` ([{ id, name, sgid }]): "@<name>" becomes that person's mention; one
// with no sgid stays text. `tokens` (a text box's [{ range, token }]) go in where they stand, as tokenHtml writes them.
export function textToHtml(text, people = [], tokens = [], hrefOf = () => null) {
  const source = String(text ?? ""), spans = [...tokens].sort((a, b) => a.range.start - b.range.start);
  let slotted = "", at = 0;
  spans.forEach((s, i) => {
    slotted += `${slotFree(source.slice(at, s.range.start))}${i}`;
    at = Math.max(at, s.range.end);
  });
  const t = (slotted + slotFree(source.slice(at))).replace(/\r\n?/g, "\n").trim();
  if (!t) return "";
  const mention = mentioning(people);
  return t.split(/\n(?:[ \t]*\n)+/).map(p => p.trim()).filter(Boolean).map(p => paragraphHtml(p, mention)).join("")
    .replace(SLOT, (_m, i) => tokenHtml(spans[i].token, people, hrefOf) ?? escapeHtml(spans[i].token.text));
}

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = s => s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos|nbsp));/gi, (m, dec, hex, name) => {
  if (name) return NAMED[name.toLowerCase()];
  const cp = dec ? Number(dec) : parseInt(hex, 16);
  return cp > 0 && cp <= 0x10ffff && (cp < 0xd800 || cp > 0xdfff) ? String.fromCodePoint(cp) : m;
});

// Fizzy's HTML -> plain text for a text box: line ends where a line, paragraph, item or heading ends (a paragraph
// and a list leave a blank line), list items get a bullet, other tags go. Newlines and indentation in the source are only
// white space, as in a browser (Fizzy pretty-prints its HTML). Tags are removed before entities are read, so
// "&lt;b&gt;" stays the text "<b>". The answer is a text box's content, { text, tokens }: a mention is the token "@<full name>"
// (`users`, [{ id, name }], names the person its photo doesn't), a link to a card the token "#<n> <title>", another attachment
// the token fileToken makes, which ends its paragraph.
export function htmlToContent(html, users = []) {
  const found = [], slot = token => `${found.push(token) - 1}`;
  const text = decode(slotFree(withoutPushedFigures(html))
    .replace(/\s+/g, " ")
    .replace(ATTACHMENT, (whole, attrs, inner) => {
      const mention = mentionOf(attrs, inner);
      if (!mention) {
        const sgid = decode(attrOf(attrs, "sgid") ?? "");
        return sgid ? `<p>${slot(fileToken(sgid, decode(attrOf(attrs, "filename") ?? ""), attrOf(attrs, "content-type")))}</p>` : whole;
      }
      const name = mentionName(mention, inner, users);
      return !name ? "" : mention.user ? slot(personToken(mention.user, name)) : escapeHtml(`@${name}`);
    })
    .replace(LINK, (whole, attrs, inner) => {
      const n = linkedCard(attrs);
      return n ? slot(cardToken(n, linkText(inner))) : whole;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|ul|ol)\s*>/gi, "\n\n")
    .replace(/<\/(?:div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<[^>]*>/g, ""))
    .replace(/\r\n?/g, "\n").replace(/[ \t]*\n[ \t]*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const out = { text: "", tokens: [] };
  let last = 0;
  for (const m of text.matchAll(SLOT)) {
    const token = found[m[1]];
    if (!token) continue;
    out.text += text.slice(last, m.index);
    out.tokens.push({ range: { start: out.text.length, end: out.text.length + token.text.length }, token });
    out.text += token.text;
    last = m.index + m[0].length;
  }
  out.text += text.slice(last);
  return out;
}

export const htmlToText = (html, users = []) => htmlToContent(html, users).text;

const BLOCK_TAG = /^(?:p|div|table|tr|figure|figcaption|hr|section|article|header|footer|details|summary|dl|dt|dd|address)$/;

// Fizzy's rich text -> the lines the panel draws: [{ runs, depth, marker, quote, heading, pre, gap }]. `depth`: how many lists it
// sits in; `marker`: a list item's "•" or "<n>."; `gap`: a block, not a line break, ends before it. A run is { text, kind: "text" |
// "link" | "mention" | "card", bold, italic, code, href?, user?, number? }: a mention is "@<full name>" (`users` names the person
// its photo doesn't), a link to a card "#<n> <title>", each one run. A file (an attachment, or an <img> from the web) is a line of
// its own, { file, gap } (see fileOf); another attachment with an address is a link to it.
export function richLines(html, users = []) {
  const atoms = [], slot = run => `${atoms.push(run) - 1}`;
  const source = slotFree(withoutPushedFigures(html))
    .replace(ATTACHMENT, (whole, attrs, inner) => {
      const mention = mentionOf(attrs, inner);
      if (mention) {
        const name = mentionName(mention, inner, users);
        return name ? slot({ text: `@${name}`, kind: "mention", user: mention.user }) : "";
      }
      const file = fileOf(attrs);
      if (file) return slot({ file });
      const url = attrOf(attrs, "url");
      return url ? slot({ text: decode(attrOf(attrs, "filename") || "attachment"), kind: "link", href: decode(url) }) : inner;
    })
    .replace(LINK, (whole, attrs, inner) => {
      const n = linkedCard(attrs);
      return n ? slot({ text: cardLabel(n, linkText(inner)), kind: "card", number: n }) : whole;
    });
  const lines = [], lists = [], links = [], on = { bold: 0, italic: 0, code: 0 };
  let line = null, gap = false, marker = null, quote = 0, heading = false, pre = false;
  const end = block => {
    if (line) {
      const last = line.runs.at(-1);
      if (!line.pre) last.text = last.text.trimEnd();
      if (line.runs.some(r => r.text)) lines.push(line);
      line = null;
    }
    gap ||= block;
  };
  const add = run => {
    if (!line) {
      if (!pre) run.text = run.text.trimStart();
      if (!run.text) return;
      line = { runs: [], depth: lists.length, marker, quote: quote > 0, heading, pre, gap };
      marker = null; gap = false;
    } else if (!pre && line.runs.at(-1).text.endsWith(" ") && run.text.startsWith(" ")) run.text = run.text.slice(1);
    if (run.text) line.runs.push(run);
  };
  const fileLine = file => {
    end(true);
    lines.push({ runs: [], file, depth: lists.length, marker: null, quote: quote > 0, heading: false, pre: false, gap: true });
  };
  const styled = run => ({ ...run, bold: on.bold > 0 || heading, italic: on.italic > 0, code: on.code > 0 || pre });
  const words = raw => {
    const s = pre ? decode(raw) : decode(raw).replace(/\s+/g, " ");
    s.split("\n").forEach((part, i) => {
      if (i) end(false);
      if (part) add(styled({ text: part, kind: links.at(-1) ? "link" : "text", ...(links.at(-1) ? { href: links.at(-1) } : {}) }));
    });
  };
  const text = raw => {
    let last = 0;
    for (const m of raw.matchAll(SLOT)) {
      words(raw.slice(last, m.index));
      const atom = atoms[m[1]];
      if (atom.file) fileLine(atom.file);
      else add(styled({ ...atom }));
      last = m.index + m[0].length;
    }
    words(raw.slice(last));
  };
  const bump = (key, close) => { on[key] = Math.max(0, on[key] + (close ? -1 : 1)); };
  const tag = (close, name, attrs) => {
    if (name === "br") end(false);
    else if (name === "b" || name === "strong") bump("bold", close);
    else if (name === "i" || name === "em") bump("italic", close);
    else if (name === "code") bump("code", close);
    else if (name === "a") { if (close) links.pop(); else links.push(decode(attrOf(attrs, "href") ?? "") || null); }
    else if (name === "ul" || name === "ol") {
      if (close) { lists.pop(); end(!lists.length); }
      else { end(!lists.length); lists.push({ ordered: name === "ol", n: 0 }); }
    } else if (name === "li") {
      end(false);
      const list = lists.at(-1);
      marker = close ? null : list?.ordered ? `${++list.n}.` : "•";
    } else if (/^h[1-6]$/.test(name)) { end(true); heading = !close; }
    else if (name === "blockquote") { end(true); quote = Math.max(0, quote + (close ? -1 : 1)); }
    else if (name === "pre") { end(true); pre = !close; }
    else if (name === "img") {
      const src = decode(attrOf(attrs, "src") ?? ""), file = /^https?:\/\//i.test(src) ? fileOf(attrs, src) : null;
      if (file) fileLine(file);
    } else if (BLOCK_TAG.test(name)) end(true);
  };
  let last = 0;
  for (const m of source.matchAll(/<!--[\s\S]*?-->|<(\/?)([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
    text(source.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[2]) tag(m[1] === "/", m[2].toLowerCase(), m[3]);
  }
  text(source.slice(last));
  end(true);
  return lines;
}

export function textLines(text) {
  const t = String(text ?? "").replace(/\r\n?/g, "\n").trim();
  return t ? t.split("\n") : [];
}

const SPLIT_TAG = /^(?:p|div|h[1-6])$/;
const WRAP_TAG = /^(?:li|blockquote|section|article|aside|header|footer|nav|main|figcaption|dd|address)$/;
const OPAQUE_TAGS = new Set(["ul", "ol", "pre", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "figure", "details", "summary", "dl", "dt", "hr",
  "form", "fieldset"]);
const VOID_TAGS = new Set(["area", "base", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const TAG_NAME = /^<(\/?)([a-z][a-z0-9-]*)/i;
const tagKind = name => (SPLIT_TAG.test(name) ? "split" : WRAP_TAG.test(name) ? "wrap" : OPAQUE_TAGS.has(name) ? "opaque" : "inline");
const newFrame = (name, open, kind) => ({ name, open, kind, hasContent: false, wrapped: false, closed: false, runStart: 0, pending: null });

// Fizzy's HTML in a shape TextView draws right. TextView ignores <br> and runs its lines together, so each <br> becomes
// the boundary of its own block: a p, div or heading is closed and reopened, a li, blockquote or other flow container
// gets p's inside, and loose text gets p's. A <br> in a pre is a newline (the same break, and the one a code block is
// drawn with); in a table, a list, a figure, details, summary or dt it stays. A <br> that would leave an empty
// block (first, last, repeated) goes; other markup stays. The break waits (`pending`) until content follows, so what
// comes between it and that content (inline tags, comments, white space) moves into the new block with the content.
export function htmlForView(html) {
  const source = String(html ?? "");
  if (!/<br\b/i.test(source)) return source;
  const out = [];
  const stack = [newFrame("", "", "wrap")];
  const hostAt = () => {
    let i = stack.length - 1;
    while (stack[i].kind === "inline") i--;
    return i;
  };
  // While a break waits, what comes in is held with the inline frame it opens or closes (`role`), if any.
  const emit = (raw, frame, role) => {
    const held = stack[hostAt()].pending?.held;
    if (held) held.push({ raw, frame, role });
    else out.push(raw);
  };
  const release = frame => {
    if (frame.pending) out.push(...frame.pending.held.map(h => h.raw));
    frame.pending = null;
  };
  const unwrap = frame => {
    if (frame.wrapped) out.push("</p>");
    frame.wrapped = false;
  };
  const settle = frame => { release(frame); unwrap(frame); };
  // The tags that were open at the break are closed before it and, if still open, reopened after it. Held tags carry over
  // as they came, but not the closes of those (already closed) nor the opens of frames that never got closed or stayed open.
  const carried = ({ frame, role }, open) => {
    if (role === "close") return !open.includes(frame);
    if (role === "open") return frame.closed || stack.includes(frame);
    return true;
  };
  const breakBlock = frame => {
    const { held, inline: open } = frame.pending;
    frame.pending = null;
    out.push(...open.map(f => `</${f.name}>`).reverse());
    if (frame.kind === "wrap") {
      if (!frame.wrapped) out.splice(frame.runStart, 0, "<p>");
      frame.wrapped = true;
      out.push("</p><p>");
    } else out.push(`</${frame.name}>`, frame.open);
    out.push(...open.filter(f => stack.includes(f)).map(f => f.open));
    out.push(...held.filter(h => carried(h, open)).map(h => h.raw));
  };
  const content = raw => {
    const frame = stack[hostAt()];
    if (frame.pending) breakBlock(frame);
    frame.hasContent = true;
    out.push(raw);
  };
  const text = chunk => {
    if (chunk) (/\S/.test(chunk) ? content : emit)(chunk);
  };
  const lineBreak = raw => {
    const index = hostAt(), frame = stack[index];
    if (frame.kind === "opaque") emit(frame.name === "pre" ? "\n" : raw);
    else if (frame.hasContent && !frame.pending) frame.pending = { held: [], inline: stack.slice(index + 1) };
  };
  const openBlock = (raw, name, kind, selfClosed) => {
    const frame = stack[hostAt()];
    settle(frame);
    frame.hasContent = false;
    out.push(raw);
    if (frame.kind === "wrap") frame.runStart = out.length;
    if (selfClosed) return;
    const block = newFrame(name, raw, kind);
    block.runStart = out.length;
    stack.push(block);
  };
  const closeTag = (raw, name, kind) => {
    let i = stack.length - 1;
    while (i > 0 && stack[i].name !== name) i--;
    if (i === 0 || (kind === "inline" && i < hostAt())) return emit(raw);
    if (kind === "inline") {
      emit(raw, stack[i], "close");
      stack[i].closed = true;
      stack.length = i;
      return;
    }
    while (stack.length - 1 > i) settle(stack.pop());
    settle(stack[i]);
    out.push(raw);
    stack.length = i;
    const parent = stack[hostAt()];
    parent.hasContent = false;
    parent.runStart = out.length;
  };
  const tag = raw => {
    const found = TAG_NAME.exec(raw);
    if (!found) return /^<[!?]/.test(raw) ? emit(raw) : text(raw);
    const name = found[2].toLowerCase(), kind = tagKind(name);
    if (found[1]) return closeTag(raw, name, kind);
    if (name === "br") return lineBreak(raw);
    const selfClosed = VOID_TAGS.has(name) || raw.endsWith("/>");
    if (kind !== "inline") return openBlock(raw, name, kind, selfClosed);
    if (!selfClosed) {
      const frame = newFrame(name, raw, kind);
      stack.push(frame);
      return emit(raw, frame, "open");
    }
    return name === "wbr" ? emit(raw) : content(raw);
  };
  let last = 0;
  for (const m of source.matchAll(/<[a-z/!?][^<>]*>/gi)) {
    text(source.slice(last, m.index));
    tag(m[0]);
    last = m.index + m[0].length;
  }
  text(source.slice(last));
  while (stack.length) settle(stack.pop());
  return out.join("");
}

// Whether saving this HTML as plain text (textToHtml) would lose something: any tag but the p, br, ul and li that
// textToHtml writes, the mentions, attachments and card links it writes back, the div Fizzy wraps it in and a plain ol; a
// list inside a list item loses its nesting.
export const formatted = html => {
  const s = withoutPushedFigures(html).replace(ATTACHMENT, (whole, attrs, inner) => (mentionOf(attrs, inner) || attrOf(attrs, "sgid") ? "" : whole))
    .replace(LINK, (whole, attrs) => (linkedCard(attrs) ? "" : whole));
  return /<\/?(?!(?:p|br|div|ul|ol|li)\b)[a-z]/i.test(s) || /<li\b(?:(?!<\/li\b)[\s\S])*<(?:ul|ol)\b/i.test(s);
};

// "Ada" -> "A", "Grace Brewster Hopper" -> "GH" (first and last word), "Helper (Bot)" -> "H", nobody -> "?".
export function initials(name) {
  const words = String(name ?? "").replace(/\([^)]*\)/g, " ").split(/\s+/).map(w => w.replace(/^[^\p{L}\p{N}]+/u, "")).filter(Boolean);
  if (!words.length) return "?";
  const letter = w => [...w][0];
  return (letter(words[0]) + (words.length > 1 ? letter(words[words.length - 1]) : "")).toUpperCase();
}

// A steady 0..7 for a string (an avatar's color).
export function hue(id) {
  let h = 0;
  for (const ch of String(id ?? "")) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h % 8;
}

// Fizzy's avatar URLs need no sign-in (they redirect to a signed link that lasts 300 s), and image() only draws files, so
// each photo is fetched once into the app's folder and drawn from there.
// AVATAR_SCRIPT fetches "$1" (an http(s) URL) into the folder "$2" as "$3.<ext>" and prints that file name. "$3" is "<user id>-<YYYYMMDD>":
// the extension comes from the content type (png, jpg, webp, svg, gif; anything else, an error page for one, fails), and the
// same user's other files (an older day, another format) are deleted once the new one is in place. It writes only in "$2", a
// half-done download is "$2/.$3.part" and is removed on any failure, and it exits non-zero on any failure. Plain POSIX sh
// (curl is the one program it runs besides mkdir, mv, rm, tr), run as sh -c SCRIPT fizzy <url> <folder> <base>.
export const AVATAR_SCRIPT = `case $1 in http://*|https://*) ;; *) exit 1;; esac
d=$2; b=$3
case $b in *[!A-Za-z0-9_-]*) exit 1;; esac
case $b in [A-Za-z0-9_]*-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]) ;; *) exit 1;; esac
u=\${b%-*}; p="$d/.$b.part"
mkdir -p "$d" || exit 1
t=$(curl -sfL --max-time 20 --max-filesize 4194304 --proto '=http,https' --proto-redir '=http,https' -o "$p" -w '%{content_type}' "$1") || { rm -f "$p"; exit 1; }
t=$(printf %s "$t" | tr 'A-Z' 'a-z')
case $t in
  image/png*) e=png;;
  image/jpeg*|image/jpg*) e=jpg;;
  image/webp*) e=webp;;
  image/svg+xml*) e=svg;;
  image/gif*) e=gif;;
  *) rm -f "$p"; exit 1;;
esac
[ -s "$p" ] || { rm -f "$p"; exit 1; }
mv -f "$p" "$d/$b.$e" || { rm -f "$p"; exit 1; }
for f in "$d/$u"-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9].*; do
  [ -e "$f" ] || continue
  case $f in "$d/$b.$e") ;; *) rm -f "$f";; esac
done
echo "$b.$e"`;

// A photo's file name without its extension: the user's id and the day it was fetched ("0000000000000000000000001-20250115").
// The name changes with every download, so Herdr's own image cache never shows an old photo.
export function avatarBase(id, at = Date.now()) {
  const day = new Date(at).toISOString().slice(0, 10).replace(/-/g, "");
  return `${String(id).replace(/[^A-Za-z0-9_]/g, "_")}-${day}`;
}
// Is this a file name AVATAR_SCRIPT can have printed (what the index keeps, and what an image path is built from)?
export const isAvatarFile = name => typeof name === "string" && /^[A-Za-z0-9_]+-\d{8}\.(?:png|jpg|webp|svg|gif)$/.test(name);

// IMAGE_SCRIPT fetches "$1" (an image on the web) into the folder "$2" as "$3.<ext>" and prints that file name. "$3" is a
// shortHash; the extension comes from the content type, and anything but an image Herdr draws, or one over IMAGE_MAX bytes, fails.
// A half-done download is "$2/.$3.part", removed on any failure. Plain POSIX sh, run as sh -c SCRIPT fizzy <url> <folder> <base>.
export const IMAGE_SCRIPT = `case $1 in http://*|https://*) ;; *) exit 1;; esac
case $3 in ''|*[!0-9a-f]*) exit 1;; esac
p="$2/.$3.part"
mkdir -p "$2" || exit 1
t=$(curl -sfL --max-time 25 --max-filesize ${IMAGE_MAX} --proto '=http,https' --proto-redir '=http,https' -o "$p" -w '%{content_type}' "$1") || { rm -f "$p"; exit 1; }
case $(printf %s "$t" | tr 'A-Z' 'a-z') in
  image/png*) e=png;;
  image/jpeg*|image/jpg*) e=jpg;;
  image/gif*) e=gif;;
  image/webp*) e=webp;;
  image/svg+xml*) e=svg;;
  image/bmp*) e=bmp;;
  *) rm -f "$p"; exit 1;;
esac
[ -s "$p" ] && mv -f "$p" "$2/$3.$e" || { rm -f "$p"; exit 1; }
echo "$3.$e"`;

// CLIP_SCRIPT writes the clipboard's image to the file "$1" as a PNG: through osascript on macOS, else wl-paste or xclip. It exits
// non-zero, leaving no file, when the clipboard holds no image or none of these programs can read it. Run as sh -c SCRIPT fizzy <file>.
export const CLIP_SCRIPT = `f=$1
if [ "$(uname -s)" = Darwin ]; then
  osascript -e 'on run argv' -e 'set d to the clipboard as «class PNGf»' -e 'set h to open for access (POSIX file (item 1 of argv)) with write permission' \\
    -e 'set eof h to 0' -e 'write d to h' -e 'close access h' -e 'end run' "$f" >/dev/null 2>&1
else
  wl-paste --type image/png >"$f" 2>/dev/null || xclip -selection clipboard -t image/png -o >"$f" 2>/dev/null
fi
[ -s "$f" ] || { rm -f "$f"; exit 1; }`;

// OPEN_SCRIPT opens the file "$2" with the system's own program ("$1" is open), or shows it in its folder ("$1" is reveal: Finder
// on macOS, else the folder itself). Run as sh -c SCRIPT fizzy <open|reveal> <path>.
export const OPEN_SCRIPT = `f=$2
if [ "$(uname -s)" = Darwin ]; then
  [ "$1" = reveal ] && exec open -R "$f"
  exec open "$f"
fi
[ "$1" = reveal ] && f=$(dirname "$f")
exec xdg-open "$f"`;

// FREE_NAME_SCRIPT prints the path, in the folder "$1" (made when missing), of a file named "$2$3" (a name with no slash, an
// extension with its dot) that is not there yet: "$2$3", else "$2 (2)$3", "$2 (3)$3" and so on. Run as sh -c SCRIPT fizzy
// <folder> <name> <extension>.
export const FREE_NAME_SCRIPT = `d=$1; b=$2; e=$3
case $b$e in ''|.|..) exit 1;; esac
mkdir -p "$d" || exit 1
p="$d/$b$e"; i=2
while [ -e "$p" ]; do p="$d/$b ($i)$e"; i=$((i + 1)); done
printf %s "$p"`;

// WRITE_SCRIPT writes the text "$2" to the file "$1", making its folder. Run as sh -c SCRIPT fizzy <path> <text>.
export const WRITE_SCRIPT = 'mkdir -p "${1%/*}" && printf %s "$2" > "$1"';

// Where a card's file is kept (under the app's folder): what dragging the card into a terminal drops there. It is named
// "#<n> <title>.md", the title cut at 60 characters, as Herdr shows that name under the pointer while it is dragged.
export function cardFile(card) {
  const title = [...flat(card.title).replace(/[\u0000-\u001f\u007f]/g, "").replace(/[/\\]/g, "-")].slice(0, 60).join("").trim();
  return `${FILE_DIR}/cards/#${card.number}${title ? ` ${title}` : ""}.md`;
}

// A card as markdown, for an agent to start on without asking Fizzy: title, board, lane, tags, people, link, description and
// steps (a card from a list has none until it is opened).
export function cardMarkdown(card) {
  const names = list => (list ?? []).map(x => flat(typeof x === "string" ? x : x?.title ?? x?.name)).filter(Boolean).join(", ");
  const tags = names(card.tags), people = names(card.assignees), description = String(card.description ?? "").trim();
  const facts = [
    card.board?.name && `Board: ${flat(card.board.name)}`,
    `Lane: ${laneName(card)}`,
    tags && `Tags: ${tags}`,
    people && `Assigned to: ${people}`,
    card.url && `Link: ${card.url}`,
  ].filter(Boolean);
  const steps = (card.steps ?? []).map(s => `- [${s.completed ? "x" : " "}] ${flat(s.content)}`);
  return [
    `# Fizzy #${card.number}: ${flat(card.title)}`, "", ...facts,
    ...(description ? ["", description] : []),
    ...(steps.length ? ["", "## Steps", ...steps] : []),
  ].join("\n") + "\n";
}

// Every user in what the CLI answered that has a photo, once each: [{ id, url }] (assignees, creators, authors, the people list).
export function photosIn(data) {
  const found = new Map();
  const walk = (x, depth) => {
    if (!x || typeof x !== "object" || depth > 8) return;
    if (Array.isArray(x)) { for (const y of x) walk(y, depth + 1); return; }
    if (typeof x.id === "string" && x.id && typeof x.avatar_url === "string" && /^https?:\/\//.test(x.avatar_url)) {
      if (!found.has(x.id)) found.set(x.id, x.avatar_url);
      return;
    }
    for (const v of Object.values(x)) walk(v, depth + 1);
  };
  walk(data, 0);
  return [...found].map(([id, url]) => ({ id, url }));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const stamp = x => (x instanceof Date ? x.getTime() : typeof x === "number" ? x : new Date(x).getTime());
// How long ago: "now", "5m", "3h", "2d", then the date ("Mar 4", with the year when it isn't this one).
export function ago(iso, now) {
  const t = stamp(iso), n = stamp(now ?? Date.now());
  if (!iso || Number.isNaN(t) || Number.isNaN(n)) return "";
  const min = Math.floor((n - t) / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d`;
  const at = new Date(t), day = `${MONTHS[at.getMonth()]} ${at.getDate()}`;
  return at.getFullYear() === new Date(n).getFullYear() ? day : `${day}, ${at.getFullYear()}`;
}

const DAY = 86400000;
const dayStart = ms => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
// Fizzy's warning on an open card that is not postponed, as its card bubble decides it: "Closes in N days" once fewer days
// than a quarter of the board's auto-postpone period (`period`, in days) are left, counted in calendar days; else "Stalled"
// when Fizzy lists the card as stalled. { kind: "closing" | "stalled", label } or null.
export function inactivity(card, { period, stalled = false, now }) {
  if (card?.closed || card?.postponed) return null;
  const last = stamp(card?.last_active_at);
  if (period > 0 && !Number.isNaN(last)) {
    const left = Math.round((dayStart(last + period * DAY) - dayStart(stamp(now))) / DAY);
    if (left < Math.round(period * 0.25)) return { kind: "closing", label: left < 1 ? "Closes today" : `Closes in ${left}d` };
  }
  return stalled ? { kind: "stalled", label: "Stalled" } : null;
}

// Walks from "$1" up to / and prints the `board:` line of the first .fizzy.yaml it finds, and nothing else of the file (it may
// hold a token), also behind a UTF-8 byte-order mark; exits 1 when there is no such file or line (or "$1" is not an absolute
// path). Only `[`, `printf` and `grep`: it reads, never writes. Plain POSIX sh, run as sh -c SCRIPT fizzy <folder>.
export const YAML_SCRIPT = "d=$1; case $d in /*) ;; *) exit 1;; esac; bom=$(printf '\\357\\273\\277'); while :; do while :; do case $d in */) d=${d%/};; *) break;; esac; done; if [ -f \"$d/.fizzy.yaml\" ]; then grep -E \"^($bom)?board[ \t]*:\" \"$d/.fizzy.yaml\"; exit; fi; [ -n \"$d\" ] || exit 1; d=${d%/*}; done";

// One value after "key:": quotes come off (and what follows the closing quote, a comment, is dropped); an
// unquoted value ends where " #" starts.
function scalar(raw) {
  const s = raw.trim(), q = s[0];
  if (q !== '"' && q !== "'") return s.replace(/(^|\s)#.*$/, "").trim();
  let out = "";
  for (let i = 1; i < s.length; i++) {
    const c = s[i];
    if (q === '"' && c === "\\" && i + 1 < s.length) out += s[++i];
    else if (c === q && q === "'" && s[i + 1] === "'") out += s[++i];
    else if (c === q) return out;
    else out += c;
  }
  return out;
}

// A .fizzy.yaml's top-level `board:` and `account:` (nothing else: the file may hold a token, which stays here).
export function parseYaml(text) {
  const out = {};
  for (const line of String(text ?? "").replace(/^\u{FEFF}/u, "").split(/\r?\n/)) {
    const m = /^(board|account)[ \t]*:(?:[ \t]+(.*))?$/.exec(line);
    if (!m) continue;
    const value = scalar(m[2] ?? "");
    if (value && value !== "~" && value !== "null") out[m[1]] = value;
  }
  return out;
}

// The board to show: the space's own when following, else the one picked, else the CLI's default, else the first.
// Only boards that exist count (`boards`: [{ id, name }]).
export function chooseBoard({ boards, follow, spaceBoard, picked, fallback }) {
  const has = id => !!id && (boards ?? []).some(b => b.id === id);
  if (follow && has(spaceBoard)) return spaceBoard;
  if (has(picked)) return picked;
  if (has(fallback)) return fallback;
  return boards?.[0]?.id ?? null;
}

// Board groups: how the board dropdown is organised (kept in shared state `fizzy.boardGroups`).
//   { groups: [{ id, name, match, hidden }],            ordered; `match`: "" (members are put there by hand) or a text, and a board
//                                                        whose name contains it (case does not matter) is in the group
//     boards: { [boardId]: { group?, hidden? } } }      `group`: a group's id, or null for "No group" by choice; absent: Automatic
// "Hidden" only takes a board out of the board dropdown: Mine, Search all boards, Follow current space and the board the panel
// shows are not affected. Every edit returns a NEW config (the one given is never changed); an edit that cannot be made (an empty
// name, a group that is not there) returns the config it was given.

export const defaultGroups = () => ({ groups: [], boards: {} });

// Whatever the shared state holds -> a config that can be used. Nothing saved (or something that is not a config): the default.
export function groupsConfig(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.groups)) return defaultGroups();
  const seen = new Set(), groups = [], boards = {};
  for (const g of raw.groups) {
    const name = typeof g?.name === "string" ? g.name.trim() : "";
    if (typeof g?.id !== "string" || !g.id || !name || seen.has(g.id)) continue;
    seen.add(g.id);
    groups.push({ id: g.id, name, match: typeof g.match === "string" ? g.match.trim() : "", hidden: g.hidden === true });
  }
  const saved = raw.boards && typeof raw.boards === "object" && !Array.isArray(raw.boards) ? raw.boards : {};
  for (const [id, e] of Object.entries(saved)) {
    const entry = {};
    if (e?.group === null || typeof e?.group === "string") entry.group = e.group;
    if (e?.hidden === true) entry.hidden = true;
    if (Object.keys(entry).length) boards[id] = entry;
  }
  const order = Array.isArray(raw.order) ? [...new Set(raw.order.filter(id => typeof id === "string" && id))] : [];
  return order.length ? { groups, boards, order } : { groups, boards };
}

const entryOf = (config, id) => (Object.hasOwn(config.boards ?? {}, id) ? config.boards[id] : undefined);
// Is this board hidden by its own flag (a board in a hidden group is hidden with the group, which is not this)?
export const ownHidden = (boardId, config) => entryOf(config, boardId)?.hidden === true;

// What a board's group is set to: "auto" (nothing chosen, or the group chosen is gone), null ("No group" by choice), or a group's id.
export function choiceOf(boardId, config) {
  const group = entryOf(config, boardId)?.group;
  if (group === null) return null;
  if (typeof group === "string" && config.groups.some(g => g.id === group)) return group;
  return "auto";
}

// The first group, in order, whose rule the board's name satisfies; null when none does.
export function ruleGroupOf(board, config) {
  const name = String(board?.name ?? "").toLowerCase();
  return config.groups.find(g => g.match && name.includes(g.match.toLowerCase())) ?? null;
}

// The group a board is in: the one chosen for it; when none is, the one its name's rule picks; else null.
export function groupOf(board, config) {
  const choice = choiceOf(board?.id, config);
  if (choice === null) return null;
  if (choice !== "auto") return config.groups.find(g => g.id === choice) ?? null;
  return ruleGroupOf(board, config);
}

// The boards in the order Settings gave them (`order`), then the boards it has not placed, in the list's order.
function sortBoards(boards, config) {
  const rank = new Map((config.order ?? []).map((id, i) => [id, i])), last = rank.size;
  return [...(boards ?? [])].sort((a, b) => (rank.get(a.id) ?? last) - (rank.get(b.id) ?? last));
}

// The boards as the dropdown shows them, in sortBoards' order: { ungrouped: [board], groups: [{ group, boards: [board] }] }, the groups
// in their own order. A hidden board, and a hidden group with what is in it, are left out; `withHidden` leaves nothing out.
// `keep`: a board (the one the panel shows) that is never left out, with its group (so the tick on it never vanishes).
// The third argument is `{ withHidden, keep }`, or just `true` for `withHidden`.
export function boardGroups(boards, config, options = {}) {
  const { withHidden = false, keep = null } = options && typeof options === "object" ? options : { withHidden: Boolean(options) };
  const ungrouped = [], by = new Map(config.groups.map(g => [g.id, []]));
  for (const b of sortBoards(boards, config)) {
    const group = groupOf(b, config);
    if (!withHidden && b.id !== keep && (ownHidden(b.id, config) || group?.hidden)) continue;
    (group ? by.get(group.id) : ungrouped).push(b);
  }
  const groups = config.groups.filter(g => withHidden || !g.hidden || by.get(g.id).length).map(g => ({ group: g, boards: by.get(g.id) }));
  return { ungrouped, groups };
}

const mapGroup = (config, id, fn) => (config.groups.some(g => g.id === id) ? { ...config, groups: config.groups.map(g => (g.id === id ? fn(g) : g)) } : config);

// A board's entry changed by `patch` (undefined and false take a key away; an entry with nothing left is dropped).
function withBoard(config, id, patch) {
  const entry = { ...entryOf(config, id), ...patch };
  for (const key of Object.keys(entry)) if (entry[key] === undefined || entry[key] === false) delete entry[key];
  const boards = { ...config.boards };
  if (Object.keys(entry).length) boards[id] = entry;
  else delete boards[id];
  return { ...config, boards };
}

// A new group, first, with no rule and shown. Its id is `g-<n>`, one that no group has.
export function addGroup(config, name) {
  const text = String(name ?? "").trim();
  if (!text) return config;
  let n = config.groups.length + 1;
  while (config.groups.some(g => g.id === `g-${n}`)) n++;
  return { ...config, groups: [{ id: `g-${n}`, name: text, match: "", hidden: false }, ...config.groups] };
}
export function renameGroup(config, id, name) {
  const text = String(name ?? "").trim();
  return text ? mapGroup(config, id, g => ({ ...g, name: text })) : config;
}
// The rule: "" is none.
export const setMatch = (config, id, text) => mapGroup(config, id, g => ({ ...g, match: String(text ?? "").trim() }));
export const setGroupHidden = (config, id, hidden) => mapGroup(config, id, g => ({ ...g, hidden: Boolean(hidden) }));
// The group goes; the boards that were put in it by hand go back to Automatic.
export function removeGroup(config, id) {
  const groups = config.groups.filter(g => g.id !== id);
  if (groups.length === config.groups.length) return config;
  let next = { ...config, groups };
  for (const [boardId, entry] of Object.entries(config.boards)) if (entry.group === id) next = withBoard(next, boardId, { group: undefined });
  return next;
}
// `to`: a group's id, null ("No group"), or "auto" (the rule decides again).
export function moveBoard(config, boardId, to) {
  if (to === "auto") return withBoard(config, boardId, { group: undefined });
  if (to === null || (typeof to === "string" && config.groups.some(g => g.id === to))) return withBoard(config, boardId, { group: to });
  return config;
}
// A board dropped into a group (`to`: its id) or out of every group (null). It is stored as Automatic when its name's rule would put it
// there anyway.
export function placeBoard(config, board, to) {
  const rule = ruleGroupOf(board, config)?.id ?? null;
  return moveBoard(config, board.id, to === rule ? "auto" : to);
}
// The boards, hidden ones too, in the order Settings lists them: each group's in the groups' order, then those in no group.
export function listedBoards(boards, config) {
  const { ungrouped, groups } = boardGroups(boards, config, true);
  return [...groups.flatMap(g => g.boards), ...ungrouped];
}
// A board dropped on another board's row: it joins that board's group and takes its place in the list, landing before it when it
// moves up and after it when it moves down, as moveGroup does. From then on `order` places every board.
export function placeBoardAt(config, boards, board, target) {
  const ids = listedBoards(boards, config).map(b => b.id), from = ids.indexOf(board.id), to = ids.indexOf(target.id);
  if (from < 0 || to < 0 || from === to) return config;
  ids.splice(to, 0, ...ids.splice(from, 1));
  return { ...placeBoard(config, board, groupOf(target, config)?.id ?? null), order: ids };
}
export const setBoardHidden = (config, boardId, hidden) => withBoard(config, boardId, { hidden: Boolean(hidden) });
// A group takes the position of another: it lands before the target when it moves up, after it when it moves down. An id that is not
// there, or the same id twice, changes nothing.
export function moveGroup(config, groupId, targetGroupId) {
  const from = config.groups.findIndex(g => g.id === groupId), to = config.groups.findIndex(g => g.id === targetGroupId);
  if (from < 0 || to < 0 || from === to) return config;
  const groups = [...config.groups];
  groups.splice(to, 0, ...groups.splice(from, 1));
  return { ...config, groups };
}

// The agent "Insert" goes to: the one in the focused terminal, else the one an agent block shows, else the most recently
// changed one in the tab.
export function targetAgent({ agents, focused }) {
  const list = agents ?? [];
  const at = address => (address ? list.find(a => a.address === address) : undefined);
  const direct = at(focused?.terminal) ?? at(focused?.agent);
  if (direct) return direct;
  let best = null;
  if (focused?.tab) for (const a of list) if (a.tab === focused.tab && (!best || (a.seq ?? 0) > (best.seq ?? 0))) best = a;
  return best;
}

// "Claude Code · fix login": the program's name (else what it reported, else "Agent"), then its tab.
export function agentLabel(agent) {
  const name = agent?.program?.name || agent?.app || "Agent", tab = agent?.tab_name;
  return tab && tab.toLowerCase() !== name.toLowerCase() ? `${name} · ${tab}` : name;
}

// The line under an agent in the Send popup: its space, then what it is doing ("work · idle").
export const agentHint = agent => [agent?.space_name, agent?.status].filter(Boolean).join(" · ");

export const findNode = (node, id) =>
  node?.id === id ? node : (node?.children ?? []).reduce((hit, child) => hit ?? findNode(child, id), null);
// The panel is offered by the stack `panel-body` (child `fizzy`) inside `panel`. A layout without that stack shows the
// panel wherever it was put, so it counts as visible.
export function fizzyVisible(root) {
  const body = findNode(root, "panel-body");
  if (!body?.children?.some(c => c.id === "fizzy")) return true;
  return !findNode(root, "panel")?.hidden && body.active === "fizzy";
}

// A notification: { id, title, body, source_type, read, creator: { name }, card: { number, title, board_name, url }, created_at }
const noteTime = note => {
  const t = Date.parse(note?.created_at);
  return Number.isNaN(t) ? 0 : t;
};
// What the Inbox lists: the unread notifications only (a read one is never shown, whatever the CLI answered), newest first.
export function unreadNotes(notes) {
  return (notes ?? []).filter(n => !n.read).sort((a, b) => noteTime(b) - noteTime(a));
}
// Oldest first (the order toasts are posted in).
export const oldestFirst = notes => [...(notes ?? [])].sort((a, b) => noteTime(a) - noteTime(b));

// The card a notification is about, or null when it has none (Fizzy numbers a missing one 0).
export function noteCard(note) {
  const card = note?.card;
  return card && Number.isInteger(card.number) && card.number > 0 ? card : null;
}

const cut = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
// A toast for a notification: its title (80 at most), then the body's first line (140 at most), `#number` and the board.
export function noteToast(note) {
  const first = String(note?.body ?? "").split(/\r?\n/).map(s => s.trim()).find(Boolean) ?? "";
  const c = note?.card;
  const body = [cut(first, 140), noteCard(note) ? `#${c.number}` : "", c?.board_name ?? ""].filter(Boolean).join(" · ");
  const title = cut(String(note?.title ?? "").trim(), 80) || (c?.title ? cut(String(c.title), 80) : "Fizzy");
  return { title, ...(body ? { body } : {}) };
}

// What clicking a notification's toast does, chosen from the layout as it is when the toast is posted. A toast's action
// runs ONE command, and `<mod>.<command>` reaches a shown copy only. `before` is what the layout looked like, for the
// notes that have to wait for the panel to come up (see noteReady); it is null when the card can be opened at once.
//   Fizzy showing                 -> fizzy.open:<number>:<id>
//   Fizzy active, panel hidden    -> layout.show panel
//   another page in front         -> layout.select panel-body -> fizzy
// A notification with no card has no action.
export function noteAction(root, note) {
  const number = noteCard(note)?.number;
  if (number == null || note.id == null) return { action: undefined, before: null };
  if (fizzyVisible(root)) return { action: { name: `fizzy.open:${number}:${note.id}` }, before: null };
  const before = { active: findNode(root, "panel-body")?.active ?? null, hidden: Boolean(findNode(root, "panel")?.hidden) };
  if (before.active === "fizzy") return { action: { name: "layout.show", args: { id: "panel" } }, before };
  return { action: { name: "layout.select", args: { stack: "panel-body", child: "fizzy" } }, before };
}
// Has the layout come up to Fizzy since the toast was posted? null: no; "open": the Fizzy page shows now; "show":
// the Fizzy page is in front but the panel is still hidden, so it has to be shown first.
export function noteReady(root, before) {
  if (findNode(root, "panel-body")?.active !== "fizzy") return null;
  const hidden = Boolean(findNode(root, "panel")?.hidden);
  if (before.active === "fizzy") return before.hidden && !hidden ? "open" : null;
  return hidden ? "show" : "open";
}

// A menu row is { type: "row", id, label, icon, hint?, checked?, danger?, color?, agent?, act }; `act` says
// what choosing it does:
//   { request: op }           a Fizzy write, done by the panel (ops below)
//   Nothing here ever submits: each hand-off only pastes text into an agent's input.
//   { insert: text }          into the current chat (the agent in view) | { paste: { address, text } } into that session, brought to focus first
//   { start: { name, argv, text, agent } }  a new tab with an agent (`agent`: its name), the text pasted once it is ready
//   { copy: text } | { open: url }
//   { choose: { follow, board, compose? } }    the board picker's answer (board null: keep the picked one); `compose`: New card's, which also opens the new-card field
//   { menu: next }            closes this popup, opens another | { arm: rowId }  re-render with that row armed
// ops: { kind: "move", number, target } | { kind: "golden"|"pin"|"watch", number, on } | { kind: "selfAssign", number }
//   | { kind: "assign", number, user } | { kind: "tag", number, name } | { kind: "moveBoard", number, board }
//   | { kind: "remove", number } | { kind: "reopen", number } | { kind: "react", number, comment, content } (toggles yours)
//   | { kind: "mention", target, user, name } | { kind: "cardref", target, number, title } (a person's or a card's token into an
//     editor: "comment", "commentEdit" or "desc"; nothing is written)
// A row may carry `user` ({ id, name }): the popup draws that person's photo (or their initials) before the label.
// Other row types ("label", "sep", "note") are not selectable.

const row = (id, label, icon, act, more = {}) => ({
  type: "row", id, label, icon, act, ...Object.fromEntries(Object.entries(more).filter(([, v]) => v !== undefined)),
});
const label = (id, text) => ({ type: "label", id, label: text });
const note = (id, text) => ({ type: "note", id, label: text });
const sep = id => ({ type: "sep", id });

// ctx: { agents, focused, known, checking, failed, boards, groups (the saved board groups), users, tags, me, mentionable, armed }, read live by the
// caller (`agents`: running agents; `known`: knownAgents(), the ones that can be started; `mentionable`: the ids of the users the panel can mention).
// A card menu opened by the panel carries `to`: the label of the agent its Insert goes to (null: it copies), and `pinned` and
// `watching` (true or false) when it knows them; a toggle row offers both verbs while its state is missing.
export function menuRows(menu, ctx = {}) {
  switch (menu?.kind) {
    case "boards": return boardRows(menu, ctx);
    case "newCard": return newCardRows(menu, ctx);
    case "card": return menu.card ? cardRows(menu, ctx) : [];
    case "agents": return agentRows(menu, ctx);
    case "start": return startRows(menu, ctx);
    case "users": return menu.card ? userRows(menu, ctx) : [];
    case "tags": return menu.card ? tagRows(menu, ctx) : [];
    case "moveBoard": return menu.card ? moveBoardRows(menu, ctx) : [];
    case "lanes": return menu.card ? laneRows(menu.card, menu.columns) : [];
    case "react": return menu.comment ? reactRows(menu) : [];
    case "mention": return mentionRows(menu, ctx);
    case "cardref": return cardRefRows(menu, ctx);
    default: return [];
  }
}

// The boards that are in no group; then each group that has a board to show, as a label and its boards (`pick` makes a board's row).
// The board the panel shows (`current`) is listed whatever is hidden.
function groupedBoards(menu, ctx, pick) {
  const boards = ctx.boards ?? [];
  const { ungrouped, groups } = boardGroups(boards, groupsConfig(ctx.groups), { keep: menu.current });
  return [
    ...ungrouped.map(pick),
    ...groups.filter(g => g.boards.length).flatMap(g => [label(`group-${g.group.id}`, g.group.name), ...g.boards.map(pick)]),
    ...(boards.length ? [] : [note("boards-note", "No boards")]),
  ];
}

// Follow current space, then the boards.
function boardRows(menu, ctx) {
  const own = (ctx.boards ?? []).find(b => b.id === menu.spaceBoard);
  const pick = b => row(`board-${b.id}`, b.name, null, { choose: { follow: false, board: b.id } }, { checked: !menu.follow && b.id === menu.current });
  return [
    row("follow", "Follow current space", null, { choose: { follow: true, board: null } }, {
      hint: menu.spaceBoard ? (own?.name ?? "unknown board") : "no .fizzy.yaml", checked: !!menu.follow,
    }),
    sep("sep-follow"),
    ...groupedBoards(menu, ctx, pick),
  ];
}

// The boards, each opening the new-card field on it; the one the panel shows is ticked.
function newCardRows(menu, ctx) {
  const pick = b => row(`board-${b.id}`, b.name, null, { choose: { follow: false, board: b.id, compose: true } }, { checked: b.id === menu.current });
  return [label("new-label", "New card on"), ...groupedBoards(menu, ctx, pick)];
}

// One row per lane: choosing it moves the card there.
function laneRows(card, columns) {
  const here = laneOf(card);
  return lanes(columns).map(l => row(`lane-${l.id}`, l.name, null, { request: { kind: "move", number: card.number, target: l.id } }, { checked: l.id === here, color: l.color ?? undefined }));
}

function cardRows(menu, ctx) {
  const { card } = menu, n = card.number, meId = idOf(ctx.me);
  // Where Insert goes: the agent in view, as the panel said when it opened the menu (`to`), else as it is now.
  const inView = targetAgent({ agents: ctx.agents, focused: ctx.focused });
  const target = "to" in menu ? menu.to : inView ? agentLabel(inView) : null;
  const mine = !!meId && (card.assignees ?? []).some(u => u.id === meId);
  return [
    row("insert", "Insert in chat", ICON("insert"), { insert: ref(card) }, { hint: target || "copies" }),
    row("send", "Send to session…", ICON("send"), { menu: { kind: "agents", cards: [card] } }),
    row("start", "Start new session…", ICON("bot"), { menu: { kind: "start", cards: [card] } }),
    row("copy-ref", "Copy reference", ICON("copy"), { copy: ref(card) }),
    ...(card.url ? [row("copy-link", "Copy link", ICON("link"), { copy: card.url })] : []),
    sep("sep-hand"),
    ...(card.closed ? [row("reopen", "Reopen", ICON("rotate-ccw"), { request: { kind: "reopen", number: n } })] : []),
    label("move-label", "Move to"),
    ...laneRows(card, menu.columns),
    sep("sep-move"),
    row("self-assign", mine ? "Unassign me" : "Assign to me", ICON("user"), { request: { kind: "selfAssign", number: n } }),
    row("assign", "Assign…", ICON("user-plus"), { menu: { kind: "users", card } }),
    row("tags", "Tags…", ICON("tag"), { menu: { kind: "tags", card } }),
    ...(menu.pinned !== true ? [row("pin", "Pin", ICON("pin"), { request: { kind: "pin", number: n, on: true } })] : []),
    ...(menu.pinned !== false ? [row("unpin", "Unpin", ICON("pin-off"), { request: { kind: "pin", number: n, on: false } })] : []),
    ...(menu.watching !== true ? [row("watch", "Watch", ICON("eye"), { request: { kind: "watch", number: n, on: true } })] : []),
    ...(menu.watching !== false ? [row("unwatch", "Unwatch", ICON("eye-off"), { request: { kind: "watch", number: n, on: false } })] : []),
    row("golden", card.golden ? "Remove golden" : "Mark golden", ICON(card.golden ? "star-off" : "star"), { request: { kind: "golden", number: n, on: !card.golden } }),
    row("move-board", "Move to board…", ICON("kanban"), { menu: { kind: "moveBoard", card } }),
    ...(card.url ? [row("open", "Open in Fizzy", ICON("external-link"), { open: card.url })] : []),
    sep("sep-danger"),
    ctx.armed === "delete"
      ? row("delete", `Click again to delete #${n}`, ICON("trash"), { request: { kind: "remove", number: n } }, { danger: true })
      : row("delete", "Delete card…", ICON("trash"), { arm: "delete" }),
  ];
}

// The running agent sessions, the one Insert would use first, the rest as agents() lists them (space, tab). Choosing one
// brings that session to focus and pastes the cards' references into it (not submitted).
function agentRows(menu, ctx) {
  const list = ctx.agents ?? [], target = targetAgent({ agents: list, focused: ctx.focused });
  const ordered = target ? [target, ...list.filter(a => a.address !== target.address)] : list;
  const text = refs(menu.cards);
  return [
    ...ordered.map(a => row(`agent-${a.address}`, agentLabel(a), a.program?.icon ?? null, { paste: { address: a.address, text } }, { hint: agentHint(a) || undefined, agent: a.program })),
    ...(ordered.length ? [] : [note("agents-note", "No agents running")]),
  ];
}

// The agents that can be started (installed ones), each opening a new tab with no first message; the cards' references are
// pasted into the new session once it is ready (not submitted).
function startRows(menu, ctx) {
  const installed = (ctx.known ?? []).filter(a => a.installed).slice(0, AGENTS);
  const name = menu.cards?.[0] ? tabName(menu.cards[0]) : "", text = refs(menu.cards);
  return [
    ...installed.map((a, i) => row(`agent-${i}`, a.name, a.icon, { start: { name, argv: a.run, text, agent: a.name } }, { agent: a })),
    ...(installed.length ? [] : [note("agents-note", ctx.checking ? "Checking installed agents…" : ctx.failed ? "Could not load agents" : "No agents found")]),
  ];
}

// The active people (no system user), you first.
export function activePeople(users, meId) {
  const active = users.filter(u => u.active !== false && u.role !== "system");
  return [...active.filter(u => meId && u.id === meId), ...active.filter(u => !meId || u.id !== meId)];
}

function userRows(menu, ctx) {
  if (ctx.users == null) return [note("users-note", "Loading people…")];
  const meId = idOf(ctx.me), assigned = new Set((menu.card.assignees ?? []).map(u => u.id));
  const people = activePeople(ctx.users, meId);
  return [
    ...people.map(u => row(`user-${u.id}`, u.name, null, { request: { kind: "assign", number: menu.card.number, user: u.id } }, { user: { id: u.id, name: u.name }, checked: assigned.has(u.id), hint: meId && u.id === meId ? "you" : undefined })),
    ...(people.length ? [] : [note("users-note", "No people")]),
  ];
}

// Someone the panel has no mention id for yet "can't tag yet": their "@<name>" is saved as plain text.
// `ctx.query`: the words typed in the popup's field; a person stays when their name holds them.
function mentionRows(menu, ctx) {
  if (ctx.users == null) return [note("users-note", "Loading people…")];
  const meId = idOf(ctx.me), known = new Set(ctx.mentionable ?? []), q = String(ctx.query ?? "").trim().toLowerCase();
  const people = activePeople(ctx.users, meId).filter(u => !q || u.name.toLowerCase().includes(q));
  return [
    ...people.map(u => row(`user-${u.id}`, u.name, null, { request: { kind: "mention", target: menu.target, user: u.id, name: u.name } }, { user: { id: u.id, name: u.name }, hint: !known.has(u.id) ? "can't tag yet" : meId && u.id === meId ? "you" : undefined })),
    ...(people.length ? [] : [note("users-note", q ? "Nobody by that name" : "No people")]),
  ];
}

const CARD_REF_ROWS = 50;
// The cards the panel passed (`menu.cards`: [{ number, title, board }]) that the field's words fit (`ctx.query`): a number, the
// cards whose number starts with it; words, the cards whose title holds them all. A number none of them has is looked up by the
// popup: `ctx.looked` is { number, title, board } once found, { number, error } when that failed.
function cardRefRows(menu, ctx) {
  const q = String(ctx.query ?? "").trim().replace(/^#/, "").toLowerCase(), digits = /^\d+$/.test(q) ? q : null;
  const words = q.split(/\s+/).filter(Boolean);
  const cards = (menu.cards ?? []).filter(c => (digits ? String(c.number).startsWith(digits) : words.every(w => String(c.title ?? "").toLowerCase().includes(w))));
  if (digits) cards.sort((a, b) => a.number - b.number);
  const looked = digits && ctx.looked?.number === Number(digits) ? ctx.looked : null;
  if (looked && !looked.error && !cards.some(c => c.number === looked.number)) cards.unshift(looked);
  const exact = cards.some(c => c.number === Number(digits));
  const pick = c => row(`card-${c.number}`, cardLabel(c.number, c.title ?? ""), null, { request: { kind: "cardref", target: menu.target, number: c.number, title: c.title ?? "" } }, { hint: c.board || undefined });
  return [
    ...cards.slice(0, CARD_REF_ROWS).map(pick),
    ...(digits && !exact ? [note("cards-note", looked?.error ?? `Looking up #${digits}…`)] : []),
    ...(!digits && !cards.length ? [note("cards-note", q ? "No cards match" : "No cards")] : []),
  ];
}

// Where one "@" or "#" was typed at the start of the text or after white space (where a mention or a card reference starts), going
// from `before` to `after`: its index in `after`, else -1.
export function typedAt(before, after) {
  if (after.length !== before.length + 1) return -1;
  let i = 0;
  while (i < before.length && before[i] === after[i]) i++;
  const mark = after[i] === "@" || after[i] === "#";
  return mark && after.slice(i + 1) === before.slice(i) && (i === 0 || /\s/.test(after[i - 1])) ? i : -1;
}

const REACTIONS = ["👍", "👎", "😄", "🎉", "❤️", "👀", "🚀", "🙏", "✅"];
// `menu.mine`: the emoji you have already put on the comment, ticked.
function reactRows(menu) {
  const mine = new Set(menu.mine ?? []);
  return REACTIONS.map((content, i) => row(`react-${i}`, content, null, { request: { kind: "react", number: menu.number, comment: menu.comment, content } }, { checked: mine.has(content) }));
}

function tagRows(menu, ctx) {
  if (ctx.tags == null) return [note("tags-note", "Loading tags…")];
  const has = new Set((menu.card.tags ?? []).map(tagTitle));
  return [
    ...ctx.tags.map(t => row(`tag-${t.id ?? t.title}`, t.title, null, { request: { kind: "tag", number: menu.card.number, name: t.title } }, { checked: has.has(t.title) })),
    ...(ctx.tags.length ? [] : [note("tags-note", "No tags yet")]),
  ];
}

function moveBoardRows(menu, ctx) {
  const others = (ctx.boards ?? []).filter(b => b.id !== menu.card.board?.id);
  return [
    ...others.map(b => row(`board-${b.id}`, b.name, null, { request: { kind: "moveBoard", number: menu.card.number, board: b.id } })),
    ...(others.length ? [] : [note("boards-note", "No other boards")]),
  ];
}

// The height a popup needs for these rows. `spare`: extra rows to leave room for (agents still being looked up).
export function menuHeight(rows, spare = 0) {
  const h = { row: ROW, note: ROW, label: LABEL, sep: SEP };
  return rows.reduce((n, r) => n + h[r.type], PAD + FRAME) + spare * ROW;
}
