#!/usr/bin/env bash
# install.sh: add the Fizzy panel to Herdr: the fizzy mod, a tab bar with a Fizzy button, a layout with a Fizzy page.
#
#   ./install.sh               install mods/fizzy; build the fizzy-tabs tab bar (Herdr's own, plus the Fizzy button of
#                              tabs/fizzy-button.patch) and the fizzy-core layout (Herdr's main, plus the Fizzy page of
#                              layout/add-fizzy.jq); switch Herdr to fizzy-core if this run made it and Herdr shows
#                              main; print the keys.json line for a key that opens Fizzy, without adding it
#   ./install.sh --add-key     the same, and bind cmd-shift-j (Linux: ctrl-shift-j) to the Fizzy button in keys.json
#                              if that key is free
#   ./install.sh --mod-only    only mods/fizzy, for your own tab bar and layout (tabs/README.md, layout/README.md)
#   ./install.sh --dry-run     build everything in a scratch folder and say what would change, changing nothing; it
#                              runs no herdr-app check
#   ./install.sh --uninstall   remove fizzy-core, fizzy-tabs (unless a layout of yours shows it), mods/fizzy, and the
#                              key from the "global" section of keys.json while it is the Fizzy button's
#   ./install.sh --help
#
# For Herdr 0.1.16 or newer: fizzy-tabs is built only when a dry run of the patch shows that all of it fits this
# Herdr's tab bar with no fuzz.
#
# The key goes into keys.json only with --add-key: while nobody has edited keys.json, Herdr adds its new default
# shortcuts to it when it updates, and any edit makes the whole file yours, which stops that.
#
# A mod that is new or changed passes herdr-app check in the scratch folder before it goes in. Where herdr-app check
# cannot load mods from there, each is checked once it is in mods/; if one fails, what was there before is put back.
#
# Your own layouts and tab bars are left as they are, but for a mods/fizzy-tabs folder install.sh did not make: that
# name is install.sh's, so such a folder is saved, then rebuilt. When the run finds one of your own (and always with
# --mod-only), it prints the lines that add Fizzy to them near its end. A key you use is never taken over, and a
# mods/fizzy, mods/fizzy-tabs or fizzy-core.json that is a link is never written through. Anything replaced or removed
# is saved first, under the backups folder ${XDG_STATE_HOME:-~/.local/state}/herdr-fizzy/backups/<time>.
#
# Needs jq, patch, diff and cmp (--mod-only: only diff and cmp; --uninstall: only jq), and node to add or remove the
# key.
#
# Environment:
#   HERDR_APP_HOME   Herdr's app folder, default ~/.config/herdr-app; set but empty, it is refused
#   XDG_STATE_HOME   where the backups folder goes, default ~/.local/state
#   HERDR_APP        the herdr-app program, default herdr-app on PATH, then /Applications/Herdr.app; set it empty to
#                    go without (no herdr-app check, no layout switch)
#
# Exit status:
#   0  done, or nothing to do, also when no key was added (the run prints the line to add); with --dry-run: everything
#      could be done, though only a real run runs herdr-app check; with --uninstall, also when a part stays because
#      install.sh did not make it or because it is a link
#   1  stopped with nothing changed: a wrong option, a missing tool, no Herdr app home, a mod failing herdr-app check,
#      or with --uninstall, Herdr not leaving fizzy-core
#   2  partly done: a part was refused, or could not be put in place, put back or taken out, or Herdr did not switch
#      to fizzy-core (the lines above say which, and where each part stands)
set -euo pipefail

case "${BASH_SOURCE[0]}" in */*) REPO="${BASH_SOURCE[0]%/*}" ;; *) REPO=. ;; esac
REPO="$(cd "$REPO" && pwd)"

MOD=fizzy
TABS=fizzy-tabs
LAYOUT=fizzy-core
ACTION="$TABS.panel:fizzy"
PATCH="$REPO/tabs/fizzy-button.patch"
FILTER="$REPO/layout/add-fizzy.jq"
KEYS="$REPO/tabs/keys.json"
MERGE="$REPO/scripts/merge-keys.mjs"
NL='
'

if [ -n "${HERDR_APP_HOME+set}" ]; then APP_HOME="$HERDR_APP_HOME"; else APP_HOME="${HOME:-}/.config/herdr-app"; fi
BACKUPS="${XDG_STATE_HOME:-${HOME:-}/.local/state}/herdr-fizzy/backups"
BACKUP="$BACKUPS/$(date -u +%Y%m%d-%H%M%S)" # this run's, made by the first thing it saves
if [ -e "$BACKUP" ]; then BACKUP="$BACKUP-$$"; fi
STAGE=""
HERDR=""
VERSION=""
RUNNING=0
SHOWN=""

say() { printf '%s\n' "$*"; }
indent() { printf '%s\n' "$1" | sed 's/^/    /'; }
die() { printf 'install.sh: %s\n' "$*" >&2; exit 1; }
usage() {
  local line first=1
  while IFS= read -r line; do
    if [ "$first" = 1 ]; then first=0; continue; fi
    case "$line" in '#'*) line="${line#\#}"; printf '%s\n' "${line# }" ;; *) return 0 ;; esac
  done < "${BASH_SOURCE[0]}"
}
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is missing: $2, then run ./install.sh again"; }

# Herdr writes these into every mod folder: never copied, compared, or removed.
herdr_written() { case "$1" in *.d.ts|jsconfig.json|*.error|.DS_Store) return 0 ;; esac; return 1; }
# Compares what copy_mod copies: no hidden files, nothing Herdr wrote.
same_tree() { diff -rq -x '.*' -x '*.d.ts' -x jsconfig.json -x '*.error' "$1" "$2" >/dev/null 2>&1; }

# Nothing is removed or moved outside the app home and the backups folder.
confined() {
  case "$1" in "$APP_HOME"/?*|"$BACKUPS"/?*) ;; *) die "refusing to touch $1: it is outside $APP_HOME" ;; esac
  case "$1/" in */../*|*/./*) die "refusing to touch $1" ;; esac
}
remove() { confined "$1"; rm -rf -- "$1"; }
move() { confined "$1"; confined "$2"; mv "$1" "$2"; }
cleanup() { if [ -n "$STAGE" ] && [ -d "$STAGE" ]; then remove "$STAGE"; fi; }
trap cleanup EXIT

# $1, a path under the app home, copied into this run's backup folder the first time it is about to change. A link is
# refused: cp copies the link, so the backup would point at what is about to change.
backup() {
  [ ! -L "$APP_HOME/$1" ] || return 1
  [ -e "$APP_HOME/$1" ] || return 0
  [ ! -e "$BACKUP/$1" ] || return 0
  mkdir -p "$BACKUP/$(dirname "$1")" && cp -R -p "$APP_HOME/$1" "$BACKUP/$1"
}

# install.sh never makes links: a part that is one is the person's, and is neither changed, saved nor removed.
is_link() { [ -L "$APP_HOME/$1" ]; }
link_note() { say "$1: $APP_HOME/$2 is a link to $(readlink "$APP_HOME/$2"), which install.sh does not make, so it and what it points at stay as they are"; }

# GNU stat, then BSD stat.
device_of() { stat -L -c %d "$1" 2>/dev/null || stat -L -f %d "$1" 2>/dev/null || true; }

# $1, staged, renamed to $2 so Herdr never sees it half made. A rename across filesystems (mods/ or layouts/ linked
# elsewhere) would copy, so then $1 is first copied next to $2 under a hidden name, and renamed within $2's folder.
put_whole() {
  local near="${2%/*}/.${2##*/}${STAGE##*/}"
  if [ "$(device_of "$STAGE")" = "$(device_of "${2%/*}")" ]; then move "$1" "$2"; return; fi
  if cp -R "$1" "$near" && move "$near" "$2"; then return 0; fi
  if [ -e "$near" ]; then remove "$near"; fi
  return 1
}

check_app_home() {
  [ -n "$APP_HOME" ] || die "HERDR_APP_HOME is empty: set it to Herdr's app folder, or unset it for ~/.config/herdr-app"
  [ -d "$APP_HOME" ] || die "no Herdr app home at $APP_HOME: start Herdr once so it writes its files, or set HERDR_APP_HOME"
  APP_HOME="$(cd "$APP_HOME" && pwd)"
  if only_slashes "$APP_HOME" || only_slashes "$(cd "$APP_HOME" && pwd -P)"; then die "refusing HERDR_APP_HOME=$APP_HOME: it is /"; fi
}
only_slashes() { case "$1" in *[!/]*) return 1 ;; esac; }

find_herdr() {
  local name
  if [ -n "${HERDR_APP+set}" ]; then name="$HERDR_APP"
  elif command -v herdr-app >/dev/null 2>&1; then name=herdr-app
  elif [ -x /Applications/Herdr.app/Contents/MacOS/Herdr ]; then name=/Applications/Herdr.app/Contents/MacOS/Herdr
  else name=""; fi
  if [ -n "$name" ] && ! HERDR="$(command -v "$name")"; then say "herdr: $name is not a program, so it was left out"; HERDR=""; fi
  if [ -z "$HERDR" ]; then say "herdr: no herdr-app, so no herdr-app check and no layout switch"; fi
  return 0
}

# The version herdr-app reports, for the clones' cloned_from.
read_version() {
  local out
  [ -n "$HERDR" ] || return 0
  out="$("$HERDR" --version 2>/dev/null)" || return 0
  out="${out#* }"; out="${out%%[[:space:]]*}"
  case "$out" in [0-9]*) VERSION="$out" ;; esac
  return 0
}

# RUNNING=1 while a Herdr window answers; SHOWN is the layout it shows.
read_window() {
  local out
  [ -n "$HERDR" ] || return 0
  out="$("$HERDR" status 2>/dev/null)" || return 0
  RUNNING=1
  SHOWN="$(printf '%s\n' "$out" | jq -r '.layout // empty' 2>/dev/null)" || SHOWN=""
  return 0
}

# A layout file with the Fizzy page in its panel-body stack and a block that shows the fizzy-tabs tab bar.
ours_layout() {
  jq -e --arg tabs "$TABS" '
    ([.. | objects | select(.id == "panel-body" and .type == "stack") | .children[]? | select(.id == "fizzy" and .content.mod? == "fizzy")] | length) == 1
    and any(.. | objects; .content.mod? == $tabs)' "$1" >/dev/null 2>&1
}
has_fizzy_page() { jq -e 'any(.. | objects; .content.mod? == "fizzy")' "$1" >/dev/null 2>&1; }
tabs_clone() { [ "$(jq -r '.cloned_from.name? // empty' "$1/mod.json" 2>/dev/null)" = tabs ]; }

# Layouts Herdr doesn't ship (installed.json is Herdr's list of what it ships) and clones of its tab bar, other than
# ours. OWN_* are those without Fizzy yet; WIRED_LAYOUTS already have the Fizzy page.
OWN_LAYOUTS="" OWN_LAYOUT="" OWN_LAYOUTS_N=0 OWN_BARS="" OWN_BAR="" OWN_BARS_N=0 WIRED_LAYOUTS=""
find_own() {
  local f d name shipped=""
  if [ -f "$APP_HOME/installed.json" ]; then shipped="$(jq -r 'keys[]' "$APP_HOME/installed.json" 2>/dev/null)" || shipped=""; fi
  for f in "$APP_HOME"/layouts/*.json; do
    [ -f "$f" ] && [ -n "$shipped" ] || continue
    name="${f##*/}"; name="${name%.json}"
    case "$NL$shipped$NL" in *"${NL}layout:$name$NL"*) continue ;; esac
    if [ "$name" = "$LAYOUT" ]; then continue
    elif has_fizzy_page "$f"; then WIRED_LAYOUTS="${WIRED_LAYOUTS:+$WIRED_LAYOUTS, }$name"
    else OWN_LAYOUTS="${OWN_LAYOUTS:+$OWN_LAYOUTS, }$name"; OWN_LAYOUT="$name"; OWN_LAYOUTS_N=$((OWN_LAYOUTS_N + 1)); fi
  done
  for d in "$APP_HOME"/mods/*; do
    [ -d "$d" ] || continue
    name="${d##*/}"
    if [ "$name" = "$TABS" ] || ! tabs_clone "$d" || grep -q 'fizzy\.unread' "$d/main.js" 2>/dev/null; then continue; fi
    OWN_BARS="${OWN_BARS:+$OWN_BARS, }$name"; OWN_BAR="$name"; OWN_BARS_N=$((OWN_BARS_N + 1))
  done
  return 0
}

# The lines that add Fizzy to a tab bar and a layout of the person's own, with their names where they are known.
porting_lines() {
  local bar="<your tab bar>" layout="<your layout>" key
  if [ "$OWN_BARS_N" = 1 ]; then bar="$OWN_BAR"; fi
  if [ "$OWN_LAYOUTS_N" = 1 ]; then layout="$OWN_LAYOUT"; fi
  case ", $OWN_LAYOUTS, " in *", $SHOWN, "*) if [ -n "$SHOWN" ]; then layout="$SHOWN"; fi ;; esac
  key="$(platform_key)"
  say ""
  if [ -n "$OWN_LAYOUTS$OWN_BARS" ]; then
    say "Your own${OWN_LAYOUTS:+ layouts ($OWN_LAYOUTS)}${OWN_LAYOUTS:+${OWN_BARS:+ and}}${OWN_BARS:+ tab bars ($OWN_BARS)} are as they were. To add Fizzy to them:"
  else
    say "To add Fizzy to your own tab bar and layout:"
  fi
  if [ "$OWN_BARS_N" = 0 ] && [ -d "$APP_HOME/mods/$TABS" ]; then
    bar="$TABS"
  else
    if [ "$OWN_BARS_N" = 0 ]; then say "  herdr-app do mod.clone '{\"name\":\"tabs\",\"as\":\"<your tab bar>\"}'"; fi
    say "  sed \"s#mods/tabs/#mods/$bar/#g\" \"$PATCH\" | patch -N -F 0 -p1 -d \"$APP_HOME/mods/$bar\""
  fi
  say "  f=\"$APP_HOME/layouts/$layout.json\"; t=\"\$(mktemp \"\$f.XXXXXX\")\" && jq --arg tabs \"$bar\" -f \"$FILTER\" \"\$f\" > \"\$t\" && mv \"\$t\" \"\$f\" || rm -f \"\$t\""
  if [ -n "$key" ]; then say "  and in keys.json, \"global\": \"$key\": \"$bar.panel:fizzy\""; fi
  say "tabs/README.md and layout/README.md say more."
}

# $1 on macOS, $2 on Linux, nothing on another system.
by_platform() {
  case "$(uname -s 2>/dev/null)" in Darwin) say "$1" ;; Linux) say "$2" ;; esac
  return 0
}
platform_key() { by_platform cmd-shift-j ctrl-shift-j; }
# The key Herdr's default keymap binds to layout.switch.
layout_key() { by_platform cmd-shift-l ctrl-shift-l; }
# $1: the layout.
switch_hint() {
  local key
  key="$(layout_key)"
  say "${key:+$key switches layouts, or }run herdr-app do layout.switch --name $1"
}

# The platform's key from tabs/keys.json into (add) or out of (remove) the person's keys.json, by merge-keys.mjs; more
# flags go to it. Returns its status: 0 the key is the Fizzy button's (or gone), 2 it is not (the lines say why), 1 the
# file could not be written.
merge_key() {
  local mode="$1" key line theirs="$APP_HOME/keys.json"
  shift
  key="$(platform_key)"
  if [ -z "$key" ]; then
    if [ "$mode" = add ]; then say "keys: no key is suggested on this system: bind one to $ACTION in keys.json (tabs/README.md)"; fi
    return 2
  fi
  line="\"$key\": \"$ACTION\""
  if [ ! -f "$theirs" ]; then
    if [ "$mode" = add ]; then say "keys: $APP_HOME has no keys.json, so none was made: once Herdr has written one, add $line to its \"global\" section"; fi
    return 2
  fi
  if ! command -v node >/dev/null 2>&1; then
    if [ "$mode" = add ]; then say "keys: node not found, so keys.json was left alone: add $line to the \"global\" section of $theirs"
    else say "keys: node not found, so keys.json was left alone: take $line out of $theirs if it is there"; fi
    return 2
  fi
  node "$MERGE" "$mode" "$KEYS" "$theirs" "$BACKUP" --only "$key" "$@"
}

# Without --add-key: the key keys.json already binds to the Fizzy button, or the line to add for one and why it was
# not added.
suggest_key() {
  local bound key
  bound="$(jq -r --arg action "$ACTION" '[.[]? | objects | to_entries[] | select(.value == $action) | .key] | first // empty' "$APP_HOME/keys.json" 2>/dev/null)" || bound=""
  if [ -n "$bound" ]; then say "keys: $bound is already $ACTION"; return 0; fi
  key="$(platform_key)"
  if [ -n "$key" ]; then
    say "keys: none added. For a key that opens Fizzy, add this line to the \"global\" section of $APP_HOME/keys.json, or run ./install.sh --add-key:"
    indent "\"$key\": \"$ACTION\""
  else
    say "keys: none added. For a key that opens Fizzy, bind one to $ACTION in the \"global\" section of $APP_HOME/keys.json (tabs/README.md)"
  fi
  say "keys: install.sh leaves keys.json alone unless asked: while nobody has edited it, Herdr adds its new default shortcuts to it when it updates, and any edit makes the whole file yours, which stops that"
}

switch_layout() {
  local out errors
  if ! out="$("$HERDR" do layout.switch --name "$1" 2>&1)"; then
    say "layout: Herdr did not switch to $1:"; indent "$out"
    return 1
  fi
  errors="$("$HERDR" status 2>/dev/null | jq -r '.errors[]? | tostring' 2>/dev/null)" || errors=""
  if [ -n "$errors" ]; then say "herdr: herdr-app status reports:"; indent "$errors"; fi
  return 0
}

# A mod folder without what Herdr writes into it; $3, when given, is a sed script for its *.js files.
copy_mod() {
  local f name
  mkdir "$2" || return 1
  for f in "$1"/*; do
    [ -e "$f" ] || continue
    name="${f##*/}"
    if herdr_written "$name"; then continue; fi
    case "$name" in
      *.js) if [ -n "${3:-}" ]; then sed "$3" "$f" > "$2/$name" || return 1; else cp "$f" "$2/$name" || return 1; fi ;;
      *) cp -R "$f" "$2/$name" || return 1 ;;
    esac
  done
}

with_clone_paths() { sed "s#mods/tabs/#mods/$1/#g" "$PATCH"; }
cloned_from() { printf '. + {cloned_from: ({name: "%s"} + (if $v == "" then {} else {version: $v} end))}' "$1"; }

# Herdr's tab bar as mod.clone would copy it (asset paths and cloned_from), with the Fizzy button patch on top.
TABS_ERROR=""
build_tabs() {
  local dir="$STAGE/mods/$TABS" out
  copy_mod "$APP_HOME/mods/tabs" "$dir" "s#mods/tabs/#mods/$TABS/#g" || { TABS_ERROR="could not copy $APP_HOME/mods/tabs"; return 1; }
  if ! jq --arg v "$VERSION" "$(cloned_from tabs)" "$APP_HOME/mods/tabs/mod.json" > "$dir/mod.json" 2>/dev/null; then
    TABS_ERROR="$APP_HOME/mods/tabs/mod.json is not valid JSON"; return 1
  fi
  if ! out="$(with_clone_paths "$TABS" | patch --dry-run -N -F 0 -p1 -d "$dir" 2>&1)" ||
     ! out="$(with_clone_paths "$TABS" | patch -N -F 0 -p1 -d "$dir" 2>&1)"; then
    TABS_ERROR="$out"; return 1
  fi
  for out in "$dir"/*.orig "$dir"/*.rej; do if [ -e "$out" ]; then remove "$out"; fi; done
}

LAYOUT_ERROR=""
build_layout() {
  local out="$STAGE/layouts/$LAYOUT.json"
  if ! LAYOUT_ERROR="$(jq --arg tabs "$TABS" -f "$FILTER" "$APP_HOME/layouts/main.json" 2>&1 > "$out.page")"; then return 1; fi
  jq --arg v "$VERSION" "$(cloned_from main)" "$out.page" > "$out" || { LAYOUT_ERROR="could not write $out"; return 1; }
  remove "$out.page"
}

# new | same | replace | link, for a staged mod folder against the installed one.
plan_mod() {
  if is_link "mods/$1"; then say link
  elif [ ! -d "$APP_HOME/mods/$1" ]; then say new
  elif same_tree "$STAGE/mods/$1" "$APP_HOME/mods/$1"; then say same
  else say replace; fi
}

# A staged mod into mods/: a new one whole, so Herdr never sees it without its mod.json; an installed one is saved,
# then updated file by file, keeping what Herdr wrote into it. A changed file goes in by a rename from a hidden name,
# which Herdr's reload ignores, so no file is ever read half written; the files the new build drops go last, after
# the files that replace them. Returns 1 when the installed folder is as it was, 2 when it may be half updated; set -e
# is off in a function whose status is tested, so each step is checked.
put_mod() {
  local src="$STAGE/mods/$1" dst="$APP_HOME/mods/$1" f name
  if [ ! -d "$dst" ]; then put_whole "$src" "$dst" || return 1; return 0; fi
  backup "mods/$1" || return 1
  for f in "$src"/*; do
    [ -e "$f" ] || continue
    name="${f##*/}"
    if [ -d "$f" ]; then
      if [ -e "$dst/$name" ]; then remove "$dst/$name" || return 2; fi
      cp -R "$f" "$dst/$name" || return 2
    elif ! cmp -s "$f" "$dst/$name"; then
      if cp "$f" "$dst/.$name.new" && move "$dst/.$name.new" "$dst/$name"; then continue; fi
      if [ -e "$dst/.$name.new" ]; then remove "$dst/.$name.new"; fi
      return 2
    fi
  done
  for f in "$dst"/* "$dst"/.*.new; do
    [ -e "$f" ] || continue
    name="${f##*/}"
    case "$name" in .*.new) ;; *) if herdr_written "$name" || [ -e "$src/$name" ]; then continue; fi ;; esac
    remove "$f" || return 2
  done
}

# The line for a mod put_mod could not put in place: $1 labels it, $2 is the mod, $3 what put_mod returned.
not_put() {
  if [ "$3" = 2 ]; then say "$1: $APP_HOME/mods/$2 may be half updated (the error is above): run ./install.sh again; the previous copy is in $BACKUP/mods/$2"
  else say "$1: $2 could not be put in $APP_HOME/mods/$2, which is as it was (the error is above): run ./install.sh again"; fi
}

# The staged mods $@ through herdr-app check. A failure is the mod's own only when Herdr's tab bar, staged next to it,
# passes; otherwise this herdr-app check cannot load mods from the staging folder, and the mod goes on CHECK_IN_PLACE,
# to be checked once it is in mods/. Returns 1 when a mod fails.
CHECK_IN_PLACE="" STAGING_LOADS=""
check_staged() {
  local name out failed=0
  [ -n "$HERDR" ] || return 0
  for name in "$@"; do
    if out="$("$HERDR" check "$STAGE/mods/$name" 2>&1)"; then continue; fi
    if ! staging_loads; then CHECK_IN_PLACE="$CHECK_IN_PLACE $name"; continue; fi
    say "check: $name fails herdr-app check:"; indent "$out"
    failed=1
  done
  if [ -n "$CHECK_IN_PLACE" ]; then say "check: herdr-app check cannot load mods from the staging folder (Herdr's own tab bar fails there too), so each is checked once it is in place"; fi
  return "$failed"
}

staging_loads() {
  if [ -z "$STAGING_LOADS" ]; then
    STAGING_LOADS=no
    if [ -d "$APP_HOME/mods/tabs" ] && copy_mod "$APP_HOME/mods/tabs" "$STAGE/mods/tabs" &&
       "$HERDR" check "$STAGE/mods/tabs" >/dev/null 2>&1; then STAGING_LOADS=yes; fi
  fi
  [ "$STAGING_LOADS" = yes ]
}

# The mods of CHECK_IN_PLACE that this run put in place (PUT, as <mod>:new or <mod>:replace) through herdr-app check
# where they are. When one fails, every mod on PUT goes back to what was there. Returns 0 when all pass, 1 when one
# failed and everything went back, 2 when a mod could not go back.
PUT=""
check_in_place() {
  local item name out failed=0
  for item in $PUT; do
    name="${item%%:*}"
    case " $CHECK_IN_PLACE " in *" $name "*) ;; *) continue ;; esac
    if out="$("$HERDR" check "$APP_HOME/mods/$name" 2>&1)"; then continue; fi
    say "check: $name fails herdr-app check:"; indent "$out"
    failed=1
  done
  [ "$failed" = 1 ] || return 0
  for item in $PUT; do put_back "${item%%:*}" "${item#*:}" || failed=2; done
  return "$failed"
}

# Mod $1 back to what was there before this run: taken out when $2 is new, else its saved copy put back whole, copied
# under a hidden name next to it first, as put_whole does.
put_back() {
  local label=mod dst="$APP_HOME/mods/$1" near="$APP_HOME/mods/.$1${STAGE##*/}"
  if [ "$1" = "$TABS" ]; then label=tabs; fi
  if [ "$2" = new ]; then
    if remove "$dst"; then say "$label: took $1 out of $APP_HOME/mods again"; return 0; fi
    say "$label: $dst could not be taken out again (the error is above)"; return 1
  fi
  if cp -R -p "$BACKUP/mods/$1" "$near" && remove "$dst" && move "$near" "$dst"; then say "$label: put the previous $1 back in $dst"; return 0; fi
  if [ -e "$near" ]; then remove "$near"; fi
  say "$label: the previous $1 could not be put back in $dst (the error is above); it is saved in $BACKUP/mods/$1"
  return 1
}

install() {
  local dry="$1" mod_only="$2" add_key="$3" failed=0 put_failed=0 mod_plan tabs_plan="" layout_plan="" status lkey
  check_app_home
  need diff "install diffutils"
  need cmp "install diffutils"
  if [ "$mod_only" = 1 ]; then
    [ -d "$APP_HOME/mods" ] || die "$APP_HOME has no mods folder: start Herdr once so it writes its files, or set HERDR_APP_HOME"
  else
    need jq "install it (macOS: brew install jq; Debian and Ubuntu: sudo apt install jq)"
    need patch "install it (Debian and Ubuntu: sudo apt install patch)"
    [ -f "$APP_HOME/mods/tabs/main.js" ] && [ -f "$APP_HOME/layouts/main.json" ] ||
      die "$APP_HOME has no mods/tabs/main.js or layouts/main.json, which Herdr writes when it starts: start Herdr once, or set HERDR_APP_HOME"
  fi
  if ! command -v fizzy >/dev/null 2>&1; then say "fizzy: the fizzy CLI is not on PATH; the panel needs version 4 or newer (README.md)"; fi
  find_herdr
  read_version
  if command -v jq >/dev/null 2>&1; then read_window; find_own; fi

  STAGE="$(mktemp -d "$APP_HOME/.herdr-fizzy.XXXXXX")"
  mkdir "$STAGE/mods" "$STAGE/layouts"
  copy_mod "$REPO/mods/$MOD" "$STAGE/mods/$MOD" || die "could not copy $REPO/mods/$MOD"
  mod_plan="$(plan_mod "$MOD")"
  if [ "$mod_only" = 0 ]; then
    if is_link "mods/$TABS"; then tabs_plan=link
    elif build_tabs; then tabs_plan="$(plan_mod "$TABS")"
    elif [ -d "$APP_HOME/mods/$TABS" ]; then tabs_plan=stale
    else tabs_plan=none; fi
    if is_link "layouts/$LAYOUT.json"; then layout_plan=link
    elif [ -e "$APP_HOME/layouts/$LAYOUT.json" ]; then
      if ours_layout "$APP_HOME/layouts/$LAYOUT.json"; then layout_plan=same; else layout_plan=refuse; fi
    elif [ "$tabs_plan" = none ]; then layout_plan=none
    elif build_layout; then layout_plan=new
    else layout_plan=fail; fi
  fi

  if [ "$dry" = 0 ]; then
    set --
    case "$mod_plan" in new|replace) set -- "$MOD" ;; esac
    case "$tabs_plan" in new|replace) set -- "$@" "$TABS" ;; esac
    if ! check_staged "$@"; then say "Nothing was changed."; exit 1; fi
  fi

  case "$mod_plan" in
    new)
      if [ "$dry" = 1 ]; then say "mod: would install $MOD in $APP_HOME/mods/$MOD"
      elif put_mod "$MOD"; then PUT="$PUT $MOD:new"; say "mod: installed $MOD in $APP_HOME/mods/$MOD"
      else not_put mod "$MOD" $?; failed=1 put_failed=1; fi ;;
    same) say "mod: $MOD is up to date" ;;
    replace)
      if [ "$dry" = 1 ]; then say "mod: would update $MOD in $APP_HOME/mods/$MOD, saving the installed copy first"
      elif put_mod "$MOD"; then PUT="$PUT $MOD:replace"; say "mod: updated $MOD; the previous copy is in $BACKUP/mods/$MOD"
      else not_put mod "$MOD" $?; failed=1 put_failed=1; fi ;;
    link) failed=1; link_note mod "mods/$MOD" ;;
  esac
  case "$tabs_plan" in
    new)
      if [ "$dry" = 1 ]; then say "tabs: would make $TABS, Herdr's tab bar with the Fizzy button"
      elif put_mod "$TABS"; then PUT="$PUT $TABS:new"; say "tabs: made $TABS, Herdr's tab bar with the Fizzy button, in $APP_HOME/mods/$TABS"
      else not_put tabs "$TABS" $?; failed=1 put_failed=1; fi ;;
    same) say "tabs: $TABS is up to date" ;;
    replace)
      if ! tabs_clone "$APP_HOME/mods/$TABS"; then say "tabs: $APP_HOME/mods/$TABS is not a copy of Herdr's tab bar; it is saved before it is replaced"; fi
      if [ "$dry" = 1 ]; then say "tabs: would rebuild $TABS from this Herdr's tab bar, saving the installed copy first"
      elif put_mod "$TABS"; then PUT="$PUT $TABS:replace"; say "tabs: rebuilt $TABS from this Herdr's tab bar; the previous copy is in $BACKUP/mods/$TABS"
      else not_put tabs "$TABS" $?; failed=1 put_failed=1; fi ;;
    link) failed=1; link_note tabs "mods/$TABS" ;;
    stale|none)
      failed=1
      if [ "$tabs_plan" = stale ]; then say "tabs: the Fizzy button patch does not fit this Herdr's tab bar, so $TABS stays as it is (tabs/README.md):"
      elif [ "$layout_plan" = none ]; then say "tabs: the Fizzy button patch does not fit this Herdr's tab bar, so there is no $TABS and no $LAYOUT (tabs/README.md):"
      else say "tabs: the Fizzy button patch does not fit this Herdr's tab bar, so there is no $TABS (tabs/README.md):"; fi
      indent "$TABS_ERROR" ;;
  esac
  if [ -n "$CHECK_IN_PLACE" ]; then
    status=0
    check_in_place || status=$?
    if [ "$status" = 1 ] && [ "$put_failed" = 0 ]; then say "Nothing was changed."; exit 1; fi
    if [ "$status" != 0 ]; then exit 2; fi
  fi
  case "$layout_plan" in
    new)
      if [ "$dry" = 1 ]; then say "layout: would make $LAYOUT, Herdr's main layout with the Fizzy page"
      elif put_whole "$STAGE/layouts/$LAYOUT.json" "$APP_HOME/layouts/$LAYOUT.json"; then say "layout: made $LAYOUT, Herdr's main layout with the Fizzy page, in $APP_HOME/layouts/$LAYOUT.json"
      else failed=1 put_failed=1; say "layout: $LAYOUT could not be put in $APP_HOME/layouts, which is as it was (the error is above): run ./install.sh again"; fi ;;
    same)
      if [ "$tabs_plan" = none ]; then say "layout: $LAYOUT stays, but it has no tab bar until there is a $TABS (tabs/README.md)"
      else say "layout: $LAYOUT is up to date (it has the Fizzy page; your changes to it stay)"; fi ;;
    link) failed=1; link_note layout "layouts/$LAYOUT.json" ;;
    refuse)
      failed=1
      say "layout: $APP_HOME/layouts/$LAYOUT.json was not made by install.sh (no Fizzy page, or a tab bar other than $TABS), so it stays as it is: move it aside and run ./install.sh again, or add the page by hand (layout/README.md)" ;;
    fail) failed=1; say "layout: the Fizzy page could not be added to Herdr's main layout:"; indent "$LAYOUT_ERROR" ;;
  esac

  if [ "$mod_only" = 1 ]; then
    say "keys: none with --mod-only (the key names your tab bar: tabs/README.md)"
  elif [ "$tabs_plan" = none ]; then
    if [ "$add_key" = 1 ]; then say "keys: none added, as there is no $TABS for the key to open"; fi
  elif [ "$add_key" = 1 ]; then
    status=0
    if [ "$dry" = 1 ]; then merge_key add --dry-run || status=$?; else merge_key add || status=$?; fi
    if [ "$status" = 1 ]; then failed=1; fi
  else
    suggest_key
  fi

  # fizzy-core is not offered without its tab bar, nor while a part is not in place.
  if [ "$tabs_plan" != none ] && [ "$put_failed" = 0 ]; then
    case "$layout_plan" in
      new|same)
        if [ "$RUNNING" = 1 ] && [ "$SHOWN" = main ] && [ "$layout_plan" = new ]; then
          lkey="$(layout_key)"
          if [ "$dry" = 1 ]; then say "layout: would switch Herdr from main to $LAYOUT"
          elif switch_layout "$LAYOUT"; then say "layout: Herdr shows $LAYOUT now${lkey:+ ($lkey switches layouts)}"
          else failed=1; fi
        elif [ "$RUNNING" = 1 ] && [ "$SHOWN" = "$LAYOUT" ]; then say "layout: Herdr shows $LAYOUT"
        elif [ "$RUNNING" = 1 ]; then say "layout: Herdr shows ${SHOWN:-another layout} and stays there: $(switch_hint "$LAYOUT")"
        else say "layout: open Herdr, then switch to $LAYOUT: $(switch_hint "$LAYOUT")"; fi ;;
    esac
  fi

  if [ "$mod_only" = 1 ] || [ -n "$OWN_LAYOUTS$OWN_BARS" ]; then porting_lines; fi
  say ""
  if [ "$dry" = 1 ]; then say "Dry run: nothing was changed."
  else
    say "Herdr reloads mods, layouts and keys.json as their files change: nothing to restart."
    if [ -d "$BACKUP" ]; then say "What was replaced is saved in $BACKUP."; fi
  fi
  if [ "$failed" = 1 ]; then exit 2; fi
}

# $2, a path under the app home, saved and then removed; $1 labels the lines and $3 names it.
take_out() {
  if ! backup "$2"; then say "$1: $APP_HOME/$2 could not be saved (the error is above), so it stays"; return 1; fi
  if ! remove "$APP_HOME/$2"; then say "$1: $APP_HOME/$2 could not be removed in full (the error is above); it is saved in $BACKUP/$2"; return 1; fi
  say "$1: removed $3; it is saved in $BACKUP/${2%/*}"
}

# Layouts that show fizzy-tabs as their tab bar, with the lines that point each back at Herdr's own. fizzy-core counts
# only while it stays ($1 is 1 when it goes).
TABS_USERS="" TABS_USER_LINES=""
find_tabs_users() {
  local f name
  for f in "$APP_HOME"/layouts/*.json; do
    [ -f "$f" ] || continue
    name="${f##*/}"; name="${name%.json}"
    if [ "$name" = "$LAYOUT" ] && [ "$1" = 1 ]; then continue; fi
    jq -e --arg tabs "$TABS" 'any(.. | objects; .content.mod? == $tabs)' "$f" >/dev/null 2>&1 || continue
    TABS_USERS="${TABS_USERS:+$TABS_USERS, }$name"
    TABS_USER_LINES="${TABS_USER_LINES:+$TABS_USER_LINES$NL}  f=\"$f\"; t=\"\$(mktemp \"\$f.XXXXXX\")\" && jq '(.. | objects | select(.content.mod? == \"$TABS\") | .content.mod) |= \"tabs\"' \"\$f\" > \"\$t\" && mv \"\$t\" \"\$f\" || rm -f \"\$t\""
  done
  return 0
}

uninstall() {
  local dry="$1" failed=0 found=0 status=0 drop_layout=0 lkey
  check_app_home
  need jq "install it (macOS: brew install jq; Debian and Ubuntu: sudo apt install jq)"
  find_herdr
  read_window
  find_own
  if ! is_link "layouts/$LAYOUT.json" && [ -f "$APP_HOME/layouts/$LAYOUT.json" ] && ours_layout "$APP_HOME/layouts/$LAYOUT.json"; then drop_layout=1; fi
  if [ "$RUNNING" = 1 ] && [ "$SHOWN" = "$LAYOUT" ] && [ "$drop_layout" = 1 ]; then
    if [ "$dry" = 1 ]; then say "layout: would switch Herdr from $LAYOUT to main first"
    elif switch_layout main; then say "layout: switched Herdr from $LAYOUT to main"
    else lkey="$(layout_key)"; say "Herdr still shows $LAYOUT, so nothing was removed: switch to another layout${lkey:+ ($lkey)} and run ./install.sh --uninstall again."; exit 1; fi
  fi
  if [ -e "$APP_HOME/layouts/$LAYOUT.json" ] || is_link "layouts/$LAYOUT.json"; then
    found=1
    if is_link "layouts/$LAYOUT.json"; then link_note layout "layouts/$LAYOUT.json"
    elif [ "$drop_layout" = 0 ]; then say "layout: $APP_HOME/layouts/$LAYOUT.json was not made by install.sh, so it stays"
    elif [ "$dry" = 1 ]; then say "layout: would remove $LAYOUT, saving it first"
    elif ! take_out layout "layouts/$LAYOUT.json" "$LAYOUT"; then failed=1 drop_layout=0; fi
  fi
  if [ -d "$APP_HOME/mods/$TABS" ] || is_link "mods/$TABS"; then
    found=1
    find_tabs_users "$drop_layout"
    if is_link "mods/$TABS"; then link_note tabs "mods/$TABS"
    elif ! tabs_clone "$APP_HOME/mods/$TABS"; then say "tabs: $APP_HOME/mods/$TABS is not a copy of Herdr's tab bar, so it stays"
    elif [ -n "$TABS_USERS" ]; then
      failed=1
      say "tabs: $TABS stays, as these layouts of yours show it as their tab bar: $TABS_USERS. These lines point them back at Herdr's own tab bar; then ./install.sh --uninstall removes it:"
      say "$TABS_USER_LINES"
    elif [ "$dry" = 1 ]; then say "tabs: would remove $TABS, saving it first"
    elif ! take_out tabs "mods/$TABS" "$TABS"; then failed=1; fi
  fi
  if [ -d "$APP_HOME/mods/$MOD" ] || is_link "mods/$MOD"; then
    found=1
    if is_link "mods/$MOD"; then link_note mod "mods/$MOD"
    elif [ "$dry" = 1 ]; then say "mod: would remove $MOD, saving it first"
    elif ! take_out mod "mods/$MOD" "$MOD"; then failed=1; fi
  fi
  if [ "$found" = 0 ]; then say "Nothing install.sh makes is in $APP_HOME."; fi
  if [ "$dry" = 1 ]; then merge_key remove --dry-run || status=$?; else merge_key remove || status=$?; fi
  if [ "$status" = 1 ]; then failed=1; fi
  if [ -n "$WIRED_LAYOUTS" ]; then say "layout: the Fizzy page shows nothing without the mod, and these layouts of yours still have it: $WIRED_LAYOUTS (layout/README.md says how to take it out)"; fi
  say ""
  if [ "$found" = 1 ]; then
    say "Left in $APP_HOME: Herdr's own records (the fizzy.* keys in shared.json, layouts/.state/$LAYOUT.json) and the profile photos the panel fetched into data/fizzy; delete that folder yourself to remove them."
  fi
  if [ "$dry" = 1 ]; then say "Dry run: nothing was changed."
  elif [ -d "$BACKUP" ]; then say "What was removed is saved in $BACKUP."; fi
  if [ "$failed" = 1 ]; then exit 2; fi
}

main() {
  local dry=0 mod_only=0 add_key=0 remove_all=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --dry-run) dry=1 ;;
      --mod-only) mod_only=1 ;;
      --add-key) add_key=1 ;;
      --uninstall) remove_all=1 ;;
      -h|--help) usage; return 0 ;;
      *) usage >&2; die "unknown option: $1" ;;
    esac
    shift
  done
  if [ "$remove_all" = 1 ] && [ "$mod_only" = 1 ]; then usage >&2; die "--uninstall removes everything install.sh made: leave out --mod-only"; fi
  if [ "$remove_all" = 1 ] && [ "$add_key" = 1 ]; then usage >&2; die "--uninstall takes the key out: leave out --add-key"; fi
  if [ "$mod_only" = 1 ] && [ "$add_key" = 1 ]; then usage >&2; die "--add-key binds the key to $TABS, which --mod-only does not make: leave out one of them"; fi
  if [ "$remove_all" = 1 ]; then uninstall "$dry"; else install "$dry" "$mod_only" "$add_key"; fi
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi
