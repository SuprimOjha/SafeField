// Ask assistant — buttons UI (Work Package 2).
//
// Renders the L0 question buttons, the rule-6 clarifying-question flow, and a
// read-aloud control on top of buildAskResponse() from Work Package 1.
//
// Grounding invariant: this UI adds NO wording of its own. Every answer text,
// decision level, fact label, source, kind and date comes from the
// deterministic lib/ask templates and helpers. UI-level strings (headings,
// button chrome) come from the app i18n dictionaries with ne/en parity.
//
// Accessibility:
// - dialog semantics: role="dialog", aria-modal, labelled title, Escape to
//   close, focus moves into the panel on open and returns to the launcher on
//   close.
// - the conversation log is a polite live region so new answers are announced
//   to assistive technology.
// - every control keeps a 44px minimum touch target and a visible focus ring.
// - answers are plain text (rule 9: no emojis, no markdown symbols), so
//   read-aloud feeds response.text straight into speechSynthesis with the
//   matching language tag (ne-NP / en-US).
//
// Scope tags, facts list and the label-reminder chip only re-render what the
// L0 response already carries; they never introduce new claims or numbers.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eraser, MessageCircleQuestion, SquareX, Volume2, X } from "lucide-react";
import { getDict, ne as dictNe, en as dictEn, type Lang } from "@/i18n";
import { buildAskResponse, buildMedicalSafetyResponse } from "@/lib/ask/answer";
import { INTENT_LABELS } from "@/lib/ask/intents";
import { LABEL_REMINDER } from "@/lib/ask/templates";
import { fmtDate, kindWord, nasaLabel, unitWord } from "@/lib/ask/provenance";
import type {
  AskFact,
  AskFieldContext,
  AskIntent,
  AskLang,
  AskResponse,
  AskSlots,
  Bi,
} from "@/lib/ask/types";

const SUITABLE_LEVEL = "CONDITIONS LOOK SUITABLE";

/**
 * Primary L0 questions shown as buttons. P1 intents
 * (irrigation_timing_hint, fertilizer_timing_window) stay in the closed
 * intent contract for L2 routing (Work Package 5) and are not offered as
 * buttons, because their L0 answers honestly report what is missing.
 */
const PRIMARY_INTENTS: readonly AskIntent[] = [
  "can_apply_today",
  "rain_this_week",
  "check_soil",
  "explain_card",
  "explain_term",
  "data_source",
  "explain_rotation",
  "what_changed",
  "stay_safe",
];

/** Rule 8 entry point: reached by an explicit health-safety button, never by guessing. */
const MEDICAL_QUESTION: Bi = {
  en: dictEn.askFeelingUnwell,
  ne: dictNe.askFeelingUnwell,
};

interface AskTurn {
  id: number;
  question: Bi;
  kind: "intent" | "medical";
  intent: AskIntent;
  slots: AskSlots;
}

interface AnsweredTurn extends AskTurn {
  response: AskResponse;
}

/** Value + unit exactly as the fact carries them; missing values say so plainly. */
function factValue(fact: AskFact, lang: AskLang): string {
  if (fact.value === null) {
    return lang === "ne" ? "उपलब्ध छैन" : "not available";
  }
  const unit = unitWord(fact.unit, lang);
  return unit ? `${fact.value} ${unit}` : fact.value;
}

/** Source, NASA labelling, kind and date for one fact (hard rule 4 in chip form). */
function provenanceLine(fact: AskFact, lang: AskLang): string | null {
  const prov = fact.provenance;
  if (!prov) return null;
  const parts: string[] = [prov.source, nasaLabel(prov.isNasa, lang), kindWord(prov.kind, lang)];
  const date =
    prov.kind === "forecast" || prov.kind === "cached"
      ? prov.fetchedAt ?? prov.validTo
      : prov.validTo ?? prov.fetchedAt;
  const shown = fmtDate(date);
  if (shown) parts.push(shown);
  return parts.filter(Boolean).join(" · ");
}

interface AnswerBubbleProps {
  turn: AnsweredTurn;
  lang: AskLang;
  t: ReturnType<typeof getDict>;
  speechSupported: boolean;
  speakingId: number | null;
  onSpeak: (turnId: number, text: string) => void;
  onOption: (intent: AskIntent, slot: AskSlots, label: Bi) => void;
}

function AnswerBubble({ turn, lang, t, speechSupported, speakingId, onSpeak, onOption }: AnswerBubbleProps) {
  const response = turn.response;
  const speaking = speakingId === turn.id;
  const isMedical = response.scope === "medical";
  const isRefusal = response.scope === "refusal";

  const tagText =
    response.scope === "unavailable"
      ? t.askTagUnavailable
      : isRefusal
        ? t.askTagRefusal
        : isMedical
          ? t.askTagMedical
          : null;

  const bubbleTone = isMedical
    ? "border-danger/40 bg-danger-soft"
    : isRefusal
      ? "border-line bg-soft"
      : "border-line bg-white";

  return (
    <div className="flex flex-col items-start gap-1">
      <p className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-forest px-4 py-2.5 text-sm font-medium text-white">
        {turn.question[lang]}
      </p>
      <div
        className={`w-full rounded-2xl rounded-bl-md border p-4 shadow-float ${bubbleTone}`}
        data-scope={response.scope}
      >
        {tagText && (
          <p className="mb-2">
            <span
              className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                isMedical ? "bg-danger text-white" : "bg-amber text-amber-ink"
              }`}
            >
              {tagText}
            </span>
          </p>
        )}

        {response.level && (
          <p className="mb-2">
            <span
              className={`inline-block rounded-full px-3 py-1 text-xs font-bold ${
                response.level === SUITABLE_LEVEL ? "bg-action text-white" : "bg-amber text-amber-ink"
              }`}
            >
              {response.level}
            </span>
          </p>
        )}

        <p className="text-sm leading-relaxed text-ink">{response.text}</p>

        {response.scope === "unavailable" && response.missing.length > 0 && (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink">
            {response.missing.map((missing, index) => (
              <li key={index}>{missing[lang]}</li>
            ))}
          </ul>
        )}

        {response.requiresLabelReminder && (
          <p className="mt-3 rounded-lg bg-amber-soft px-3 py-2 text-xs font-semibold text-amber-ink">
            {LABEL_REMINDER[lang]}
          </p>
        )}

        {response.facts.length > 0 && (
          <details className="mt-3 rounded-lg border border-divider bg-canvas px-3 py-2">
            <summary className="cursor-pointer text-xs font-semibold text-ink-soft">
              {t.askFactsTitle}
            </summary>
            <ul className="mt-2 flex flex-col gap-2">
              {response.facts.map((fact) => {
                const prov = provenanceLine(fact, lang);
                return (
                  <li key={fact.id} className="text-sm text-ink">
                    <span className="font-medium">{fact.label[lang]}</span>
                    {": "}
                    <span className="tabular-nums">{factValue(fact, lang)}</span>
                    {prov && <span className="mt-0.5 block text-xs text-ink-muted">{prov}</span>}
                  </li>
                );
              })}
            </ul>
          </details>
        )}

        {response.scope === "clarification" && response.clarification && (
          <div className="mt-3 flex flex-col gap-2">
            <p className="text-sm font-semibold text-ink">{response.clarification.question[lang]}</p>
            {response.clarification.options.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => onOption(option.intent, option.slot ?? {}, option.label)}
                className="flex min-h-11 w-full items-center rounded-xl border border-line bg-canvas px-3 py-2 text-left text-sm font-medium text-ink transition hover:bg-mint hover:text-forest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
              >
                {option.label[lang]}
              </button>
            ))}
          </div>
        )}

        {speechSupported && (
          <button
            type="button"
            onClick={() => onSpeak(turn.id, response.text)}
            aria-pressed={speaking}
            className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-white px-4 text-xs font-semibold text-ink-soft transition hover:bg-mint hover:text-forest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
          >
            {speaking ? (
              <SquareX className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Volume2 className="h-4 w-4" aria-hidden="true" />
            )}
            {speaking ? t.askStopReading : t.askReadAloud}
          </button>
        )}
      </div>
    </div>
  );
}

export interface AskAssistantProps {
  lang: Lang;
  context: AskFieldContext;
}

export default function AskAssistant({ lang, context }: AskAssistantProps) {
  const t = getDict(lang);
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const [speakingId, setSpeakingId] = useState<number | null>(null);
  // speechSynthesis is browser-only. Lazy init reads it on the client's first
  // render; the result only affects the panel (never rendered during
  // hydration), so there is no SSR mismatch.
  const [speechSupported] = useState(
    () => typeof window !== "undefined" && "speechSynthesis" in window,
  );

  const idRef = useRef(0);
  const fabRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // Responses are recomputed from the stored intent + slots on every render.
  // Deterministic tools make this cheap, and it keeps the whole conversation
  // in the current language (i18n parity) and current data (provenance stays
  // truthful after a re-assessment).
  const answeredTurns: AnsweredTurn[] = useMemo(
    () =>
      turns.map((turn) => ({
        ...turn,
        response:
          turn.kind === "medical"
            ? buildMedicalSafetyResponse(lang)
            : buildAskResponse(turn.intent, context, lang, turn.slots),
      })),
    [turns, context, lang],
  );

  const stopSpeaking = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setSpeakingId(null);
  }, []);

  const speak = useCallback(
    (turnId: number, text: string) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      if (speakingId === turnId) {
        stopSpeaking();
        return;
      }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang === "ne" ? "ne-NP" : "en-US";
      utterance.onend = () => setSpeakingId((current) => (current === turnId ? null : current));
      utterance.onerror = () => setSpeakingId((current) => (current === turnId ? null : current));
      setSpeakingId(turnId);
      window.speechSynthesis.speak(utterance);
    },
    [lang, speakingId, stopSpeaking],
  );

  // Stop any ongoing speech when the language changes mid-sentence (the app
  // broadcasts this event; see page.tsx updateStoredLanguage).
  useEffect(() => {
    const onLanguageChange = () => stopSpeaking();
    window.addEventListener("safefield-language-change", onLanguageChange);
    return () => window.removeEventListener("safefield-language-change", onLanguageChange);
  }, [stopSpeaking]);

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // The dedicated Ask tab can open this same accessible assistant panel.
  useEffect(() => {
    const openFromTab = () => setOpen(true);
    window.addEventListener("safefield-open-ask", openFromTab);
    return () => window.removeEventListener("safefield-open-ask", openFromTab);
  }, []);

  // Move focus into the dialog when it opens.
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  // Lock background scroll while the dialog is open.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Keep the latest answer in view when a new turn arrives. With an empty
  // log the panel stays scrolled to the top so the question buttons are
  // fully visible.
  useEffect(() => {
    const el = logRef.current;
    if (open && el && turns.length > 0) el.scrollTo({ top: el.scrollHeight });
  }, [turns.length, open]);

  const closeAssistant = useCallback(() => {
    stopSpeaking();
    setOpen(false);
    fabRef.current?.focus();
  }, [stopSpeaking]);

  const askQuestion = useCallback((intent: AskIntent, slots: AskSlots, question: Bi) => {
    idRef.current += 1;
    const id = idRef.current;
    setTurns((previous) => [...previous, { id, question, kind: "intent", intent, slots }]);
  }, []);

  const askMedical = useCallback(() => {
    idRef.current += 1;
    const id = idRef.current;
    setTurns((previous) => [
      ...previous,
      { id, question: MEDICAL_QUESTION, kind: "medical", intent: "unknown", slots: {} },
    ]);
  }, []);

  const clearConversation = useCallback(() => {
    stopSpeaking();
    setTurns([]);
  }, [stopSpeaking]);

  const onOption = useCallback(
    (intent: AskIntent, slot: AskSlots, label: Bi) => {
      askQuestion(intent, slot, label);
    },
    [askQuestion],
  );

  return (
    <>
      <button
        ref={fabRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t.askOpenAria}
        className="fixed bottom-[calc(env(safe-area-inset-bottom)+96px)] right-4 z-[65] flex h-14 items-center gap-2 rounded-full bg-forest px-5 text-white shadow-float transition hover:bg-action-pressed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2 lg:bottom-6 lg:right-6"
      >
        <MessageCircleQuestion className="h-5 w-5" aria-hidden="true" />
        <span className="text-sm font-semibold">{t.askOpen}</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[70]">
          <div
            aria-hidden="true"
            onClick={closeAssistant}
            className="absolute inset-0 bg-charcoal/45"
          />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ask-title"
            tabIndex={-1}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                closeAssistant();
              }
            }}
            className="absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col overflow-hidden rounded-t-2xl bg-white shadow-float outline-none sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:w-[420px] sm:max-w-[94vw] sm:max-h-none sm:rounded-t-none sm:rounded-l-2xl"
          >
            <div className="flex items-start justify-between gap-3 border-b border-divider px-4 py-3">
              <div className="min-w-0">
                <h2 id="ask-title" className="text-base font-bold text-forest">
                  {t.askTitle}
                </h2>
                <p className="mt-0.5 text-xs text-ink-soft">{t.askSubtitle}</p>
              </div>
              <button
                type="button"
                onClick={closeAssistant}
                aria-label={t.askClose}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-soft transition hover:bg-canvas hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <p
              role="note"
              className="border-b border-divider bg-amber-soft px-4 py-2 text-xs font-medium text-amber-ink"
            >
              {t.askReviewNote}
            </p>

            <div ref={logRef} className="flex-1 overflow-y-auto px-4 py-4">
              <section aria-label={t.askQuestions}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  {t.askQuestions}
                </h3>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {PRIMARY_INTENTS.map((intent) => (
                    <button
                      key={intent}
                      type="button"
                      onClick={() => askQuestion(intent, {}, INTENT_LABELS[intent])}
                      className="flex min-h-11 items-center rounded-xl border border-line bg-white px-3 py-2 text-left text-sm font-medium text-ink transition hover:bg-mint hover:text-forest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
                    >
                      {INTENT_LABELS[intent][lang]}
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => askQuestion("unknown", {}, INTENT_LABELS.unknown)}
                    className="flex min-h-11 w-full items-center rounded-xl border border-dashed border-line bg-white px-3 py-2 text-left text-sm font-medium text-ink-soft transition hover:bg-canvas hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
                  >
                    {INTENT_LABELS.unknown[lang]}
                  </button>
                  <button
                    type="button"
                    onClick={askMedical}
                    className="flex min-h-11 w-full items-center rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-left text-sm font-semibold text-danger transition hover:bg-danger hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
                  >
                    {t.askFeelingUnwell}
                  </button>
                </div>
              </section>

              <div
                role="log"
                aria-live="polite"
                aria-label={t.askLogLabel}
                className="mt-4 flex flex-col gap-4"
              >
                {answeredTurns.length === 0 ? (
                  <p className="text-sm text-ink-muted">{t.askEmptyLog}</p>
                ) : (
                  answeredTurns.map((turn) => (
                    <AnswerBubble
                      key={turn.id}
                      turn={turn}
                      lang={lang}
                      t={t}
                      speechSupported={speechSupported}
                      speakingId={speakingId}
                      onSpeak={speak}
                      onOption={onOption}
                    />
                  ))
                )}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-divider px-4 py-3 pb-[max(env(safe-area-inset-bottom),12px)]">
              <button
                type="button"
                onClick={clearConversation}
                disabled={turns.length === 0}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-4 text-sm font-semibold text-ink-soft transition enabled:hover:bg-canvas enabled:hover:text-ink disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
              >
                <Eraser className="h-4 w-4" aria-hidden="true" />
                {t.askClear}
              </button>
              <button
                type="button"
                onClick={closeAssistant}
                className="inline-flex min-h-11 items-center rounded-full bg-forest px-4 text-sm font-semibold text-white transition hover:bg-leaf focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action focus-visible:ring-offset-2"
              >
                {t.askClose}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
