import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { state, reset } from "./mocks/herdr.mjs";
import { all, find, fire } from "./mocks/element.mjs";
import { makeCx, drawn as drawnBy, space, agent, ROOT, MOD_DIR, modFile } from "./helpers.mjs";
import { makeAccount, LAYOUT } from "./fizzy-fixtures.mjs";

const { default: Fizzy } = await import(modFile("main.js"));
const { REQUEST_EVERY } = await import(modFile("lib.js"));

const ours = path => /^mods\/fizzy\//.test(path);
const drawn = tree => all(tree, n => n.kind === "svg" || n.kind === "image").map(n => n.path);

function rootSvgAttributes(svg) {
  const tag = /^\s*(?:<\?xml[^>]*\?>\s*)?<svg\b([^>]*)>/.exec(svg)?.[1] ?? "";
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)].map(([, name, value]) => [name, value]));
}

test("our icons are 24x24 line drawings Herdr can tint: a 0 0 24 24 viewBox, stroked in currentColor, no fixed colors", () => {
  const icons = readdirSync(MOD_DIR).filter(f => f.endsWith(".svg"));
  assert.ok(icons.length >= 20, `only ${icons.length} icons`);
  for (const name of icons) {
    const svg = readFileSync(join(MOD_DIR, name), "utf8");
    const root = rootSvgAttributes(svg);
    assert.deepEqual(root.viewBox?.trim().split(/[\s,]+/).map(Number), [0, 0, 24, 24], `${name}: viewBox`);
    assert.equal(root.stroke, "currentColor", `${name}: stroke`);
    assert.equal(root.fill, "none", `${name}: fill`);
    for (const [, attribute, value] of svg.matchAll(/\b(fill|stroke|color|stop-color)\s*=\s*"([^"]*)"/g)) {
      assert.ok(value === "none" || value === "currentColor", `${name}: ${attribute}="${value}" is a fixed color`);
    }
    assert.doesNotMatch(svg, /#[0-9a-f]{3,6}\b|rgba?\(|hsla?\(|style\s*=/i, `${name} has a fixed color`);
    assert.match(svg, /<(path|circle|rect|line|polyline|polygon|ellipse)\b/, `${name} draws nothing`);
    assert.match(svg, /<\/svg>\s*$/, name);
  }
});

test("the Fizzy folder has every icon the panel's code names", () => {
  const names = new Set();
  for (const file of ["main.js", "lib.js"]) {
    const source = readFileSync(join(MOD_DIR, file), "utf8");
    for (const [, args] of source.matchAll(/\bICON\(((?:[^()]|\([^()]*\))*)\)/g)) {
      for (const [, name] of args.matchAll(/"([^"]+)"/g)) names.add(name);
    }
  }
  assert.ok(names.size >= 20, `only found ${[...names]}`);
  for (const name of names) assert.ok(existsSync(join(MOD_DIR, `${name}.svg`)), `mods/fizzy/${name}.svg is missing`);
});

// Every asset path drawn in every state the Fizzy panel and its popups can draw an icon in: the board (lanes open, a
// selection, the filter and the search), a new card, a card (read, editing, a file in it), the other views, Settings, and each
// kind of popup.
async function panelPaths() {
  const account = makeAccount({ closed: 2 });
  account.pins = [account.card(102)];
  account.card(101).description_html = '<div><p>Notes</p><action-text-attachment sgid="sgid-notes" content-type="application/pdf" filename="notes.pdf" filesize="2048"></action-text-attachment></div>';
  reset({
    layout: LAYOUT, exec: account.exec,
    spaces: [space("s1", "work", { active: true, folder: "/work" })],
    agents: [{ address: "t1", pane: "p1", space: "s1", space_name: "work", tab: "s1-tab", tab_index: 1, tab_name: "fix", status: "idle", app: "claude-code", title: "", seq: 1, pinned: false, focused: false,
      program: { key: "claude", name: "Claude Code", icon: "icons/claude.svg", tint: false, tile: null, color: null, shell: false, agent: true } }],
    knownAgents: async () => [agent("claude", "Claude Code"), agent("pi", "Pi", { tint: true })],
  });
  const paths = new Set(), see = tree => { for (const p of drawn(tree)) paths.add(p); };
  const cx = makeCx(), panel = new Fizzy();
  panel.init(undefined, cx);
  const draw = async () => { for (let i = 0; i < 3; i++) { drawnBy(panel, cx); await cx.settle(); } const tree = drawnBy(panel, cx); see(tree); return tree; };
  const press = (tree, id, event = {}) => {
    const el = find(tree, id);
    assert.ok(el, `no element ${id}`);
    return fire(el, "on_click", { click_count: 1, modifiers: {}, ...event }, cx);
  };

  // The board: the cards' step progress and comment counts read (the request timer), the board watched (Stop watching's
  // icon), the lanes opened, a selection (the bar of hand-offs: its four icons and the chevrons), then a golden card's detail.
  let tree = await draw();
  const requests = cx.timers.find(t => !t.after && t.ms === REQUEST_EVERY);
  for (let i = 0; i < 3; i++) { await requests.fn(cx); await cx.settle(); }
  press(tree, "fizzy-watch-toggle");
  await cx.settle();
  tree = await draw();
  for (const name of ["circle-check", "message-square-text", "bell-off"]) assert.ok(drawn(tree).includes(`mods/fizzy/${name}.svg`), `the board draws ${name}.svg`);
  for (const id of ["not-now", "done"]) press(tree, `fizzy-section-${id}`);
  press(tree, "fizzy-card-101", { modifiers: { platform: true } });
  tree = await draw();
  for (const name of ["insert", "send", "bot", "copy", "chevron-down"]) assert.ok(drawn(find(tree, "fizzy-bar")).includes(`mods/fizzy/${name}.svg`), `the bottom bar draws ${name}.svg`);
  press(tree, "fizzy-card-101", { modifiers: { platform: true } });
  // The filter with words (its clear button), then the search of every board (its field, then its results).
  panel.boardFilter.edit("login", cx);
  tree = await draw();
  for (const name of ["search", "x", "user", "plus"]) assert.ok(drawn(find(tree, "fizzy-list-bar")).includes(`mods/fizzy/${name}.svg`), `the list bar draws ${name}.svg`);
  panel.boardFilter.edit("", cx);
  press(await draw(), "fizzy-search-open");
  panel.searchField.edit("login", cx);
  panel.searchField.submit(cx);
  tree = await draw();
  press(tree, "fizzy-search-back");
  // A new card: its foot, Discard and Done.
  press(await draw(), "fizzy-add-c1");
  tree = await draw();
  assert.ok(find(tree, "fizzy-fresh-bar"), "the new card's page");
  press(tree, "fizzy-fresh-done");
  press(await draw(), "fizzy-card-102");
  tree = await draw();
  press(tree, "fizzy-back");
  // A card with steps and comments, its title and description being edited, a comment and the card about to go.
  press(await draw(), "fizzy-card-101");
  tree = await draw();
  press(tree, "fizzy-title");
  press(tree, "fizzy-desc-edit");
  press(tree, "fizzy-comment-del-cm1");
  tree = await draw();
  press(tree, "fizzy-back");
  // A step and one's own comment being edited, and the Inbox with a read note (which is not drawn).
  press(await draw(), "fizzy-card-101");
  tree = await draw();
  press(tree, "fizzy-step-text-s1");
  press(tree, "fizzy-comment-edit-cm1");
  tree = await draw();
  press(tree, "fizzy-back");
  account.notifications[0].read = true;
  press(await draw(), "fizzy-view-inbox");
  await draw(); // the Inbox lists the unread note only
  for (const view of ["mine", "inbox", "pins"]) { press(await draw(), `fizzy-view-${view}`); await draw(); }
  // Settings: opened by the gear, with a group and a board hidden (the shut eye), a name and a rule being changed, a delete asked for, a block folded.
  press(await draw(), "fizzy-home");
  tree = await draw();
  assert.ok(drawn(find(tree, "fizzy-open-settings")).includes("mods/fizzy/settings.svg"), "the gear draws settings.svg");
  press(tree, "fizzy-open-settings");
  press(await draw(), "fizzy-setting-mentions");
  press(await draw(), "fizzy-back");
  press(await draw(), "fizzy-setting-groups");
  state.shared["fizzy.boardGroups"] = { groups: [{ id: "team", name: "Team", match: "[team]", hidden: false }, { id: "g-2", name: "Quiet", match: "", hidden: true }], boards: { b2: { hidden: true } } };
  tree = await draw();
  press(tree, "fizzy-group-head-g-2");
  press(tree, "fizzy-group-name-team");
  tree = await draw();
  assert.ok(drawn(find(tree, "fizzy-group-rename-team")).includes("mods/fizzy/x.svg"), "a name being changed has its x");
  press(tree, "fizzy-group-match-g-2");
  press(await draw(), "fizzy-group-del-g-2");
  press(await draw(), "fizzy-groups-add");
  await draw();
  press(await draw(), "fizzy-back");
  assert.ok(paths.size > 15, `only drew ${[...paths]}`);

  const card = { number: 101, title: "T", url: "https://app.fizzy.do/111/cards/101", golden: false, closed: false, postponed: false, column: { id: "c1", name: "In progress" }, tags: ["bug"], assignees: [], board: { id: "b1", name: "Roadmap" } };
  const columns = account.columns.b1;
  state.shared["fizzy.people"] = { me: "u-me", users: [{ id: "u-me", name: "Ada", active: true, role: "owner" }], tags: [{ id: "t1", title: "bug" }] };
  state.shared["fizzy.boards"] = [{ id: "b1", name: "Roadmap" }, { id: "b2", name: "Personal" }];
  const menus = [{ kind: "card", card, columns }, { kind: "card", card, columns, pinned: true }, { kind: "card", card: { ...card, closed: true, golden: true }, columns, pinned: true, watching: true },
    { kind: "boards", current: "b1", follow: false, spaceBoard: "b2" }, { kind: "newCard", current: "b1" }, { kind: "agents", cards: [card] },
    { kind: "start", cards: [card] },
    { kind: "users", card }, { kind: "tags", card }, { kind: "moveBoard", card }, { kind: "lanes", card, columns },
    { kind: "react", number: 101, comment: "cm1", mine: ["👍"] }, { kind: "mention", target: "comment" }, { kind: "cardref", target: "comment", cards: [{ number: 101, title: "T", board: "Roadmap" }] }];
  for (const menu of menus) {
    state.props = { menu, overlay: "o" };
    const view = new Fizzy(), mcx = makeCx();
    view.init(undefined, mcx);
    await mcx.settle();
    see(drawnBy(view, mcx));
    if (menu.kind === "card") { fire(find(drawnBy(view, mcx), "fizzy-menu-delete"), "on_click", {}, mcx); see(drawnBy(view, mcx)); }
  }
  state.props = undefined;
  return paths;
}

test("the Fizzy panel, its card view and its popups draw every icon in mods/fizzy, and every mods/fizzy path they draw is there", async () => {
  const paths = await panelPaths();
  for (const name of readdirSync(MOD_DIR).filter(f => f.endsWith(".svg"))) {
    assert.ok(paths.has(`mods/fizzy/${name}`), `the panel never drew ${name}`);
  }
  for (const path of [...paths].filter(ours)) assert.ok(existsSync(join(ROOT, path)), `${path} is in this folder`);
});
