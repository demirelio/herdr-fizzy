// Adds the keys a package suggests (its keys.json) to the person's keys.json, or takes them out again. A key is added
// only where the person's file binds it nowhere, in no section; a key they use is never replaced. Removal takes a key
// out only while it still has our action. The file is edited where it changes, never written again from its parsed
// value, so every other byte stays as the person left it.
//
//   node merge-keys.mjs add|remove <our keys.json> <their keys.json> <backup folder> [--only <key>] [--dry-run]
//
// Prints a line a key. A changed file is copied into the backup folder first, then replaced in one rename (through a
// link, the file it points at). A file it can't read as keys is left alone, with why (and for add, what to add). Exits
// 0 when every key has our action afterwards (add) or is no longer ours to remove (remove), 2 when a key of theirs was
// kept or the file was refused, 1 when it can't write or is called wrongly.
import { chmodSync, copyFileSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export class Refusal extends Error {}

const SPACE = " \t\n\r";
const DONE = 0, FAILED = 1, NOT_BOUND = 2;

const MODIFIER_NAMES = { super: "cmd", win: "cmd", command: "cmd", meta: "cmd", control: "ctrl", option: "alt", opt: "alt" };

// One key however it is written: "Super-Shift-J" is "cmd-shift-j". The modifier names are those GPUI-style keymaps
// accept, read broadly, so that a key that may be taken counts as taken. A stroke may end in "-", its key ("cmd--").
export function chord(keys, platform = process.platform) {
  const secondary = platform === "darwin" ? "cmd" : "ctrl";
  const modifier = name => (name === "secondary" ? secondary : MODIFIER_NAMES[name] ?? name);
  return keys.trim().split(/\s+/).map(stroke => {
    const parts = stroke.toLowerCase().split("-");
    let key = parts.pop();
    if (key === "" && parts.length) { key = "-"; parts.pop(); }
    return [...new Set(parts.map(modifier))].sort().concat(key).join("-");
  }).join(" ");
}

// Where things sit in `text`, which is valid JSON: each value's span, and for an object its members' keys and values.
function locate(text) {
  let at = 0;
  const space = () => { while (at < text.length && SPACE.includes(text[at])) at++; };
  const string = () => {
    const start = at++;
    while (text[at] !== '"') at += text[at] === "\\" ? 2 : 1;
    return { start, end: ++at, name: JSON.parse(text.slice(start, at)) };
  };
  const value = () => {
    space();
    const start = at, open = text[at];
    if (open === "{" || open === "[") {
      const members = [];
      at++;
      space();
      while (text[at] !== (open === "{" ? "}" : "]")) {
        if (open === "{") {
          const key = string();
          space();
          at++;
          members.push({ key, value: value() });
        } else value();
        space();
        if (text[at] === ",") { at++; space(); }
      }
      at++;
      return open === "{" ? { start, end: at, members } : { start, end: at };
    }
    if (open === '"') return { start, end: string().end };
    while (at < text.length && !`,]}${SPACE}`.includes(text[at])) at++;
    return { start, end: at };
  };
  return value();
}

const lastOf = (list, test) => list.findLast(test) ?? null;
const indentAt = (text, at) => /^[ \t]*/.exec(text.slice(text.lastIndexOf("\n", at - 1) + 1))[0];
const valueOf = (text, node) => JSON.parse(text.slice(node.start, node.end));

// How the file writes an object: its line ending, one level of indent, and the text between a key and its value.
function styleOf(text, root) {
  const first = root.members[0];
  const memberIndent = first ? indentAt(text, first.key.start) : "";
  const multiline = first && text.slice(root.start, first.key.start).includes("\n");
  return {
    eol: text.includes("\r\n") ? "\r\n" : "\n",
    unit: multiline && memberIndent.length > indentAt(text, root.start).length ? memberIndent.slice(indentAt(text, root.start).length) : "  ",
    colon: first ? text.slice(first.key.end, first.value.start) : ": ",
  };
}

// `entries` ([key, action] or [section, entries]) as an object: on one line, or one member a line under `indent`.
function objectText(entries, indent, inline, style) {
  const item = ([key, value], inner) => `${JSON.stringify(key)}${style.colon}${Array.isArray(value) ? objectText(value, inner, inline, style) : JSON.stringify(value)}`;
  if (inline) return `{ ${entries.map(e => item(e, indent)).join(", ")} }`;
  const inner = indent + style.unit;
  return `{${style.eol}${entries.map(e => inner + item(e, inner)).join(`,${style.eol}`)}${style.eol}${indent}}`;
}

// The edit that adds `entries` to `object`: after its last member, spaced as that member is from the one before; an
// empty object is written anew.
function addTo(text, object, entries, style) {
  const last = object.members.at(-1);
  if (!last) return { start: object.start, end: object.end, text: objectText(entries, indentAt(text, object.start), false, style) };
  let from = last.key.start;
  while (SPACE.includes(text[from - 1])) from--;
  const gap = text.slice(from, last.key.start), inline = !gap.includes("\n"), colon = text.slice(last.key.end, last.value.start);
  const indent = inline ? "" : gap.slice(gap.lastIndexOf("\n") + 1);
  const value = v => (Array.isArray(v) ? objectText(v, indent, inline, style) : JSON.stringify(v));
  return { start: last.value.end, end: last.value.end, text: entries.map(([key, v]) => `,${gap}${JSON.stringify(key)}${colon}${value(v)}`).join("") };
}

// The edit that takes member `i` out of `object` with the comma and spacing that came with it: the reverse of addTo.
function removeFrom(object, i) {
  const { members } = object, member = members[i];
  if (members.length === 1) return { start: object.start + 1, end: object.end - 1, text: "" };
  if (i === members.length - 1) return { start: members[i - 1].value.end, end: member.value.end, text: "" };
  return { start: member.key.start, end: members[i + 1].key.start, text: "" };
}

const applyEdits = (text, edits) => [...edits].sort((a, b) => b.start - a.start).reduce((out, e) => out.slice(0, e.start) + e.text + out.slice(e.end), text);

function parse(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { throw new Refusal(`it is not valid JSON (${e.message})`); }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Refusal("it is not an object");
  return locate(text);
}

// The section objects as JSON.parse reads them: a section written twice is its last one.
function sectionsOf(root) {
  const sections = new Map();
  for (const m of root.members) sections.set(m.key.name, m.value);
  return sections;
}

// Every place `text` binds `key`: one per section, with that section's last spelling of it.
function usesOf(text, root, key) {
  const uses = [];
  for (const [section, node] of sectionsOf(root)) {
    const hit = node.members && lastOf(node.members, m => chord(m.key.name) === chord(key));
    if (hit) uses.push({ section, as: hit.key.name, action: valueOf(text, hit.value) });
  }
  return uses;
}

// `wanted` ({ section: { key: action } }) added to the keys.json `text` where each key is free. `bound`: every key has
// its action afterwards. Throws a Refusal for a file it can't merge.
export function addKeys(text, wanted) {
  const root = parse(text), style = styleOf(text, root), sections = sectionsOf(root), edits = [], notes = [], fresh = [];
  for (const [section, keys] of Object.entries(wanted)) {
    const node = sections.get(section) ?? null;
    if (node && !node.members) throw new Refusal(`its "${section}" is not an object`);
    const missing = [];
    for (const [key, action] of Object.entries(keys)) {
      const uses = usesOf(text, root, key), other = uses.find(u => u.action !== action);
      if (!uses.length) {
        missing.push([key, action]);
        notes.push({ section, key, as: key, action, outcome: "added" });
      } else if (other) notes.push({ section: other.section, key, as: other.as, action, was: other.action, outcome: "kept" });
      else notes.push({ section: uses[0].section, key, as: uses[0].as, action, outcome: "same" });
    }
    if (missing.length && node) edits.push(addTo(text, node, missing, style));
    else if (missing.length) fresh.push([section, missing]);
  }
  if (fresh.length) edits.push(addTo(text, root, fresh, style));
  return { text: applyEdits(text, edits), notes, bound: notes.every(n => n.outcome !== "kept") };
}

// `wanted` taken out of the keys.json `text`: a key goes only from its own section, and only while it has our action.
export function removeKeys(text, wanted) {
  const notes = [];
  parse(text);
  for (const [section, keys] of Object.entries(wanted)) {
    for (const [key, action] of Object.entries(keys)) {
      const node = sectionsOf(locate(text)).get(section);
      const i = node?.members ? node.members.findLastIndex(m => chord(m.key.name) === chord(key)) : -1;
      if (i < 0) {
        const elsewhere = usesOf(text, locate(text), key).length > 0;
        notes.push({ section, key, as: key, action, outcome: elsewhere ? "elsewhere" : "absent" });
        continue;
      }
      const hit = node.members[i], was = valueOf(text, hit.value), note = { section, key, as: hit.key.name, action, was };
      if (was !== action) { notes.push({ ...note, outcome: "theirs" }); continue; }
      text = applyEdits(text, [removeFrom(node, i)]);
      notes.push({ ...note, outcome: "removed" });
    }
  }
  return { text, notes };
}

export function describe({ section, key, as = key, action, outcome, was }, { dryRun = false } = {}) {
  const name = section === "global" ? as : `${as} in "${section}"`, theirs = typeof was === "string" ? was : JSON.stringify(was);
  if (outcome === "added") return `keys: ${dryRun ? "would add" : "added"} ${name}: ${action}`;
  if (outcome === "same") return `keys: ${name} is already ${action}`;
  if (outcome === "kept") return `keys: kept your ${name}: ${theirs}; to use ${action}, bind another key to it in keys.json`;
  if (outcome === "removed") return `keys: ${dryRun ? "would remove" : "removed"} ${name}: ${action}`;
  if (outcome === "theirs") return `keys: ${name} is ${theirs}, not ${action}: left as it is`;
  if (outcome === "elsewhere") return `keys: ${as} is not in "${section}": nothing to remove`;
  return `keys: ${name} is not bound: nothing to remove`;
}

const toAdd = wanted => Object.entries(wanted).map(([section, keys]) =>
  `add ${Object.entries(keys).map(([key, action]) => `${JSON.stringify(key)}: ${JSON.stringify(action)}`).join(", ")} to its ${JSON.stringify(section)} section`).join(" and ");

// The members of `all` whose key is `key`, however its modifiers are written.
function only(all, key) {
  const picked = {};
  for (const [section, keys] of Object.entries(all)) {
    const hits = Object.entries(keys).filter(([k]) => chord(k) === chord(key));
    if (hits.length) picked[section] = Object.fromEntries(hits);
  }
  return picked;
}

function main(argv) {
  const [mode, ours, theirs, backup] = argv, flags = argv.slice(4), dryRun = flags.includes("--dry-run");
  const onlyKey = flags.includes("--only") ? flags[flags.indexOf("--only") + 1] : null;
  if (!["add", "remove"].includes(mode) || !ours || !theirs || !backup || (flags.includes("--only") && !onlyKey)) {
    console.error("usage: node merge-keys.mjs add|remove <our keys.json> <their keys.json> <backup folder> [--only <key>] [--dry-run]");
    return FAILED;
  }
  const all = JSON.parse(readFileSync(ours, "utf8")), wanted = onlyKey ? only(all, onlyKey) : all;
  if (!Object.keys(wanted).length) {
    console.error(`keys: ${ours} suggests no ${onlyKey}`);
    return FAILED;
  }
  const file = realpathSync(theirs), before = readFileSync(file, "utf8");
  let merged;
  try { merged = mode === "add" ? addKeys(before, wanted) : removeKeys(before, wanted); }
  catch (e) {
    if (!(e instanceof Refusal)) throw e;
    console.log(`keys: left ${theirs} alone: ${e.message}${mode === "add" ? `; once it is, ${toAdd(wanted)}` : ""}`);
    return NOT_BOUND;
  }
  for (const note of merged.notes) console.log(describe(note, { dryRun }));
  const done = mode === "add" && !merged.bound ? NOT_BOUND : DONE;
  if (merged.text === before || dryRun) return done;
  const temp = join(dirname(file), `.${basename(file)}.${process.pid}.tmp`), saved = join(backup, "keys.json");
  try {
    writeFileSync(temp, merged.text);
    chmodSync(temp, statSync(file).mode & 0o7777);
    mkdirSync(backup, { recursive: true });
    copyFileSync(file, saved);
    renameSync(temp, file);
  } catch (e) {
    rmSync(temp, { force: true });
    console.error(`keys: could not write ${theirs}: ${e.message}`);
    return FAILED;
  }
  console.log(`keys: saved the previous keys.json as ${saved}`);
  return done;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
