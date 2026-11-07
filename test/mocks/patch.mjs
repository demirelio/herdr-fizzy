// A stand-in for patch(1) in install.sh's tests, so they need neither the patch program nor a real tab bar. It takes
// a one-file unified diff on stdin and the options -d <dir>, -p<n>, -N and --dry-run; -F <n> is accepted and does
// nothing, as it never reads the hunks: the diff fits the file its +++ line names when that file has the line FITS_AT,
// and applying puts the diff's added lines in front of that line, keeping the old file as <file>.orig, as GNU patch
// does for a hunk that lands at an offset. With -N, a file that already has every added line was patched before, and
// is skipped; without it, the diff goes in again. It answers with patch's own messages and exits 0 when it applied
// (or, with --dry-run, would), 1 when the file is missing, does not fit or was patched before, and 2 when the input
// has no +++ line. Each call goes to the file STUB_PATCH_LOG as a JSON line, { args, diff }.
import { appendFileSync, copyFileSync, existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const FITS_AT = "  render() {";

export const addedLines = diff => diff.split("\n").filter(line => line.startsWith("+") && !line.startsWith("+++ ")).map(line => line.slice(1));

export function applied(text, diff) {
  const lines = new Set(text.split("\n"));
  return addedLines(diff).every(line => lines.has(line));
}

// `text` with the diff applied, or null when it does not fit.
export function apply(text, diff) {
  const lines = text.split("\n"), at = lines.indexOf(FITS_AT);
  if (at < 0) return null;
  lines.splice(at, 0, ...addedLines(diff));
  return lines.join("\n");
}

function main(args) {
  const diff = readFileSync(0, "utf8");
  if (process.env.STUB_PATCH_LOG) appendFileSync(process.env.STUB_PATCH_LOG, `${JSON.stringify({ args, diff })}\n`);
  const dir = args.includes("-d") ? args[args.indexOf("-d") + 1] : ".", dryRun = args.includes("--dry-run"), forward = args.includes("-N");
  const strip = Number(/^-p(\d+)$/.exec(args.find(a => /^-p\d+$/.test(a)) ?? "-p0")[1]);
  const named = /^\+\+\+ (\S+)/m.exec(diff)?.[1];
  if (!named) {
    console.log("patch: **** Only garbage was found in the patch input.");
    return 2;
  }
  const name = named.split("/").slice(strip).join("/"), file = join(dir, name);
  console.log(`${dryRun ? "checking" : "patching"} file ${name}`);
  if (!existsSync(file)) {
    console.log(`can't find file to patch at input line 3`);
    return 1;
  }
  const text = readFileSync(file, "utf8");
  if (forward && applied(text, diff)) {
    console.log("Reversed (or previously applied) patch detected!  Skipping patch.");
    console.log("1 out of 1 hunk ignored");
    return 1;
  }
  const patched = apply(text, diff);
  if (patched === null) {
    console.log("Hunk #1 FAILED at 1.");
    console.log("1 out of 1 hunk FAILED");
    return 1;
  }
  if (!dryRun) {
    copyFileSync(file, `${file}.orig`);
    writeFileSync(file, patched);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
