# Fizzy

A **Fizzy** page in the right panel, next to Files and Changes, opened from a Fizzy button in the tab bar. It shows a
Fizzy board lane by lane, your cards on every board, your unread notifications and your pinned cards; a card opens in
the panel to be renamed, moved, assigned, tagged, ticked off and commented on. A bar at its foot hands the card to a
coding agent running in Herdr by pasting a one-line reference into the agent's input, never submitted. Unread
notifications pop up as toasts even while the panel is hidden, and a dot on the button shows while there are any.
Everything goes through the `fizzy` CLI.

## What you see

Top to bottom, inside the panel (Herdr's `main` layout gives it 368 px, at least 280 and at most 900). The panel is one
column, rounded 10, with a 1 px `border` and the `background` color; text is 13 px in `foreground`. Colors here are
theme names.

- **Header**, 42 px, padding 10, a 1 px line under it. At the left, **Fizzy**: the kanban icon (14 px) and the word
  "Fizzy" in semibold, 26 px high; it is `selected` while the Board view shows, and below 340 px of panel width it
  loses the word. Then **Mine**, **Inbox** and **Pins** (12 px, `selected` when shown); while there are unread
  notifications, Inbox carries a round 16 px badge in `accent` with their number. At the right, Refresh and Settings:
  26 px icon buttons, 14 px icons in `muted`, `hover` behind them on hover.
- **Board row**, 34 px: a 26 px dropdown in `raised` with the board's name (12 px, cut with an ellipsis) and a 12 px
  chevron; at the right, New card (+) and Open board in Fizzy.
- **Filter row**, 36 px, in every view but Inbox: a 28 px field ("Filter cards…", rounded 7, 1 px `input` border) and,
  on Board, a **Me** toggle (28 px, `accent` border and `selected` fill when on).
- **The list**, scrolling, padding 6:
  - Board: a 28 px header per lane: a 12 px chevron, an 8 px dot in the lane's color, the lane's name (medium), its
    count (11 px, `dim`) and, on Maybe? and the columns, a 22 px +. Column colors are Fizzy's names as hex: blue
    `#4b73e6`, gray `#8a8f98`, tan `#b69a7a`, yellow `#e5b422`, lime `#8cc63f`, aqua `#2fbfbf`, violet `#7c5ce6`, purple
    `#a855c7`, pink `#e8579f`, red `#e5484d`, orange `#f08a24`, green `#3fa65b` (Fizzy also sends `var(--color-card-N)`:
    default blue, 1 gray, 2 tan, 3 yellow, 4 lime, 5 aqua, 6 violet, 7 purple, 8 pink). Maybe?, Not Now and Done
    have no color (`dim`).
  - A card row, 46 px, rounded 7: a 3×30 px bar in its lane's color (`border` when none); line one: a 12 px star in
    `ansi3` when golden, `#number` (11 px, `dim`), the title (cut), and two 22 px buttons, Insert (↵) and More (⋯);
    line two (11 px, `dim`): up to three tag chips (`raised`, rounded 5, at most 90 px) and `+N`, up to three 16 px
    round avatars, and at the right the time since it changed (`now`, `5m`, `3h`, `2d`, then `Mar 4`, with the year
    when it is not this one). A picked card is `selected`.
  - Mine and search results: a 26 px board name (12 px, medium, `muted`) over that board's cards.
  - Inbox: a **Mark all read** button, then one block per note: a 7 px `accent` dot, the sender's 16 px avatar, the
    title in semibold; the text (12 px, `dim`, wrapping); `#number · board · sender · time` (11 px, `dim`).
  - Under Board or Mine filtered by words, a 30 px row **Search all boards for "…"**.
  - States as one dim 12 px line: `Loading…`, `No cards`, `No cards match`, `No cards found` (Search all boards),
    `No boards`, `No pinned cards`, `You're all caught up`; an error adds a 28 px **Retry** row.
- **The bar**, at the foot, `chrome` behind it, a 1 px line above it, padding 6: four buttons sharing the width, each 28
  px, rounded 7, `raised`, 12 px medium: **Insert**, **Send** ▾, **Start** ▾, **Copy**, each with a 13 px icon before
  its label and an 11 px chevron after Send and Start. Below 340 px the icons go and the labels and chevrons stay, on
  one line at 280. With nothing to act on they are `dim`.

**A card**, in place of the board row, filter and list: a 42 px top bar (Back, `#number` and the board in 12 px `dim`,
then three 26 px toggles: pin and watch lit in `accent` on `selected`, golden lit in `ansi3`; Open in Fizzy, left out
when narrow; More). Then the title (15 px semibold, wrapping) with a 26 px lane chip at its right (an 8 px dot, the
lane's name at most 140 px, 96 when narrow, a chevron); **People** (20 px avatars and names) and **Tags** (chips),
each with a 52 px label; **Description** (rich text; `No description`); **Steps** with `done/total` (16 px boxes,
`accent` when ticked, ticked text struck through and `dim`; a field "Add a step" at the end); **Comments** with a
count (20 px avatar, name in medium, time; the text indented 26 px; an **Activity** row, folded, with Fizzy's own
lines at 11 px), and at the end a three-line box "Write a comment…" with a **Comment** button.

**Settings**, from the gear: a header with Back and "Settings", then **Board groups** with a + at the right. Each group
is a 28 px line: a chevron, its name (medium; `dim` when hidden), its rule (`contains "…"`, or `"…"` when narrow, or
`No rule`; 11 px `dim`), the number of boards, a bin and an eye; its boards under it, indented 31 px, each with an eye.
Then **No group** with its boards. The bar is left out here.

**Popups**, 260 px wide (320 for Send's list of sessions), as tall as their rows and at most 560 px: `popover`
behind 12.8 px text, 31 px rows (an icon, the label, a hint in 11 px `dim`), 28 px labels, 9 px separators; the
highlighted row is `selected`, a destructive one `blocked`.

**People** are round photos where one is cached, else a circle with their initials (the first letters of the first and
last words, `background` colored text) on one of `ansi1` `ansi2` `ansi3` `ansi4` `ansi5` `ansi6` `ansi9` `ansi12`,
picked by a steady hash of their id.

**The tab bar's button**, after Files and Changes and before the window buttons: 26 px, padding 8, rounded 6, 12 px
text, the kanban icon (14 px) and "Fizzy", `selected` while the Fizzy page is in front, else `chrome`; a 6 px `accent`
dot after the label while `fizzy.unread` is above zero.

## How it behaves

- **Views.** Fizzy shows the Board view; Mine, Inbox and Pins switch to theirs. The view, the board picked and whether
  the panel follows the space are kept between runs.
- **Which board.** Following (the default): the nearest `.fizzy.yaml` from the active space's folder up, read on that
  space's machine, names the board by id. Else the board picked, then the CLI's default board (`config show`), then the
  first board. That default is kept for the next start; the very first start waits for it before it picks a board.
  Picking a board in the dropdown stops following; its first row, **Follow current space**, starts it again and shows
  the space's board (or `no .fizzy.yaml`) as its hint.
- **Board.** Lanes in the order of `fizzy column list`; Maybe? first and Not Now and Done last when missing. Not Now
  and Done start folded and are read when unfolded; Done reads page by page and shows 50, then **Show more** (50
  more). A header's click folds its lane (kept per board). Pressing a card and letting go over another lane's header or
  cards moves it there; the change shows at once and the list reads again after the CLI answers.
- **Picking.** ⌘-click or Ctrl-click a card toggles it in the picked set (`selected`); a plain click opens it.
- **Filter.** Every word must appear in the title, `#number`, a tag, an assignee's name, the column or the first 300
  characters of the description. **Search all boards** asks every board, six at a time, and shows
  `Searching N boards…`, then a section per board; the x closes it, and changing the words drops it.
- **Card.** Click the title to rename (Enter saves, Escape or the x cancels); the lane chip opens the lanes popup;
  People and Tags open their pickers (people: you first, with `you` as the hint; tags: a "New tag…" field at the top).
  The description and comments are edited as plain text: blank lines split paragraphs, a single line break stays, and
  lines starting `- `, `* ` or `• ` (the mark, then a space) become a bulleted list, so a numbered list comes back as
  a bulleted one; a note says "Saving keeps only the text: formatting is lost." when there is other formatting.
  Deleting your comment takes two clicks (the bin turns into `Delete?`). Links in a description or comment open in the
  browser. The watch toggle is dim until it is set from the panel.
- **Menus.** A right-click on a card, its ⋯, or the card's ⋯ opens the card menu; Up, Down and Enter move and choose,
  Escape closes. Delete card… asks again (`Click again to delete #N`).
- **The bar.** Acts on the open card, else the picked cards, else in the Board view the board. The reference is
  `Fizzy #N "Title" (url)`, one line per card, or `Fizzy board "Name" (url)`. Insert pastes it into the agent of the
  focused pane, else of the focused agent block, else the tab's agent that changed last; with none it copies and
  toasts `Copied — no agent here`. Send lists the running agents (each as `Program · tab`, with `space · status` as the
  hint, the one Insert would use first); choosing one selects its space and tab, focuses its pane and pastes. Start
  lists up to six installed agents of the active space's machine; choosing one opens a tab named after the card
  (`#N Title`, cut to 32 characters) or the board, running that agent with no first message, and pastes once that
  session's status is `idle` or 3 seconds after it appeared; after 30 seconds with no session, the reference goes to
  the clipboard with a toast. Copy copies and toasts `Copied`. Nothing ever presses Enter. A paste borrows the
  clipboard and puts the old text back 500 ms later.
- **Notifications.** Every 30 s, shown or hidden, the unread notifications are read: the count goes to `fizzy.unread`
  and the Inbox badge, and each one not seen before becomes an `info` toast for 8 s (title up to 80 characters; body:
  the first line up to 140, `#N`, the board), at most three per poll plus `N more in Fizzy`. A panel with nothing
  remembered learns what is there without toasts. A toast's click opens its card and marks it read, bringing the
  Fizzy page up first when needed.
- **Inbox.** Only unread notes, newest first. A click marks the note read, removes it and opens its card; Mark all read
  empties the list. A refusal from Fizzy puts the note back.
- **Polling.** Every 30 s while the page shows (and at once when it shows again): the open card, its comments and the
  pin list, else the view (Mine every other time); never while a title, description, step or comment is edited.
- **Board groups.** + adds a group at the top. Clicking the name or the rule edits it in place; the bin asks once
  (`Delete?`); the eye hides; clicking the rest of the line folds. A press with ⌘ or Ctrl held on a board or group picks
  it up: the block under the pointer is `selected` (for a board) or shows a 2 px `accent` line where a group lands, and
  letting go places it. The dropdown leaves out hidden boards and groups, except the board shown.
- **Errors** are shown as text: ``Not signed in to Fizzy: run `fizzy auth login <token>` in a terminal``,
  `The fizzy CLI isn't installed (or not on PATH)`, `Fizzy took too long to answer`, `Can't reach Fizzy`, `Not found
  in Fizzy: it was deleted, or you can't see it`, `Fizzy doesn't let you do that`, `Fizzy is busy: try again in a
  minute`, else the CLI's own message.
- **Keys.** `<tab bar>.panel:fizzy` toggles the Fizzy page like its button. No key is bound to it unless asked
  (`install.sh --add-key` binds `cmd-shift-j`, on Linux `ctrl-shift-j`, in `global` when that key is free): an edit to
  `keys.json` stops Herdr adding its new default shortcuts to it.
  `fizzy.<command>` (`refresh`, `view[:board|mine|inbox|pins]`, `board:<id or name>`, `follow`,
  `open:<n>[:<notification id>]`, `back`, `settings`, `insert`, `send`, `start`, `copy`, `new`, `filter`, `menu:<n>`)
  reaches the panel while it is shown.

## Built from

- **Herdr** 0.1.12 or newer; `install.sh` checks at install time that the tab-bar patch fits. On a Herdr whose tab bar
  changed so that it doesn't, the patch is applied by hand (`tabs/README.md`).
- **Layout.** Herdr's `main`, with one block added last to the `panel-body` stack (inside the `panel` column, which
  starts hidden): `{ "id": "fizzy", "type": "block", "content": { "mod": "fizzy" } }`, and the tab-bar block's
  `content.mod` pointed at the patched tab bar (`fizzy-tabs`). `layout/add-fizzy.jq` makes both changes.
- **Mods.** `fizzy` (`mod.json`: `{ "place": "none", "title": "Fizzy" }`): one class that is the panel, and also every
  popup, opened as `openOverlay({ mod: "fizzy", kind: "popup", props: { menu } })` with `menu.kind` one of `boards`,
  `card`, `agents`, `start`, `users`, `tags`, `moveBoard`, `lanes`. `lib.js` holds the pure parts (no imports).
  `fizzy-tabs` is Herdr's `tabs` cloned, plus `tabs/fizzy-button.patch`: a Fizzy button when `panel-body` has a `fizzy`
  child, its dot from `fizzy.unread`, and a `nextCommand()` loop taking `panel:<page>`.
- **Shipped mods it relies on.** `tabs` (cloned), `toast` (draws `notify`), `new-menu` (its `new-menu.agents` cache is
  read and written), and Herdr's `icons/` for the agents' icons.
- **`herdr` functions.** `exec`, `agents`, `panes`, `spaces`, `focused`, `knownAgents`, `theme`, `shared`, `setShared`,
  `layout`, `home`, `appHome`, `props`, `run`, `notify`, `openOverlay`, `closeOverlay`, `nextCommand`, and
  `localStorage`. From `gpui-kit`: `View`, `div`, `svg`, `image`; from `gpui-base`: `v_flex`, `h_flex`, `InputState`,
  `Input`, `TextareaState`, `Textarea`, `TextView` (`TextView.html` for descriptions and comments).
- **Commands.** `space.select`, `tab.select`, `pane.focus`, `terminal.paste` (the hand-offs), `tab.new` (Start),
  `layout.show` (a toast); toast actions `fizzy.open:<n>:<id>`, `layout.show {id: "panel"}`,
  `layout.select {stack: "panel-body", child: "fizzy"}`. The tab bar: `layout.select`, `layout.show`, `layout.hide`.
- **Shared state.** `fizzy.unread`, `fizzy.boards`, `fizzy.people`, `fizzy.avatars`, `fizzy.boardGroups` (written by
  the panel); `fizzy.request` and `fizzy.board` (a popup's action and board choice, done by the panel).
- **Programs.** `fizzy` 4 or newer, always run from the home folder, every command ending with `--json`. It reads with
  `board list --all`, `column list --board`, `card list --board <id> --all` (also with `--indexed-by not_now`,
  `--assignee <user>` or `--search <words>`; Done as `--indexed-by closed --page <n>`), `card show`,
  `comment list --card <n> --all`, `user list --all`, `tag list --all`, `pin list`, `notification tray`,
  `identity show` and `config show`. `card list`, `pin list`, `notification tray` and `config show` carry a `--jq`
  projection: only the envelope's `ok` and the fields the panel uses come back. It writes with the `card` commands
  `create`, `update`, `column`, `postpone`, `untriage`, `close`, `reopen`, `golden`, `ungolden`, `pin`, `unpin`,
  `watch`, `unwatch`, `self-assign`, `assign`, `tag`, `move` and `delete`; `step create`, `update` and `delete`;
  `comment create`, `update` and `delete`; `notification read` and `read-all`. Then `sh -c` with a script that walks
  up for `.fizzy.yaml` (`[` and `cat` only), run with `exec(…, { on: space.machine })`, and `sh -c` with a script that
  fetches a photo with `curl` into `<appHome>/data/fizzy/avatars/<user id>-<YYYYMMDD>.<ext>`.
- **Art.** Lucide icons in `mods/fizzy/` (24×24, `stroke="currentColor"`): arrow-left, bot, check, chevron-down,
  chevron-right, copy, external-link, eye, eye-off, insert (Lucide's corner-down-left), kanban (square-kanban), link,
  more (ellipsis), pencil, pin, pin-off, plus, refresh (refresh-cw), rotate-ccw, search, send, settings, star, star-off,
  tag, trash, user, user-plus, x.

## Watch out

- **The CLI answers with an envelope.** Asked with `--json`, it answers
  `{ "ok": true, "data": … }` or `{ "ok": false, "error": "…", "code": "…" }`, on stdout whatever the exit code, so
  stdout alone is read, and a warning printed before the JSON must not hide it. Herdr stops a program after 30 s with
  `<program> took longer than 30 s and was stopped`; any other `exec` rejection is a missing CLI.
- **`card show` and Done's pages are typed**: empty `assignees`, `tags` and `steps` and an empty description are left
  out, and no column comes as one with an empty id; a notification about no card has card number 0.
- **`identity show`'s own id is the login's**, not the user's: assignees and authors carry the account's user, found in
  `accounts[]` by the slug of the account `config show` names.
- **Done's pages are short**: read page by page until a page says none follows (the last one has no `has_next`) or one
  comes back empty (a page past the end says one follows), at most 40 pages.
- **The CLI can't make a card in a column**: make it in Maybe?, then `card column`. Moving a closed card reopens it
  first; a reopened card goes back to its last column.
- **Fizzy doesn't report watching**: only what the panel set is known.
- **Run `fizzy` from the home folder**, and name the board in every command that takes one (`column list`,
  `card list`, `card create`), so a `.fizzy.yaml` near Herdr doesn't change what it reads.
- **A popup's tasks and timers die when it closes.** A popup leaves its action in `fizzy.request` and closes; the
  panel, which lives on, does the write, the paste and the wait for a new session.
- **A hidden copy is never drawn.** What the panel must notice while hidden (a popup's request, a toast's click, a
  starting session, photos to fetch) is looked for on a 300 ms timer, and a 1 s timer notes that the panel is hidden
  so the next draw reads again.
- **A draw may not act**: `cx.notify()` throws during a draw. A draw that finds work schedules it with
  `cx.timer.after(1, …)`.
- **`<mod>.<command>` reaches shown copies only**, so `fizzy.*` keys do nothing while the page is hidden, and a toast
  (whose action runs one command) for a hidden page runs `layout.show` or `layout.select`; the panel opens the card
  when it sees the page come up, up to a minute later.
- **`image()` draws files only**, and Fizzy's photo addresses redirect to links that expire, so photos are fetched to
  files; the day in the file name keeps Herdr's image cache from showing an old one.
- **`TextView` ignores `<br>`**: the HTML is rewritten so each break ends a block.
- **Paste goes through the clipboard** (`terminal.paste`), so the person's clipboard text is put back afterwards.
- **280 px**: every row must shrink to the panel's narrowest; the bar keeps its four buttons on one line there.
- **Assumes** the layout ids `panel`, `panel-body` and `fizzy`; macOS or Linux (`sh`, `curl`). None of the CLI's own
  files is read: `config show` names its account and default board.
- **Not built:** reactions, attachments, making or changing boards and columns.

## Done when

- `herdr-app check` passes for `mods/fizzy` and the patched tab bar.
- With the layout's Fizzy page and the CLI signed in, Board shows the board's lanes in `column list` order, Not Now
  and Done folded; unfolding Done shows up to 50 cards and Show more.
- Dragging a card from one lane onto another lane's header moves it in Fizzy (`fizzy card show` agrees), and the list
  shows it there after the next read.
- With an agent in the focused pane, Insert puts `Fizzy #N "Title" (url)`, followed by a space, in its input, and
  nothing is submitted; with none, the reference is on the clipboard and a toast says so.
- Start on a card opens a tab named `#N Title`, running the chosen agent, and the reference appears in its input once
  it is idle.
- A `.fizzy.yaml` with `board: <id>` in a space's folder makes that board show when that space is active and Follow
  current space is on.
- With the panel hidden, a new notification gives a toast within 30 s and the tab bar's dot; clicking the toast brings
  the Fizzy page up with that card open, and the notification is read.
- With the CLI signed out, the panel says ``Not signed in to Fizzy: run `fizzy auth login <token>` in a terminal`` and
  offers Retry.
- At 280 px the header, the board row and the bar's four buttons each fit on one line.
- `npm test` passes.
