// A chainable stand-in for gpui-kit's element builder. Nothing is drawn: every call is recorded on a node
// (id, children, text, styles, handlers) so a test can render a view, find an element by id and fire its handler.
// Only the builder methods this mock lists are accepted, so a typo in a mod fails here, not in the app.

const STYLES = new Set(`size size_full w h min_w min_h max_w max_h w_full h_full p px py pl pr pt pb mx my mt mb mr gap flex flex_1 flex_none flex_shrink flex_col
  items_center items_start items_end justify_center justify_between justify_end rounded rounded_full border border_1 border_2 border_b border_t border_l border_r border_color
  bg text_color text_size text_right text_center font_semibold font_medium font_bold font_family font_weight line_height truncate whitespace_nowrap underline
  overflow_hidden overflow_y_scrollbar overflow_x_scrollbar overflow_y_scroll cursor_pointer cursor_text opacity relative absolute inset_0 top left right bottom
  spin transition frames loop tooltip key_context`.split(/\s+/));
// More the Fizzy panel draws with (every one is a builder in Herdr's gpui-kit.d.ts).
export const PANEL_STYLES = `whitespace_normal line_through flex_wrap italic text_ellipsis overflow_x_hidden overflow_y_hidden cursor_default
  self_center self_start items_baseline flex_shrink_0 justify_start text_left content_center gap_x gap_y flex_row items_stretch cursor_grabbing
  token rounded_br`.split(/\s+/);
for (const name of PANEL_STYLES) STYLES.add(name);
// The builders that take a value in gpui-kit.d.ts: Herdr fails the draw ("expected a number, got nil") when one has none.
const VALUED = new Set(`size w h min_w min_h max_w max_h p px py pl pr pt pb mx my mt mb mr ml gap gap_x gap_y rounded rounded_br border_color bg
  text_color text_size opacity flex_shrink top left right bottom line_height font_family font_weight border_b border_t border_l border_r
  tooltip`.split(/\s+/));
const HANDLERS = new Set(["on_click", "on_key_down", "on_key_up", "on_hover", "on_scroll_wheel", "on_size_change", "on_drop", "on_mouse_move", "on_mouse_down_out", "on_action"]);
// Things a test runner or inspector may probe on any object.
const PROBES = new Set(["then", "toJSON", "constructor", "valueOf", "toString", "inspect", "asymmetricMatch", "nodeType", "tagName", "$$typeof", "length"]);

export const nodeOf = el => el?.__node ?? null;

export function makeElement(kind, extra = {}) {
  const node = { kind, id: null, kids: [], handlers: {}, style: {}, hover: false, consumed: false, ...extra };
  const add = child => {
    if (typeof child === "string" || typeof child === "number") return node.kids.push({ kind: "text", id: null, text: String(child), kids: [], handlers: {}, style: {} });
    if (typeof child === "boolean") return;
    const c = nodeOf(child);
    if (!c) throw new Error(`${kind}.child(): not an element or text: ${String(child)}`);
    if (c.consumed) throw new Error(`${kind}.child(): this element was already used as a child`);
    c.consumed = true;
    node.kids.push(c);
  };
  const methods = {
    id: v => { node.id = String(v); },
    child: add,
    children: list => { for (const c of list) add(c); },
    hover: fn => { node.hover = true; const h = makeElement("hover"); fn(h); node.hoverStyle = nodeOf(h).style; },
    on_mouse_down: (button, fn) => { node.handlers[`on_mouse_down:${button}`] = fn; },
    on_mouse_up: (button, fn) => { node.handlers[`on_mouse_up:${button}`] = fn; },
    track_focus: handle => { node.focus = handle; },
    drag_paths: (paths, options) => { node.dragPaths = paths; node.dragOptions = options; },
  };
  // What only a TextView has (TextViewElement in gpui-kit.d.ts): other elements still refuse these.
  if (kind === "textview") {
    methods.selectable = (value = true) => { node.style.selectable = value; };
    methods.scrollable = (value = true) => { node.style.scrollable = value; };
    methods.on_link_click = fn => { node.handlers.on_link_click = fn; };
  }
  const proxy = new Proxy(node, {
    get(_target, prop) {
      if (prop === "__node") return node;
      if (typeof prop === "symbol" || PROBES.has(prop)) return undefined;
      if (prop === "when") {
        return (cond, branch) => {
          if (!cond) return proxy;
          const next = branch(proxy);
          if (!nodeOf(next)) throw new Error(`${kind}.when(): the branch must return the element`);
          return next;
        };
      }
      if (prop in methods) return (...args) => { methods[prop](...args); return proxy; };
      if (HANDLERS.has(prop)) return fn => { node.handlers[prop] = fn; return proxy; };
      if (STYLES.has(prop)) {
        return (...args) => {
          if (VALUED.has(prop) && args[0] === undefined) throw new Error(`${kind}.${prop}(): expected a value, got none`);
          node.style[prop] = args.length > 1 ? args : args[0] ?? true;
          return proxy;
        };
      }
      return () => { throw new Error(`${kind}.${prop}(): not a builder method on this mock's list`); };
    },
  });
  return proxy;
}

const asNode = el => nodeOf(el) ?? el;

export function walk(el, fn) {
  const visit = n => { fn(n); n.kids.forEach(visit); };
  visit(asNode(el));
}
export function all(el, pred = () => true) {
  const out = [];
  walk(el, n => { if (pred(n)) out.push(n); });
  return out;
}
export const find = (el, id) => all(el, n => n.id === id)[0] ?? null;
export const ids = el => all(el, n => n.id !== null).map(n => n.id);
export const textOf = el => {
  const parts = [];
  walk(el, n => { if (n.kind === "text") parts.push(n.text); });
  return parts.join(" ");
};
// Fires a recorded handler the way Herdr would, with a fake event and cx.
export function fire(target, name, event = {}, cx) {
  const node = asNode(target);
  const fn = node.handlers[name];
  if (!fn) throw new Error(`no ${name} handler on ${node.id ?? node.kind}`);
  return fn(event, cx);
}
