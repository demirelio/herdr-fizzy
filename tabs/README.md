# The Fizzy button for Herdr's tab bar

[`fizzy-button.patch`](fizzy-button.patch) changes a copy of Herdr's own tab bar (the `tabs` mod) so it opens the
Fizzy panel. It is made against Herdr's stock tab bar, for **Herdr 0.1.16 or newer**; `../install.sh` checks at install
time that it fits ([When it doesn't fit](#when-it-doesnt-fit)).

## What it adds

- A **Fizzy** button after Files and Changes and before the window buttons, drawn like them, with the mod's
  `mods/fizzy/kanban.svg`. It shows only when the layout's `panel-body` stack has a page with the id `fizzy`
  ([`../layout/README.md`](../layout/README.md)), whichever of Files and Changes the welcome chose.
- A dot on the button while the shared value `fizzy.unread` is above zero. The mod updates that count every 30
  seconds, also while its page is hidden, so the dot shows with the panel closed.
- A click opens the Fizzy page; with Fizzy already in front it hides the panel. Files and Changes work as before.
- A key command: `panel:<page>` (`panel:fizzy`, `panel:files`, `panel:changes`) does what that page's button does,
  for a page the bar offers. Bind it in `keys.json` as `"<key>": "<your tab bar>.panel:fizzy"`.
  [`keys.json`](keys.json) here suggests `cmd-shift-j` on macOS and `ctrl-shift-j` on Linux: take the one for your
  system.
- Herdr's tab bar remembers, for each space, which page of the side panel you had open; the patch adds Fizzy to the
  pages it offers, so that includes Fizzy.

[`../install.sh`](../install.sh) builds all this as `fizzy-tabs` on Herdr's own setup. It prints the `keys.json` line
for the key and adds it only with `--add-key`, when the key is free: since Herdr 0.1.13, a `keys.json` nobody has edited
gets Herdr's new default shortcuts when Herdr updates, and any edit makes the whole file yours, which stops that. The
rest of this page is for doing it by hand.

## Apply it to your own tab bar

Herdr's own mods can't be edited (it puts them back on every start), so the patch goes onto a clone. Make one if you
don't have one yet:

```sh
herdr-app do mod.clone '{"name":"tabs","as":"desk-tabs"}'
```

Then, from the root of this repo, with your clone's name in `BAR`:

```sh
APP_HOME="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
BAR=desk-tabs
sed "s#mods/tabs/#mods/$BAR/#g" tabs/fizzy-button.patch | patch -N -F 0 -p1 -d "$APP_HOME/mods/$BAR"
```

A clone rewrites its own asset paths (`mods/tabs/win-min.svg` becomes `mods/desk-tabs/win-min.svg`), and the patch's
context has those lines, so the `sed` rewrites the patch the same way. Put `--dry-run` after `patch` to see first
whether it fits; `-N` refuses to apply it twice.

Then point your layout's tab-bar block at the clone and add the Fizzy page
([`../layout/README.md`](../layout/README.md)), and bind the key in `keys.json` (on Linux, `ctrl-shift-j`):

```json
{ "global": { "cmd-shift-j": "desk-tabs.panel:fizzy" } }
```

## A clone that already has a nextCommand() loop

Herdr hands a mod its key commands through `nextCommand()`. With two loops waiting on it in one mod, which loop gets a
command is not something to count on, so a mod keeps one loop and each feature adds its line to it. If another patch
already gave your clone a loop, apply this one with `-f` in place of `-N`:

```sh
sed "s#mods/tabs/#mods/$BAR/#g" tabs/fizzy-button.patch | patch -f -F 0 -p1 -d "$APP_HOME/mods/$BAR"
```

The first two hunks (the import and the loop) are refused into `main.js.rej`, and the rest goes in. Then, by hand:

1. add `nextCommand` to the import from `"herdr"` if it is not there;
2. add one line inside the loop you have, next to its own dispatch line, using that loop's name for the command:

   ```js
   try { this.panelCommand(command); } catch {}
   ```

3. delete `main.js.rej`, and `main.js.orig` if `patch` made one.

`panelCommand` ignores commands that aren't `panel:<page>`, so it shares the loop with any other feature's handler.

## When it doesn't fit

The patch is made against Herdr's stock tab bar. On a Herdr whose tab bar changed, or on a clone you changed, `patch`
names the hunks it refused and writes them to `main.js.rej`: each shows the lines to add and where, and you add them by
hand. `../install.sh` builds `fizzy-tabs` only when a dry run of the patch shows that every hunk fits with no fuzz;
otherwise it shows what `patch` said and builds no `fizzy-tabs`: one from an earlier run stays as it is, and without
one it makes no `fizzy-core` layout either. Then apply the patch to a clone of your own, as above.

## Undo

```sh
sed "s#mods/tabs/#mods/$BAR/#g" tabs/fizzy-button.patch | patch -R -F 0 -p1 -d "$APP_HOME/mods/$BAR"
```

Or delete the clone, once your layout points back at the tab bar it showed before. Take the key out of `keys.json`
too. For `fizzy-tabs`, `../install.sh --uninstall` removes the clone and takes `cmd-shift-j` (Linux: `ctrl-shift-j`)
out of the `global` section of `keys.json` while it is bound to `fizzy-tabs.panel:fizzy` there (that key in another
section stays), and also removes `mods/fizzy` and the `fizzy-core` layout: it has no option to remove the tab bar
alone. It keeps `fizzy-tabs` while a layout of yours shows it, and prints the line that points that layout back at
Herdr's own tab bar.

## Without the patch

`layout.toggle:panel` in `keys.json` shows and hides the side panel, with whatever page is in front, which is not
always Fizzy. Here it takes the key suggested for the Fizzy button (on Linux, `ctrl-shift-j`):

```json
{ "global": { "cmd-shift-j": "layout.toggle:panel" } }
```
