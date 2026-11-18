/** Slot numbers are fixed to the odd digits (rule R1, decided). */
export const SLOT_NUMBERS = [1, 3, 5, 7, 9] as const;
export type SlotNumber = (typeof SLOT_NUMBERS)[number];

/** Maps a book page to the slot it selects, or null for an even last digit. */
export function slotForPage(page: number): SlotNumber | null {
  const digit = page % 10;
  return (SLOT_NUMBERS as readonly number[]).includes(digit) ? (digit as SlotNumber) : null;
}
