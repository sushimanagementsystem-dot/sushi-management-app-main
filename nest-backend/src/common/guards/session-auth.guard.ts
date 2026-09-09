import { Injectable, type CanActivate, type ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthService } from "../../auth/auth.service.js";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator.js";

// Registered globally (see app.module.ts's APP_GUARD provider) so every
// route is session-gated by default — @Public() opts a route out, matching
// the old backend's short allow-list (login, kiosk_info, kiosk-token
// routes) rather than requiring every controller to remember to add this.
@Injectable()
export class SessionAuthGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly authService: AuthService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (isPublic) return true;

        const request = context.switchToHttp().getRequest();
        const token: unknown = request.body?.sessionToken;
        if (typeof token !== "string" || !token) {
            throw new UnauthorizedException("Missing session token.");
        }

        const { user, refreshedToken } = await this.authService.verifySession(token);
        request.user = user;
        request.refreshedSessionToken = refreshedToken;
        return true;
    }
}
