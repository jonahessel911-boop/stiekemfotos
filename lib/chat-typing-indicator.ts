import type { ChatMessage } from "@/lib/types/chat";

export type TypingEvent = NonNullable<ChatMessage["typingEvents"]>[number];

/**
 * Plant timers op basis van server `typingEvents` (startedAt / stoppedAt / sent).
 * Roept `onVisible` alleen aan tijdens echte typ-fasen, niet tijdens stilte ertussen.
 */
export function scheduleTypingIndicatorFromEvents(
  events: TypingEvent[] | undefined,
  onVisible: (visible: boolean) => void
): () => void {
  const list = (events ?? []).filter((e) => e.startedAt);
  if (list.length === 0) {
    onVisible(false);
    return () => {};
  }

  const base = new Date(list[0]!.startedAt).getTime();
  const timers: ReturnType<typeof setTimeout>[] = [];
  let visible = false;

  const set = (next: boolean) => {
    if (visible === next) return;
    visible = next;
    onVisible(next);
  };

  for (const ev of list) {
    const startMs = Math.max(0, new Date(ev.startedAt).getTime() - base);
    timers.push(
      setTimeout(() => {
        set(true);
      }, startMs)
    );
    if (ev.stoppedAt) {
      const stopMs = Math.max(0, new Date(ev.stoppedAt).getTime() - base);
      timers.push(
        setTimeout(() => {
          set(false);
        }, stopMs)
      );
    }
    if (ev.sent) {
      const sentMs = Math.max(0, new Date(ev.startedAt).getTime() - base);
      timers.push(
        setTimeout(() => {
          set(false);
        }, sentMs)
      );
    }
  }

  const endMs = list.reduce((max, ev) => {
    const candidates = [new Date(ev.startedAt).getTime()];
    if (ev.stoppedAt) candidates.push(new Date(ev.stoppedAt).getTime());
    return Math.max(max, ...candidates);
  }, base);
  timers.push(
    setTimeout(() => {
      set(false);
    }, Math.max(0, endMs - base) + 80)
  );

  return () => {
    for (const t of timers) clearTimeout(t);
    set(false);
  };
}
