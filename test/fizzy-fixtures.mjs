// A fake `fizzy` CLI for the Fizzy panel's tests: a small account (two boards, cards in every lane, steps, comments,
// people, tags, notifications) that answers each argv the panel sends, changes itself on a write the way the real
// one would, and records what it was asked. The panel's own `exec` goes through the herdr mock into makeAccount().exec.
import { layoutWith, modFile } from "./helpers.mjs";
import { state } from "./mocks/herdr.mjs";

const { YAML_SCRIPT, AVATAR_SCRIPT, IMAGE_SCRIPT, CLIP_SCRIPT, OPEN_SCRIPT, FREE_NAME_SCRIPT, WRITE_SCRIPT, JQ, SEARCH_CAP } = await import(modFile("lib.js"));

export const LAYOUT = layoutWith({ active: "fizzy", children: ["files", "changes", "fizzy"] });

const user = (id, name, role = "member") => ({ id, name, role, active: true, email_address: `${name.toLowerCase()}@example.com`, avatar_url: `https://example.com/${id}.png` });
export const ME = user("u-me", "Ada", "owner");
export const TEAMMATE = user("u-bob", "Bob", "admin");
export const BOT = user("u-bot", "Helper (Bot)", "system");

const PSEUDO = { notNow: { id: "not-now", kind: "not_now", name: "Not Now", pseudo: true }, maybe: { id: "maybe", kind: "triage", name: "Maybe?", pseudo: true }, done: { id: "done", kind: "closed", name: "Done", pseudo: true } };
const IN_PROGRESS = { id: "c1", name: "In progress", color: { name: "Aqua", value: "var(--color-card-5)" } };
const REVIEW = { id: "c2", name: "Review", color: { name: "Purple", value: "var(--color-card-7)" } };
export const B1 = { id: "b1", name: "Roadmap", url: "https://app.fizzy.do/111/boards/b1" };
export const B2 = { id: "b2", name: "Personal", url: "https://app.fizzy.do/111/boards/b2" };

const ok = data => ({ code: 0, stdout: JSON.stringify({ ok: true, data, summary: "ok" }), stderr: "" });
// A failure as the CLI prints it into a pipe: the envelope on stdout, with the exit code that goes with its code.
const EXIT = { usage: 1, not_found: 2, auth_required: 3, forbidden: 4, rate_limit: 5, network: 6, api_error: 7 };
export const failure = (code, message) => ({ code: EXIT[code] ?? 1, stdout: JSON.stringify({ ok: false, error: message, code }), stderr: "" });

// What the typed answers (`card show`, `pin list`, a Done page) give: the empty lists and texts left out, and no column as
// an empty one.
const NO_COLUMN = { created_at: "", id: "", name: "" };
function typed(card) {
  const out = { ...card, column: card.column ?? NO_COLUMN };
  for (const key of ["assignees", "tags", "steps"]) if (!out[key]?.length) delete out[key];
  for (const key of ["description", "description_html"]) if (!out[key]) delete out[key];
  return out;
}

let sequence = 0;
// `more`: the card's own fields (column, closed, postponed, golden, tags, assignees, steps, description_html ...).
function card(number, title, board, more = {}) {
  return {
    id: `id-${number}`, number, title, description: "", description_html: "", status: "published", closed: false, postponed: false, golden: false,
    column: null, tags: [], assignees: [], steps: [], creator: TEAMMATE, board, last_active_at: new Date(Date.now() - 3 * 3600_000).toISOString(),
    created_at: "2026-01-02T10:00:00Z", url: `https://app.fizzy.do/111/cards/${number}`, ...more,
  };
}

export const CLOSED_FROM = 4500;
// Events per page of `activity list`, as Fizzy pages it.
export const ACTIVITY_PAGE = 15;

// opts.closed: how many extra closed cards board b1 has (to page through), numbered from CLOSED_FROM;
// opts.pageSize: this fake's own page size, small so that a few cards make several pages;
// opts.morePages: every page of closed cards says another follows, the last one too.
export function makeAccount(opts = {}) {
  const a = {
    boards: [B1, B2],
    columns: { b1: [PSEUDO.notNow, PSEUDO.maybe, IN_PROGRESS, REVIEW, PSEUDO.done], b2: [PSEUDO.notNow, PSEUDO.maybe, PSEUDO.done] },
    cards: [
      card(101, "Fix the login redirect", B1, {
        column: IN_PROGRESS, assignees: [ME], tags: ["bug"],
        description: "The spinner hangs.", description_html: '<div class="action-text-content"><p>The spinner <b>hangs</b>.</p></div>',
        steps: [{ id: "s1", content: "Reproduce it", completed: false }, { id: "s2", content: "Patch it", completed: true }],
      }),
      card(102, "Write the changelog", B1, { column: REVIEW, assignees: [TEAMMATE], golden: true, tags: ["docs", "release", "web", "extra"] }),
      card(103, "Triage me", B1),
      card(104, "Maybe later", B1, { postponed: true }),
      card(105, "Shipped thing", B1, { closed: true, column: IN_PROGRESS }),
      card(201, "Other board card", B2, { assignees: [ME] }),
    ],
    comments: {
      101: [
        { id: "cm1", body: { html: "<div><p>Tried <b>twice</b></p></div>", plain_text: "Tried twice" }, creator: ME, created_at: "2026-01-03T10:00:00Z", updated_at: "2026-01-03T10:00:00Z" },
        { id: "cm2", body: { html: "<div><p>On it</p></div>", plain_text: "On it" }, creator: TEAMMATE, created_at: "2026-01-04T10:00:00Z", updated_at: "2026-01-04T10:00:00Z" },
        { id: "cm3", body: { html: "<div>moved</div>", plain_text: "Bob moved this to In progress" }, creator: BOT, created_at: "2026-01-05T10:00:00Z", updated_at: "2026-01-05T10:00:00Z" },
      ],
    },
    users: [ME, TEAMMATE, BOT, { ...user("u-off", "Gone"), active: false }],
    tags: [{ id: "t1", title: "bug", url: "x" }, { id: "t2", title: "docs", url: "x" }],
    pins: [],
    notifications: [
      { id: "n1", title: "Fix the login redirect", body: "Assigned to you", source_type: "event", read: false, created_at: new Date(Date.now() - 600_000).toISOString(), creator: TEAMMATE,
        card: { id: "id-101", number: 101, title: "Fix the login redirect", status: "published", closed: false, postponed: false, column: IN_PROGRESS, board_name: B1.name, url: "https://app.fizzy.do/111/cards/101" } },
      { id: "n2", title: "Write the changelog", body: "Moved to Review", source_type: "event", read: false, created_at: new Date(Date.now() - 7200_000).toISOString(), creator: TEAMMATE,
        card: { id: "id-102", number: 102, title: "Write the changelog", status: "published", closed: false, postponed: false, column: REVIEW, board_name: B1.name, url: "https://app.fizzy.do/111/cards/102" } },
    ],
    identity: { id: "login-1", accounts: [{ id: "acct-1", name: "Example Co", slug: "/111", user: ME }] },
    config: { account: "111", board: "b1" }, // the account and default board `config show` says the CLI uses
    yaml: {},          // folder -> the text of its .fizzy.yaml (what the folder script finds walking up)
    stalled: [],       // the numbers of the open cards Fizzy lists as stalled
    activity: [],      // the activity feed, newest first: events as `activity list` gives them ({ eventable: { body: { html } } | { description_html } })
    reactions: {},     // comment id -> its reactions ([{ id, content, reacter }])
    attachments: {},   // card number -> its attachments' sgids, in the order `card attachments download` numbers them
    clipboardImage: false, // the clipboard holds an image (what the paste script reads)
    written: {}, // path -> the text WRITE_SCRIPT wrote there
    watching: { b1: [TEAMMATE.id] }, // board id -> the ids of who watches it for new cards
    webImageFails: null,   // (url) => true: the image script cannot fetch that image from the web
    pageSize: opts.pageSize ?? 15,
    searchCap: opts.searchCap ?? SEARCH_CAP,
    morePages: opts.morePages ?? false,
    createReturnsNumber: true,
    fail: null,        // (argv) => a failure result, or undefined: made-up trouble
    hold: null,        // a promise every fizzy call waits for first (unhold() lets them all go, whatever it does)
    missing: false,    // the program cannot start
    stopped: false,    // Herdr stops every fizzy call at its time limit
    trayShowsRead: false, // the tray answers read notifications too, flag or not (a CLI that ignores the unread filter)
    log: [],           // every argv asked
    inflight: 0, peak: 0,
  };
  for (let i = 0; i < (opts.closed ?? 0); i++) a.cards.push(card(CLOSED_FROM + i, `Closed ${i}`, B1, { closed: true, column: i % 2 ? REVIEW : null }));

  const find = n => a.cards.find(c => c.number === Number(n));
  const flag = (args, name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
  const listItem = ({ steps, ...rest }) => rest;
  const lane = c => (c.closed ? "done" : c.postponed ? "not-now" : c.column?.id ?? "maybe");

  function answer(args, jq) {
    const [a1, a2] = args, n = args[2];
    if (a1 === "config" && a2 === "show") {
      const { account = null, board = null } = a.config;
      return ok(jq === JQ.config ? { account, board } : { account, api_url: "https://app.fizzy.do", board, profile: account, profiles: null, token: { configured: true, source: "test-vault" } });
    }
    if (a1 === "board" && a2 === "list") return ok(a.boards);
    if (a1 === "column" && a2 === "list") return ok(a.columns[flag(args, "--board")] ?? []);
    // A column trades places with the next real column on that side; Maybe?, Not Now and Done keep theirs.
    if (a1 === "column" && (a2 === "move-left" || a2 === "move-right")) {
      for (const list of Object.values(a.columns)) {
        const real = list.filter(c => !c.pseudo), i = real.findIndex(c => c.id === n), j = i + (a2 === "move-left" ? -1 : 1);
        if (i < 0) continue;
        if (j < 0 || j >= real.length) return ok(null);
        [real[i], real[j]] = [real[j], real[i]];
        let k = 0;
        list.splice(0, list.length, ...list.map(c => (c.pseudo ? c : real[k++])));
        return ok(null);
      }
      return failure("not_found", `Resource not found: column ${n}`);
    }
    if (a1 === "search") {
      const words = (args[args.indexOf("--") + 1] ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const text = c => [c.title, c.description, ...c.tags, ...(a.comments[c.number] ?? []).map(x => x.body.plain_text)].join(" ").toLowerCase();
      const hits = a.cards.filter(c => words.every(w => text(c).includes(w)));
      return ok(hits.sort((x, y) => Date.parse(y.last_active_at) - Date.parse(x.last_active_at)).slice(0, a.searchCap).map(listItem));
    }
    if (a1 === "card" && a2 === "list") {
      // No --board: every board, unless the CLI has a default board, which a boardless list silently stays on.
      const board = flag(args, "--board") ?? a.config.board, by = flag(args, "--indexed-by"), assignee = flag(args, "--assignee");
      let list = a.cards.filter(c => board == null || c.board.id === board);
      if (by === "closed") {
        list = list.filter(c => c.closed);
        const page = Number(flag(args, "--page") ?? 1), from = (page - 1) * a.pageSize;
        const cards = list.slice(from, from + a.pageSize).map(listItem).map(typed);
        if (jq !== JQ.page) return ok(cards);
        // JQ.page's answer: a page follows every page but the last, and every page past the end.
        return ok({ cards, more: a.morePages || !cards.length || from + a.pageSize < list.length });
      }
      list = by === "not_now" ? list.filter(c => c.postponed && !c.closed) : list.filter(c => !c.closed && !c.postponed);
      if (by === "stalled") list = list.filter(c => a.stalled.includes(c.number));
      if (assignee) list = list.filter(c => c.assignees.some(u => u.id === assignee));
      return ok(jq === JQ.numbers ? list.map(c => c.number) : list.map(listItem));
    }
    if (a1 === "card" && a2 === "attachments") {
      const sgids = a.attachments[Number(args[3])] ?? [];
      if (args[2] === "show") return ok(jq === JQ.attachments ? sgids : sgids.map(sgid => ({ sgid })));
      return sgids[Number(args[4]) - 1] ? ok({ path: flag(args, "-o") }) : failure("not_found", "Attachment not found");
    }
    if (a1 === "activity" && a2 === "list") {
      const page = Number(flag(args, "--page") ?? 1), from = (page - 1) * ACTIVITY_PAGE, events = a.activity.slice(from, from + ACTIVITY_PAGE);
      if (jq !== JQ.mentions) return ok(events);
      const html = events.flatMap(e => [e.eventable?.body?.html ?? "", e.eventable?.description_html ?? ""]).filter(h => h.includes("vnd.actiontext.mention"));
      return ok({ html: [...new Set(html)], more: from + ACTIVITY_PAGE < a.activity.length });
    }
    if (a1 === "reaction") {
      const comment = flag(args, "--comment"), list = a.reactions[comment] ??= [];
      if (a2 === "list") return ok(list.map(r => ({ id: r.id, content: r.content, reacter: { id: r.reacter.id, name: r.reacter.name } })));
      if (a2 === "create") {
        const made = { id: `r-new${++sequence}`, content: flag(args, "--content"), reacter: ME };
        list.push(made);
        return ok(made);
      }
      if (a2 === "delete") { a.reactions[comment] = list.filter(r => r.id !== n); return ok(null); }
    }
    if (a1 === "upload" && a2 === "file") return ok({ attachable_sgid: `sgid-upload-${++sequence}`, filename: n.split("/").pop() });
    if (a1 === "card" && a2 === "show") return find(n) ? ok(typed(find(n))) : failure("not_found", `Resource not found: https://app.fizzy.do/111/cards/${n}`);
    if (a1 === "comment" && a2 === "list") {
      const list = a.comments[Number(flag(args, "--card"))] ?? [];
      return ok(jq === JQ.count ? list.length : list);
    }
    // Who watches a board for new cards (`watching`: board id -> user ids), and the signed-in user watching it or not.
    if (a1 === "board" && a2 === "accesses") return ok((a.watching[flag(args, "--board")] ?? []).slice());
    if (a1 === "board" && a2 === "involvement") {
      const list = (a.watching[n] ??= []).filter(id => id !== ME.id);
      a.watching[n] = flag(args, "--involvement") === "watching" ? [...list, ME.id] : list;
      return ok(null);
    }
    if (a1 === "user" && a2 === "list") return ok(a.users);
    if (a1 === "tag" && a2 === "list") return ok(a.tags);
    if (a1 === "pin" && a2 === "list") return ok(a.pins.map(typed));
    if (a1 === "identity") return ok(a.identity);
    if (a1 === "notification" && a2 === "tray") return ok(a.notifications.filter(x => a.trayShowsRead || !x.read || args.includes("--include-read")));
    if (a1 === "card") {
      const c = find(n);
      switch (a2) {
        case "create": {
          const made = card(300 + ++sequence, flag(args, "--title"), a.boards.find(b => b.id === flag(args, "--board")), {
            description: (flag(args, "--description") ?? "").replace(/<[^>]*>/g, ""), description_html: flag(args, "--description") ?? "",
          });
          a.cards.push(made);
          return ok(a.createReturnsNumber ? { number: made.number, title: made.title } : null);
        }
        case "close": c.closed = true; return ok(null);
        case "reopen": c.closed = false; return ok(null);
        case "postpone": c.postponed = true; c.column = null; return ok(null);
        case "untriage": c.postponed = false; c.column = null; return ok(null);
        case "column": c.column = a.columns[c.board.id].find(x => x.id === flag(args, "--column")); c.postponed = false; return ok(null);
        case "golden": c.golden = true; return ok(null);
        case "ungolden": c.golden = false; return ok(null);
        case "update":
          if (args.includes("--title")) c.title = flag(args, "--title");
          if (args.includes("--description")) { c.description_html = flag(args, "--description"); c.description = flag(args, "--description").replace(/<[^>]*>/g, ""); }
          return ok(c);
        case "delete": a.cards.splice(a.cards.indexOf(c), 1); return ok(null);
        case "move": c.board = a.boards.find(b => b.id === flag(args, "--to")); c.column = null; return ok(null);
        case "tag": {
          const tag = flag(args, "--tag");
          c.tags = c.tags.includes(tag) ? c.tags.filter(x => x !== tag) : [...c.tags, tag];
          if (!a.tags.some(x => x.title === tag)) a.tags.push({ id: `t-${tag}`, title: tag, url: "x" });
          return ok(null);
        }
        case "assign": case "self-assign": {
          const who = a2 === "self-assign" ? ME : a.users.find(u => u.id === flag(args, "--user"));
          c.assignees = c.assignees.some(u => u.id === who.id) ? c.assignees.filter(u => u.id !== who.id) : [...c.assignees, who];
          return ok(null);
        }
        case "pin": a.pins.push(c); return ok(null);
        case "unpin": a.pins = a.pins.filter(x => x !== c); return ok(null);
        case "watch": case "unwatch": return ok(null);
        default: return failure("usage", `unknown command "${a2}" for "fizzy card"`);
      }
    }
    if (a1 === "step") {
      const c = find(flag(args, "--card"));
      if (a2 === "create") c.steps.push({ id: `s-new${++sequence}`, content: flag(args, "--content"), completed: false });
      else if (a2 === "update") {
        const s = c.steps.find(x => x.id === n);
        if (args.includes("--completed")) s.completed = true;
        if (args.includes("--not_completed")) s.completed = false;
        if (args.includes("--content")) s.content = flag(args, "--content");
      } else if (a2 === "delete") c.steps = c.steps.filter(x => x.id !== n);
      return ok(null);
    }
    if (a1 === "comment") {
      const number = Number(flag(args, "--card"));
      if (a2 === "create") (a.comments[number] ??= []).push({ id: `cm-new${++sequence}`, body: { html: flag(args, "--body"), plain_text: flag(args, "--body").replace(/<[^>]*>/g, "") }, creator: ME, created_at: new Date().toISOString() });
      else if (a2 === "update") {
        const c = (a.comments[number] ?? []).find(x => x.id === n);
        c.body = { html: flag(args, "--body"), plain_text: flag(args, "--body").replace(/<[^>]*>/g, "") };
      } else if (a2 === "delete") a.comments[number] = (a.comments[number] ?? []).filter(x => x.id !== n);
      return ok(null);
    }
    if (a1 === "notification") {
      if (a2 === "read") a.notifications.find(x => x.id === n).read = true;
      else if (a2 === "read-all") for (const x of a.notifications) x.read = true;
      return ok(null);
    }
    return failure("usage", `unknown command "${args.join(" ")}" for "fizzy"`);
  }

  // The photo script (AVATAR_SCRIPT), as a fetch that never touches the network: it logs { url, dir, base } and prints the file
  // name the real script would (`ext`). photos.hold: a promise every fetch waits for first; photos.fail: (url) => true makes
  // that user's fetch fail; photos.throws: the script cannot start at all; photos.peak: the most fetches that were out at once.
  a.photos = { log: [], inflight: 0, peak: 0, hold: null, fail: null, throws: false, ext: "png" };
  async function photo(args) {
    const p = a.photos, [, , , url, dir, base] = args;
    p.log.push({ url, dir, base });
    p.inflight++; p.peak = Math.max(p.peak, p.inflight);
    try {
      if (p.hold) await Promise.race([p.hold, unheld]);
      await Promise.resolve();
      if (p.throws) throw new Error("spawn sh ENOENT");
      if (p.fail?.(url)) return { code: 22, stdout: "", stderr: "curl: (22) The requested URL returned error: 404" };
      return { code: 0, stdout: `${base}.${p.ext}\n`, stderr: "" };
    } finally { p.inflight--; }
  }

  // The scripts that handle files, as the panel runs them (sh -c SCRIPT fizzy ...): a web image is "fetched" under its base name,
  // the clipboard holds an image only when `clipboardImage` says so, the free name is always the first one tried, and opening works.
  function fileScript(script, params) {
    const done = (code, stdout = "") => ({ code, stdout, stderr: "" });
    if (script === IMAGE_SCRIPT) {
      const [url, , base] = params;
      return a.webImageFails?.(url) ? done(22) : done(0, `${base}.png\n`);
    }
    if (script === CLIP_SCRIPT) return done(a.clipboardImage ? 0 : 1);
    if (script === OPEN_SCRIPT) return done(0);
    if (script === FREE_NAME_SCRIPT) {
      const [folder, name, ext] = params;
      return done(0, `${folder}/${name}${ext}`);
    }
    if (script === WRITE_SCRIPT) {
      const [path, text] = params;
      a.written[path] = text;
      return done(0);
    }
    return null;
  }

  a.exec = async (command, args, options) => {
    if (command === "sh" && args[0] === "-c" && args[1] === AVATAR_SCRIPT) return photo(args);
    const scripted = command === "sh" && args[0] === "-c" ? fileScript(args[1], args.slice(3)) : null;
    if (scripted) return scripted;
    if (["mkdir", "mv", "rm"].includes(command)) return { code: 0, stdout: "", stderr: "" };
    if (command === "sh") {
      // The folder script (walk up to a .fizzy.yaml): the nearest folder in `yaml` at or above the given one, and of its file
      // the `board:` line only.
      if (args[0] !== "-c" || args[1] !== YAML_SCRIPT) throw new Error(`unexpected sh script ${args[1]}`);
      for (let d = args[3]; d; d = d.slice(0, d.lastIndexOf("/"))) {
        if (a.yaml[d] == null) continue;
        const lines = a.yaml[d].split(/\r?\n/).filter(line => /^board[ \t]*:/.test(line));
        return lines.length ? { code: 0, stdout: `${lines.join("\n")}\n`, stderr: "" } : { code: 1, stdout: "", stderr: "" };
      }
      return { code: 1, stdout: "", stderr: "" };
    }
    if (command !== "fizzy") throw new Error(`unexpected command ${command}`);
    if (a.missing) throw new Error("spawn fizzy ENOENT");
    if (a.stopped) throw new Error("fizzy took longer than 30 s and was stopped");
    if (options?.cwd !== state.home) throw new Error(`fizzy must run from the home folder, not ${options?.cwd}`);
    // The log, `fail` and the answer see the command without the --json it ends with (lib.js withJson; a search's ends before
    // the `--` that its query follows) and without its --jq projection (lib.js JQ); the answer takes the projection's shape
    // where it differs from the CLI's own.
    const end = args[0] === "search" ? args.indexOf("--") : args.length;
    const bare = args[end - 1] === "--json" ? [...args.slice(0, end - 1), ...args.slice(end)] : args;
    const at = bare.indexOf("--jq"), jq = at < 0 ? null : bare[at + 1];
    const plain = at < 0 ? bare : [...bare.slice(0, at), ...bare.slice(at + 2)];
    a.log.push(plain);
    a.inflight++; a.peak = Math.max(a.peak, a.inflight);
    try {
      if (a.hold) await Promise.race([a.hold, unheld]);
      await Promise.resolve();
      return a.fail?.(plain) ?? answer(plain, jq);
    } finally { a.inflight--; }
  };

  // Lets every held call and photo go, now and from now on: a test that ends with a hold in place leaves nothing waiting.
  let unhold;
  const unheld = new Promise(resolve => { unhold = resolve; });
  a.unhold = () => unhold();

  const reads = new Set(["board list", "board accesses", "column list", "card list", "card show", "card attachments", "comment list", "user list", "tag list", "pin list", "identity show",
    "notification tray", "config show", "search --", "activity list", "reaction list"]);
  a.writes = () => a.log.filter(args => !reads.has(`${args[0]} ${args[1]}`));
  a.asked = (...prefix) => a.log.filter(args => prefix.every((p, i) => args[i] === p));
  a.lane = n => lane(find(n));
  a.card = find;
  return a;
}
