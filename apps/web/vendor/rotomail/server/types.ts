// Copyright (c) 2026 Rotomic. Licensed under the Apache 2.0 license.

import type { Account } from "./accounts";

/**
 * Hono environment. `session` is attached by requireApiAuth; `account` is the
 * specific signed-in account resolved from the :mailboxId on per-mailbox routes.
 */
export interface AppEnv {
	Variables: {
		session: { sid: string; accounts: Account[] };
		account: Account;
	};
}
