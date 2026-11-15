// Ask assistant — L0 entry point (Work Package 1).
//
// buildAskResponse is the single function the UI (Work Package 2) will call.
// It is deterministic: same inputs, same answer. No model is involved at L0,
// so every intent works offline of any model (Definition of Done).
//
// L1 (a later work package) may call this and then pass the result through the
// wording layer + validator; on any failure it must show THIS answer and only
// then set aiAssisted on its own copy.

import type { AskFieldContext, AskLang, AskResponse, AskSlots } from "./types";
import { buildL0Answer, buildMedicalResponse } from "./templates";

export function buildAskResponse(
  intent: AskResponse["intent"],
  context: AskFieldContext,
  lang: AskLang,
  slots: AskSlots = {},
): AskResponse {
  return buildL0Answer(intent, context, lang, slots);
}

/**
 * Rule 8 path: chemical poisoning or illness. Never treatment advice. The
 * message is marked for expert review. L2 text matching may route here; it is
 * also reachable from the stay_safe answer buttons in Work Package 2.
 */
export function buildMedicalSafetyResponse(lang: AskLang): AskResponse {
  return buildMedicalResponse(lang);
}
