import { SetMetadata } from "@nestjs/common";

// Marks a route as not requiring a session (mirrors the old backend's
// short allow-list: login, whoami's own login step, kiosk_info, and the
// kiosk-token-gated bootstrap_*/submit routes, which authenticate via
// KioskTokenGuard instead — see backend/core/Auth.js's session-bypass note).
export const IS_PUBLIC_KEY = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
