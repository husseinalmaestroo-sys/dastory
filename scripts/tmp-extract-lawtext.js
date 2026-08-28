// Extracts a lob.gov.jo law text from a saved browser tool-result file into a
// downloads .txt, ready for `npm run ingest`. Args: <toolResultFile> <outFile>
const fs = require("fs");
const [, , src, out] = process.argv;
const data = JSON.parse(fs.readFileSync(src, "utf8"));
// The return value is a JSON-encoded string literal (opening quote + escaped \n)
// that may span multiple `text` parts, followed by the browser tool's
// "(captured at origin …)" / "Tab Context:" annotations. Join all parts, then
// take only the leading string literal: scan to the first unescaped closing
// quote and JSON.parse that slice.
const joined = data.map((p) => (p && p.type === "text" ? p.text : "")).join("");
let text;
if (joined[0] === '"') {
  let i = 1;
  for (; i < joined.length; i++) {
    if (joined[i] === "\\") i++; // skip escaped char
    else if (joined[i] === '"') break; // closing quote
  }
  text = JSON.parse(joined.slice(0, i + 1));
} else {
  text = joined;
}
fs.mkdirSync(require("path").dirname(out), { recursive: true });
fs.writeFileSync(out, text, "utf8");
const arts = new Set([...text.matchAll(/^\s*المادة\s*\(?\s*(\d+)/gm)].map((m) => Number(m[1])));
console.log(`wrote ${text.length} chars, ${arts.size} unique articles -> ${out}`);
