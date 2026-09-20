import { friendlyDbError } from "./prisma-error.js";
import { Catch, HttpException, HttpStatus, Logger, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";

/**
 * Mirrors the success envelope's shape on the failure path: frontend-next
 * reads `res.ok` (false) and `res.error` (a display string) — see
 * lib/api.js and e.g. app/login/page.js's `loginMutation.data.error`.
 * Kept as a plain HTTP-status response (not always 200) since that's more
 * correct than the old Apps Script backend's always-200-with-ok:false
 * convention, and React Query / fetch callers here only ever read the
 * parsed JSON body, never the status code, for this codebase's error UX.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger("UnhandledException");

    catch(exception: unknown, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse();

        // A known database rejection (duplicate value, missing reference, DB
        // unreachable, ...) gets a plain-language message the user can act on
        // instead of "Something went wrong." — still logged below.
        const db = exception instanceof HttpException ? null : friendlyDbError(exception);
        const status = exception instanceof HttpException ? exception.getStatus() : (db?.status ?? HttpStatus.INTERNAL_SERVER_ERROR);
        const message = exception instanceof HttpException ? extractMessage(exception) : (db?.message ?? "Something went wrong.");

        // A 4xx from a deliberate HttpException (validation, not found, ...)
        // is expected, everyday traffic — not logged. Anything else is a
        // real bug and would otherwise vanish with zero trace, as one just
        // did during testing (a client-visible "Something went wrong."
        // with nothing in this log to find it from).
        if (!(exception instanceof HttpException)) {
            this.logger.error(exception instanceof Error ? exception.stack : String(exception));
        }

        response.status(status).json({ ok: false, error: message });
    }
}

function extractMessage(exception: HttpException): string {
    const body = exception.getResponse();
    if (typeof body === "string") return body;
    if (body && typeof body === "object" && "message" in body) {
        const msg = (body as { message: unknown }).message;
        return Array.isArray(msg) ? msg.join(" ") : String(msg);
    }
    return exception.message;
}
