import { Injectable, type NestInterceptor, type ExecutionContext, type CallHandler } from "@nestjs/common";
import { map, type Observable } from "rxjs";

/**
 * Wraps every successful controller return value into the flat
 * `{ok: true, ...}` envelope frontend-next already expects from the old
 * Apps Script backend (see lib/api.js's apiCall — it reads `out.ok` and,
 * when present, `out.sessionToken` for the 30-day sliding refresh, which
 * SessionAuthGuard stashes on the request as `refreshedSessionToken`).
 * Controllers just return their plain result object — this is the one
 * place the envelope shape lives, so it can't drift between routes.
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        const request = context.switchToHttp().getRequest();
        return next.handle().pipe(
            map((data) => ({
                ok: true,
                ...(request.refreshedSessionToken ? { sessionToken: request.refreshedSessionToken } : {}),
                ...(data ?? {}),
            })),
        );
    }
}
