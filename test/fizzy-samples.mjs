// Answers of the fizzy CLI as a pipe gets them (the exec result: exit code, stdout, stderr). The keys, the keys left out,
// the value types and the error messages are the CLI's own; every name, title, id and other text is made up.

// A plain answer is indented JSON; what --jq prints is one line, its keys sorted.
const pipe = (body, code = 0) => ({ code, stdout: JSON.stringify(body, null, 2), stderr: "" });
const line = (body, code = 0) => ({ code, stdout: JSON.stringify(body), stderr: "" });

const ADA = {
  active: true, avatar_url: "https://app.fizzy.do/111/users/u-me/avatar", created_at: "2025-01-02T10:00:00.000Z",
  email_address: "ada@example.com", id: "u-me", name: "Ada", role: "owner", url: "https://app.fizzy.do/111/users/u-me",
};
const ROADMAP = {
  all_access: false, auto_postpone_period_in_days: 30, created_at: "2025-01-02T10:00:00.000Z", creator: ADA, id: "b1", name: "Roadmap",
  url: "https://app.fizzy.do/111/boards/b1",
};
const REVIEW = {
  cards_url: "https://app.fizzy.do/111/boards/b1/columns/c2/cards", color: { name: "Purple", value: "var(--color-card-7)" },
  created_at: "2025-01-02T10:00:00.000Z", id: "c2", name: "Review",
};
const links = n => ({ comments_url: `https://app.fizzy.do/111/cards/${n}/comments`, reactions_url: `https://app.fizzy.do/111/cards/${n}/reactions`, url: `https://app.fizzy.do/111/cards/${n}` });

export const BOARD_LIST = pipe({ ok: true, data: [ROADMAP], summary: "1 board", breadcrumbs: [] });

// `card show` of a card in Maybe? that nobody took, with no tags, steps or description: those keys are left out, and the
// column is an empty one.
export const SHOW_BARE = pipe({
  ok: true,
  data: {
    board: ROADMAP, closed: false, column: { created_at: "", id: "", name: "" }, comments_url: links(4243).comments_url,
    created_at: "2025-01-15T09:00:00.000Z", creator: ADA, golden: false, has_attachments: false, id: "0000000000000000000000001",
    last_active_at: "2025-01-15T09:00:00.000Z", number: 4243, postponed: false, reactions_url: links(4243).reactions_url,
    status: "published", title: "Order the stickers", url: links(4243).url,
  },
  summary: "Card #4243: Order the stickers",
  breadcrumbs: [],
});

// `card show` of a closed card: it keeps the column it was closed in.
export const SHOW_CLOSED = pipe({
  ok: true,
  data: {
    assignees: [ADA], board: ROADMAP, closed: true, column: REVIEW, comments_url: links(4242).comments_url,
    created_at: "2025-01-10T09:00:00.000Z", creator: ADA, description: "Newest on top",
    description_html: '<div class="action-text-content"><p>Newest on top</p></div>', golden: false, has_attachments: false,
    id: "0000000000000000000000002", last_active_at: "2025-01-14T12:00:00.000Z", number: 4242, postponed: false,
    reactions_url: links(4242).reactions_url, status: "published", steps: [{ completed: true, content: "List the fixes", id: "s1" }],
    tags: ["release"], title: "Write the changelog", url: links(4242).url,
  },
  summary: "Card #4242: Write the changelog",
  breadcrumbs: [],
});

// `card list` of the open cards: every list is there, and a card in Maybe? has no `column` key.
const LISTED = {
  assignees: [ADA], board: ROADMAP, closed: false, column: REVIEW, ...links(4242), created_at: "2025-01-10T09:00:00.000Z", creator: ADA,
  description: "Newest on top", description_html: '<div class="action-text-content"><p>Newest on top</p></div>', golden: true,
  has_attachments: false, id: "0000000000000000000000002", last_active_at: "2025-01-14T12:00:00.000Z", number: 4242, postponed: false,
  status: "published", tags: ["release"], title: "Write the changelog",
};
const NOTES = "Notes for the launch. ".repeat(20);
const TRIAGED = {
  assignees: [], board: ROADMAP, closed: false, ...links(4243), created_at: "2025-01-15T09:00:00.000Z", creator: ADA, description: NOTES,
  description_html: `<div class="action-text-content"><p>${NOTES}</p></div>`, golden: false, has_attachments: false,
  id: "0000000000000000000000001", last_active_at: "2025-01-15T09:00:00.000Z", number: 4243, postponed: false, status: "published",
  tags: [], title: "Order the stickers",
};
export const OPEN = pipe({ ok: true, data: [LISTED, TRIAGED], summary: "2 cards", breadcrumbs: [] });

// Done, page by page (typed, as `card show` is): a page with another after it, the last page, which has no `has_next`, and
// a page past the end, which says one follows.
const CLOSED = {
  board: ROADMAP, closed: true, column: { created_at: "", id: "", name: "" }, ...links(4210), created_at: "2025-01-05T09:00:00.000Z",
  creator: ADA, golden: false, has_attachments: false, id: "0000000000000000000000003", last_active_at: "2025-01-12T09:00:00.000Z",
  number: 4210, postponed: false, status: "published", title: "Ship the beta",
};
const ONE_MORE = { pagination: { has_next: true } };
export const DONE_PAGE = pipe({ ok: true, data: [CLOSED], summary: "1 card", context: ONE_MORE, breadcrumbs: [] });
export const DONE_LAST = pipe({ ok: true, data: [{ ...LISTED, closed: true }], summary: "1 card", breadcrumbs: [] });
export const DONE_PAST = pipe({ ok: true, data: [], summary: "0 cards", context: ONE_MORE, breadcrumbs: [] });

// The unread tray: a note about a card, and one about no card, which Fizzy numbers 0.
export const TRAY = pipe({
  ok: true,
  data: [
    {
      body: "Assigned to you",
      card: { board_name: "Roadmap", closed: false, column: REVIEW, id: "0000000000000000000000002", number: 4242, postponed: false, status: "published", title: "Write the changelog", url: links(4242).url },
      created_at: "2025-01-15T10:00:00.000Z", creator: ADA, id: "n1", read: false, source_type: "event", title: "Write the changelog",
    },
    {
      body: "",
      card: { board_name: "", closed: false, column: { created_at: "", id: "", name: "" }, id: "", number: 0, postponed: false, status: "", title: "", url: "" },
      created_at: "2025-01-15T11:00:00.000Z", creator: ADA, id: "n2", read: false, source_type: "event", title: "Welcome to Example Co",
    },
  ],
  summary: "2 notifications",
  breadcrumbs: [],
});

// `config show`, cut to the account and the default board by lib.js's JQ.config.
export const CONFIG = line({ data: { account: "111", board: "b1" }, ok: true });
// `config show` without --jq: the token's details come with it.
export const CONFIG_SHOWN = pipe({
  ok: true,
  data: { account: "111", api_url: "https://app.fizzy.do", board: "b1", profile: "111", profiles: null, token: { configured: true, source: "test-vault" } },
  summary: "Configuration",
  breadcrumbs: [],
});

// A write's answer (`card close`, `card column`): nothing to read.
export const WRITE = pipe({ ok: true, data: {}, summary: "Card #4242 closed", breadcrumbs: [] });

// Failures: the envelope on stdout, whatever the exit code.
export const NOT_FOUND = pipe({ ok: false, error: "Resource not found: https://app.fizzy.do/111/cards/4210", code: "not_found" }, 2);
export const USAGE = pipe({ ok: false, error: "unknown flag: --nope", code: "usage" }, 1);
export const NO_TOKEN = pipe({
  ok: false, error: "No API token configured. Run 'fizzy auth login TOKEN' or set FIZZY_TOKEN", code: "auth_required",
  hint: "Run 'fizzy auth login TOKEN' or set FIZZY_TOKEN",
}, 3);
