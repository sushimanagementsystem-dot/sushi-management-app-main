export type UserHistoryCounts = {
    submissions: number;
    transfers: number;
    staffFood: number;
    requests: number;
    weeklySales: number;
    auditCorrections: number;
    assignedActions: number;
    activity: number;
};

const LABELS: [keyof UserHistoryCounts, string, string][] = [
    ["submissions", "form submission", "form submissions"],
    ["transfers", "stock transfer", "stock transfers"],
    ["staffFood", "staff food record", "staff food records"],
    ["requests", "request", "requests"],
    ["weeklySales", "weekly sales entry", "weekly sales entries"],
    ["auditCorrections", "audit correction", "audit corrections"],
    ["assignedActions", "assigned inbox action", "assigned inbox actions"],
    ["activity", "activity log entry", "activity log entries"],
];

/**
 * Why a staff member can NOT be deleted, in words an owner can act on — or null if they can. History blocks it
 * because deleting a person clears the "who" on everything they did; switching Active off keeps that history and
 * still stops them signing in.
 */
export function explainUserBlockers(
    person: { name: string; role: string; active: boolean; isSelf: boolean; otherActiveAdmins: number },
    history: UserHistoryCounts,
): string | null {
    if (person.isSelf) return "You can't delete your own account. Ask another admin to do it.";
    if (person.role === "ADMIN" && person.active && person.otherActiveAdmins === 0) return "This is the last active admin. Add or activate another admin before deleting them.";
    const parts = LABELS.filter(([k]) => history[k] > 0).map(([k, one, many]) => `${history[k]} ${history[k] === 1 ? one : many}`);
    if (!parts.length) return null;
    return `${person.name} can't be deleted because the system has their history (${parts.join(", ")}), and deleting them would erase who did that work. Set them to inactive instead: they can no longer sign in, their history stays, and they move to the bottom of the list.`;
}
