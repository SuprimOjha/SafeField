import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const files = {
  en: readFileSync(resolve(root, "src/i18n/en.ts"), "utf8"),
  ne: readFileSync(resolve(root, "src/i18n/ne.ts"), "utf8"),
};

function keys(source) {
  return [...source.matchAll(/^  ([A-Za-z_$][\\w$]*):/gm)].map((match) => match[1]);
}

const enKeys = keys(files.en);
const neKeys = keys(files.ne);
const enSet = new Set(enKeys);
const neSet = new Set(neKeys);
const missingInNepali = enKeys.filter((key) => !neSet.has(key));
const missingInEnglish = neKeys.filter((key) => !enSet.has(key));
const duplicateEnglish = enKeys.filter((key, index) => enKeys.indexOf(key) !== index);
const duplicateNepali = neKeys.filter((key, index) => neKeys.indexOf(key) !== index);

if (missingInNepali.length || missingInEnglish.length || duplicateEnglish.length || duplicateNepali.length) {
  console.error("i18n key parity failed");
  if (missingInNepali.length) console.error("Missing in ne.ts:", missingInNepali.join(", "));
  if (missingInEnglish.length) console.error("Missing in en.ts:", missingInEnglish.join(", "));
  if (duplicateEnglish.length) console.error("Duplicate in en.ts:", duplicateEnglish.join(", "));
  if (duplicateNepali.length) console.error("Duplicate in ne.ts:", duplicateNepali.join(", "));
  process.exitCode = 1;
} else {
  console.log(`i18n key parity passed: ${enKeys.length} matching keys (en.ts / ne.ts)`);
}
