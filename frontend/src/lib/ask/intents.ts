// Ask assistant — fixed intent list (Work Package 1).
//
// This list is CLOSED. The assistant may answer nothing else. A language model
// (L1/L2) may only pick one of these ids; confidence below threshold shows the
// buttons instead. L3 free-text advice is never built.

import type { AskIntent, Bi } from "./types";

export const ASK_INTENT_IDS: readonly AskIntent[] = [
  "can_apply_today",
  "check_soil",
  "rain_this_week",
  "stay_safe",
  "explain_card",
  "explain_term",
  "data_source",
  "explain_rotation",
  "what_changed",
  // P1 intents: declared in the contract; L0 answers name what is missing.
  "irrigation_timing_hint",
  "fertilizer_timing_window",
  "unknown",
];

export function isAskIntent(value: string): value is AskIntent {
  return (ASK_INTENT_IDS as readonly string[]).includes(value);
}

/**
 * Button labels for the L0 question buttons (Work Package 2 renders them).
 * Short, plain words; no emojis; no markdown symbols.
 */
export const INTENT_LABELS: Record<AskIntent, Bi> = {
  can_apply_today: {
    en: "Can I apply fertilizer today?",
    ne: "आज मल हाल्ने अवस्था के छ?",
  },
  check_soil: {
    en: "What does the data say about my soil?",
    ne: "डाटाले मेरो माटोबारे के भन्छ?",
  },
  rain_this_week: {
    en: "Will it rain in the coming days?",
    ne: "आउँदा दिनमा पानी पर्छ?",
  },
  stay_safe: {
    en: "How do I handle fertilizer with care?",
    ne: "मल सम्हाल्दा के ध्यान दिने?",
  },
  explain_card: {
    en: "Explain a card on this screen",
    ne: "यो पृष्ठको कार्ड बुझाउनुहोस्",
  },
  explain_term: {
    en: "Explain a term",
    ne: "शब्दको अर्थ बुझाउनुहोस्",
  },
  data_source: {
    en: "Where does the data come from?",
    ne: "डाटा कहाँबाट आयो?",
  },
  explain_rotation: {
    en: "Crop rotation plans",
    ne: "बाली फेरबदल योजना",
  },
  what_changed: {
    en: "What changed since my last check?",
    ne: "पछिल्लो जाँचदेखि के फरक पर्यो?",
  },
  irrigation_timing_hint: {
    en: "When should I irrigate?",
    ne: "कहिले सिँचाइ गर्ने?",
  },
  fertilizer_timing_window: {
    en: "When is the time to apply fertilizer?",
    ne: "मल हाल्ने समय कहिले हो?",
  },
  unknown: {
    en: "Other questions",
    ne: "अन्य प्रश्न",
  },
};
