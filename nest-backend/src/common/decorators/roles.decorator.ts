import { SetMetadata } from "@nestjs/common";

// User.role values — see backend/core/Config.js ROLES in the old system.
export type Role = "DEVELOPER" | "ADMIN" | "STAFF";

export const ROLES_KEY = "roles";

// Applied per-route, exactly like the old system's inline isOwnerRole_()
// calls — deliberately opt-in per action rather than a blanket default, so
// it's obvious from the controller which actions are owner-only.
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
