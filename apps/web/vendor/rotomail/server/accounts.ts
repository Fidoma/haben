// Copyright (c) 2026 Rotomic. Licensed under the Apache 2.0 license.
//
// Pure helpers for the list of signed-in accounts carried in a session.
// Accounts are keyed by email (case-insensitive); re-adding an email updates
// its stored credential (handy when a re-login refreshes a changed password or
// a fresh OAuth token set).
//
// An account carries exactly one credential, depending on AUTH_MODE:
//   - password mode: `password` (mailbox password or, recommended, an app
//     password). App passwords are just passwords on the wire — nothing here
//     treats them specially.
//   - oidc mode: `oauth` tokens, used for XOAUTH2 binds. No password is stored.

export interface OAuthTokens {
	accessToken: string;
	/** Absent if the provider issued no refresh token (no offline_access). */
	refreshToken?: string;
	/** Epoch milliseconds at which the access token expires. */
	expiresAt: number;
}

export interface Account {
	email: string;
	displayName?: string;
	saveDisplayName?: (name: string) => Promise<void>;
	username?: string;
	password?: string;
	imap?: { host: string; servername?: string; port: number; secure: boolean };
	smtp?: { host: string; servername?: string; port: number; secure: boolean; username?: string; password?: string };
	oauth?: OAuthTokens;
}

function sameEmail(a: string, b: string): boolean {
	return a.toLowerCase() === b.toLowerCase();
}

/** True for an OAuth-backed account (oidc mode), false for a password account. */
export function isOAuthAccount(account: Account): account is Account & { oauth: OAuthTokens } {
	return account.oauth !== undefined;
}

/**
 * Whether an OAuth access token is expired or close enough to expiry that it
 * should be refreshed before use. `skewMs` guards against using a token that
 * dies mid-request. Pure (takes the clock) so it's trivially testable.
 */
export function tokenNeedsRefresh(tokens: OAuthTokens, now: number, skewMs = 120_000): boolean {
	return tokens.expiresAt - now <= skewMs;
}

export function findAccount(accounts: Account[], email: string): Account | undefined {
	return accounts.find((a) => sameEmail(a.email, email));
}

export function addAccount(accounts: Account[], account: Account): Account[] {
	const without = accounts.filter((a) => !sameEmail(a.email, account.email));
	const existing = accounts.find((a) => sameEmail(a.email, account.email));
	// Preserve original position when updating; append when new.
	if (existing) {
		return accounts.map((a) => (sameEmail(a.email, account.email) ? account : a));
	}
	return [...without, account];
}

export function removeAccount(accounts: Account[], email: string): Account[] {
	return accounts.filter((a) => !sameEmail(a.email, email));
}
