// Ask assistant — deterministic glossary (Work Package 1, get_glossary).
//
// Definitions stay strictly inside the vocabulary already published on the
// app's own "Data & methods" screen (Screen E) and the provenance docs. No new
// agronomic claims, no numbers beyond dataset descriptors already printed by
// the app. Nepali text carries the standing review-banner requirement until a
// native reviewer signs off.

import type { GlossaryEntry } from "./types";

export const GLOSSARY_TERMS: GlossaryEntry[] = [
  {
    id: "imerg",
    term: "GPM IMERG",
    aliases: ["imerg", "gpm imerg", "IMERG"],
    definition: {
      en: "GPM IMERG is a NASA satellite rainfall map. This app uses its daily Late product only when a fresh local cache is installed. The grid spacing is about ten kilometres, so it is a neighbourhood estimate, not a gauge on your field.",
      ne: "GPM IMERG NASA को उपग्रह वर्षा नक्सा हो। यो एपले यसको दैनिक Late उत्पादन त्यसबेला मात्र प्रयोग गर्छ जब ताजा स्थानीय क्यास जडान हुन्छ। ग्रिडको दूरी करिब दश किलोमिटर हुने भएकाले यो छिमेकी-स्तरको अनुमान हो, तपाईंको खेतको नाप होइन।",
    },
  },
  {
    id: "power",
    term: "NASA POWER",
    aliases: ["power", "nasa power"],
    definition: {
      en: "NASA POWER is a gridded weather dataset from NASA. It is about fifty-five kilometres wide per cell and built from reanalysis, so it is modelled regional data, not a sensor on your field. This app uses it for temperature, modelled wetness and rainfall fallback.",
      ne: "NASA POWER NASA को ग्रिड मौसम डाटासेट हो। प्रति खण्ड करिब पचपन किलोमिटर फराकिलो हुन्छ र रिअनालाइसिसबाट बनेकाले यो मोडेल गरिएको क्षेत्रीय डाटा हो, खेतको सेन्सर होइन। यो एपले यसबाट तापक्रम, मोडेल चिस्यान र वर्षा वैकल्पिक मान लिन्छ।",
    },
  },
  {
    id: "gwettop",
    term: "GWETTOP",
    aliases: ["gwettop", "surface wetness"],
    definition: {
      en: "GWETTOP is a modelled surface soil wetness proxy from NASA POWER. It shows what the model estimates for the top of the soil. It is not a SMAP satellite reading and not a probe in your field.",
      ne: "GWETTOP NASA POWER को मोडेल गरिएको सतही माटो चिस्यान-प्रॉक्सी हो। यसले मोडेलले अनुमान गरेको माथिल्लो माटोको चिस्यान देखाउँछ। यो SMAP उपग्रहको नाप होइन र तपाईंको खेतको जाँच होइन।",
    },
  },
  {
    id: "gwetroot",
    term: "GWETROOT",
    aliases: ["gwetroot", "root wetness"],
    definition: {
      en: "GWETROOT is a modelled root-zone soil wetness proxy from NASA POWER. It estimates wetness around plant roots. It is a model value, not a measurement of your field.",
      ne: "GWETROOT NASA POWER को मोडेल गरिएको जरा-क्षेत्र चिस्यान-प्रॉक्सी हो। यसले बिरुवाको जरा नजिकको चिस्यान अनुमान गर्छ। यो मोडेल मान हो, तपाईंको खेतको नाप होइन।",
    },
  },
  {
    id: "soilgrids",
    term: "SoilGrids",
    aliases: ["soilgrids", "soil grids", "isric"],
    definition: {
      en: "SoilGrids is a predicted soil map from ISRIC. This app uses its prediction for the top five centimetres at two hundred fifty metre spacing. It is a model prediction, not a soil test of your plot. It is a non-NASA source.",
      ne: "SoilGrids ISRIC को अनुमानित माटो नक्सा हो। यो एपले माथिल्लो पाँच सेन्टिमिटर गहिराइको, दुई सय पचास मिटर दूरीको अनुमान प्रयोग गर्छ। यो मोडेल अनुमान हो, तपाईंको प्लटको माटो परीक्षण होइन। यो गैर-NASA स्रोत हो।",
    },
  },
  {
    id: "openmeteo",
    term: "Open-Meteo",
    aliases: ["open-meteo", "openmeteo"],
    definition: {
      en: "Open-Meteo is a weather service that is not NASA. This app uses it for the rain forecast and for elevation and reanalysis rainfall. Forecasts are model estimates with normal forecast uncertainty.",
      ne: "Open-Meteo गैर-NASA मौसम सेवा हो। यो एपले यसबाट वर्षा पूर्वानुमान, उचाई र रिअनालाइसिस वर्षा लिन्छ। पूर्वानुमान मोडेल अनुमान हुन् र सामान्य पूर्वानुमान अनिश्चितता हुन्छ।",
    },
  },
  {
    id: "theilsen",
    term: "Theil-Sen slope",
    aliases: ["theil-sen", "theil sen", "theilsen"],
    definition: {
      en: "The Theil-Sen slope is a statistical way to draw a trend line that outliers cannot easily drag. The Climate trends screen uses it on yearly heavy-rain days.",
      ne: "Theil-Sen ढल्कान सांख्यिकीय विधि हो जसले असामान्य मानले तान्न नसक्ने प्रवृत्ति रेखा बनाउँछ। जलवायु प्रवृत्ति पृष्ठले यसलाई वार्षिक भारी-वर्षा दिनहरूमा प्रयोग गर्छ।",
    },
  },
  {
    id: "mannkendall",
    term: "Mann-Kendall test",
    aliases: ["mann-kendall", "mann kendall"],
    definition: {
      en: "The Mann-Kendall test checks whether a trend is statistically meaningful or looks like natural ups and downs. This app adjusts it for autocorrelation before trusting it.",
      ne: "Mann-Kendall परीक्षणले प्रवृत्ति सांख्यिकीय रूपमा अर्थपूर्ण छ वा प्राकृतिक ओझेल-चढाव मात्र हो जाँच्छ। यो एपले भर पर्नुअघि स्वसहसम्बन्धका लागि समायोजन गर्छ।",
    },
  },
  {
    id: "fdr",
    term: "FDR correction",
    aliases: ["fdr", "false discovery rate", "benjamini-hochberg"],
    definition: {
      en: "FDR correction (Benjamini-Hochberg) reduces false alarms when many statistical tests run together. A result called significant after FDR is stronger evidence than a raw result.",
      ne: "FDR समायोजन (Benjamini-Hochberg) धेरै सांख्यिकीय परीक्षण एकैसाथ चल्दा झूटा संकेत घटाउँछ। FDR पछि महत्वपूर्ण भनिएको नतिजा कच्चा नतिजाभन्दा बलियो प्रमाण हो।",
    },
  },
  {
    id: "sand_fraction",
    term: "Sand fraction",
    aliases: ["sand fraction", "sand percent", "sand"],
    definition: {
      en: "The sand fraction is the share of sand particles in the soil. The screening rules look at it because sandy ground can let nutrients move downward. The cut-off value is a prototype assumption pending expert review.",
      ne: "ढुस्सा प्रतिशत भनेको माटोमा ढुस्सा कणको हिस्सा हो। ढुस्सा-माटोमा पोषण तल बग्न सक्ने भएकाले स्क्रीनिङ नियमले यसलाई हेर्छ। सीमा मान विज्ञ समीक्षा हुन बाँकी प्रोटोटाइप मान्यता हो।",
    },
  },
  {
    id: "slope",
    term: "Slope",
    aliases: ["slope"],
    definition: {
      en: "Slope is how steep the field is, estimated here from a terrain model, not from a survey. Steeper ground can lose surface material to runoff. The cut-off value is a prototype assumption pending expert review.",
      ne: "ढाल भनेको खेत कति खाड़ो छ भन्ने हो; यहाँ यो टेरेन मोडेलबाट अनुमान गरिन्छ, सर्वेक्षणबाट होइन। खाड़ो जमिनमा सतहको सामग्री बगेर जान सक्छ। सीमा मान विज्ञ समीक्षा हुन बाँकी प्रोटोटाइप मान्यता हो।",
    },
  },
  {
    id: "decision_level",
    term: "Decision level",
    aliases: ["decision level", "decision signal", "signal"],
    definition: {
      en: "The decision level is the exact word the screening rules return: CONDITIONS LOOK SUITABLE, WAIT AND RECHECK, or LOCAL REVIEW NEEDED. It is a screening flag with thresholds pending expert review. It is not permission and it is not a schedule.",
      ne: "निर्णय स्तर भनेको स्क्रीनिङ नियमले फर्काउने शब्द हो: CONDITIONS LOOK SUITABLE, WAIT AND RECHECK वा LOCAL REVIEW NEEDED। यो विज्ञ समीक्षा हुन बाँकी सीमा भएको स्क्रीनिङ संकेत हो। यो अनुमति होइन र तालिका पनि होइन।",
    },
  },
  {
    id: "rain72",
    term: "72-hour rainfall",
    aliases: ["72-hour rainfall", "recent rainfall", "rainfall 72"],
    definition: {
      en: "The 72-hour rainfall is rain added up over the past seventy-two hours from the best available source. When a fresh IMERG cache exists it is a satellite observation; otherwise the app labels the coarser source it used as model or fallback.",
      ne: "७२ घण्टाको वर्षा भनेको पछिल्लो तीन दिनको उपलब्ध स्रोतबाट जोडिएको वर्षा हो। ताजा IMERG क्यास हुँदा यो उपग्रह अवलोकन हो; नहुँदा एपले प्रयोग गरेको खुरो स्रोतलाई मोडेल वा वैकल्पिक भनेर चिनाउँछ।",
    },
  },
];

export function findGlossaryEntry(term: string | undefined | null): GlossaryEntry | null {
  if (!term) return null;
  const needle = term.trim().toLowerCase();
  if (!needle) return null;
  for (const entry of GLOSSARY_TERMS) {
    if (entry.term.toLowerCase() === needle) return entry;
    if (entry.aliases.some((alias) => alias.toLowerCase() === needle)) return entry;
  }
  // Substring fallback so "soilgrid" still finds "SoilGrids".
  for (const entry of GLOSSARY_TERMS) {
    if (entry.term.toLowerCase().includes(needle) || entry.aliases.some((alias) => alias.toLowerCase().includes(needle))) {
      return entry;
    }
  }
  return null;
}

export function glossarySuggestions(max = 4): string[] {
  return GLOSSARY_TERMS.slice(0, max).map((entry) => entry.term);
}
