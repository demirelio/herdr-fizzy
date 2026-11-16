// gpui-kit as the mods import it: the View base class and the element factories.
import { makeElement } from "./element.mjs";

export class View {
  constructor(props) { this.initialProps = props; }
}
export const div = () => makeElement("div");
export const svg = path => makeElement("svg", { path });
export const image = path => makeElement("image", { path });

// Paths and backgrounds as plain records of what was asked. window.paint_path, a global in Herdr before any mod loads,
// is made in register.mjs: it draws nothing but keeps both on its element.
export const PathBuilder = {
  fill: () => {
    const steps = [], builder = new Proxy({}, { get: (_t, name) => (name === "build" ? () => ({ steps }) : (...args) => { steps.push([name, ...args]); return builder; }) });
    return builder;
  },
};
export const Background = {
  solid: color => ({ kind: "solid", color }),
  stop: (color, percentage) => ({ color, percentage }),
  linear_gradient: (angle, from, to) => ({ kind: "linear-gradient", angle, from, to }),
};
