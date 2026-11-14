// Ask assistant — refusal and safety paths (Work Package 1).
//
// Rule 7 (out of scope): reply with the fixed refusal and the agriculture-office
// pointer. The fixed strings below are copied VERBATIM from the specification.
// The Nepali refusal is flagged in the spec as "needs native review"; the
// review banner requirement (rule 5) covers assistant answers until an expert
// review record exists.
//
// Rule 8 (poisoning / illness): never advise treatment. Say to stop work, get
// to fresh air, and contact a health worker or hospital now. The message is
// marked for expert review. L2 text matching may route to it; L0 buttons can
// reach it from stay_safe.

import type { AskLang, Bi } from "./types";

/** Fixed refusal, exact wording from the specification (rule 7). */
export const FIXED_REFUSAL: Bi = {
  en: "Sorry, I cannot answer this. Please ask your local agriculture office.",
  ne: "माफ गर्नुहोस्, म यो प्रश्नको उत्तर दिन सक्दिनँ। कृपया आफ्नो नजिकको कृषि कार्यालयसँग सोध्नुहोस्।",
};

/**
 * Medical referral (rule 8). States only: stop work, fresh air, contact a
 * health worker or hospital now, no treatment advice. Marked for expert review.
 */
export const MEDICAL_REFERRAL: Bi = {
  en: "Stop work and move to fresh air now. Contact a health worker or the nearest hospital now. I cannot give treatment advice. This message is marked for expert review.",
  ne: "काम रोक्नुहोस् र तुरुन्तै खुला हावा भएको ठाउँमा जानुहोस्। तुरुन्तै स्वास्थ्यकर्मी वा नजिकको अस्पतालमा सम्पर्क गर्नुहोस्। म उपचारको सल्लाह दिन सक्दिनँ। यो सन्देश विज्ञ समीक्षाका लागि चिन्हित गरिएको छ।",
};

/** Agriculture-office pointer used by unavailable answers (rule 1 + rule 7 spirit). */
export const AGRICULTURE_OFFICE_POINTER: Bi = {
  en: "For local advice, ask your local agriculture office.",
  ne: "स्थानीय सल्लाहका लागि आफ्नो नजिकको कृषि कार्यालयसँग सोध्नुहोस्।",
};

export function getFixedRefusal(lang: AskLang): string {
  return FIXED_REFUSAL[lang];
}

export function getMedicalReferral(lang: AskLang): string {
  return MEDICAL_REFERRAL[lang];
}

export function getOfficePointer(lang: AskLang): string {
  return AGRICULTURE_OFFICE_POINTER[lang];
}
