/**
 * Spraakbericht-natuurlijker voor xAI TTS: pauzes, lichte lach-tags, geen emoji.
 * Doel: dichter bij een echt voice note (adem, pauzes) — zacht/ASMR-achtig door
 * korte zinnen en [pause]; geen meta-zinnen die hardop gelezen worden.
 */

function injectLaughTags(t: string): string {
  if (/\[laugh\]/i.test(t)) return t;
  let s = t;
  s = s.replace(/\bhihi\b/i, "hihi [laugh]");
  s = s.replace(/\bhah\b(?!\w)/i, "hah [laugh]");
  s = s.replace(/\bhee\b/i, "hee [laugh]");
  return s;
}

/** Meer pauzes = intiemer / "dicht bij de mic" gevoel (TTS blijft normale stem; voice_id via XAI_TTS_VOICE). */
export function textForExpressiveTts(visibleText: string): string {
  let t = visibleText.replace(/[\u{1F300}-\u{1F9FF}]/gu, "").trim();
  t = t.replace(/\s+/g, " ");
  if (!t) return visibleText.trim();

  t = t.replace(/\.\.\./g, " [pause] ");
  t = t.replace(/\s+—\s+/g, " [pause] ");

  const parts = t.split(/(?<=[.!?…])\s+/).filter(Boolean);
  if (parts.length >= 2) {
    t = parts.join(" [pause] ");
  } else if (t.length > 52) {
    const cut = t.indexOf(" ", 36);
    if (cut !== -1) {
      t = `${t.slice(0, cut)} [pause] ${t.slice(cut + 1)}`.trim();
    }
  }

  const commaIdx = t.indexOf(", ");
  if (commaIdx !== -1 && commaIdx > 12 && commaIdx < t.length * 0.65) {
    t = `${t.slice(0, commaIdx + 2)}[pause] ${t.slice(commaIdx + 2)}`;
  }

  t = injectLaughTags(t);

  const m = t.match(/^(.+?[.!?…])(\s+.+)$/);
  if (m && !t.includes("[pause]")) {
    t = `${m[1]} [pause] ${m[2]}`.trim();
  }

  if (t.length > 18 && !/^\[pause\]/i.test(t)) {
    t = `[pause] ${t}`;
  }

  return t;
}
