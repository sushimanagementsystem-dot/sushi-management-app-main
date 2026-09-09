import { Injectable, type CanActivate, type ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ROLES_KEY, type Role } from "../decorators/roles.decorator.js";

// Runs after SessionAuthGuard (request.user is already populated). Routes
// with no @Roles() metadata are unrestricted — role gating stays opt-in
// per action, same as the old backend's inline isOwnerRole_() calls.
@Injectable()
export class RolesGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) {}

    canActivate(context: ExecutionContext): boolean {
        const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (!requiredRoles || requiredRoles.length === 0) return true;

        const request = context.switchToHttp().getRequest();
        const userRole: Role | undefined = request.user?.role;
        if (!userRole || !requiredRoles.includes(userRole)) {
            throw new ForbiddenException("You do not have permission to perform this action.");
        }
        return true;
    }
}
