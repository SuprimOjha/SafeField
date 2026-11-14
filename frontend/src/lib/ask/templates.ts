// Ask assistant — L0 templates (Work Package 1).
//
// Pure template functions: tool results in, bilingual plain-text answers out.
// No model, no network. Hard rules encoded here:
// - rule 1: answer only from tool results; unavailable is stated plainly and
//   names what is missing.
// - rule 2: the decision-level word is carried EXACTLY as the tool returned it.
// - rule 3: no doses, no mixing ratios, no product names, no yield or income,
//   no diagnoses; the words safe / guaranteed / best never appear; the
//   fertilizer product selected by the farmer is referred to only as "the
//   fertilizer you selected".
// - rule 4: every number carries kind and date; non-NASA sources are labelled.
// - rule 5: label reminder where application advice appears; review banner
//   flag stays on while no expert review record exists.
// - rule 6: one clarifying question with 2-3 buttons when a slot is missing.
// - rule 9: short sentences, plain words, no emojis, no markdown symbols.

import type {
  AskClarification,
  AskFact,
  AskFieldContext,
  AskLang,
  AskResponse,
  AskSlots,
  Bi,
} from "./types";
import { factSentence, sanitizeDescriptor } from "./provenance";
import {
  getConditions,
  getDataStatus,
  getForecastSummary,
  getGlossaryTerm,
  getProvenance,
  getRotationPlans,
  getSafeApplication,
  rain72Fact,
  forecast48Fact,
} from "./tools";
import { AGRICULTURE_OFFICE_POINTER, getFixedRefusal, getMedicalReferral } from "./refusals";
import { ne as appNe } from "../../i18n";

const REVIEW_LINE: Bi = {
  en: "This answer is not expert-reviewed.",
  ne: "यो उत्तर विज्ञ-समीक्षित छैन।",
};

const LABEL_REMINDER: Bi = {
  en: "Always follow the product label.",
  ne: "सधैं उत्पादनको लेबल पालना गर्नुहोस्।",
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function baseResponse(intent: AskResponse["intent"], lang: AskLang): AskResponse {
  return {
    scope: "answer",
    intent,
    language: lang,
    text: "",
    level: null,
    facts: [],
    missing: [],
    requiresLabelReminder: false,
    requiresReviewBanner: true,
    markedForExpertReview: false,
    aiAssisted: false,
    clarification: null,
  };
}

function join(parts: string[]): string {
  return parts.filter((part) => part.length > 0).join(" ").replace(/ {2,}/g, " ").trim();
}

function bi(text: Bi, lang: AskLang): string {
  return text[lang];
}

function signalNeLabel(signal: string): string {
  if (signal === "CONDITIONS LOOK SUITABLE") return appNe.signalSuitableNe;
  if (signal === "WAIT AND RECHECK") return appNe.signalWaitNe;
  if (signal === "LOCAL REVIEW NEEDED") return appNe.signalReviewNe;
  return "";
}

const REASON_NE: Record<string, string> = {
  rain: "वर्षा-सम्बन्धी अवस्थाले पर्खनु र पुनः जाँच्नु उपयुक्त देखाउँछ।",
  terrain: "निर्णयअघि स्थानीय माटो र खेतको समीक्षा गर्नु उपयुक्त देखाउँछ।",
  favorable: "उपलब्ध सूचकहरूले प्रोटोटाइपका वर्षा वा भू-आकृति चेतावनी देखाएनन्।",
  missing_data: "मल हाल्ने समय मूल्याङ्कन गर्न पर्याप्त भरपर्दो डाटा छैन।",
};

function reasonSentence(reasonEn: string, reasonKey: string, lang: AskLang): string {
  if (lang === "en") return reasonEn.endsWith(".") ? reasonEn : `${reasonEn}.`;
  const mapped = REASON_NE[reasonKey];
  const text = mapped ?? reasonEn;
  return text.endsWith("।") || text.endsWith(".") ? text : `${text}।`;
}

function unavailableResponse(
  intent: AskResponse["intent"],
  lang: AskLang,
  reason: Bi,
  missing: Bi[],
  withOfficePointer: boolean,
): AskResponse {
  const response = baseResponse(intent, lang);
  response.scope = "unavailable";
  const missingSentence =
    missing.length > 0
      ? lang === "ne"
        ? `उपलब्ध नभएका: ${missing.map((item) => item.ne).join(", ")}।`
        : `Missing: ${missing.map((item) => item.en).join(", ")}.`
      : "";
  response.text = join([bi(reason, lang), missingSentence, withOfficePointer ? bi(AGRICULTURE_OFFICE_POINTER, lang) : ""]);
  response.missing = missing;
  return response;
}

function clarificationResponse(
  intent: AskResponse["intent"],
  lang: AskLang,
  question: Bi,
  options: AskClarification["options"],
): AskResponse {
  const response = baseResponse(intent, lang);
  response.scope = "clarification";
  response.requiresReviewBanner = false;
  response.clarification = { question, options };
  response.text = bi(question, lang);
  return response;
}

// ---------------------------------------------------------------------------
// can_apply_today
// ---------------------------------------------------------------------------

function buildCanApplyToday(context: AskFieldContext, lang: AskLang): AskResponse {
  const tool = getSafeApplication(context);
  if (!tool.available || !tool.data) {
    return unavailableResponse("can_apply_today", lang, tool.unavailableReason ?? { en: "Not available.", ne: "उपलब्ध छैन।" }, tool.missing, true);
  }
  const data = tool.data;
  const response = baseResponse("can_apply_today", lang);
  response.level = data.level;
  response.requiresLabelReminder = true;
  response.facts = data.facts;
  response.missing = tool.missing;

  const levelSentence =
    lang === "ne"
      ? `निर्णय स्तर: ${data.level}${signalNeLabel(data.level) ? ` (${signalNeLabel(data.level)})` : ""}।`
      : `Decision level: ${data.level}.`;
  const confidenceSentence = lang === "ne" ? `विश्वसनीयता: ${data.confidence}।` : `Confidence: ${data.confidence}.`;
  const waitSentence =
    data.waitDays > 0
      ? lang === "ne"
        ? `स्क्रीनिङ नियमले लगभग ${data.waitDays} दिन पर्खनु र खेत फेरि जाँच्नु सुझाव दिन्छ।`
        : `The screening rule suggests waiting about ${data.waitDays} ${data.waitDays === 1 ? "day" : "days"} and then checking the field again.`
      : "";
  const notZeroSentence =
    data.reasonKey === "missing_data"
      ? lang === "ne"
        ? "उपलब्ध नभएका मानहरूलाई शून्य मानिएको छैन।"
        : "Missing values were not treated as zero."
      : "";
  const missingSentence =
    tool.missing.length > 0
      ? lang === "ne"
        ? `उपलब्ध नभएका: ${tool.missing.map((item) => item.ne).join(", ")}।`
        : `Missing: ${tool.missing.map((item) => item.en).join(", ")}.`
      : "";
  const closing =
    lang === "ne"
      ? "यो स्थिर प्रोटोटाइप स्क्रीनिङ नियमबाट आएको हो; सीमा मानहरू विज्ञ समीक्षाका लागि बाँकी छन्। यसले मल चाहिन्छ कि चाहिँदैन, कति हाल्ने वा अनुमति कुनै पनि दिँदैन।"
      : "This comes from fixed prototype screening rules whose cut-off values are pending expert review. It does not decide whether fertilizer is needed, set an amount, or give permission.";

  response.text = join([
    levelSentence,
    confidenceSentence,
    waitSentence,
    reasonSentence(data.reasonEn, data.reasonKey, lang),
    notZeroSentence,
    missingSentence,
    ...data.facts.map((fact) => factSentence(fact, lang)),
    closing,
    bi(LABEL_REMINDER, lang),
    bi(REVIEW_LINE, lang),
  ]);
  return response;
}

// ---------------------------------------------------------------------------
// check_soil
// ---------------------------------------------------------------------------

function buildCheckSoil(context: AskFieldContext, lang: AskLang): AskResponse {
  const tool = getConditions(context);
  if (!tool.available || !tool.data) {
    return unavailableResponse("check_soil", lang, tool.unavailableReason ?? { en: "Not available.", ne: "उपलब्ध छैन।" }, tool.missing, true);
  }
  const data = tool.data;
  const response = baseResponse("check_soil", lang);
  const intro =
    lang === "ne" ? "तपाईंको खेतको माटो सम्बन्धी डाटा।" : "Soil data for your field.";
  const overrideSentence = data.usedFarmerSandOverride
    ? lang === "ne"
      ? "ढुस्साका लागि स्क्रीनिङले तपाईंले दिनुभएको मान प्रयोग गरेको छ।"
      : "For sand, the screening used the value you entered."
    : "";
  const closing =
    lang === "ne"
      ? "यी मोडेल अनुमान हुन्, तपाईंको खेतको माटो परीक्षण होइन। पोषण सम्बन्धी निर्णयका लागि माटो परीक्षण गराउनुहोस् र स्थानीय कृषि कार्यालयसँग सोध्नुहोस्।"
      : "These are modelled estimates, not a soil test of your field. For nutrient decisions, get a soil test and ask your local agriculture office.";

  const soilFacts: AskFact[] = [
    data.sand,
    data.silt,
    data.clay,
    data.textureClass,
    data.surfaceWetness,
    data.rootWetness,
    data.slopePercent,
    data.elevationM,
    data.temperatureC,
  ].flatMap((fact) => (fact ? [fact] : []));
  response.facts = soilFacts;
  response.missing = tool.missing;

  response.text = join([
    intro,
    overrideSentence,
    ...soilFacts.map((fact) => factSentence(fact, lang)),
    closing,
    bi(REVIEW_LINE, lang),
  ]);
  return response;
}

// ---------------------------------------------------------------------------
// rain_this_week
// ---------------------------------------------------------------------------

function buildRainThisWeek(context: AskFieldContext, lang: AskLang): AskResponse {
  const tool = getForecastSummary(context);
  if (!tool.available || !tool.data) {
    const reason = tool.unavailableReason ?? { en: "Not available.", ne: "उपलब्ध छैन।" };
    const response = baseResponse("rain_this_week", lang);
    response.scope = "unavailable";
    response.text = join([
      bi(reason, lang),
      lang === "ne"
        ? "यसको अर्थ वर्षा शून्य होइन। स्थानीय मौसम जाँच्नुहोस् र पछि पुनः प्रयास गर्नुहोस्।"
        : "This does not mean zero rainfall. Check local weather signs and try again later.",
    ]);
    response.missing = tool.missing;
    return response;
  }
  const data = tool.data;
  const response = baseResponse("rain_this_week", lang);
  const intro = lang === "ne" ? "आउँदा दिनको वर्षा पूर्वानुमान।" : "Rain outlook for the coming days.";
  const prov = tool.provenance[0] ?? null;
  const provSentence = prov
    ? lang === "ne"
      ? `सबै पूर्वानुमान मान ${prov.source} बाट आएका हुन्। प्रकार: पूर्वानुमान। गैर-NASA स्रोत।${prov.fetchedAt ? ` लिइएको मिति: ${prov.fetchedAt}।` : ""}`
      : `All forecast values come from ${prov.source}. Kind: forecast. non-NASA source.${prov.fetchedAt ? ` Fetched date: ${prov.fetchedAt}.` : ""}`
    : "";
  const daySentences = data.days.map((day) => {
    const mmPart = day.mm ? `${day.mm.value} mm` : (lang === "ne" ? "उपलब्ध छैन" : "not available");
    const chancePart = day.chancePercent ? (lang === "ne" ? `; वर्षा सम्भावना ${day.chancePercent.value} प्रतिशत` : `; rain chance ${day.chancePercent.value} percent`) : "";
    return lang === "ne" ? `${day.date} को वर्षा: ${mmPart}${chancePart}।` : `Rain on ${day.date}: ${mmPart}${chancePart}.`;
  });
  const totals = [data.next48mm, data.next120mm].flatMap((fact) => (fact ? [factSentence(fact, lang)] : []));
  const closing =
    lang === "ne"
      ? "पूर्वानुमान मोडेल अनुमान हो, नापिएको वर्षा होइन।"
      : "A forecast is a model estimate, not measured rain.";

  response.facts = [
    ...(data.next48mm ? [data.next48mm] : []),
    ...(data.next120mm ? [data.next120mm] : []),
    ...data.days.flatMap((day) => [day.mm, day.chancePercent]).flatMap((fact) => (fact ? [fact] : [])),
  ];
  response.text = join([intro, ...daySentences, ...totals, provSentence, closing, bi(REVIEW_LINE, lang)]);
  return response;
}

// ---------------------------------------------------------------------------
// stay_safe
// ---------------------------------------------------------------------------

const SAFETY_BULLETS: { en: string[]; ne: string[] } = {
  en: [
    "Wear gloves and a dust mask when handling dusty products.",
    "Wear long sleeves, long trousers and closed footwear.",
    "Avoid breathing dust.",
    "Wash hands and exposed skin after handling; change contaminated clothing.",
    "Keep products in their original labelled container, away from children, food and drinking water.",
    "Do not mix products unless the label or a qualified adviser explicitly permits it.",
    "Avoid working in the hottest part of the day; stop spraying in gusty wind.",
  ],
  ne: [
    "धूलो मल सम्हाल्दा उपयुक्त ग्लभ्स र धूलो-निवारक मास्क लगाउनुहोस्।",
    "लामो बाहुला, लामो सुरुवात र खुट्टा पूरै ढाक्ने जुत्ता लगाउनुहोस्।",
    "धूलो सासैमा नसुन्नुहोस्।",
    "सम्हालिसकेपछि हात र खुला छाला धुनुहोस्; दूषित लुगा फेर्नुहोस्।",
    "उत्पादन मूल लेबल भएको भाँडामा, बालबालिका, खाना र पिउने पानीबाट टाढा राख्नुहोस्।",
    "लेबल वा योग्य सल्लाहकारले स्पष्ट अनुमति नदिएको खण्डमा उत्पादनहरू नमिसाउनुहोस्।",
    "दिनको तातो समयमा काम नगर्नुहोस्; झोक्किएको हावामा छर्कने काम रोक्नुहोस्।",
  ],
};

function buildStaySafe(lang: AskLang): AskResponse {
  const response = baseResponse("stay_safe", lang);
  response.requiresLabelReminder = true;
  const intro = lang === "ne" ? "मल र कृषि रसायन सम्हाल्दा सामान्य सावधानी।" : "General precautions when handling fertilizer and farm chemicals.";
  const bullets = SAFETY_BULLETS[lang];
  const closing =
    lang === "ne"
      ? "सधैं उत्पादनको लेबल पालना गर्नुहोस्। अस्वस्थ महसुस भए काम रोक्नुहोस्, खुला हावामा जानुहोस् र स्वास्थ्यकर्मीसँग सम्पर्क गर्नुहोस्।"
      : "Always follow the product label. If you feel unwell, stop work, move to fresh air and contact a health worker.";
  response.text = join([intro, ...bullets, closing, bi(REVIEW_LINE, lang)]);
  return response;
}

// ---------------------------------------------------------------------------
// explain_card
// ---------------------------------------------------------------------------

function buildExplainCard(context: AskFieldContext, lang: AskLang, slots: AskSlots): AskResponse {
  const cardId = (slots.cardId ?? "").trim();
  if (!cardId || cardId === "unknown") {
    return clarificationResponse("explain_card", lang, { en: "Which card should I explain?", ne: "कुन कार्ड बुझाउनु?" }, [
      { id: "decision", label: { en: "The decision card", ne: "निर्णय कार्ड" }, intent: "explain_card", slot: { cardId: "decision" } },
      { id: "rainfall", label: { en: "The rainfall card", ne: "वर्षा कार्ड" }, intent: "explain_card", slot: { cardId: "rainfall" } },
      { id: "soil", label: { en: "The soil card", ne: "माटो कार्ड" }, intent: "explain_card", slot: { cardId: "soil" } },
    ]);
  }

  const response = baseResponse("explain_card", lang);
  const closingAssumptions =
    lang === "ne"
      ? "सीमा मानहरू विज्ञ समीक्षाका लागि बाँकी प्रोटोटाइप मान्यता हुन्।"
      : "The cut-off values are prototype assumptions pending expert review.";
  const notZeroNote =
    lang === "ne"
      ? "कार्डमा उपलब्ध छैन देखिँदा यसको अर्थ प्रयोगयोग्य स्थानीय वर्षा नभएको हो; नियमले यसलाई शून्य मानेको होइन।"
      : "When a card shows unavailable, no usable value was available and the rules did not treat it as zero.";

  if (cardId === "decision") {
    const tool = getSafeApplication(context);
    if (!tool.available || !tool.data) {
      return unavailableResponse("explain_card", lang, tool.unavailableReason ?? { en: "Not available.", ne: "उपलब्ध छैन।" }, tool.missing, true);
    }
    const data = tool.data;
    response.level = data.level;
    response.requiresLabelReminder = true;
    response.facts = data.facts;
    response.missing = tool.missing;
    response.text = join([
      lang === "ne" ? "यो कार्डले आजको खेत स्क्रीनिङ नतिजा देखाउँछ।" : "This card shows the field screening result for today.",
      lang === "ne" ? `निर्णय स्तर: ${data.level}${signalNeLabel(data.level) ? ` (${signalNeLabel(data.level)})` : ""}।` : `Decision level: ${data.level}.`,
      lang === "ne" ? `विश्वसनीयता: ${data.confidence}।` : `Confidence: ${data.confidence}.`,
      reasonSentence(data.reasonEn, data.reasonKey, lang),
      ...data.facts.map((fact) => factSentence(fact, lang)),
      closingAssumptions,
      bi(LABEL_REMINDER, lang),
      bi(REVIEW_LINE, lang),
    ]);
    return response;
  }

  const conditionsTool = getConditions(context);
  if (!conditionsTool.available || !conditionsTool.data) {
    return unavailableResponse("explain_card", lang, conditionsTool.unavailableReason ?? { en: "Not available.", ne: "उपलब्ध छैन।" }, conditionsTool.missing, true);
  }
  const conditions = conditionsTool.data;

  const pick = (fact: AskFact | null): AskFact | null => fact;

  let intro = "";
  let note = "";
  let facts: AskFact[] = [];

  switch (cardId) {
    case "rainfall":
      intro = lang === "ne" ? "यो कार्डले स्क्रीनिङ नियमले प्रयोग गरेको वर्षा मान देखाउँछ।" : "This card shows the rainfall value the screening rules used.";
      facts = [pick(conditions.usedRainfall)].flatMap((fact) => (fact ? [fact] : []));
      note = notZeroNote;
      break;
    case "wetness":
      intro = lang === "ne" ? "यो कार्डले NASA POWER को मोडेल गरिएको सतही चिस्यान देखाउँछ।" : "This card shows modelled surface wetness from NASA POWER.";
      facts = [pick(conditions.surfaceWetness), pick(conditions.rootWetness)].flatMap((fact) => (fact ? [fact] : []));
      note = lang === "ne" ? "यो मोडेल प्रॉक्सी हो, तपाईंको खेतको सेन्सर होइन।" : "It is a modelled proxy, not a sensor in your field.";
      break;
    case "temperature":
      intro = lang === "ne" ? "यो कार्डले NASA POWER को दैनिक तापक्रम देखाउँछ।" : "This card shows the daily air temperature from NASA POWER.";
      facts = [pick(conditions.temperatureC)].flatMap((fact) => (fact ? [fact] : []));
      note = lang === "ne" ? "यो ग्रिड मोडेल मान हो, खेतको सेन्सर नाप होइन।" : "It is a gridded model value, not a sensor at your field.";
      break;
    case "terrain":
      intro = lang === "ne" ? "यो कार्डले अनुमानित उचाई र ढाल देखाउँछ।" : "This card shows the estimated elevation and slope.";
      facts = [pick(conditions.slopePercent), pick(conditions.elevationM)].flatMap((fact) => (fact ? [fact] : []));
      note = lang === "ne" ? "यो टेरेन मोडेल अनुमान हो, सर्वेक्षण होइन।" : "It is a terrain model estimate, not a survey.";
      break;
    case "soil":
      intro = lang === "ne" ? "यो कार्डले SoilGrids को माटो बनावट अनुमान देखाउँछ।" : "This card shows the predicted soil texture from SoilGrids.";
      facts = [pick(conditions.sand), pick(conditions.silt), pick(conditions.clay), pick(conditions.textureClass)].flatMap((fact) => (fact ? [fact] : []));
      note =
        conditions.usedFarmerSandOverride
          ? lang === "ne"
            ? "ढुस्साका लागि तपाईंले दिनुभएको मान प्रयोग भएको छ।"
            : "The sand value you entered was used."
          : lang === "ne"
            ? "यो माटो परीक्षण होइन; २५० मिटर अनुमान हो।"
            : "It is not a soil test; it is a 250 metre prediction.";
      break;
    case "forecast": {
      const forecastTool = getForecastSummary(context);
      if (!forecastTool.available || !forecastTool.data) {
        return unavailableResponse("explain_card", lang, forecastTool.unavailableReason ?? { en: "Not available.", ne: "उपलब्ध छैन।" }, forecastTool.missing, true);
      }
      intro = lang === "ne" ? "यो कार्डले आउँदा दिनको वर्षा पूर्वानुमान देखाउँछ।" : "This card shows the rain outlook for the coming days.";
      facts = [forecastTool.data.next48mm, forecastTool.data.next120mm].flatMap((fact) => (fact ? [fact] : []));
      note = lang === "ne" ? "पूर्वानुमान Open-Meteo बाट आउँछ; गैर-NASA मोडेल पूर्वानुमान।" : "The forecast comes from Open-Meteo; a non-NASA model forecast.";
      break;
    }
    default:
      return unavailableResponse(
        "explain_card",
        lang,
        {
          en: "I do not know that card. Cards I can explain: decision, rainfall, wetness, temperature, terrain, soil, forecast.",
          ne: "त्यो कार्ड थाहा छैन। म बुझाउन सक्ने कार्ड: decision, rainfall, wetness, temperature, terrain, soil, forecast।",
        },
        [],
        false,
      );
  }

  response.facts = facts;
  response.requiresLabelReminder = false;
  response.text = join([intro, ...facts.map((fact) => factSentence(fact, lang)), note, bi(REVIEW_LINE, lang)]);
  return response;
}

// ---------------------------------------------------------------------------
// explain_term
// ---------------------------------------------------------------------------

function buildExplainTerm(lang: AskLang, slots: AskSlots): AskResponse {
  const term = (slots.term ?? "").trim();
  if (!term) {
    return clarificationResponse("explain_term", lang, { en: "Which term should I explain?", ne: "कुन शब्द बुझाउनु?" }, [
      { id: "imerg", label: { en: "GPM IMERG", ne: "GPM IMERG" }, intent: "explain_term", slot: { term: "GPM IMERG" } },
      { id: "soilgrids", label: { en: "SoilGrids", ne: "SoilGrids" }, intent: "explain_term", slot: { term: "SoilGrids" } },
      { id: "theilsen", label: { en: "Theil-Sen slope", ne: "Theil-Sen ढल्कान" }, intent: "explain_term", slot: { term: "Theil-Sen slope" } },
    ]);
  }
  const tool = getGlossaryTerm(term);
  if (!tool.available || !tool.data) {
    return unavailableResponse("explain_term", lang, tool.unavailableReason ?? { en: "Not available.", ne: "उपलब्ध छैन।" }, tool.missing, false);
  }
  const entry = tool.data;
  const response = baseResponse("explain_term", lang);
  response.text = join([
    lang === "ne" ? `${entry.term} भनेको: ${entry.definition.ne}` : `${entry.term} means: ${entry.definition.en}`,
    bi(REVIEW_LINE, lang),
  ]);
  return response;
}

// ---------------------------------------------------------------------------
// data_source
// ---------------------------------------------------------------------------

function statusSentence(row: { status: string; latestObservation: string | null; fetchedAt: string | null; resolution: string | null; latencyNote?: string | null }, lang: AskLang): string {
  const latest = row.latestObservation ? row.latestObservation.slice(0, 10) : null;
  const fetched = row.fetchedAt ? row.fetchedAt.slice(0, 10) : null;
  const resolution = sanitizeDescriptor(row.resolution);
  if (lang === "ne") {
    return `स्थिति: ${row.status}। पछिल्लो अवलोकन: ${latest ?? "उपलब्ध छैन"}। लिइएको मिति: ${fetched ?? "उपलब्ध छैन"}। स्थानिक विभेदन: ${resolution ?? "उपलब्ध छैन"}।`;
  }
  return `Status: ${row.status}. Latest observation: ${latest ?? "not available"}. Fetched: ${fetched ?? "not available"}. Resolution: ${resolution ?? "not supplied"}.`;
}

function buildDataSource(context: AskFieldContext, lang: AskLang, slots: AskSlots): AskResponse {
  const valueId = (slots.valueId ?? "").trim();
  if (!valueId) {
    return clarificationResponse("data_source", lang, { en: "Which data source should I describe?", ne: "कुन डाटा स्रोत बताउनु?" }, [
      { id: "all", label: { en: "All data sources", ne: "सबै डाटा स्रोत" }, intent: "data_source", slot: { valueId: "all" } },
      { id: "rainfall", label: { en: "Rainfall", ne: "वर्षा" }, intent: "data_source", slot: { valueId: "rainfall_72h" } },
      { id: "forecast", label: { en: "Rain forecast", ne: "वर्षा पूर्वानुमान" }, intent: "data_source", slot: { valueId: "forecast" } },
    ]);
  }

  if (valueId === "all") {
    const tool = getDataStatus(context);
    if (!tool.available || !tool.data) {
      return unavailableResponse("data_source", lang, tool.unavailableReason ?? { en: "Not available.", ne: "उपलब्ध छैन।" }, tool.missing, false);
    }
    const response = baseResponse("data_source", lang);
    const intro = lang === "ne" ? "यो मूल्याङ्कनमा प्रयोग भएका डाटा स्रोतहरू।" : "Data sources used by this assessment.";
    const sentences = tool.data.map((row) => {
      const nasa = lang === "ne" ? (row.isNasa ? "NASA स्रोत।" : "गैर-NASA स्रोत।") : row.isNasa ? "NASA source." : "non-NASA source.";
      const name = row.valueId === "rainfall_source_detail"
        ? lang === "ne"
          ? `वर्षा विवरण: ${row.sourceOrg}, डाटासेट ${row.datasetName}।`
          : `Rainfall detail: ${row.sourceOrg}, dataset ${row.datasetName}.`
        : lang === "ne"
          ? `${row.datasetName} (${row.sourceOrg})। ${nasa}`
          : `${row.datasetName} (${row.sourceOrg}). ${nasa}`;
      return row.valueId === "rainfall_source_detail"
        ? join([name, row.latencyNote ? `${lang === "ne" ? "विलम्ब नोट" : "Latency note"}: ${row.latencyNote}` : ""])
        : join([name, statusSentence(row, lang)]);
    });
    response.text = join([intro, ...sentences, bi(REVIEW_LINE, lang)]);
    return response;
  }

  const provTool = getProvenance(context, { valueId });
  if (!provTool.available || !provTool.data) {
    return unavailableResponse("data_source", lang, provTool.unavailableReason ?? { en: "Not available.", ne: "उपलब्ध छैन।" }, provTool.missing, false);
  }
  const prov = provTool.data;
  const response = baseResponse("data_source", lang);
  const nasa = lang === "ne" ? (prov.isNasa ? "NASA स्रोत।" : "गैर-NASA स्रोत।") : prov.isNasa ? "NASA source." : "non-NASA source.";
  const kind = lang === "ne"
    ? { observation: "अवलोकन", model: "मोडेल अनुमान", forecast: "पूर्वानुमान", fallback: "वैकल्पिक स्रोत", cached: "क्यास गरिएको", farmer_input: "किसानको जानकारी" }[prov.kind]
    : { observation: "observation", model: "model estimate", forecast: "forecast", fallback: "fallback", cached: "cached", farmer_input: "farmer input" }[prov.kind];
  response.text = join([
    lang === "ne" ? `वर्षा मानको स्रोत विवरण।` : `Provenance for the requested value.`,
    lang === "ne" ? `स्रोत: ${prov.source}। ${nasa} प्रकार: ${kind}।` : `Source: ${prov.source}. ${nasa} Kind: ${kind}.`,
    prov.validTo ? (lang === "ne" ? `अवलोकन मिति: ${prov.validTo}।` : `Observation date: ${prov.validTo}.`) : "",
    prov.fetchedAt ? (lang === "ne" ? `लिइएको मिति: ${prov.fetchedAt}।` : `Fetched: ${prov.fetchedAt}.`) : "",
    prov.resolution ? (lang === "ne" ? `स्थानिक विभेदन: ${sanitizeDescriptor(prov.resolution)}।` : `Resolution: ${sanitizeDescriptor(prov.resolution)}.`) : "",
    bi(REVIEW_LINE, lang),
  ]);
  return response;
}

// ---------------------------------------------------------------------------
// explain_rotation / what_changed / P1 hints
// ---------------------------------------------------------------------------

function buildExplainRotation(context: AskFieldContext, lang: AskLang): AskResponse {
  const tool = getRotationPlans(context);
  return unavailableResponse("explain_rotation", lang, tool.unavailableReason ?? { en: "Not available.", ne: "उपलब्ध छैन।" }, tool.missing, true);
}

function usedValuesForChange(assessment: NonNullable<AskFieldContext["assessment"]>): { level: string; rain: number | null; forecast: number | null; waitDays: number } {
  const obs = assessment.rainfall_observation;
  const rain = obs ? (obs.status === "AVAILABLE" ? obs.amount_mm : null) : assessment.power_summary.rain_last_72h_mm;
  return {
    level: assessment.decision.signal,
    rain,
    forecast: assessment.forecast.expected_rain_next_48h_mm,
    waitDays: assessment.decision.wait_days_recommended,
  };
}

function buildWhatChanged(context: AskFieldContext, lang: AskLang): AskResponse {
  const response = baseResponse("what_changed", lang);
  if (!context.assessment) {
    return unavailableResponse("what_changed", lang, { en: "No field assessment is loaded.", ne: "खेतको मूल्याङ्कन लोड भएको छैन।" }, [], false);
  }
  if (!context.previousAssessment) {
    return unavailableResponse(
      "what_changed",
      lang,
      {
        en: "I do not have a previous saved assessment to compare. Run an assessment first; then ask again to see what changed.",
        ne: "तुलनाका लागि पहिलेको सेभ गरिएको मूल्याङ्कन छैन। पहिले मूल्याङ्कन चलाउनुहोस्; त्यसपछि फेरि सोध्नुहोस्।",
      },
      [],
      false,
    );
  }

  const current = usedValuesForChange(context.assessment);
  const previous = usedValuesForChange(context.previousAssessment);
  const changes: string[] = [];

  if (current.level !== previous.level) {
    changes.push(lang === "ne" ? `निर्णय स्तर ${previous.level} बाट ${current.level} मा बदलियो।` : `Decision level changed from ${previous.level} to ${current.level}.`);
  }
  if (current.rain !== null && previous.rain !== null && current.rain !== previous.rain) {
    changes.push(
      lang === "ne"
        ? `पछिल्लो ७२ घण्टाको वर्षा ${previous.rain} मि.मी. बाट ${current.rain} मि.मी. मा बदलियो।`
        : `Recent rainfall changed from ${previous.rain} mm to ${current.rain} mm.`,
    );
  }
  if (current.forecast !== null && previous.forecast !== null && current.forecast !== previous.forecast) {
    changes.push(
      lang === "ne"
        ? `आगामी ४८ घण्टाको वर्षा पूर्वानुमान ${previous.forecast} मि.मी. बाट ${current.forecast} मि.मी. मा बदलियो।`
        : `The 48-hour rain forecast changed from ${previous.forecast} mm to ${current.forecast} mm.`,
    );
  }
  if (current.waitDays !== previous.waitDays) {
    changes.push(lang === "ne" ? `सुझाव गरिएको पर्खाइ ${previous.waitDays} दिनबाट ${current.waitDays} दिनमा बदलियो।` : `The suggested wait changed from ${previous.waitDays} days to ${current.waitDays} days.`);
  }

  const prevFetched = context.previousAssessment.forecast.freshness.fetched_at_utc?.slice(0, 10) ?? null;
  const prevSentence = prevFetched
    ? lang === "ne"
      ? `अघिल्ला मानहरू ${prevFetched} मा सेभ भएको पुरानो मूल्याङ्कनबाट आएका हुन्।`
      : `Previous values come from the earlier assessment saved on ${prevFetched}.`
    : "";

  const rainFact = rain72Fact(context.assessment);
  const forecastFact = forecast48Fact(context.assessment);

  if (changes.length === 0) {
    response.text = join([
      lang === "ne" ? "जाँचिएका मानहरूमा पछिल्लो मूल्याङ्कनदेखि कुनै फरक परेन।" : "The checked values did not change since the previous assessment.",
      prevSentence,
      ...[rainFact, forecastFact].flatMap((fact) => (fact ? [factSentence(fact, lang)] : [])),
      bi(REVIEW_LINE, lang),
    ]);
    return response;
  }

  response.facts = [rainFact, forecastFact].flatMap((fact) => (fact ? [fact] : []));
  response.level = current.level;
  response.text = join([
    lang === "ne" ? "पछिल्लो मूल्याङ्कनसँग तुलना गर्दा:" : "Compared with your previous saved assessment:",
    ...changes,
    prevSentence,
    ...[rainFact, forecastFact].flatMap((fact) => (fact ? [factSentence(fact, lang)] : [])),
    bi(REVIEW_LINE, lang),
  ]);
  return response;
}

function buildIrrigationHint(lang: AskLang): AskResponse {
  const response = baseResponse("irrigation_timing_hint", lang);
  response.scope = "unavailable";
  response.missing = [
    { en: "expert-reviewed irrigation thresholds", ne: "विज्ञ-समीक्षित सिँचाइ सीमाहरू" },
    { en: "on-farm moisture measurement", ne: "खेत-स्तरको चिस्यान नाप" },
  ];
  response.text = join([
    lang === "ne"
      ? "यो प्रोटोटाइपमा म सिँचाइको समय-संकेत दिन सक्दिनँ।"
      : "I cannot give an irrigation timing hint in this prototype.",
    lang === "ne"
      ? "उपलब्ध नभएका: विज्ञ-समीक्षित सिँचाइ सीमाहरू, खेत-स्तरको चिस्यान नाप।"
      : "Missing: expert-reviewed irrigation thresholds, on-farm moisture measurement.",
    lang === "ne"
      ? "मेरो खेत पृष्ठमा मोडेल गरिएको चिस्यान र वर्षा पूर्वानुमान देखाइएको छ।"
      : "The My field screen shows the modelled wetness values and the rain forecast.",
    bi(AGRICULTURE_OFFICE_POINTER, lang),
  ]);
  return response;
}

function buildFertilizerTimingWindow(lang: AskLang): AskResponse {
  const response = baseResponse("fertilizer_timing_window", lang);
  response.scope = "unavailable";
  response.requiresLabelReminder = true;
  response.missing = [{ en: "expert-reviewed, crop-specific schedules", ne: "विज्ञ-समीक्षित, बाली-विशेष तालिका" }];
  response.text = join([
    lang === "ne"
      ? "यो प्रोटोटाइपमा म मल हाल्ने समय-सीमा दिन सक्दिनँ।"
      : "I cannot give a fertilizer timing window in this prototype.",
    lang === "ne"
      ? "उपलब्ध नभएका: विज्ञ-समीक्षित, बाली-विशेष तालिका।"
      : "Missing: expert-reviewed, crop-specific schedules.",
    lang === "ne"
      ? "स्क्रीनिङ नियमले आजको वर्षा र भू-आकृति अवस्था मात्र जाँच्छ।"
      : "The screening rules only check today's rain and terrain conditions.",
    bi(LABEL_REMINDER, lang),
    bi(AGRICULTURE_OFFICE_POINTER, lang),
  ]);
  return response;
}

// ---------------------------------------------------------------------------
// Public entry (used by answer.ts)
// ---------------------------------------------------------------------------

export function buildL0Answer(
  intent: AskResponse["intent"],
  context: AskFieldContext,
  lang: AskLang,
  slots: AskSlots = {},
): AskResponse {
  switch (intent) {
    case "can_apply_today":
      return buildCanApplyToday(context, lang);
    case "check_soil":
      return buildCheckSoil(context, lang);
    case "rain_this_week":
      return buildRainThisWeek(context, lang);
    case "stay_safe":
      return buildStaySafe(lang);
    case "explain_card":
      return buildExplainCard(context, lang, slots);
    case "explain_term":
      return buildExplainTerm(lang, slots);
    case "data_source":
      return buildDataSource(context, lang, slots);
    case "explain_rotation":
      return buildExplainRotation(context, lang);
    case "what_changed":
      return buildWhatChanged(context, lang);
    case "irrigation_timing_hint":
      return buildIrrigationHint(lang);
    case "fertilizer_timing_window":
      return buildFertilizerTimingWindow(lang);
    case "unknown":
    default: {
      const response = baseResponse("unknown", lang);
      response.scope = "refusal";
      response.requiresReviewBanner = false;
      response.text = getFixedRefusal(lang);
      return response;
    }
  }
}

export function buildMedicalResponse(lang: AskLang): AskResponse {
  const response = baseResponse("stay_safe", lang);
  response.scope = "medical";
  response.markedForExpertReview = true;
  response.text = getMedicalReferral(lang);
  return response;
}
