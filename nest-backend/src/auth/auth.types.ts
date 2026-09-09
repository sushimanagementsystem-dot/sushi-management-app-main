import type { Role } from "../common/decorators/roles.decorator.js";

export type AuthenticatedUser = {
    user_id: string;
    name: string;
    email: string;
    role: Role;
};

// Payload signed into the session JWT — kept minimal (just the id); the
// guard always re-loads the user row fresh so role/active changes take
// effect immediately, matching the old system's "re-verify on every call,
// not just at login" rule (see CLAUDE.md's Auth model section).
export type SessionJwtPayload = {
    sub: string; // user_id
};
