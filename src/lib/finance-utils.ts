/**
 * Normalizes a description by converting to lowercase and removing all spaces and special characters.
 */
export function normalizeDescription(description: string): string {
  if (!description) return '';
  return description
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Generates a unique key for a transaction based on date, amount, and normalized description.
 * Format: YYYY-MM-DD_AMOUNT_NORMALIZEDDESCRIPTION
 */
export function generateTransactionKey(date: string, amount: number, description: string): string {
  const normalizedDate = date.split('T')[0]; // Ensure only YYYY-MM-DD
  const normalizedDesc = normalizeDescription(description);
  return `${normalizedDate}_${Math.abs(amount)}_${normalizedDesc}`;
}

/**
 * Checks if two transactions are a potential match based on amount tolerance,
 * description similarity, and date range.
 */
export function isPotentialMatch(
  tx1: { amount: number; description: string; date: string },
  tx2: { amount: number; description: string; date: string },
  options = { amountTolerance: 50, daysTolerance: 3 }
): boolean {
  // 1. Amount check (within tolerance)
  const amountDiff = Math.abs(Math.abs(tx1.amount) - Math.abs(tx2.amount));
  if (amountDiff > options.amountTolerance) return false;

  // 2. Date check (within tolerance)
  const d1 = new Date(tx1.date).getTime();
  const d2 = new Date(tx2.date).getTime();
  const daysDiff = Math.abs(d1 - d2) / (1000 * 60 * 60 * 24);
  if (daysDiff > options.daysTolerance) return false;

  // 3. Description check (normalized similarity)
  const n1 = normalizeDescription(tx1.description);
  const n2 = normalizeDescription(tx2.description);
  
  // If one contains the other or they are very similar
  if (n1.includes(n2) || n2.includes(n1)) return true;

  return false;
}
