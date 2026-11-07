// gpui-base as the mod imports it: flex containers, text inputs and rich text.
import { makeElement } from "./element.mjs";

export const h_flex = () => makeElement("h_flex");
export const v_flex = () => makeElement("v_flex");

// Text inputs (Input + InputState, Textarea + TextareaState). The state holds the text and the handlers a mod
// registered with on(); nothing is drawn. A test types with edit(text, cx) (sets the value, then runs the
// "change" handler, as an edit does) and presses Enter with submit(cx). set_value() and replace() change the
// text without firing "change" (so a test sees what the mod does by itself). replace() takes the whole value:
// there is no selection here.
class TextState {
  static new(options = {}) {
    const state = new this();
    state.options = options;
    state.text = options.value ?? "";
    state.focused = false; // true once focus() was asked for
    state.handlers = {}; // event name -> the function given to on()
    return state;
  }
  value() { return this.text; }
  content() { return { text: this.text, tokens: [] }; }
  set_value(next) { this.text = typeof next === "string" ? next : String(next?.text ?? ""); }
  replace(text) { this.text = String(text); }
  replace_with_token(token) { this.text += token.text; }
  focus() { this.focused = true; }
  on(event, handler) { this.handlers[event] = handler; return true; }
  release() { return true; }
  edit(text, cx) { this.text = text; return this.handlers.change?.({}, cx); }
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
