# The Fizzy page in a layout

The Fizzy panel is a page of the side panel on the right, next to Files and Changes. `mods/fizzy/mod.json` says
`"place": "none"`, so Herdr never puts the mod anywhere by itself: a layout shows it only where it has this block.

## The block

```json
{ "id": "fizzy", "type": "block", "content": { "mod": "fizzy" } }
```

It goes last in the `children` of the stack whose `id` is `panel-body` (`"type": "stack"`), after `files` and
`changes`. In Herdr's own `main` layout that stack sits in the column `panel`, which starts hidden. The ids matter:
the mod and the tab bar's Fizzy button look for `panel`, `panel-body` and the page id `fizzy`. Nothing else changes:
the panel stays hidden, and Files stays the page in front until you pick Fizzy.

[`add-fizzy.jq`](add-fizzy.jq) makes that change:

- it adds the block once (a second run changes nothing);
- it points every block that shows Herdr's own tab bar (`"content": { "mod": "tabs" }`) at the tab bar named with
  `--arg tabs`; `--arg tabs tabs` leaves it alone, and a block that shows a clone already keeps it;
- it stops, writing nothing, when the layout has no single `panel-body` stack or another node already has the id
  `fizzy` (ids are unique in a layout).

## What install.sh does

On Herdr's own setup, [`../install.sh`](../install.sh) writes `layouts/fizzy-core.json`: Herdr's `main` layout through
this filter with `--arg tabs fizzy-tabs`, plus the `cloned_from` that Herdr's own clones record. It never edits a
layout that is already there. Herdr sees a new layout file at once. When the run has just made `fizzy-core` and Herdr
shows `main`, it switches Herdr to `fizzy-core`; otherwise switch with Herdr's layout key, `cmd-shift-l` (Linux:
`ctrl-shift-l`), or `herdr-app do layout.switch --name fizzy-core`.

## Your own layout

Herdr's own layouts (`main`, `terminals`, `win98`) can't be edited: Herdr puts its version back on every start and
moves an edited one aside as `<name>-edited`. Change a layout of your own, or make one first (it switches to it):

```sh
herdr-app do layout.clone '{"name":"main","as":"desk"}'
```

Then, from the root of this repo, with your layout in `LAYOUT` and your tab bar with the Fizzy button in `BAR` (your
clone patched as in [`../tabs/README.md`](../tabs/README.md), or `fizzy-tabs` from `install.sh`):

```sh
APP_HOME="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
LAYOUT=desk BAR=desk-tabs
f="$APP_HOME/layouts/$LAYOUT.json"; t="$(mktemp "$f.XXXXXX")" && jq --arg tabs "$BAR" -f layout/add-fizzy.jq "$f" > "$t" && mv "$t" "$f" || rm -f "$t"
```

The result is written next to the layout under a name that doesn't end in `.json`, which Herdr ignores, and replaces
the layout in one rename once `jq` has succeeded.

By hand instead: add the block above to the `children` of `panel-body`, and set the `"content": { "mod": … }` of the
tab-bar block (id `tabs` in a copy of `main`) to your patched tab bar. A layout without a side panel needs a `panel`
column holding a `panel-body` stack first: Herdr's `layouts/main.json` has the shape.

## Undo

- `fizzy-core`: `../install.sh --uninstall` removes it, with `fizzy-tabs` and `mods/fizzy` (it switches Herdr to
  `main` first when `fizzy-core` is shown). It keeps `fizzy-tabs` while a layout of yours shows it, and prints the
  line that points that layout back at Herdr's own tab bar. Herdr's escape hatch `ctrl-alt-shift-escape` also sets the
  shown layout aside (`*.reset-<time>`), with your `keys.json`, and goes back to `main`; running `../install.sh` again
  makes `fizzy-core` anew.
- Your own layout: take the page out, then point the tab-bar block back at the tab bar it showed before.

  ```sh
  f="$APP_HOME/layouts/$LAYOUT.json"; t="$(mktemp "$f.XXXXXX")" && jq 'del(.. | objects | select(.id == "panel-body" and .type == "stack") | .children[]? | select(.id == "fizzy"))' "$f" > "$t" && mv "$t" "$f" || rm -f "$t"
  ```
