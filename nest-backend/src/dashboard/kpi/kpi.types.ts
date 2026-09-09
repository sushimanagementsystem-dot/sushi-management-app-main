export type StatTotals = { qty: number; cost: number; count: number; uncostedCount: number };

export const emptyStats = (): StatTotals => ({ qty: 0, cost: 0, count: 0, uncostedCount: 0 });
