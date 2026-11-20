// Copyright (c) 2026 Rotomic. Licensed under the Apache 2.0 license.
//
// Central runtime configuration, sourced from environment variables.
// Bun auto-loads `.env`, so these are populated from .env in dev and from
// the container environment in prod. See .env.example for the full list.

function str(name: string, fallback?: string): string {
	const v = process.env[name];
	if (v === undefined || v === "") {
		if (fallback !== undefined) return fallback;
		throw new Error(
			`Missing required environment variable ${name}. See .env.example.`,
		);
	}
	return v;
}

function num(name: string, fallback: number): number {
	const v = process.env[name];
	if (v === undefined || v === "") return fallback;
	const n = Number(v);
	if (Number.isNaN(n)) throw new Error(`Environment variable ${name} must be a number, got "${v}".`);
	return n;
}

function bool(name: string, fallback: boolean): boolean {
	const v = process.env[name];
	if (v === undefined || v === "") return fallback;
	return v === "true" || v === "1";
}

const isProduction = process.env.NODE_ENV === "production";

// Session secret must be long enough for iron-webcrypto (>= 32 chars).
const sessionSecret = str("SESSION_SECRET", "haben-webmail-uses-the-existing-session");
if (sessionSecret.length < 32) {
	throw new Error("SESSION_SECRET must be at least 32 characters long.");
}

const imapHost = str("IMAP_HOST", "localhost");

// How users authenticate. "password" (default) binds to IMAP/SMTP with a
// password (the user's mailbox password or, recommended, a per-app password).
// "oidc" authenticates the user via an OpenID Connect provider and binds to the
// mail server with the resulting OAuth access token (XOAUTH2) — so no password
// is ever stored. OIDC mode requires an OAuth-capable mail backend (e.g. mailcow
// with OIDC, Gmail, Office 365) wired to the same issuer.
const authMode = str("AUTH_MODE", "password").toLowerCase();
if (authMode !== "password" && authMode !== "oidc") {
	throw new Error(`AUTH_MODE must be "password" or "oidc", got "${authMode}".`);
}

// OIDC settings are only required (and only validated) in oidc mode.
const oidc =
	authMode === "oidc"
		? {
				issuer: str("OIDC_ISSUER").replace(/\/$/, ""),
				clientId: str("OIDC_CLIENT_ID"),
				clientSecret: str("OIDC_CLIENT_SECRET"),
				redirectUri: str("OIDC_REDIRECT_URI"),
				// offline_access asks the provider for a refresh token; without one
				// the session can't outlive the access token's short lifetime.
				scopes: str("OIDC_SCOPES", "openid email offline_access"),
				// Claim on the userinfo/id_token holding the mailbox address.
				emailClaim: str("OIDC_EMAIL_CLAIM", "email"),
			}
		: null;

export const config = {
	authMode: authMode as "password" | "oidc",
	oidc,
	isProduction,
	port: num("PORT", 3000),
	// Interface to bind. 0.0.0.0 exposes the server on all interfaces (LAN /
	// container); set to 127.0.0.1 to restrict to localhost only.
	host: str("HOST", "0.0.0.0"),

	imap: {
		host: imapHost,
		port: num("IMAP_PORT", 993),
		secure: bool("IMAP_SECURE", true), // 993 implicit TLS (mailcow default)
	},

	smtp: {
		host: str("SMTP_HOST", imapHost), // mailcow serves both on the same host
		port: num("SMTP_PORT", 587),
		secure: bool("SMTP_SECURE", false), // 587 STARTTLS (secure:false + requireTLS)
	},

	// Shared TLS posture for IMAP + SMTP. mailcow ships valid Let's Encrypt
	// certs, so this defaults to strict; set false only for self-signed.
	tls: {
		rejectUnauthorized: bool("MAIL_TLS_REJECT_UNAUTHORIZED", true),
	},

	// Domains advertised by GET /api/v1/config.
	domains: str("DOMAINS", "")
		.split(",")
		.map((d) => d.trim())
		.filter(Boolean),

	sessionSecret,
	// httpOnly cookie flags. Secure cookies require HTTPS; default on in prod,
	// off in dev so the cookie works over plain http://localhost.
	cookieSecure: bool("COOKIE_SECURE", isProduction),
	cookieName: "rotomail_session",

	// Idle IMAP connections are reaped after this long.
	sessionIdleMs: num("SESSION_IDLE_MS", 5 * 60 * 1000),

	// Threaded folder view groups the most recent N messages into conversations.
	// Older messages aren't grouped (reachable via search). Bounds the per-page
	// header fetch cost. Raise for deeper history at the cost of slower lists.
	threadListWindow: num("THREAD_LIST_WINDOW", 400),
} as const;

export type AppConfig = typeof config;
