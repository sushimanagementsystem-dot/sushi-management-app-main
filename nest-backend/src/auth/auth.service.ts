import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { OAuth2Client } from "google-auth-library";
import { PrismaService } from "../prisma/prisma.service.js";
import { TableCacheService } from "../reference-data/table-cache.service.js";
import type { AuthenticatedUser, SessionJwtPayload } from "./auth.types.js";
import type { User } from "@prisma/client";

const SESSION_TTL = "30d"; // sliding — reissued on every successful verify, see verifySession()

@Injectable()
export class AuthService {
    private readonly googleClient: OAuth2Client;

    constructor(
        private readonly prisma: PrismaService,
        private readonly jwt: JwtService,
        private readonly config: ConfigService,
        private readonly tableCache: TableCacheService,
    ) {
        this.googleClient = new OAuth2Client(this.config.getOrThrow<string>("GOOGLE_CLIENT_ID"));
    }

    /**
     * Exchanges a short-lived Google ID token for our own session token.
     * Mirrors backend/core/Auth.js: unknown emails are auto-registered as
     * an inactive STAFF row (an owner must flip them active from the
     * Settings/Users dashboard page) rather than rejected outright.
     */
    async login(idToken: string): Promise<{ user: AuthenticatedUser; sessionToken: string }> {
        const email = (await this.verifyGoogleIdToken(idToken)).trim().toLowerCase();

        // Case-insensitive: an email stored as "Jane@Gmail.com" (typed by an
        // owner before Data Tables started lowercasing them) must still match
        // Google's lowercase one, or a duplicate inactive row gets created
        // next to the real one and that person can't sign in.
        const findByEmail = async () => (await this.tableCache.getAll<User>("user")).find((u) => u.email.trim().toLowerCase() === email);
        let user = await findByEmail();
        if (!user) {
            try {
                user = await this.prisma.user.create({
                    data: { user_id: crypto.randomUUID(), name: email.split("@")[0]!, email, role: "STAFF", active: false },
                });
            } catch (err) {
                // Two first sign-ins with the same new email at once: the other
                // request created the row between our lookup and our insert.
                if ((err as { code?: string }).code !== "P2002") throw err;
                this.tableCache.invalidate("user");
                user = await findByEmail();
                if (!user) throw err;
            }
            // A second write path into `user` besides DataTablesService
            // (owner Staff-tab edits) — this one must invalidate too.
            this.tableCache.invalidate("user");
        }
        if (!user.active) {
            throw new UnauthorizedException("Account is not active yet — ask an owner to enable it.");
        }

        return { user: toAuthenticatedUser(user), sessionToken: this.mintSessionToken(user.user_id) };
    }

    /**
     * Re-verifies on every call (not just at login) and re-checks the user
     * is still active — the old system's own stated rule. Always reissues
     * a fresh token so the 30-day expiry keeps sliding forward as long as
     * the user keeps using the app. Runs on nearly every request in the
     * system, so this reads the shared user cache rather than a live
     * query — an owner deactivating/promoting someone via Data Tables
     * still takes effect on that user's very next request, since that
     * write invalidates the same cache (see DataTablesService.invalidateFor).
     */
    async verifySession(token: string): Promise<{ user: AuthenticatedUser; refreshedToken: string }> {
        let payload: SessionJwtPayload;
        try {
            payload = this.jwt.verify<SessionJwtPayload>(token);
        } catch {
            throw new UnauthorizedException("Invalid or expired session.");
        }

        const users = await this.tableCache.getAll<User>("user");
        const user = users.find((u) => u.user_id === payload.sub);
        if (!user || !user.active) {
            throw new UnauthorizedException("Session is no longer valid.");
        }

        return { user: toAuthenticatedUser(user), refreshedToken: this.mintSessionToken(user.user_id) };
    }

    private mintSessionToken(userId: string): string {
        return this.jwt.sign({ sub: userId } satisfies SessionJwtPayload, { expiresIn: SESSION_TTL });
    }

    private async verifyGoogleIdToken(idToken: string): Promise<string> {
        try {
            const ticket = await this.googleClient.verifyIdToken({
                idToken,
                audience: this.config.getOrThrow<string>("GOOGLE_CLIENT_ID"),
            });
            const email = ticket.getPayload()?.email;
            if (!email) throw new Error("Google token had no email");
            return email;
        } catch {
            throw new UnauthorizedException("Invalid Google sign-in.");
        }
    }
}

function toAuthenticatedUser(user: { user_id: string; name: string; email: string; role: string }): AuthenticatedUser {
    return { user_id: user.user_id, name: user.name, email: user.email, role: user.role as AuthenticatedUser["role"] };
}
