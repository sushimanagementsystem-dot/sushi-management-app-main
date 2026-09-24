import type { Kiosk, Prisma, Submission } from "@prisma/client";

export type ValidationResult = { valid: true } | { valid: false; message: string };

export type ProcessingContext<TPayload = unknown> = {
    submission: Submission;
    kiosk: Kiosk;
    payload: TPayload;
    businessDate: Date;
    /** Mutated by the processor as it goes — included in the error log if it throws. */
    stage: string;
    /** Free-form bag a processor can stash data in during process() for
     * afterCommit() to read back (e.g. a computed plan that's expensive/
     * stateful to recompute) — same ctx object instance is passed to both,
     * never persisted, never logged. */
    extra: Record<string, unknown>;
};

export type KeyContext<TPayload = unknown> = {
    kiosk: Kiosk;
    payload: TPayload;
    businessDate: Date;
    userId: string | null;
};

/**
 * One implementation per FORM_TYPE — direct equivalent of the registry
 * entries in backend/api/Pipeline.js's getProcessors_(). Registered as a
 * keyed provider array (SUBMISSION_PROCESSORS token, see pipeline.module)
 * so adding a form type means adding a class, not editing a shared
 * dispatcher or switch statement.
 */
export interface SubmissionProcessor<TPayload = unknown> {
    readonly formType: string;

    /**
     * Tables this processor writes, used to clear a prior attempt's rows
     * on resubmit (same processing_key). Defaults to matching on
     * `submission_id`; set `viaSourceSubmission: true` for tables that
     * link back via `source_submission_id` instead (only owner_action
     * today — see backend/api/Pipeline.js's processSubmission_).
     */
    readonly tables: { model: string; viaSourceSubmission?: boolean }[];

    /** Stable identity of the logical event — same across retries/resubmits/corrections. */
    buildKey(ctx: KeyContext<TPayload>): string;

    /** Cheap payload-only check at intake — no DB reads, shown to staff directly on failure. */
    validate(payload: unknown): ValidationResult;

    /**
     * Optional transform applied to the payload before intake stores it —
     * async because it may do real I/O (photo upload), unlike the old
     * Apps Script version's synchronous UrlFetchApp/DriveApp calls.
     */
    prepareIntake?(payload: unknown, kiosk: Kiosk): Promise<TPayload> | TPayload;

    /**
     * Runs before the generic per-table clear, for tables needing custom
     * cascade logic (e.g. deleting audit_answer rows via their parent
     * audit_response, which isn't itself keyed by submission_id) — or to
     * BLOCK the resubmit entirely by throwing, once an owner has already
     * acted on the prior attempt (see WeeklyStocktakeProcessor/
     * MonthlyAuditProcessor). Receives the prior submission_ids sharing
     * this processing_key.
     */
    clearExtra?(tx: Prisma.TransactionClient, oldSubmissionIds: string[]): Promise<void>;

    /**
     * Runs BEFORE the transaction opens, for slow network I/O whose result
     * process() needs (e.g. an AI vision call) — Prisma's interactive
     * transactions expire after 5s by default, so anything that can take
     * longer than a database query must never run inside process(). Stash
     * the result in ctx.extra; process() then only writes it. May throw —
     * the submission is marked ERROR for manual retry, same as process().
     * Must be safe to run again on a retry (nothing is written here).
     */
    prepare?(ctx: ProcessingContext<TPayload>): Promise<void>;

    /**
     * Does the real work. Runs inside the sweep's transaction — a thrown
     * error rolls back cleanly and the submission is marked ERROR for
     * manual retry. May return a processing_status override (e.g.
     * "PROCESSED_WITH_WARNING"); defaults to "PROCESSED".
     */
    process(tx: Prisma.TransactionClient, ctx: ProcessingContext<TPayload>): Promise<string | void>;

    /**
     * Runs after the transaction from process() has already committed —
     * for real I/O (network calls like sending email) that must never hold
     * a DB transaction open. Same ctx object passed to process(), so
     * anything stashed in ctx.extra there is readable here. May return a
     * processing_status override (e.g. downgrading "PROCESSED" to
     * "PROCESSED_WITH_WARNING" if the I/O fails) — the data write already
     * succeeded either way, so a failure here must never flip the
     * submission to ERROR.
     */
    afterCommit?(ctx: ProcessingContext<TPayload>): Promise<{ status?: string } | void>;
}

export const SUBMISSION_PROCESSORS = Symbol("SUBMISSION_PROCESSORS");
