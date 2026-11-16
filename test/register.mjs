// Maps the specifiers a Herdr mod imports (gpui-kit, gpui-base, herdr) to the mocks next to this file, and makes the
// `window` global a mod finds in Herdr (only its paint_path, which keeps what it was given on a "path" element).
import * as nodeModule from "node:module";
import { makeElement } from "./mocks/element.mjs";

globalThis.window = { paint_path: (path, background) => makeElement("path", { path, background }) };

const MOCKS = {
  "gpui-kit": new URL("./mocks/gpui-kit.mjs", import.meta.url).href,
  "gpui-base": new URL("./mocks/gpui-base.mjs", import.meta.url).href,
  herdr: new URL("./mocks/herdr.mjs", import.meta.url).href,
};

// module.register() is deprecated on current node; registerHooks() runs the same resolve hook in-thread.
if (typeof nodeModule.registerHooks === "function") {
  nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
      return specifier in MOCKS ? { url: MOCKS[specifier], shortCircuit: true } : nextResolve(specifier, context);
    },
  });
} else {
  nodeModule.register("./hooks.mjs", import.meta.url);
}
