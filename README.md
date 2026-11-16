# herdr-fizzy

Your Fizzy boards, cards and notifications in Herdr's side panel, through the `fizzy` CLI.

The **Fizzy** page sits in Herdr's right panel, next to Files and Changes. It shows a board lane by lane, the cards
assigned to you on every board, your unread notifications and your pinned cards, and it searches every board. You can
make a card, open one and change it, comment with mentions, card links and images, and react, without leaving Herdr,
and hand a card to a coding agent running in Herdr. Nothing is ever sent to an agent for you: a hand-off puts the
card's reference in the agent's input box, and you press Enter yourself.

The repo holds:

| Path | What it is |
|---|---|
| `mods/fizzy/` | The mod: the panel and its popups. Plain JavaScript (`main.js`, `lib.js`), no build step, and its icons. `text.js`'s `TEXT_SCALE` sizes all its text (Herdr's settings size only the terminals') |
| `tabs/` | `fizzy-button.patch`, the Fizzy button for a copy of Herdr's tab bar, and `keys.json`, the key it suggests on macOS and on Linux ([tabs/README.md](tabs/README.md)) |
| `layout/` | `add-fizzy.jq`, which adds the Fizzy page to a layout ([layout/README.md](layout/README.md)) |
| `install.sh` | Puts it all in place on Herdr's own setup, and takes it out again |
| `scripts/merge-keys.mjs` | What `install.sh --add-key` adds the key to your `keys.json` with, and `--uninstall` takes it out with |
| `test/` | The tests, and what they run on: mocks of Herdr's mod API, a fake `fizzy` CLI and a stand-in `patch` |

## What you see

**The header.** From the left: **Fizzy** (its icon and name; below 440 px of panel width, the icon alone) shows the
Board view. Then **Mine**, **Inbox** (with the number of unread notifications) and **Pins**, and at the right
**Search**, **Refresh** and **Settings**. Below 340 px Refresh is left out; the `refresh` key and the 30-second poll
still read again. On the Board view only, the **board row** sits under the header, as Fizzy's head: the board's name
in the middle, big and bold, between two thin rules (click it to pick another board; "Following space" sits under it
while it follows the space's own board), **Who can see this board** at the left and **Open board in Fizzy** at the
right, both round. Who can see this board lists the people who can, with **Everyone on the team** at the top: a switch
that lets every member of the team see the board, or only the people given it. Adding or taking away one person is
done in Fizzy (the CLI can't): a person's row, and the last row, open the board there. Mine, Inbox and Pins go
straight to their list.

**The bar at the foot** follows the view:

- On Board: the filter, **My cards** and **New card**. Below 340 px, My cards and New card show their icon alone.
- On Mine and Pins: the filter alone.
- Inside a card, and in a list while you have cards picked: **Insert**, **Send**, **Start** and **Copy**
  ([Hand a card to an agent](#hand-a-card-to-an-agent)).
- On a card New card has just made: **Discard** and **Done** (see **New card** below).
- The Inbox, and the search with no card picked, have no bar.

**Board, side by side.** From 480 px of panel width the board looks like Fizzy's: its lanes stand side by side in the
board's own order, Not Now first and Done last. One lane is open (Maybe?, until you open another), with its name and a
dot in its color at the top and its cards under it, scrolling on their own; it grows no wider than 380 px, and with
room to spare the lanes stay together in the middle of the panel, as in Fizzy. The others are folded, as in Fizzy: a
narrow pill in the lane's color (gray for Not Now and Done) that fades downwards to a tenth of it, taller the more
cards the lane holds (a circle when it holds none), with the number of its cards at the top and its name read top to
bottom, and a faint line on to the board's foot; the one under the pointer brightens. Not Now and Done are as tall as
a pill gets until they are read. Click a pill to open that lane; below 760 px that folds the one that was open, from
760 px two stay open (the one opened longest ago folds when you open a third). Click an open lane's name to fold it,
unless it is the only one open. What is open is kept per board. Not Now and Done are read when they open (so a folded
one shows no count until then), and again on Refresh and after a change you make while they are open; Done shows 50
cards, then **Show more**. The **+** beside an open lane's name makes a new card there.

**Board, stacked.** Narrower than 480 px the lanes stack, each a block of its own: a header tinted in the lane's
color, with a dot, the lane's name and the number of its cards, and its cards under it. Not Now and Done start folded
and are read each time you unfold them; a click on a lane's header folds or unfolds it (kept per board). The **+** on
Maybe? and on each column makes a new card there (see **New card** below).

A column has the color it has in Fizzy; Maybe? is blue, Not Now gray and Done a muted gray. Maybe? starts with
**Add a card** and, under **Watching for new cards**, the photos of the people who watch the board, with **Watch for
new cards** or **Stop watching** for you (it switches at once; the watchers are read with the board's columns, and again
after you switch).

**Cards** look like Fizzy's. At the top left, the card's number and its board on a tab in its lane's color; in Mine,
Pins and the search, where lanes mix, its lane is named beside it too. At the right of that line the step progress
(✓ 1/2), Fizzy's inactivity warning, ↵ (Insert in chat) and `⋯` (the card's menu). Then the title in bold (a pin
before it when the card is pinned) and up to three tags. Then, smaller and in the lane's color: who made it, with their
photo, and how long ago ("Added 127 days ago"); when it last changed ("Today", "Yesterday", "8 days ago") and who it
is assigned to, with their photos; and at the right the number of its comments. Golden cards come first in their lane,
with a faint gold glow from the bottom left to the top right, as in Fizzy. The warning is the one Fizzy shows on the
card: "Closes in 3d" (or "Closes today") once less than a quarter of the board's auto-postpone period is left since the
card last changed, counted in calendar days, else "Stalled" when Fizzy lists the card as stalled. A card in Not Now or
Done has none.

Fizzy's card lists carry no step progress or comment count, so the panel reads them for each card of the board shown
(a `card show` and a `comment list` per card, three cards at a time) and keeps them, for the next run too. A card is
read again only once it has changed in Fizzy; opening a card refreshes its counts with what the card page reads
anyway. The first time a big board shows, that is two commands per card.

Drag a card, from anywhere on its tile, onto another lane (anywhere in its block, its open column or its folded pill)
to move it there, or onto a terminal to hand it over as a file ([Hand a card to an agent](#hand-a-card-to-an-agent)).
Drag a column's header (or its pill) onto another column to move the column to that place, in Fizzy too: the lanes
reorder at once, Fizzy moves the column one place at a time, and the columns are read again. Maybe?, Not Now and Done
keep their places. ⌘-click or Ctrl-click picks several
cards; ⌘-click or Ctrl-click one again to unpick it. While cards are picked, the hand-off buttons take the filter's
place at the foot.

**Filter and My cards.** The filter at the foot narrows the list as you type: it keeps the cards whose title,
`#number`, tags, assignees' names, column or the first 300 characters of the description hold every word you type, in
any case. The x empties it. Board has a filter of its own; Mine and Pins share one. On Board, **My cards** keeps only
the cards assigned to you, and while a filter or My cards is on, every stacked lane that holds a match is open, folded
or not; the fold kept for the lane does not change. Side by side, the open lanes show the matches and each folded pill
counts its own. The filter only sees cards the panel has already read; search finds the rest.

**Search.** The search icon in the header turns the header into a search field, and the results take the place of the
list, in any view. Press Enter: the panel asks Fizzy once, across every board, in open, Not Now and closed cards and in
comments, and shows what it finds, a section per board. Fizzy answers with its 15 newest matches at most; when it
does, the list says so, and more words narrow it. Fizzy limits searches to 300 an hour per person, shared with anything
else of yours that searches, so the panel never searches as you type; when Fizzy does not answer, the panel says the
limit may be used up, and never tries again by itself. A card's number with its `#`, such as `#42`, opens that card
instead, from any board: at once when you paste it, on Enter when you type it. The arrow or Escape closes the search,
and the field keeps its words for next time; the x empties the field and closes the search.

**Mine** lists the cards assigned to you on every board, a section per board. **Pins** lists your pinned cards.

**Inbox** lists your unread notifications, newest first, each with who, the card's number and board, and when. A
click marks one read (it leaves the list) and opens its card; **Mark all read** empties the list. A read notification
is never listed; with none left it says "You're all caught up".

**New card.** Fizzy has no drafts: a card is on the board the moment it is made. So **New card** makes the card at
once. The button in the Board view's bar (and the `new` key) opens a picker of your boards under "New card on", the
board shown ticked and highlighted. Choosing one shows that board, makes a card titled "New card" in its Maybe?, and
opens it with an empty title field, ready for you to type the title and press Enter; the description, steps, people and
the rest are there at once. The bar at its foot has **Discard**, which deletes the card again, and **Done**, which
keeps it and goes back to the list. A lane's **+** does the same in that lane, without the picker. A title you never
save leaves the card as "New card".

**A card.** Click one to open it. Its top bar has Back, the card's number and board, three toggles (**pin**, **watch**
and **golden**), Open in Fizzy (left out when the panel is narrow) and `⋯`, the card's menu. Fizzy doesn't tell anyone
whether you watch a card, so the eye stays dim until you set it from the panel; the panel remembers that for the last
200 cards, and forgets a "not watching" when you comment on the card or take it, since Fizzy may start watching it for
you then. Click the title to rename the card; the lane button at its right moves it. **People** and **Tags** open
pickers: the account's people with their photos, you first, and its tags, with a field for a new one; a tick marks
what the card has. Then come:

- the description, drawn by the panel with its formatting, mentions, card links, images and files. The pencil edits it
  as text. Line breaks are kept, and so are lists of lines that start with `- `, `* ` or `• ` (the mark, then a space),
  and mentions, card links and files stay what they are. A numbered list comes back as a bulleted one; other formatting
  is lost on save, and the editor says so when there is some;
- the steps: tick the box, click the text to change it, the bin removes one, and the field at the bottom adds one.
  Steps are plain text: `@` and `#` open no picker there, and a file can't go in one;
- the comments, oldest first, each with its reactions: write one at the bottom; edit your own as text, as the
  description is, and delete your own (deleting takes two clicks). Fizzy's own lines, such as "… moved this to Not
  Now", are folded under **Activity** after the comments.

**Reactions.** Under each comment: one chip per emoji, with how many people put it there (point at it for their names),
yours outlined. Click a chip to add yours or take it back; the smiley with a plus offers 👍 👎 😄 🎉 ❤️ 👀 🚀 🙏 ✅,
yours ticked. The change shows at once, and goes back when Fizzy refuses it. A comment's reactions are read the first
time its card opens, and again on Refresh.

**Mentions and card links.** In the description and comment boxes, `@` typed at the start or after a space opens a
picker of the account's people (you first), and `#` a picker of cards: those of the board shown (its Not Now and Done
as far as read), Mine, Pins and the search. Type to narrow it, by name, or by a card's number or the words of its
title; a number the picker doesn't hold is looked up in Fizzy. Up and Down move, Enter or Tab takes the highlighted
one, and Escape closes the picker, leaving what you typed. The choice takes the place of the `@` or `#`: a person in
bold blue, a card in bold yellow, then a space. Saved, a person becomes a real Fizzy mention, which notifies them, and a
card a link to it. `@` and a person's full name, typed out, work too. Where the panel shows a description or comment,
mentions are bold blue and card links bold yellow; a click on a card link opens that card in the panel.

The panel can only mention someone whose mention id it knows. Fizzy gives each person one, but no command lists them
and none can be made, so the panel learns them from mentions already in Fizzy, in every card and comment it reads.
Until it has someone's, the picker says "can't tag yet" beside their name, their name in the box is dim, and saving
keeps "@Name" as plain text, with a toast that says they were not notified. **Settings > Mentions** shows how many of
the account's people can be tagged, and who can't yet, and has three ways to learn more:

- **Find mentions automatically** (on to begin with): while someone can't be tagged, the panel reads Fizzy's recent
  activity in the background, at most once a week, and learns from the mentions made there.
- **Find mentions now** reads the activity once, newest first: at most 40 pages (600 events), stopping sooner once
  everyone can be tagged.
- **Learn from a card**: in Fizzy, post one comment on any card that @-mentions each person, then enter that card's
  number here and press Enter. The panel reads its description and comments.

**Images and files.** An image in a description or comment shows in place, at its own shape and no wider than the
text; until it is downloaded, a box of its size says "Loading image…". Click it to open it in your system's viewer, or
drag it into a terminal to drop its file there (Claude Code, for one, attaches a dropped image).
Images are downloaded once, three at a time, and kept in Herdr's app folder, in `data/fizzy/files`: one attached in
Fizzy through the `fizzy` CLI, one linked from the web through `curl`. Any other file, an image over 15 MiB, and an
image that won't download show as a chip with a paperclip, the file's name and its size. Click the chip to save the
file in your Downloads folder under its own name (with " (2)" and so on when that is taken), shown in Finder (on Linux,
its folder opens); a web image that won't download opens in your browser instead. Refresh tries the images that failed
again.

To add a file, drop it on the description or comment box: it is uploaded to Fizzy, goes in at the cursor as "🖼 name"
for an image or "📎 name" for another file, and becomes an attachment when you save. Pasting an image (a clipboard
with no text) puts it in the same way, as a PNG: the panel reads it through `osascript` on macOS, and `wl-paste`
(Wayland) or `xclip` (X11) on Linux. Where that fails, the panel says so; drop the file instead.

**The card's menu**, from `⋯` or a right-click on a card: Insert in chat, Send to session…, Start new session…, Copy
reference, Copy link, Reopen (on a closed card), Move to (every lane), Assign to me (or Unassign me), Assign…, Tags…,
Pin or Unpin, Watch or Unwatch, Mark golden (or Remove golden), Move to board…, Open in Fizzy and Delete card… (two
clicks).

**Settings** (the gear) is a list of pages, each with what it is set to now: **Mentions** (how many people can be
tagged, and whether the panel finds new ones by itself; see above) and **Board groups** (how many groups). Click one to
open it. Back goes from a page to the list, and from the list out of Settings.

**Board groups.** The board dropdown lists **Follow current space** ([Which board](#which-board)), then the boards in no
group, then each group under its name. A new user starts with no groups. **Settings > Board groups** lists each group
with its boards, then **No group**.

- **+** adds a group. Click a group's name to rename it, or its rule to change it: a board whose name contains the
  rule's text (in any case) goes to the first group whose rule it matches, unless you placed it by hand.
- ⌘-drag or Ctrl-drag a board onto a group, or onto No group, to place it there, and a group onto another group to
  move it. Let a board go on another board's row to put it right there, in that board's group: a line shows where it
  lands (before the row when you drag up, after it when you drag down). The dropdown lists the boards in that order;
  boards you never placed follow, in Fizzy's order.
- The bin deletes a group (two clicks); the eye hides a group or one board; a click elsewhere on a group's line folds
  it.
- Hiding only takes a board out of the dropdown and the New card picker: Mine, the search, Follow current space and the
  board shown are not affected. Every change is kept at once.

**Notifications.** Every 30 seconds, also while the panel is hidden, the panel asks Fizzy for your unread
notifications. Each new one pops up as a Herdr toast: its title, the first line of its text, the card's number and the
board. A poll shows at most three; with more, the three newest and one "N more in Fizzy". A panel that starts with
nothing remembered (a new install, cleared storage) only learns what is already there, so it never floods you. Click a
toast and its card opens in the panel, which brings the Fizzy page up first when it is hidden or another page is in
front, and the notification is marked read.

**Photos.** People show with their Fizzy profile photo, round, wherever they appear: a card's assignees, People, the
comments, the Assign list, the `@` picker and the Inbox. Without a photo, or until it is fetched, you see their
initials on a color of their own. How the photos are fetched and kept is under
[What it runs, reads and stores](#what-it-runs-reads-and-stores).

**Not in the panel:** reactions on the card itself, and making or changing boards and columns (beyond a column's
place). Open in Fizzy is there for those.

### Hand a card to an agent

Inside a card, and in a list while you have cards picked, the bar at the foot of the panel has four buttons:
**Insert**, **Send**, **Start** and **Copy**. They act on the open card, else on the cards you picked. The `insert`,
`send`, `start` and `copy` keys ([Keys](#keys)) do the same, and in the Board view, with no card open or picked, act on
the board shown.

Each one puts a one-line reference, `Fizzy #42 "Fix the login redirect" (<the card's link>)` for a card (one line per
card) or `Fizzy board "Roadmap" (<the board's link>)` for a board, into an agent's input box or on the clipboard.
**Nothing is ever sent for you:** you read it, add what you want to say, and press Enter yourself.

- **Insert** pastes into the chat you are in: the agent in the focused pane, else the agent in that tab that changed
  last. With no agent there it copies the reference and says so.
- **Send** lists your running agent sessions, the one Insert would use first, each with its space and what it is doing.
  Pick one: Herdr brings its space, tab and pane to the front, and the reference is pasted into it.
- **Start** lists the agents installed on the active space's machine, up to six. Pick one: a new tab opens with that
  agent, named after the card (or the board), with no first message. Once the session is up and idle, or 3 seconds
  after it appeared, the reference is pasted into it. If no session shows up within 30 seconds, the reference is left
  on your clipboard and a toast says so.
- **Copy** puts the reference on the clipboard.

A card's ↵ button is Insert for that card, and its menu has the same hand-offs plus Copy link. To paste, the panel puts
the reference on the clipboard for a moment, then puts back the text you had there.

**Drag into a terminal.** Drag a card, or the bar's **Insert**, onto any terminal, an agent's or a shell, to drop the
card as a markdown file there: Herdr types the file's path into it, quoted and without Enter. Herdr's drags carry files
only, so the card goes as one; while you drag, the file's name, `#<number> <title>.md`, follows the pointer. The file
holds the title, board, lane, tags, people, link and description, and the steps when the card is open. It is written
when you press a card or Insert (from what the panel already holds; nothing more is asked of Fizzy), in
`data/fizzy/files/cards` under Herdr's app folder. A picked card drags every picked card, and so does the bar's Insert.
Dropped on a terminal on another machine, the file is copied there.

## Requirements

- **Herdr 0.1.16 or newer**: the panel uses its file drags into terminals, and the tab-bar patch is made against its
  tab bar. `install.sh` checks at install time that the patch fits. On a Herdr whose tab bar changed so that it
  doesn't, apply the patch by hand ([tabs/README.md](tabs/README.md#when-it-doesnt-fit)).
- **macOS or Linux.** It is built for both; it is tested on macOS, and Linux is untested.
- **The `fizzy` CLI, version 4 or newer** (https://github.com/basecamp/fizzy-cli), on your PATH and signed in. With
  Homebrew: `brew tap basecamp/tap && brew install --cask basecamp/tap/fizzy`. Sign in with `fizzy setup`, which asks
  for the token in a masked prompt (a token typed on a command line stays in your shell history). The panel
  ends every command with `--json` (a search puts it just before its `--`), and the CLI answers with its JSON envelope,
  `{ "ok": true, "data": … }` or `{ "ok": false, "error": …, "code": … }`. When the CLI is missing or signed out, the
  panel says so.
- **`sh` and `curl`**: `sh` for the `.fizzy.yaml` lookup, the photos and the images, `curl` for the photos and the
  images linked from the web. Without `curl` you see initials, and a web image shows as a file.
- **To open, save and paste files**: on macOS, `open` and `osascript`, which come with it; on Linux, `xdg-open`, and
  `wl-paste` or `xclip` to paste an image. Without a paste tool, drop the file on the box instead.
- For `install.sh`: **bash** (macOS's own 3.2 will do), **jq**, **patch**, **diff** and **cmp**. `--mod-only` needs
  only diff and cmp; `--uninstall` needs only jq.
- **Node.js**, only for `install.sh --add-key` and `--uninstall` to add the key to `keys.json` or take it out (without
  it the script prints the line instead), and, 22 or newer, for the tests.

## Install

```text
./install.sh               install mods/fizzy; build the fizzy-tabs tab bar (Herdr's own, plus the Fizzy button of
                           tabs/fizzy-button.patch) and the fizzy-core layout (Herdr's main, plus the Fizzy page of
                           layout/add-fizzy.jq); switch Herdr to fizzy-core if this run made it and Herdr shows
                           main; print the keys.json line for a key that opens Fizzy, without adding it
./install.sh --add-key     the same, and bind cmd-shift-j (Linux: ctrl-shift-j) to the Fizzy button in keys.json
                           if that key is free
./install.sh --mod-only    only mods/fizzy, for your own tab bar and layout (tabs/README.md, layout/README.md)
./install.sh --dry-run     build everything in a scratch folder and say what would change, changing nothing; it
                           runs no herdr-app check
./install.sh --uninstall   remove fizzy-core, fizzy-tabs (unless a layout of yours shows it), mods/fizzy, and the
                           key from the "global" section of keys.json while it is the Fizzy button's
./install.sh --help
```

`--dry-run` goes with any of the others, and runs no `herdr-app check`. `--add-key` goes with neither `--mod-only` nor
`--uninstall`, and `--uninstall` not with `--mod-only`: such a pair stops the run.

On Herdr's own setup it makes these, in Herdr's app folder (`HERDR_APP_HOME`, else `~/.config/herdr-app`; a
`HERDR_APP_HOME` that is set but empty is refused):

- `mods/fizzy`, the mod.
- `mods/fizzy-tabs`: Herdr's tab bar copied the way `mod.clone` copies it, with the Fizzy button of
  [`tabs/fizzy-button.patch`](tabs/fizzy-button.patch). The button shows in a layout that has the Fizzy page, after
  Files and Changes, with a dot while you have unread notifications.
- `layouts/fizzy-core.json`: Herdr's `main` layout with the Fizzy page last in the right panel's `panel-body` stack, and
  its tab bar pointed at `fizzy-tabs` ([`layout/add-fizzy.jq`](layout/add-fizzy.jq)). The panel stays hidden, and Files
  stays in front until you pick Fizzy.

**The key** is yours to add. Since Herdr 0.1.13, a `keys.json` nobody has edited gets Herdr's new default shortcuts
when Herdr updates, and any edit makes the whole file yours, which stops that. So by default the run leaves `keys.json`
alone: it prints the line to add to its `global` section, `"cmd-shift-j": "fizzy-tabs.panel:fizzy"` on macOS or
`"ctrl-shift-j": "fizzy-tabs.panel:fizzy"` on Linux (on another system, it says to bind a key of your own), and why it
did not add it. When `keys.json` already binds a key to `fizzy-tabs.panel:fizzy`, in any section, it names that key
instead.

`--add-key` adds that line at the end of `global` (a `global` section is added when the file has none), only when the
key is bound nowhere in the file: a key you use is never replaced (the run names it, and still exits 0). The merge
leaves every other byte of the file as it was, and saves the old file in the backups folder first. It needs `node`;
without it, without a `keys.json`, or with one that is not valid JSON, the run prints the line to add. When there is no
`fizzy-tabs`, there is no key to add either.

It switches Herdr to `fizzy-core` only when this run made that layout, nothing failed to go in, Herdr is running, and
Herdr shows its own `main` layout. Otherwise it says how to switch: Herdr's layout key, `cmd-shift-l` (Linux:
`ctrl-shift-l`), or `herdr-app do layout.switch --name fizzy-core`. Herdr reloads mods, layouts and `keys.json` as their
files change, so there is nothing to restart.

When it finds `herdr-app` (on your PATH, else in `/Applications/Herdr.app`; `HERDR_APP` names another), the script
asks `herdr-app status` whether Herdr runs and which layout it shows, and records the version `herdr-app --version`
reports in the `cloned_from` of `fizzy-tabs` and `fizzy-core`, as Herdr's own clones do. Without one, or with
`HERDR_APP` set but empty, there is no `herdr-app check` and no layout switch.

A mod that is new or changed passes `herdr-app check` in the scratch folder before it goes in (not with `--dry-run`,
which runs no check): one that fails stops the run with nothing changed. Where `herdr-app check` cannot load mods from
the scratch folder (Herdr's own tab bar, copied there, fails as well), each mod is checked once it is in `mods/`,
before the layout and the key; if one fails there, every mod the run put in place goes back to what was there (a new
one is taken out, a replaced one is restored from its backup) and the run stops with nothing changed.

**Whether the patch fits** is checked on every run, whatever Herdr's version: `fizzy-tabs` is built only when a dry run
of the patch shows that every hunk fits this Herdr's tab bar with no fuzz (a hunk that moved is fine). Otherwise none of
the patch goes in and no `fizzy-tabs` is built: a `fizzy-tabs` from an earlier run stays as it is, and `fizzy-core` is
made only when such an earlier `fizzy-tabs` is there. The mod still goes in, the run shows what `patch` said, and it
exits 2. Then apply the patch by hand to a clone of your own ([tabs/README.md](tabs/README.md#when-it-doesnt-fit)).

It can run again at any time. A part that is up to date stays; `mods/fizzy` is updated file by file; `fizzy-tabs` is
built again from the tab bar of the Herdr you have now (when the patch no longer fits, the one that is there stays, and
the script says so); a `fizzy-core.json` that is there is never edited. Anything replaced or removed is saved first,
under `${XDG_STATE_HOME:-~/.local/state}/herdr-fizzy/backups/<time>`. A `mods/fizzy`, `mods/fizzy-tabs` or
`layouts/fizzy-core.json` that is a link is left as it is. `HERDR_APP_HOME` and `XDG_STATE_HOME` move the two folders.

It exits with:

- 0 when it is done, or there was nothing to do, also when no key was added (the run prints the line to add). With
  `--dry-run`, 0 means everything could be done, though only a real run runs `herdr-app check`. With `--uninstall`, a
  part left in place because `install.sh` did not make it, or because it is a link, still counts as done.
- 1 when it stopped with nothing changed: a wrong option or pair of options, a missing tool, no Herdr app home, a mod
  failing `herdr-app check`, or, with `--uninstall`, Herdr not leaving `fizzy-core`.
- 2 when it is partly done: a part was refused, or could not be put in place, put back or taken out, or Herdr did not
  switch to `fizzy-core`. Its lines say which part, and where each part stands.

**Your own tab bar or layout.** `install.sh` never changes a layout or tab bar of yours, with one exception: the name
`mods/fizzy-tabs` is its own, so a folder there that `install.sh` did not make is saved in the backups folder and
rebuilt as `fizzy-tabs` (the run says so when that folder is not a copy of Herdr's tab bar). When it finds a tab bar
or layout of yours, it prints the commands that add Fizzy to them near the end of its run; `--mod-only` installs the
mod alone and always prints those commands. [`tabs/README.md`](tabs/README.md) adds the Fizzy button to your own copy
of the tab bar, and [`layout/README.md`](layout/README.md) adds the page to your own layout.

## Uninstall

```sh
./install.sh --uninstall             # --dry-run to see first
```

When Herdr shows `fizzy-core`, it switches to `main` first; if that fails, nothing is removed, it says to switch to
another layout (with `cmd-shift-l`, Linux: `ctrl-shift-l`) and run it again, and it exits with 1. Then it removes
`layouts/fizzy-core.json`, `mods/fizzy-tabs` and `mods/fizzy`, each saved in the backups folder first, and takes
`cmd-shift-j` (Linux: `ctrl-shift-j`) out of the `global` section of `keys.json` only while it still names
`fizzy-tabs.panel:fizzy`, whether `--add-key` or you put it there. That key in another section, and another key you
bound to the Fizzy button, stay. Without `node`, it prints the line to take out. It keeps `fizzy-tabs` while a layout
of yours shows it, prints the line that points that layout back at Herdr's own tab bar, and exits 2. A
`fizzy-core.json` it did not make, a `fizzy-tabs` that is not a copy of Herdr's tab bar, and anything that is a link,
stay as well; those count as done.

It leaves, in Herdr's app folder, Herdr's own records (the `fizzy.*` keys in `shared.json`, and the clicks Herdr kept
for the layout in `layouts/.state/fizzy-core.json`) and the profile photos and images the panel fetched into
`data/fizzy`; delete that folder yourself to remove them. Files you saved to Downloads stay there. Its lines near the
end say where these are. The panel's local storage, which Herdr keeps, is not touched either.

## Which board

**Follow current space** is on to begin with. The panel takes the active space's folder (the folder of its first
terminal, else the space's own) and looks for the nearest `.fizzy.yaml` from there upward, on that space's machine when
the space is on another machine. Its `board:` (a board id) is the board shown. Put one in a project, and that
project's board comes up when you switch to its space. The lookup is asked again at most once a minute per folder.

Without one, or with a board that is not in your list, it shows the board you picked, then the `fizzy` CLI's own
default board (what `fizzy config show` says from your home folder), then your first board. The panel keeps that
default for its next start; on its very first start it waits for `config show` before it shows a board. Picking a
board in the dropdown turns following off; **Follow current space** turns it back on, and shows the space's board
beside it, or "no .fizzy.yaml". A board chosen in the **New card** picker is picked the same way (following off), unless
it is the board already shown: then following and the pick stay as they are.

## Keys

**`fizzy-tabs.panel:fizzy`** is the action of the key `install.sh` prints a line for, and binds with `--add-key`:
`cmd-shift-j` on macOS, `ctrl-shift-j` on Linux ([Install](#install)). It does what the tab bar's Fizzy button does:
it brings the Fizzy page up, or hides the panel when Fizzy is already in front. `panel:files` and `panel:changes` do
the same for those pages, when the bar shows their buttons. Only `fizzy-tabs` takes these keys: in a layout whose tab
bar is `fizzy-tabs`, such as `fizzy-core`, the bar is always shown, so the key works whether the panel is open or
hidden; in other layouts it does nothing.

**`fizzy-tabs.search:fizzy`** brings the Fizzy page up (it never hides it) with the search of every board open and
its field focused. Bind it yourself, for example `"cmd-k": "fizzy-tabs.search:fizzy"` in the `global` section on macOS
(Herdr uses ⌘K for nothing). On Linux pick another key than `ctrl-k`, which terminal programs use to cut to the end of
the line. The tab bar asks the panel through `fizzy.request`, which the panel reads even while it is hidden, as
Herdr gives a `fizzy.*` key only to a shown panel.

The panel takes commands of its own: bind `"<key>": "fizzy.<command>"` in `keys.json`, for example
`{ "global": { "<your key>": "fizzy.insert" } }`. A command is `name` or `name:arg` (`name arg` works too, and the
name's case doesn't matter); an unknown one, or one with nothing to act on, does nothing. Herdr delivers a `fizzy.*`
command only while the Fizzy page is shown, so with the panel hidden or another page in front these keys do nothing;
`fizzy-tabs.panel:fizzy` brings the page up for them.

| Command | What it does |
|---|---|
| `refresh` | What Refresh does: the boards, the CLI's config, the signed-in user and what shows, read again |
| `view:<board\|mine\|inbox\|pins>` | Shows that view, leaving an open card, Settings or the search; `view` alone shows the next one |
| `board:<id or name>` | Picks that board for the Board view and stops following the space |
| `follow` | Follows the current space again |
| `open:<number>` | Opens that card; `open:<number>:<notification id>`, what a toast's click sends, also marks the notification read |
| `back` | Goes from a Settings page to the list of settings; else leaves Settings or the open card; else closes the search |
| `settings` | Opens Settings |
| `insert`, `send`, `start`, `copy` | The hand-off buttons: for the open card, else the picked cards, else (Board view) the board shown |
| `new` | Opens the **New card** board picker (nothing happens until a board shows); choosing a board makes a card in its Maybe? and opens it |
| `search` | Opens the search in the header, leaving an open card or Settings |
| `filter` | Puts the cursor in the filter at the foot, closing the search and unpicking cards (from the Inbox, which has none, it shows the Board view first) |
| `menu:<number>` | Opens that card's menu |

## What it runs, reads and stores

**Network.** The mod makes no requests of its own. Everything that reaches Fizzy goes through the `fizzy` CLI, to the
account the CLI is set up for, attachments and uploads included; the only other downloads are people's profile photos
and the images a description or comment links from the web, by `curl`. Open in Fizzy, and a link in a description or a
comment, open in your browser.

**Programs.**

- `fizzy`, on this computer, run from your home folder, every command with `--json`. To read: `board list`,
  `board accesses` (who can see and watch the board), `column list`, `card list`, `card show`, `comment list`,
  `reaction list`, `user list`, `tag list`, `pin list`, `notification tray`, `activity list`, `search`,
  `card attachments show`, `identity show` and `config show`. The reads it repeats (`card list`, `search`, `pin list`,
  `notification tray`, `reaction list`, `activity list`, `card attachments show`, `board accesses`, and the
  `comment list` that counts a card's comments) and `config show` ask with `--jq` for only the fields the panel uses.
  `card attachments download` saves an attachment to a file: an image into the panel's images folder, a file you click
  into Downloads. To change something, only when you do: `card`, `step`, `comment` and `reaction` commands,
  `column move-left` and `move-right` for a column you drag (one per place), `board involvement` for Watch for new
  cards and Stop watching, `board update --all_access` for Everyone on the team, `upload file` for a file you drop or
  paste, and `notification read` and `read-all`. Each action is one command, or two (a closed card is reopened before
  it moves), and the panel reads again afterwards (not after Watch or Unwatch, or a reaction). New card is
  `card create`, then a `card list` when the CLI's answer does not give the new card's number, and a `card column` when
  the card goes in a column. An upload or a download may take up to 5 minutes; Herdr stops any other command after 30
  seconds.
- `sh` on this computer, for the photos: a short script that runs `curl` for one photo address (http or https only,
  following redirects, at most 4 MiB and 20 seconds), keeps the file only when it is a png, jpeg, webp, svg or gif
  image, and deletes that person's older photos (besides shell built-ins such as `[`, `printf` and `echo`, it runs only
  `mkdir`, `mv`, `rm` and `tr`).
- `sh` on this computer, for the images from the web: a short script that runs `curl` for one image address (http or
  https only, following redirects, at most 15 MiB and 25 seconds) and keeps the file only when it is a png, jpeg, gif,
  webp, svg or bmp image (besides shell built-ins, it runs only `mkdir`, `mv`, `rm` and `tr`).
- `sh` on this computer, for files: a script that finds a free name in Downloads (`mkdir`), one that opens a file or
  shows it in its folder (`uname`, then `open` on macOS, `dirname` and `xdg-open` on Linux), and one that writes the
  clipboard's image to a PNG (`uname`, then `osascript` on macOS, `wl-paste` or `xclip` on Linux, and `rm`), and one
  that writes a card's file for a drag (`mkdir` and `printf`). The panel also runs `mkdir`, `mv` and `rm` itself, in the
  images folder.
- `sh` on the active space's machine (this computer, or the other machine a remote space is on): a script that walks
  up from the space's folder and prints the `board:` line of the first `.fizzy.yaml` it finds (never the rest of the
  file, which may hold a token), using only `[` and `grep`.
- When you open Start, Herdr's `knownAgents` asks the active space's machine which agents are installed; the agent you
  pick runs in a new tab, through Herdr's `tab.new`.

**Files it reads.** The nearest `.fizzy.yaml` in or above the space's folder ([Which board](#which-board)), of which it
keeps only `board:`. It opens none of the CLI's own files: the CLI's account and default board come from
`fizzy config show`, asked at start and on Refresh with `--jq` for those two values only, so nothing of your CLI token
reaches the panel. A file you drop on a box is read by `fizzy upload file`, which sends it to Fizzy, and a paste with
no text reads the clipboard's image.

**Files it writes.** Profile photos, under Herdr's app folder in `data/fizzy/avatars`: one file per person, named after
their user id and the day it was fetched. A photo is kept a week; the list of people is read again every day, and what
is missing or older is fetched again, at most four at a time. A photo that fails is tried again after an hour.

Images from descriptions and comments, under Herdr's app folder in `data/fizzy/files`: one file per image, named after a
short hash of its attachment id or its address. A pasted image is written there first, and becomes the copy of that
image once it is uploaded; when the upload fails, it is deleted. A card's file for a drag is written to
`data/fizzy/files/cards`, again at each press. At start, whatever is in `data/fizzy/files` from over 7 days ago is
deleted (a card shown again downloads its images again). The folded columns' names, read top to bottom, are small SVG
files in `data/fizzy/labels` (mods can't turn text), one per name, written once per run. A file whose chip you click
is saved in `~/Downloads`. The mod writes no other file; the rest goes to Herdr's storage.

**Herdr's storage.** The mod keeps in its local storage (Herdr's `localStorage`): the view, the board you picked and
whether you follow the space, the list of boards (with each board's auto-postpone period), the CLI's account and
default board (from `config show`), the signed-in user's id and account, a copy of each board you opened (its columns
and open cards, each description cut to 300 characters) so it shows at once next time, which lanes and groups are
folded and which columns are open side by side, the step progress and comment count of the last 400 cards it counted
(with when each card last changed), the photos' and the images' file names, the ids of the last 300 notifications
already announced, what you set for watching on the last 200 cards, the mention id it learned for each person, when it
last looked through Fizzy's activity for them, and whether it may do so by itself.

The mention ids stay on this computer, in that local storage only: the shared `fizzy.people` says only who can be
tagged, and an id goes nowhere but back to Fizzy, inside a comment or description you save.

It writes these shared keys, which every mod can read (Herdr keeps them in `shared.json`):

| Shared key | What it holds |
|---|---|
| `fizzy.unread` | The number of your unread notifications (see below) |
| `fizzy.boards` | Your boards' ids and names |
| `fizzy.people` | The account's people (id, name, role, active), its tags, the signed-in user's id, and the ids of the people the panel can tag (not their mention ids) |
| `fizzy.avatars` | Each person's photo file, by user id |
| `fizzy.boardGroups` | Your board groups, and the order you gave the boards |
| `fizzy.board` | The last choice made in the board dropdown or the New card picker |
| `fizzy.request` | An action a popup hands to the panel (popups are copies of the same mod): a change, a reaction, the person or card picked for a box, or a hand-off with its text; or, from the tab bar's `search:fizzy`, `{ op: { kind: "search" } }`. The panel sets it to null once it has handled it |
| `new-menu.agents` | Herdr's own `new-menu` cache of the agents each machine reported; the Start list shows it at once, and writes back what the machine answered |

**When it asks Fizzy.** Never while `herdr-app check` loads it (as `install.sh` does): there it runs nothing and
writes nothing. Every 30 seconds while the panel shows, and at once when it comes back, it reads what is on
screen: the open card with its comments, else the view, and nothing while you edit a title, a description, a step or a
comment. On Board that is the open cards; the columns are read when they are not known yet (none kept from an earlier
run) and on Refresh, each time with the board's stalled cards and its watchers, and when an open card names a column it
does not know; Not Now and Done are read when you unfold (or open) them, on Refresh and after a change you make while
they show. After each read of the board, the cards whose step progress and comment count are not kept for them as they
are now are counted, three at a time. Mine
asks every board in one call when the CLI has no default board (with one, a boardless read would only see that board,
so it asks each board), and is read every other time. The pin list is read at start, when a card opens, after a change
you make and in the Pins view. When a card is read, the reactions of its comments are read the first time (six at a
time, and all again on Refresh), and its images that are not on disk yet are downloaded. Every 30 seconds, even while
the panel is hidden, it reads your unread notifications with one `notification tray`, which fills the Inbox, the count
and the toasts; opening the Inbox or Refresh in it reads that once more. The board list is read at start and on
Refresh, the people at start and then daily, the tags the first time a card or a card menu opens, and again after you
tag a card. After the people are read, while someone can't be tagged and **Find mentions automatically** is on, the
activity is read too, at most once a week. The signed-in user is kept between runs for the account the CLI's config
names; it is read again on Refresh, and when the config names another account.

## For other mods: `fizzy.unread`

`shared("fizzy.unread")` is the number of your unread Fizzy notifications. The panel counts them every 30 seconds, also
while it is hidden, and at once when you read notifications in the panel, and writes the key only when the number
changes; while the CLI fails, the key keeps its last value. It is kept up to date while a layout with the Fizzy page is
shown. The tab bar's dot reads it.

## Development

```sh
npm test                                                        # the whole suite
node --import ./test/register.mjs --test test/fizzy-lib.test.mjs  # one file
```

Tested on macOS with node 26; Linux and node 22 are untested. The suite uses no npm packages. It needs node 22 or
newer, `bash`, `sh`, `jq`, `diff`, `cmp` and `patch` on PATH, besides the usual `cat`, `cp`, `date`, `dirname`, `grep`,
`mkdir`, `mktemp`, `mv`, `readlink`, `rm`, `sed`, `stat` and `tr`.

- The panel's tests load the mod against mocks of Herdr's `herdr`, `gpui-kit` and `gpui-base` modules (`test/mocks/`,
  put in place by `test/register.mjs`) and a fake `fizzy` CLI with a made-up account (`test/fizzy-fixtures.mjs`). They
  never start Herdr or run a real `fizzy`. `lib.js`'s tests read answers in the CLI's own shapes, with made-up content
  (`test/fizzy-samples.mjs`), and run its `--jq` projections through the real `jq`. The photo tests run the photo
  script with `sh` and a stub `curl` first on PATH; the `.fizzy.yaml` lookup runs under each of `sh`, `dash`,
  `bash --posix`, `ksh` and `zsh --emulate sh` that the machine has.
- The install tests run `install.sh` under `/bin/bash` where there is one (macOS's 3.2), on a scratch Herdr app folder
  that holds an invented tab bar and `main` layout, with stubs of `herdr-app` and `uname` and a stand-in `patch`
  (`test/mocks/patch.mjs`) first on PATH. `jq`, `diff`, `cmp` and the usual tools are the real ones.
- The patch tests run the real `patch` on a tab bar assembled from the patch's own lines, then load the patched bar.

Without `jq`, `diff`, `cmp` or `patch`, the tests that run them fail; they are not skipped. Two tests are skipped when
what they need is missing: the `shellcheck` one without `shellcheck`, and the one with a `keys.json` that cannot be
written when run as root. The test of the `.fizzy.yaml` lookup with no file to find leaves those cases out, with a
note, when a `.fizzy.yaml` sits in the temp folder or a folder above it. And `install.sh changed nothing in this repo`
compares the repo's `install.sh`, `mods`, `tabs`, `layout` and `scripts` before and after, so editing them while the
suite runs fails it.

| Test | What it covers |
|---|---|
| `test/fizzy-lib.test.mjs` | `lib.js`: the CLI's envelope and errors, each command's arguments and `--jq` projections, lanes and moves, the filter, references, HTML and text, the board choice, board groups, menus, notifications |
| `test/fizzy-panel.test.mjs` | The panel and its popups: what they ask the CLI, what they draw, what each click and key does |
| `test/fizzy-avatars.test.mjs` | The photo script, run for real against a stub `curl`, and the photo file names |
| `test/install.test.mjs` | `install.sh`, `layout/add-fizzy.jq` and `scripts/merge-keys.mjs` |
| `test/tabs-patch.test.mjs` | The patch: its form, `patch` applying and reversing it, and the patched tab bar's button, dot and key command |
| `test/assets.test.mjs` | The icons: every one the panel draws is there, and in Lucide's style |
| `test/syntax.test.mjs` | Syntax, `bash -n` and `shellcheck`, and the mod rules a test can see in the source |
| `test/mocks.test.mjs` | The mocks themselves |

`RECIPE.md` is the brief to build the panel from scratch, with the sections Herdr's recipe form has; it has no preview
image.

## License

MIT: see [LICENSE](LICENSE). The icons are Lucide's, and the patch's context lines are Herdr's:
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) has their licenses.
