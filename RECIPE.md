# Fizzy

A **Fizzy** page in the right panel, next to Files and Changes, opened from a Fizzy button in the tab bar. It shows a
Fizzy board as tinted lane blocks of card tiles, your cards on every board, your unread notifications and your pinned
cards, and searches every board; a card is made at once and opens in the panel to be renamed, moved, assigned, tagged,
ticked off and commented on, with @-mentions, card links, reactions, images and files. A bar at a card's foot hands it
to a coding agent running in Herdr by pasting a one-line reference into the agent's input, never submitted. Unread
notifications pop up as toasts even while the panel is hidden, and a dot on the button shows while there are any.
Everything goes through the `fizzy` CLI.

## What you see

Top to bottom, inside the panel (Herdr's `main` layout gives it 368 px, at least 280 and at most 900). The panel is one
column, rounded 10, with a 1 px `border` and the `background` color; text is 13 px in `foreground`. Colors here are
theme names.

- **Header**, 42 px, padding 10, a 1 px line under it. At the left, **Fizzy**: the kanban icon (14 px) and, from 440 px
  of panel width, the word "Fizzy" in semibold, 26 px high; it is `selected` while the Board view shows, and without
  the word it has the tooltip "Board". Then **Mine**, **Inbox** and **Pins** (12 px, `selected` when shown); while
  there are unread notifications, Inbox carries a round 16 px badge in `accent` with their number. At the right (gap
  2), **Search** (tooltip "Search all boards"), **Refresh** and **Settings**: 26 px icon buttons, 14 px icons in
  `muted`, `hover` behind them and `foreground` on hover. The panel's width has three tiers, measured on the panel's
  root (its border included):

  | Panel width | Fizzy and the views | Gap | Refresh |
  |---|---|---|---|
  | 440 px and up | icon and word, padding 8 | 8, 3 between the views | shown |
  | 340 to 439 px (368 by default) | icon alone, padding 6 | 6, 2 between the views | shown |
  | under 340 px | icon alone, padding 6 | 6, 2 between the views | left out |

  Without Refresh, Refresh stays reachable by the `refresh` key and the 30 s poll. While the search is open, the
  header (padding 10, gap 6) is Back (26 px, arrow-left, tooltip "Back") and the search field, taking the room: 28 px,
  rounded 7, 1 px `accent` border, `background`, 12 px, padding 8, placeholder "Search all boards, or #number…". While
  a field has words, a 20 px **x** sits at its right end inside it (4 px in, rounded 5, a 12 px x in `dim`; `hover`
  behind it and `foreground` on hover; tooltip "Clear"), and the field's right padding is 28.
- **Board row**, 36 px, padding 10, gap 6, **in the Board view only** (Mine, Inbox and Pins go straight from the header
  to their list; it is left out while the search is open): a select and a button. The select takes the room: 28 px,
  rounded 7, 1 px `input` border, `background`, padding 8, gap 7, `hover` behind it on hover; a 14 px kanban icon in
  `muted`, the board's name (13 px medium, `foreground`, `dim` with no board, cut with an ellipsis), "Following space"
  (11 px `dim`, left out when narrow) while following and showing the space's own board, and a 12 px chevron in `dim`
  at the right end. Its tooltip is "Following the current space" in that case, else "Switch board". At its right,
  **Open board in Fizzy**: 36×28, rounded 7, 1 px `input` border, `background`, a 14 px external-link icon in `muted`
  (`foreground` and `hover` behind it on hover; `dim` and inert without a url), tooltip "Open board in Fizzy".
- **The list**, scrolling, padding 8, gap 8:
  - Board: one block per lane, rounded 10, a 1 px border in the lane's color at alpha `33`. Its header, 34 px, padding
    10 at the left and 6 at the right, gap 8, has the lane's color at alpha `26` behind it (`40` on hover): a 12 px
    chevron in `dim`, a 9 px dot in the lane's color, the lane's name (12 px semibold, cut), its count in an 18 px pill
    (at least 18 wide, padding 6, `raised`, 11 px `muted`; no pill while the lane is not read) and, at the right end on
    Maybe? and the columns, a 22 px + in `dim` (tooltip "New card here"). Under an unfolded header, its cards: padding
    6 (2 at the top), gap 6. An alpha is two hex digits after the color's `#rrggbb`.
  - Lane colors: a column's is Fizzy's color name as hex: blue `#4b73e6`, gray `#8a8f98`, tan `#b69a7a`, yellow
    `#e5b422`, lime `#8cc63f`, aqua `#2fbfbf`, violet `#7c5ce6`, purple `#a855c7`, pink `#e8579f`, red `#e5484d`, orange
    `#f08a24`, green `#3fa65b` (Fizzy also sends `var(--color-card-N)`: default blue, 1 gray, 2 tan, 3 yellow, 4 lime,
    5 aqua, 6 violet, 7 purple, 8 pink). Fizzy gives Maybe?, Not Now and Done none: Maybe? is `#4f8ef7` (Fizzy's own
    blue), Not Now `#8a8f98`, Done `#9aa0aa` (Fizzy's muted gray). A column whose color is not known is `#8a8f98`.
  - A card is drawn as Fizzy's: rounded 8, clipped, `background` behind it and a 1 px `border` border (`input` on
    hover); golden, a layer under its content (`window.paint_path`, the card's whole rectangle) filled with a 45° linear
    gradient from `#e5b42200` to `#e5b42238`; picked, `selected` behind it and a 1 px `accent` border. Its top line
    starts with a tab at the card's top left in the lane's color (padding 9 by 4, its bottom right corner rounded 6,
    11 px semibold `#15171c` text): the number, a 1 px rule, the board's name in capitals. In Mine, Pins and the search
    the lane's name in capitals follows (10 px, in the lane's color, after a 6 px dot). At its right: `✓ done/total`
    (`circle-check` in the lane's color, `done` when all are done) once the counts are read, the inactivity label, and
    two 22 px buttons, Insert (↵) and More (⋯). Then, padding 11 by 6 and 10, gap 7: a 13 px `accent` pin when the pin
    list has the card and the whole title (13 px, bold, wrapping); up to three tag chips (`#tag`) and `+N`. Then the
    meta line (10 px, in the lane's color): the creator's 20 px avatar; `ADDED <days>` over the creator's name, a rule
    between; a 1 px divider; `refresh` and the day it last changed over `arrow-right` and the assignees' names; up to two
    20 px assignee avatars; at the right `message-square-text` (in the lane's color) and the comment count when there are
    comments. Days are calendar days: `TODAY`, `YESTERDAY`, `N DAYS AGO`. The label is 16 px high, padding 5,
    rounded 4, with a 1 px border and medium text in one color: `ansi3` for `Closes in Nd` and `Closes today`, `blocked`
    for `Stalled`.
  - Mine and search results: a 26 px board name (12 px, medium, `muted`) over that board's cards.
  - Inbox: a **Mark all read** button, then one block per note: a 7 px `accent` dot, the sender's 16 px avatar, the
    title in semibold; the text (12 px, `dim`, wrapping); `#number · board · sender · time` (11 px, `dim`).
  - The search: a 30 px line `Results for "…"` (a 13 px search icon, 12 px `muted`) over the boards' sections.
  - States as one dim 12 px line: `Loading…`, `Press Enter to search every board, comments included.` (the search,
    before Enter), `Searching…`, `No cards`, `No cards match`, `No cards found` (the search), `No boards`,
    `No pinned cards`, `You're all caught up`; an error adds a 28 px **Retry** row.
- **The bars**, at the foot: one line each, `chrome` behind it, a 1 px line above it, padding 6.

  | Where | Bar |
  |---|---|
  | Board, no card picked | the filter, My cards and New card (gap 6) |
  | Mine and Pins, no card picked | the filter |
  | A card; a list or the search with cards picked | the hand-off buttons |
  | A card New card has just made | Discard and Done |
  | The Inbox; the search with no card picked; Settings | none |

  - The filter takes the room: a 28 px field, rounded 7, 1 px `input` border, `background`, 12 px, padding 28 at the
    left, where a 14 px search icon sits in `dim` (9 px in, 7 down), and the **x** of the search field while it has
    words. The Board view's field says "Filter this board…"; Mine and Pins share one that says "Filter cards…".
  - **My cards**: 28 px, rounded 7, padding 8, gap 5, 12 px, a 13 px user icon and "My cards", a 1 px `input` border,
    `background`, `muted` text, `hover` behind it on hover; on, an `accent` border, `selected` behind it and
    `foreground` text.
  - **New card**: 28 px, rounded 7, padding 10, gap 5, 12 px medium, a 13 px plus and "New card", in the
    primary-button colors (`solid` behind `solid_foreground`; `opacity` 0.88 on hover). Until a board shows it is
    `raised` and `dim`, with no hover, pointer or click.
  - Below 340 px My cards and New card are their icon alone, 28×28, with the tooltips "My cards" and "New card".
  - The hand-off buttons, gap 4: four buttons sharing the width, each 28 px, rounded 7, `raised`, 12 px medium:
    **Insert**, **Send** ▾, **Start** ▾, **Copy**, each with a 13 px icon before its label and an 11 px chevron after
    Send and Start. Below 340 px the icons go and the labels and chevrons stay, on one line at 280.
  - **Discard** at the left and **Done** at the right: 30 px text buttons, padding 10, gap 6, rounded 7, 12 px medium,
    a 13 px icon (trash, check), `opacity` 0.88 on hover; Discard `raised` behind `foreground`, Done in the
    primary-button colors.

**A card**, in place of the board row and list: a 42 px top bar (Back, `#number` and the board in 12 px `dim`, then
three 26 px toggles: pin and watch lit in `accent` on `selected`, golden lit in `ansi3`; Open in Fizzy, left out when
narrow; More). Then the title (15 px semibold, wrapping; edited, a 34 px field in 15 px, `accent` border, placeholder
"Card title", and an x) with a 26 px lane chip at its right (an 8 px dot in the lane's color, the lane's name at most
140 px, 96 when narrow, a chevron); **People** (20 px avatars and names) and **Tags** (chips), each with a 52 px label;
**Description** (rich text; `No description`); **Steps** with `done/total` (16 px boxes, `accent` when ticked, ticked
text struck through and `dim`; a field "Add a step" at the end); **Comments** with a count (20 px avatar, name in
medium, time; the rich text indented 26 px, the reactions under it; an **Activity** row, folded, with Fizzy's own
lines at 11 px), and at the end a three-line box "Write a comment… (@ mention, # card, drop or paste images)" with a
**Comment** button. The description's editor is eight lines, "Add a description… (@ mention, # card, drop or paste
images)"; a comment's own, four lines. While a file uploads into a box, `Uploading <name>…` (11 px `muted`, cut) shows
under it.

**Rich text** (a description, a comment) is drawn by the panel, 13 px. A block (paragraph, list, heading, quote, `pre`,
image, file) starts 8 px under the one before; a line break starts a line; a line wraps between its words. Bold and
headings are bold, italic italic, `code` and `pre` in the theme's mono font (`pre` keeps its white space). A list item
has its `•` or `N.` in a 20 px column in `dim`, a nested list 20 px further in; a quote has a 2 px `border` line at its
left, 8 px of padding, and `muted` text. A link is `accent` and underlined; a mention is `@Full Name` in bold `ansi4`;
a card link is `#N Title` in bold `ansi3`.

- An image is as wide as it is, at most the text's width (the panel's width less 40 px in the description, 66 in a
  comment, never under 120), at its own aspect ratio (0.6 when not known; at least 24 px high), rounded 6, with a 1 px
  `border`. Until it is on disk, that box is `raised`, with its file name and `Loading image…` (12 px `dim`) in the
  middle. A caption goes under it in 12 px `muted`.
- A file (and an image over 15 MiB, or one that failed to download): a 30 px chip at most the text's width, padding 8,
  gap 6, rounded 6, 1 px `border`, `raised` (`hover` on hover): a 13 px paperclip in `muted`, the name (cut), the size
  in 11 px `dim` (`820 KB`, `3.4 MB`; none when unknown). Tooltip "Save to Downloads", or "Open in the browser" for an
  image from the web.

**Reactions**, under a comment once its reactions are read, indented 26 px, wrapping, gap 4: a chip per emoji, 22 px
high, padding 7, gap 4, rounded 11, 12 px, with the emoji and its count in `muted`; yours with a 1 px `accent` border
on `selected`, the others `raised`; `hover` on hover; its tooltip names who reacted. Then a 22 px smile-plus button,
tooltip "Add reaction".

**Tokens**, how an editor shows a person, a card or a file: `@Full Name` in bold 13 px `ansi4` (`dim` while the panel
has no mention id for that person), `#N Title` in bold `ansi3`, and `🖼 name` (an image) or `📎 name` (another file)
in 12 px `muted` on `raised`, rounded 4, padding 5. A selected token has `selection` behind it.

**Settings**, from the gear: a 42 px header with Back (tooltip "Back"; on a page, "Settings") and "Settings" or the
page's name, in semibold. Then, padding 10, gap 8, the list: one 52 px block per setting (padding 12 across and 8 down,
gap 12, rounded 9, 1 px `border`, `input` on hover, `surface`): a 30 px square (rounded 8, `background`) with a 15 px
icon in `muted` (user for Mentions, kanban for Board groups), the name (medium) over what it is set to (12 px `dim`,
cut), and a 14 px chevron-right in `dim`.

| Setting | What it is set to |
|---|---|
| Mentions | `Can tag N of M people · Finds new ones by itself`, or `· Manual only`; `Loading people…` |
| Board groups | `N groups`, `1 group` or `No groups` |

- **Mentions**: four blocks (padding 12, gap 8, rounded 9, 1 px `border`, `surface`; a title in medium, then a note in
  12 px `dim`, then the controls): `You can tag N of M people`, noting `Not yet: <names>` or `Everyone can be tagged
  with @.`; **Find mentions automatically**, noting "While someone can't be tagged, the panel reads Fizzy's recent
  activity in the background, at most once a week, and learns them from mentions made there.", with a switch (34×20,
  round, padding 2; on, `solid` with a 16 px `solid_foreground` knob at the right; off, `raised` with a `muted` knob at
  the left) and `On` (`foreground`) or `Off` (`dim`); **Find mentions now**, noting "Reads up to 600 recent events
  across your boards, once.", with the text button **Find mentions in Fizzy** (search icon; `Searching… page N` while
  it runs) and then its outcome (`Learned N more people`, `Learned 1 more person`, `No new mentions found`, `Reading
  #N…`, or the error with Retry); **Learn from a card**, noting "Fizzy lets the panel tag only people it has seen tagged
  before. To teach it everyone at once: in Fizzy, post one comment on any card that @-mentions each person, then enter
  that card's number here and press Enter.", with `#` (13 px `dim`) and a 140 px field "Card number".
- **Board groups**: "Groups sort the board dropdown. The eye hides a board or a group from it." (12 px `dim`, wrapping)
  with a + at the right. Each group is a 28 px line: a chevron, its name (medium; `dim` when hidden), its rule
  (`contains "…"`, or `"…"` when narrow, or `No rule`; 11 px `dim`), the number of boards, a bin and an eye; its boards
  under it, indented 31 px, each with an eye. Then **No group** with its boards.

The bars are left out in Settings.

**Popups**, 260 px wide (320 for Send's list of sessions), as tall as their rows and at most 560 px: `popover`
behind 12.8 px text, 31 px rows (an icon, the label, a hint in 11 px `dim`), 28 px labels, 9 px separators; the
highlighted row is `selected`, a destructive one `blocked`. Tags and the two pickers have a 28 px field over their rows
(rounded 7, 1 px `input` border, 12 px): "New tag…", "Search people…" (`mention`), "Card number or title…" (`cardref`).

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
- **New card.** Fizzy has no drafts, so New card makes the card at once. The Board view bar's New card opens the
  `newCard` popup: the label "New card on", then the boards as the dropdown lists them (hidden ones left out, except
  the board shown), the board shown ticked and highlighted so that Enter means "on this board", and no Follow row.
  Choosing a board writes `fizzy.board` with `compose: true`. The panel moves to that board as for any pick (following
  off, the pick kept), except when it is the board already shown: then following and the pick stay as they are. A
  moment later (a draw may not act) it leaves an open card or Settings, shows the Board view, closes the search, and
  runs `card create` with the title `New card` on that board. A lane header's + does the same at once, with no popup,
  in that lane: a card for a column is made in Maybe?, then moved with `card column`. When the answer has no number,
  the newest open card titled `New card` is the one. The card opens with its title field empty and focused; Enter
  saves the title, and Escape, or no title, leaves `New card`. Its foot is **Discard** (`card delete`, then back to
  the list) and **Done** (back to the list). While one is being made, New card does nothing; a failure is an `error`
  toast. The `new` key opens the same popup, and does nothing without a board.
- **Board, side by side** (from 480 px of panel width): `fizzy-columns`, the lanes in a row, gap 8, padding 8. Open
  lanes (`openColumns`, per board, Maybe? when none; one below 760 px, two from 760 px, the one opened longest ago
  folding first) share the width: a 30 px head (a 10 px dot in the lane's color but on Done, the name in capitals,
  13 px semibold, + on Maybe? and the columns) over their cards, which scroll on their own. A folded lane is 36 px wide,
  as tall as the board, clipped: its count (13 px semibold, 10 from the top) and its name in capitals read top to bottom,
  over a pill (`window.paint_path`: a round top of radius 18, then straight down) filled with a 180° gradient from the
  lane's color at `b3` (`#8a8f98` for Not Now and Done) to nothing, 36 px tall and 28 more per card, at most 480 (480
  while Not Now or Done is not read), over a 1 px line in the color at `4d` from below the name to the foot. The name is
  an SVG file (`data/fizzy/labels/<shortHash>.svg`, its text turned 90°), written by the request
  timer once per run; until it is there the pill shows its count alone. A pill's click opens its lane; an open lane's
  head folds it unless it is the only one open. Not Now and Done are read when they open.
- **Board, stacked** (narrower): lanes in the order of `fizzy column list`; Maybe? first and Not Now and Done last when
  missing. Not Now and Done start folded and are read when unfolded; Done reads page by page and shows 50, then **Show
  more** (50 more). A header's click folds its lane (kept per board).
- **Maybe?'s head** (both): `fizzy-watch`, a bordered box, padding 12 by 14: **Add a card** (`solid`, rounded full;
  New card in Maybe?), then once `board accesses --jq` has named the watchers (read with the columns), `WATCHING FOR NEW
  CARDS` between two rules, their 28 px avatars (eight, then `+N`), and **Watch for new cards** (`bell`) or **Stop
  watching** (`bell-off`) in `accent` for the signed-in user: `board involvement <id> --involvement watching` or
  `access_only`, shown at once, then the watchers are read again.
- **Card counts.** After each read of the board (and of Not Now or Done), every card whose kept counts are not for its
  `last_active_at` is wanted; the request timer reads them three cards at a time with `card show` (its steps) and
  `comment list --card <n> --all --jq '{ok, data: ((.data // []) | length)}'`. Kept for the last 400 cards (`counts`); a
  failed read is kept too, so it is not asked again until the card changes. Opening a card sets its counts from the card
  page's own reads.
- **Board, both.** In each lane golden cards come first, the rest in Fizzy's order. Pressing a card and letting go
  anywhere over another lane's block (its header, its cards or between them, or its folded pill)
  moves it there; the change shows at once and the list reads again after the CLI answers. Pressing a column's header
  and letting go over another column's block moves the column to that place (before it moving left, after it moving
  right): the lanes reorder at once, `column move-left` or `move-right` runs once per place, and the columns are read
  again. Maybe?, Not Now and Done neither move nor take a column.
- **Inactivity.** A card that is neither closed nor postponed shows Fizzy's own warning, as Fizzy's card decides it.
  With the board's `auto_postpone_period_in_days` (from `board list`) as P, and N the calendar days from today to the
  day `last_active_at` plus P days falls on: when N is under P × 0.25, rounded, `Closes in Nd`, or `Closes today` when
  N is under 1. Else `Stalled`, when the card is in `card list --board <id> --indexed-by stalled --all` (only the
  numbers come back). That list is read with the columns, in the same go; a failure only costs the labels.
- **Picking.** ⌘-click or Ctrl-click a card toggles it in the picked set (`selected`); a plain click opens it. While
  any card is picked, the hand-off buttons replace the list's bar.
- **Filter.** As you type, every word must appear in the title, `#number`, a tag, an assignee's name, the column or the
  first 300 characters of the description. The Board view's field is its own; Mine and Pins share the other. My cards
  keeps the cards assigned to the signed-in user. On Board, while words or My cards filter, every lane holding a match
  is drawn unfolded; the fold kept for it does not change. The x empties the field.
- **Search.** The header's search icon (and the `search` key) leaves an open card or Settings and turns the header into
  the search field, focused; the search takes the place of any view's list, and the board row and the list's bar go. The
  field keeps its words when the search closes. Enter runs one `fizzy search` (account-wide: every board, open, Not Now
  and closed cards, comments), shows `Searching…`, then a section per board; a newer search drops the older one's
  results. A leading `#` and surrounding white space are cut from the words. When 15 cards come back (Fizzy's most), a
  dim line says `Fizzy shows its 15 newest matches. Add words to narrow it.` When Fizzy does not answer (TIMEOUT or
  `rate_limit`: its limit is 300 searches an hour per user), the line says `Fizzy didn't answer the search. Its search
  limit (300 an hour, shared with your agents) may be used up. Try again later.` with Retry, and nothing retries by
  itself. A field holding only `#<number>` (white space around it allowed) opens that card and closes the search, with
  the field emptied: pasted (more than one character arriving at once), at once; typed, on Enter, so `#4` on the way
  to `#42` opens nothing. Back, Escape, and the `back` and `view` keys close the search; the x empties the field and
  closes it.
- **Card.** Click the title to rename (Enter saves, Escape or the x cancels); the lane chip opens the lanes popup;
  People and Tags open their pickers (people: you first, with `you` as the hint; tags: a "New tag…" field at the top).
  The description and comments are edited as text with tokens (see Mentions and Images): blank lines split
  paragraphs, a single line break stays, and lines starting `- `, `* ` or `• ` (the mark, then a space) become a
  bulleted list, so a numbered list comes back as a bulleted one; a note says "Saving keeps only the text: formatting
  is lost." when there is other formatting (mentions, card links and attachments don't count). Deleting your comment
  takes two clicks (the bin turns into `Delete?`). A link in a description or comment opens in the browser (a path
  gets the open card's `https://host`; only http and https open); a card link opens that card in the panel. Steps are
  plain text, with no pickers or files. The watch toggle is dim until it is set from the panel.
- **Mentions and card links.** In the description, new-comment and comment editors, one `@` or `#` typed at the start
  or after white space opens a picker for that editor: `mention` (the active people, no system user, you first) or
  `cardref`. The picker's field narrows its rows as you type (people by name; cards by a number, the cards whose
  number starts with it in number order, or by words, the cards whose title holds them all); Up and Down move, Enter
  or Tab takes the highlighted row (once: Enter reaches both the field and the popup), Escape closes it and leaves the
  `@` or `#`. A person with no mention id has `can't tag yet` as the hint (you: `you`); the notes are `Loading
  people…`, `Nobody by that name`, `No people`. `cardref` is handed the cards the panel holds, at most 300 (the board
  shown, its Not Now and Done as read, Mine, Pins, the search's), and shows at most 50 rows, each `#N Title` with its
  board as the hint (notes: `No cards match`, `No cards`). A number none of them has is read with `card show` 300 ms
  after the typing stops (`Looking up #N…` until then, the error if it fails). The choice goes to the panel through
  `fizzy.request` and becomes a token in place of the `@` or `#` (at the cursor if that is gone), followed by a space.
  On save a person's token, and `@` with a person's full name typed out (any case, the longest name first, not inside
  a word), become `<action-text-attachment sgid="…" content-type="application/vnd.actiontext.mention">` when the panel
  has that person's mention id; else they stay text, and an `info` toast says `Can't notify <names> yet: mention them
  once in Fizzy, and the panel learns how.` A card's token becomes `<a href="<account url>/cards/<n>">#N Title</a>`,
  the address made from the open card's own. Read back, a mention is the token `@<full name>` (the name from the
  photo's `title` inside it, else the people list, else its text), and a link whose path is `/<account>/cards/<n>` is a
  card's token.
- **Mention ids** (`user id -> sgid`) are learned from every mention in what the panel reads: `card show`'s
  description, `comment list`, Find mentions, Learn from a card. They are kept in local storage (`mentions`) and never
  shared: `fizzy.people` carries `mentionable`, only the user ids. **Find mentions** reads `activity list --page 1`,
  2, … (15 events a page) until everyone active can be tagged, a page says none follows, or 40 pages were read, one
  look at a time. With **Find mentions automatically** on (the default, kept as `mentionAuto`), it runs after the
  people are read (at start and daily) while someone can't be tagged and the last look (`mentionScanAt`) is a week
  old. **Learn from a card** takes `12` or `#12` and Enter, and reads that card's `card show` and `comment list`. The
  outcome replaces the last one.
- **Images and files.** Each file in a description or comment is an `<action-text-attachment>` with an sgid (or an
  `<img>`, or an attachment with a `url`, from the web). Images whose type is png, jpeg, gif, webp, svg or bmp, and
  every image from the web, are downloaded when the card is read, at most 3 at a time, into
  `<appHome>/data/fizzy/files/<16 hex digits>.<ext>` (a hash of the sgid or address), and the names are kept
  (`files`). An attachment comes through the CLI, a web image through `curl`. One over 15 MiB, or that failed, is a
  file chip; Refresh tries the failed ones again. A click on an image opens it in the system's viewer, and dragged into
  a terminal it drops its file there (`drag_paths`); a click on a file chip
  saves it as `~/Downloads/<name>` (`<base> (2)<ext>` and so on when taken), reveals it (Finder on macOS, its folder
  on Linux) and toasts `Saved to Downloads`; a web image with no sgid opens in the browser. Files dropped on an editor
  are uploaded one after another with `upload file <path>` (`Uploading <name>…` meanwhile), each put in at the cursor
  as a token, then a space; saved, it is `<action-text-attachment sgid="<attachable_sgid>">`. A paste with no text
  writes the clipboard's image to `<appHome>/data/fizzy/files/Pasted image <YYYY-MM-DD> at <HH.MM.SS>.png`, uploads it,
  then renames it to its hash as that image's copy (deleted when the upload fails); with no image or no tool, an
  `error` toast says `Pasting images isn't supported here: drop the file on the box instead`.
- **Reactions.** The reactions of each comment people wrote (not Fizzy's own lines) are read once, 6 at a time, when
  the card is read, and all again on Refresh; a failed read leaves it with none. A chip's click, or a row of the `react`
  popup (👍 👎 😄 🎉 ❤️ 👀 🚀 🙏 ✅, yours ticked), toggles yours: it shows at once, `reaction create --content` or
  `reaction delete <id>` follows, and a refusal puts it back with an `error` toast. When `reaction create` gives no
  id, the comment's reactions are read again.
- **Menus.** A right-click on a card, its ⋯, or the card's ⋯ opens the card menu; Up, Down and Enter move and choose,
  Escape closes. Delete card… asks again (`Click again to delete #N`).
- **Hand-offs.** The buttons act on the open card, else the picked cards; the `insert`, `send`, `start` and `copy`
  keys act on those too, else, in the Board view, on the board. The reference is `Fizzy #N "Title" (url)`, one line
  per card, or `Fizzy board "Name" (url)`. Insert pastes it into the agent of the focused pane, else of the focused
  agent block, else the tab's agent that changed last; with none it copies and toasts `Copied — no agent here`. Send
  lists the running agents (each as `Program · tab`, with `space · status` as the hint, the one Insert would use
  first); choosing one selects its space and tab, focuses its pane and pastes. Start lists up to six installed agents
  of the active space's machine; choosing one opens a tab named after the card (`#N Title`, cut to 32 characters) or
  the board, running that agent with no first message, and pastes once that session's status is `idle` or 3 seconds
  after it appeared; after 30 seconds with no session, the reference goes to the clipboard with a toast. Copy copies
  and toasts `Copied`. Nothing ever presses Enter. A paste borrows the clipboard and puts the old text back 500 ms
  later. A card's tile and the bar's Insert are also `drag_paths` sources: the press writes each card's markdown (title,
  board, lane, tags, people, link, description, and steps when the open card's own read has them) to
  `<appHome>/data/fizzy/files/cards/#<N> <title>.md` (the title on one line, no slashes, at most 60 characters), and a
  drop on a terminal types the quoted paths there. The tile's press also picks the card up for a lane move. A picked
  card's tile drags every picked card; the bar drags what it acts on, never a board.
- **Notifications.** Every 30 s, shown or hidden, the unread notifications are read: the count goes to `fizzy.unread`
  and the Inbox badge, and each one not seen before becomes an `info` toast for 8 s (title up to 80 characters; body:
  the first line up to 140, `#N`, the board), at most three per poll plus `N more in Fizzy`. A panel with nothing
  remembered learns what is there without toasts. A toast's click opens its card and marks it read, bringing the
  Fizzy page up first when needed.
- **Inbox.** Only unread notes, newest first, filled by the same unread poll (one `notification tray` per 30 s in every
  view; opening the Inbox or Refresh in it runs that poll). A click marks the note read, removes it and opens its card;
  Mark all read empties the list. A refusal from Fizzy puts the note back.
- **Polling.** Every 30 s while the page shows (and at once when it shows again): the open card and its comments, else
  the view (Mine every other time; the Inbox is not read here); never while a title, description, step or comment is
  edited. The Board view's poll reads the open cards, and the columns, with the stalled list, only when they are not
  known yet and on Refresh; the columns alone again when an open card names a column that is not among them. Not Now
  and Done are read when unfolded, on Refresh, and after a write while unfolded; a folded lane is never read, and an
  unfolded lane with no data (after a restart, or on switching to a board whose saved fold state has it open) is read
  by the board's read. The pin list, which marks pinned tiles, is read at start, when a card opens, after a write and
  in the Pins view. A card's read also reads the reactions it has not read, and downloads its images. Mine is one
  boardless `card list --assignee <user> --all` grouped by board when the CLI has no default board (with one, a
  boardless list reads that board only, so each board is read).
- **Settings** opens on its list; a block opens its page. Back (and the `back` key) goes from a page to the list, and
  from the list out of Settings. The Mentions switch is kept (`mentionAuto`).
- **Board groups.** + adds a group at the top. Clicking the name or the rule edits it in place; the bin asks once
  (`Delete?`); the eye hides; clicking the rest of the line folds. A press with ⌘ or Ctrl held on a board or group picks
  it up: the block under the pointer is `selected` (for a board) or shows a 2 px `accent` line where a group lands, and
  letting go places it. A board let go over another board's row joins that row's group and takes its place (a 2 px
  `accent` line at the row's top when it moves up, its bottom when it moves down); the config's `order` then lists
  every board, and the dropdown and the page follow it, boards placed later coming after, in Fizzy's order. The
  dropdown leaves out hidden boards and groups, except the board shown.
- **Errors** are shown as text: ``Not signed in to Fizzy: run `fizzy setup` in a terminal``,
  `The fizzy CLI isn't installed (or not on PATH)`, `Fizzy took too long to answer`, `Can't reach Fizzy`, `Not found
  in Fizzy: it was deleted, or you can't see it`, `Fizzy doesn't let you do that`, `Fizzy is busy: try again in a
  minute`, else the CLI's own message. Saving a file to Downloads adds `That file is no longer on the card` and
  `Couldn't save the file to Downloads`; an upload with no sgid in its answer, `Fizzy took <name> but gave nothing to
  embed it with`.
- **Keys.** `<tab bar>.panel:fizzy` toggles the Fizzy page like its button. No key is bound to it unless asked
  (`install.sh --add-key` binds `cmd-shift-j`, on Linux `ctrl-shift-j`, in `global` when that key is free): an edit to
  `keys.json` stops Herdr adding its new default shortcuts to it. `<tab bar>.search:fizzy` (for `cmd-k`, bound by
  hand) shows the Fizzy page and sets `fizzy.request` to `{ id, op: { kind: "search" } }`, which the panel, shown or
  hidden, takes on its request timer and opens the search with.
  `fizzy.<command>` (`refresh`, `view[:board|mine|inbox|pins]`, `board:<id or name>`, `follow`,
  `open:<n>[:<notification id>]`, `back`, `settings`, `insert`, `send`, `start`, `copy`, `new`, `search`, `filter`,
  `menu:<n>`) reaches the panel while it is shown. `filter` closes the search, unpicks the cards and focuses the view's
  filter (from the Inbox, the Board view's).

## Built from

- **Herdr** 0.1.16 or newer (`drag_paths`, `checking()`); `install.sh` checks at install time that the tab-bar patch
  fits. On a Herdr whose tab bar changed so that it doesn't, the patch is applied by hand (`tabs/README.md`).
- **Layout.** Herdr's `main`, with one block added last to the `panel-body` stack (inside the `panel` column, which
  starts hidden): `{ "id": "fizzy", "type": "block", "content": { "mod": "fizzy" } }`, and the tab-bar block's
  `content.mod` pointed at the patched tab bar (`fizzy-tabs`). `layout/add-fizzy.jq` makes both changes.
- **Mods.** `fizzy` (`mod.json`: `{ "place": "none", "title": "Fizzy" }`): one class that is the panel, and also every
  popup, opened as `openOverlay({ mod: "fizzy", kind: "popup", props: { menu } })` with `menu.kind` one of `boards`,
  `newCard`, `card`, `agents`, `start`, `users`, `tags`, `moveBoard`, `lanes`, `react` (a comment's emoji), `mention`
  (the `@` picker) and `cardref` (the `#` picker). `lib.js` holds the pure parts (no imports).
  `fizzy-tabs` is Herdr's `tabs` cloned, plus `tabs/fizzy-button.patch`: a Fizzy button when `panel-body` has a `fizzy`
  child, its dot from `fizzy.unread`, and a `nextCommand()` loop taking `panel:<page>`.
- **Shipped mods it relies on.** `tabs` (cloned), `toast` (draws `notify`), `new-menu` (its `new-menu.agents` cache is
  read and written), and Herdr's `icons/` for the agents' icons.
- **`herdr` functions.** `exec`, `agents`, `panes`, `spaces`, `focused`, `knownAgents`, `theme`, `shared`, `setShared`,
  `layout`, `home`, `appHome`, `props`, `run`, `notify`, `openOverlay`, `closeOverlay`, `nextCommand`, and
  `localStorage`. From `gpui-kit`: `View`, `div`, `svg`, `image`, and an element's `on_drop` (the paths dropped on an
  editor); from `gpui-base`: `v_flex`, `h_flex`, `InputState`, `Input`, `TextareaState`, `Textarea` with tokens
  (`.token(…)` draws them; `content()`, `tokens()`, `replace_with_token`, `replace_range_with_token`,
  `set_selected_range`; the `paste_other` event for a paste with no text), and `TextView` (`TextView.html`, only where
  the panel's own drawing of rich text fails). The theme's `typography.mono` is the code font.
- **Commands.** `space.select`, `tab.select`, `pane.focus`, `terminal.paste` (the hand-offs), `tab.new` (Start),
  `layout.show` (a toast); toast actions `fizzy.open:<n>:<id>`, `layout.show {id: "panel"}`,
  `layout.select {stack: "panel-body", child: "fizzy"}`. The tab bar: `layout.select`, `layout.show`, `layout.hide`.
- **Shared state.** `fizzy.unread`, `fizzy.boards`, `fizzy.people` (users, tags, `me`, and `mentionable`: the ids of
  the users the panel can mention, never their mention ids), `fizzy.avatars`, `fizzy.boardGroups` (written by the
  panel); `fizzy.request` and `fizzy.board` (a popup's action and board choice, New card's included, done by the
  panel, which sets `fizzy.request` to null afterwards so a hand-off's text does not stay in `shared.json`). A
  request's `op` adds `{ kind: "react", number, comment, content }`, `{ kind: "mention", target, user, name }` and
  `{ kind: "cardref", target, number, title }`, `target` naming the editor (`comment`, `commentEdit`, `desc`); a
  picker's choice goes into that editor only while it is still open.
- **Local storage** (the panel's, never shared), as JSON: `view`, `follow`, `board`, `boards` (each with `period`, its
  `auto_postpone_period_in_days`), `config`, `me`, `data:<board>`, `collapsed:<board>`, `folds`, `avatars`,
  `seenNotes`, `watching`, `mentions` (user id -> mention id), `mentionScanAt`, `mentionAuto`, and `files` (image key ->
  its file in `data/fizzy/files`).
- **Programs.** `fizzy` 4 or newer, always run from the home folder, every command ending with `--json`. It reads with
  `board list --all`, `column list --board`, `card list --board <id> --all` (also with `--indexed-by not_now`,
  `--assignee <user>`, also with no `--board`; Done as `--indexed-by closed --page <n>`), `search --jq … -- <words>`
  (words after `--`, so a leading `-` stays a word; `--json` goes before the `--`), `card show`,
  `comment list --card <n> --all`, `reaction list --card <n> --comment <id>`, `user list --all`, `tag list --all`,
  `pin list`, `notification tray`, `activity list --page <n>`, `card attachments show <n> --include-comments`,
  `identity show` and `config show`; the stalled cards with `card list --board <id> --indexed-by stalled --all`.
  `card list`, `search`, `pin list`, `notification tray`, `reaction list`, `activity list`, `card attachments show`
  and `config show` carry a `--jq` projection: only the envelope's `ok` and the fields the panel uses come back (the
  stalled list, the numbers alone; `activity list`, only the comment bodies and descriptions that hold a mention, and
  whether a page follows; `card attachments show`, the sgids in order). `card attachments download <n> <index>
  --include-comments -o <path>` saves an attachment. It writes with the `card` commands `create`, `update`, `column`,
  `postpone`, `untriage`, `close`, `reopen`, `golden`, `ungolden`, `pin`, `unpin`, `watch`, `unwatch`, `self-assign`,
  `assign`, `tag`, `move` and `delete`; `step create`, `update` and `delete`; `comment create`, `update` and `delete`;
  `reaction create --card <n> --comment <id> --content <emoji>` and `reaction delete <id> --card <n> --comment <id>`;
  `upload file <path>`; `notification read` and `read-all`. Then `sh -c` with a script that walks up for
  `.fizzy.yaml` and prints its `board:` line only (`[` and `grep` only), run with `exec(…, { on: space.machine })`;
  and on this computer `sh -c` with a script that fetches a photo with `curl` into
  `<appHome>/data/fizzy/avatars/<user id>-<YYYYMMDD>.<ext>`, one that fetches a web image with `curl` (http and https
  only, following redirects, at most 15 MiB and 25 s, its type by the answer's content type) into
  `<appHome>/data/fizzy/files/<key>.<ext>`, one that writes the clipboard's image as a PNG (`osascript` reading
  `«class PNGf»` on macOS, else `wl-paste --type image/png` or `xclip -selection clipboard -t image/png -o`), one that
  opens a file or reveals it (`open` or `open -R` on macOS, `xdg-open` on the file or its folder on Linux), and one
  that prints a free path in `~/Downloads` (`<name>`, `<name> (2)`, …); and `mkdir -p`, `mv -f` and `rm -f` on the
  images folder.
- **Art.** Lucide icons in `mods/fizzy/` (24×24, `stroke="currentColor"`): arrow-left, bot, check, chevron-down,
  chevron-right, copy, external-link, eye, eye-off, insert (Lucide's corner-down-left), kanban (square-kanban), link,
  more (ellipsis), paperclip, pencil, pin, pin-off, plus, refresh (refresh-cw), rotate-ccw, search, send, settings,
  smile-plus, star, star-off, tag, trash, user, user-plus, x.

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
- **Fizzy has no drafts**: `card create` publishes the card, and Fizzy requires a title. New card makes it at once under
  the stand-in title `New card`, and Discard deletes it.
- **Mention ids can't be listed or made.** A mention is `<action-text-attachment sgid="…"
  content-type="application/vnd.actiontext.mention">`, its sgid one per person; no command lists them. They are learned
  from the mentions in what is read, the person's user id taken from the photo inside the mention
  (`/users/<user id>/avatar`), else from the sgid, whose part before `--` is base64 JSON naming `…/User/<user id>`.
- **Attachments download by position**: `card attachments download <n> <index> --include-comments` takes the index,
  from 1, in the order `card attachments show <n> --include-comments` lists them (the description's, then the
  comments'), not the sgid. The list is read once per card, and again once when it lacks the sgid.
- **`upload file` answers `attachable_sgid`**: the uploaded file goes into the HTML as `<action-text-attachment
  sgid="…">`.
- **Search on Enter only**: Fizzy allows 300 searches an hour per user, shared with the person's agents.
- **Steps are plain text** in Fizzy (`step create` and `step update` take `--content`): no pickers, tokens or files.
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
  files; the day in the file name keeps Herdr's image cache from showing an old one. The images in descriptions and
  comments are files too, downloaded to `data/fizzy/files`; an attachment needs Fizzy's login, so it comes through the
  CLI.
- **`TextView` can't color text**, so the panel draws Fizzy's HTML itself (mentions in `ansi4`, card links in
  `ansi3`). `TextView.html` is the fallback, and it ignores `<br>`: for it the HTML is rewritten so each break ends a
  block.
- **A paste with no text** reaches the editor only as its `paste_other` event: the panel reads the clipboard's image
  with a script of its own.
- **Enter in a picker** reaches both its field (the field's submit) and the popup's keys: the choice is taken once.
- **Paste goes through the clipboard** (`terminal.paste`), so the person's clipboard text is put back afterwards.
- **280 px**: every row must shrink to the panel's narrowest; each bar stays on one line there.
- **Assumes** the layout ids `panel`, `panel-body` and `fizzy`; macOS or Linux (`sh`, `curl`; `open` and `osascript`,
  or `xdg-open` and `wl-paste` or `xclip`). None of the CLI's own files is read: `config show` names its account and
  default board.
- **Not built:** reactions on the card itself, formatting (bold, headings, numbered lists) in the editors, making or
  changing boards and columns (beyond a column's place).

## Done when

- `herdr-app check` passes for `mods/fizzy` and the patched tab bar.
- With the layout's Fizzy page and the CLI signed in, Board shows the board's lanes in `column list` order, Not Now
  and Done folded; unfolding Done shows up to 50 cards and Show more.
- Dragging a card from one lane onto another lane's header moves it in Fizzy (`fizzy card show` agrees), and the list
  shows it there after the next read. Dragging a column's header onto another column moves the column in Fizzy
  (`fizzy column list` agrees).
- A card dropped on a terminal types the quoted path of `#<N> <title>.md`, which holds the card; an image dropped on
  Claude Code attaches.
- A description emptied and saved is empty in Fizzy (`fizzy card show` agrees).
- New card opens the board picker; choosing a board shows the Board view on it and opens a card made in Maybe? there,
  its empty title field focused; typing a title and Enter saves it (`fizzy card show` agrees), and Discard deletes the
  card.
- A golden card heads its lane with an `ansi3` border, a pinned one shows a pin, and a card past three quarters of the
  board's auto-postpone period shows `Closes in Nd`.
- On Board, a filter's words open every lane with a match; My cards keeps the signed-in user's cards.
- The search icon, then a pasted `#N`, opens card N; words and Enter list Fizzy's matches by board.
- In a comment, `@` and a person the panel can tag, then Comment, makes a Fizzy mention (the person is notified); `#`
  and a card makes a link that opens that card in the panel.
- A comment's reaction chip toggles yours in Fizzy (`fizzy reaction list` agrees).
- An image in a comment shows in place once downloaded; a file's chip saves it to Downloads; a file dropped on the
  comment box goes in as an attachment.
- Settings > Mentions > Learn from a card, given a card whose comment mentions everyone, says everyone can be tagged.
- With an agent in the focused pane, Insert puts `Fizzy #N "Title" (url)`, followed by a space, in its input, and
  nothing is submitted; with none, the reference is on the clipboard and a toast says so.
- Start on a card opens a tab named `#N Title`, running the chosen agent, and the reference appears in its input once
  it is idle.
- A `.fizzy.yaml` with `board: <id>` in a space's folder makes that board show when that space is active and Follow
  current space is on.
- With the panel hidden, a new notification gives a toast within 30 s and the tab bar's dot; clicking the toast brings
  the Fizzy page up with that card open, and the notification is read.
- With the CLI signed out, the panel says ``Not signed in to Fizzy: run `fizzy setup` in a terminal`` and
  offers Retry.
- At 280 px the header, the board row and each bar fit on one line.
- `npm test` passes.
