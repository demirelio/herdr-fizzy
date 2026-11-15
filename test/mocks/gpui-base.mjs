// gpui-base as the mod imports it: flex containers, text inputs and rich text.
import { makeElement } from "./element.mjs";

export const h_flex = () => makeElement("h_flex");
export const v_flex = () => makeElement("v_flex");
export const ScrollHandle = { new: () => ({ items: [], scroll_to_item(index) { this.items.push(index); } }) };

// Text inputs (Input + InputState, Textarea + TextareaState). The state holds the text, its inline tokens ({ range, token }),
// the selection (a cursor at the end of the text until something moves it) and the handlers a mod registered with on();
// nothing is drawn. A test types with edit(text, cx): the new value, put in as one edit where it differs from the old one
// (tokens outside that edit move with the text, a token it touches goes), then the "change" handler runs, as typing does.
// submit(cx) presses Enter. set_value(), replace() and the token calls change the text without firing "change" (so a test
// sees what the mod does by itself); replace() and replace_with_token() put their text in place of the selection.
const copySpan = s => ({ range: { start: s.range.start, end: s.range.end }, token: { ...s.token } });
class TextState {
  static new(options = {}) {
    const state = new this();
    state.options = options;
    state.text = options.value ?? "";
    state.spans = [];
    state.selection = { start: state.text.length, end: state.text.length };
    state.focused = false; // true once focus() was asked for
    state.handlers = {}; // event name -> the function given to on()
    return state;
  }
  value() { return this.text; }
  content() { return { text: this.text, tokens: this.tokens() }; }
  tokens() { return this.spans.map(copySpan); }
  set_value(next) {
    this.text = typeof next === "string" ? next : String(next?.text ?? "");
    this.spans = typeof next === "string" ? [] : (next?.tokens ?? []).map(copySpan);
    this.selection = { start: this.text.length, end: this.text.length };
  }
  replace(text) { this.splice(this.selection, String(text)); }
  replace_with_token(token) { this.splice(this.selection, token.text, token); }
  replace_range_with_token(range, token) { this.splice(range, token.text, token); }
  set_selected_range(range) { this.selection = { start: range.start, end: range.end }; }
  splice({ start, end }, text, token = null) {
    const shift = text.length - (end - start);
    this.spans = this.spans.filter(s => s.range.end <= start || s.range.start >= end)
      .map(s => (s.range.start >= end ? { ...s, range: { start: s.range.start + shift, end: s.range.end + shift } } : s));
    if (token) this.spans.push({ range: { start, end: start + text.length }, token: { ...token } });
    this.spans.sort((a, b) => a.range.start - b.range.start);
    this.text = this.text.slice(0, start) + text + this.text.slice(end);
    this.selection = { start: start + text.length, end: start + text.length };
  }
  focus() { this.focused = true; }
  on(event, handler) { this.handlers[event] = handler; return true; }
  release() { return true; }
  edit(text, cx) {
    const was = this.text, next = String(text);
    let start = 0, tail = 0;
    while (start < was.length && start < next.length && was[start] === next[start]) start++;
    while (tail < was.length - start && tail < next.length - start && was[was.length - 1 - tail] === next[next.length - 1 - tail]) tail++;
    this.splice({ start, end: was.length - tail }, next.slice(start, next.length - tail));
    return this.handlers.change?.({}, cx);
  }
  submit(cx) { return this.handlers.submit?.({}, cx); }
}
export class InputState extends TextState {}
export class TextareaState extends TextState {}
export const Input = { new: state => makeElement("input", { state }) };
export const Textarea = { new: state => makeElement("textarea", { state }) };

// Rich text. The element is found by the id TextView.html was given and carries the html it was given.
export const TextView = {
  html: (id, html) => makeElement("textview", { id: String(id), html }),
};
