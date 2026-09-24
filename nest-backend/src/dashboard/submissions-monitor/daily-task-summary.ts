export type DailyTaskSummary = {
    /** Finished days in the range — today is left out, it isn't over and can still be completed. */
    daysCounted: number;
    /** Finished days on which at least one DAILY task (never an "as needed" / scheduled form) was not submitted. */
    daysWithGap: number;
    tasksDone: number;
    tasksExpected: number;
    /** 0-100, whole number; 0 when there are no finished days yet. */
    completionPct: number;
};

type DayStatus = { date: string; kiosks: Record<string, Record<string, boolean>> };

/**
 * The single definition of "day with a gap" for the All Submissions page:
 * a finished day on which the kiosk missed any of the DAILY tasks — the same
 * three forms the kiosk home menu lists under "Complete each of these tasks
 * every day". Forms without a daily expectation can never create a gap, so a
 * kiosk that did every daily task is a clean day however few other forms it sent.
 */
export function summarizeDailyTasks(days: DayStatus[], kioskId: string, dailyTasks: readonly string[], todayStr: string): DailyTaskSummary {
    let daysCounted = 0;
    let daysWithGap = 0;
    let tasksDone = 0;
    for (const day of days) {
        if (day.date >= todayStr) continue;
        const status = day.kiosks[kioskId] ?? {};
        const done = dailyTasks.filter((t) => status[t]).length;
        daysCounted += 1;
        tasksDone += done;
        if (done < dailyTasks.length) daysWithGap += 1;
    }
    const tasksExpected = daysCounted * dailyTasks.length;
    return { daysCounted, daysWithGap, tasksDone, tasksExpected, completionPct: tasksExpected > 0 ? Math.round((tasksDone / tasksExpected) * 100) : 0 };
}
