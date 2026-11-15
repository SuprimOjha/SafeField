import { en, type Dictionary } from "./en";
import { ne } from "./ne";

export type Lang = "en" | "ne";

export function getDict(lang: Lang): Dictionary {
  return lang === "ne" ? ne : en;
}

export { en, ne };
export type { Dictionary };
