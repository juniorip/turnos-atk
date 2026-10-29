/** A preferential ticket behaves as if it arrived 30 minutes earlier. */
export const PREFERENTIAL_PRIORITY_ADVANCE_MS = 30 * 60 * 1000;

export type QueueOrderTicket = {
  id: number;
  arrivedAt: Date;
  isPreferential: boolean;
};

/**
 * Sort by effective arrival time so preferential tickets get a 30-minute
 * head start while an older regular ticket can still move ahead of newer ones.
 */
export function sortTicketsForCall<T extends QueueOrderTicket>(tickets: T[]): T[] {
  return [...tickets].sort((a, b) => {
    const effectiveArrivalA = a.arrivedAt.getTime() - (a.isPreferential ? PREFERENTIAL_PRIORITY_ADVANCE_MS : 0);
    const effectiveArrivalB = b.arrivedAt.getTime() - (b.isPreferential ? PREFERENTIAL_PRIORITY_ADVANCE_MS : 0);
    return effectiveArrivalA - effectiveArrivalB
      || Number(b.isPreferential) - Number(a.isPreferential)
      || a.arrivedAt.getTime() - b.arrivedAt.getTime()
      || a.id - b.id;
  });
}
