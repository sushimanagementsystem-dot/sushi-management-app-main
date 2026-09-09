import { Body, Controller, Post } from "@nestjs/common";
import { AuthService } from "./auth.service.js";
import { LoginDto } from "./dto/login.dto.js";
import { Public } from "../common/decorators/public.decorator.js";
import { CurrentUser } from "../common/decorators/current-user.decorator.js";
import type { AuthenticatedUser } from "./auth.types.js";

// Route paths double as the old backend's `action` names — frontend-next's
// apiCall(action, data) only needs its URL templated with the action as a
// path segment (BACKEND_URL -> `${BACKEND_URL}/${action}`), not rewritten
// call-site by call-site. See src/auth/auth.service.ts for the "why".
@Controller()
export class AuthController {
    constructor(private readonly authService: AuthService) {}

    @Public()
    @Post("login")
    async login(@Body() dto: LoginDto) {
        const { user, sessionToken } = await this.authService.login(dto.idToken);
        return { sessionToken, role: user.role, name: user.name };
    }

    // Session-gated (default — no @Public()). Purely a UX check for the
    // frontend's requireRole() gate; every real data action re-verifies
    // role server-side on its own regardless of what this returns.
    @Post("whoami")
    whoami(@CurrentUser() user: AuthenticatedUser) {
        return { role: user.role, name: user.name };
    }
}
