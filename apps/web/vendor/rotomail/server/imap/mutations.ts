// Copyright (c) 2026 Rotomic. Licensed under the Apache 2.0 license.
//
// IMAP write operations: APPEND (file a Sent copy / save a draft), move, and
// delete. mailcow's Dovecot supports UIDPLUS, so APPEND returns the new UID,
// which we encode back into a folder:uidvalidity:uid message id.

import type { ImapFlow } from "imapflow";
import { encodeMessageId } from "./message-id";

function selectedUidValidity(client: ImapFlow): number | null {
	if (!client.mailbox || typeof client.mailbox === "boolean") return null;
	return Number(client.mailbox.uidValidity);
}

/** APPEND a raw message to a folder; returns its new message id (or null). */
export async function appendMessage(
	client: ImapFlow,
	folderId: string,
	path: string,
	raw: Buffer,
	flags: string[],
): Promise<string | null> {
	const res = await client.append(path, raw, flags);
	if (res && typeof res !== "boolean" && res.uid && res.uidValidity) {
		return encodeMessageId(folderId, res.uidValidity, res.uid);
	}
	return null;
}

/** Move a message to another folder. Returns false on a stale uidvalidity. */
export async function moveMessage(
	client: ImapFlow,
	sourcePath: string,
	uidValidity: number,
	uid: number,
	targetPath: string,
): Promise<boolean> {
	const lock = await client.getMailboxLock(sourcePath);
	try {
		if (selectedUidValidity(client) !== uidValidity) return false;
		await client.messageMove(String(uid), targetPath, { uid: true });
		return true;
	} finally {
		lock.release();
	}
}

/**
 * Delete a message. Already in Trash (or no Trash configured) -> permanent
 * expunge; otherwise move to Trash, matching user expectations.
 */
export async function deleteMessage(
	client: ImapFlow,
	sourcePath: string,
	uidValidity: number,
	uid: number,
	trashPath: string | null,
): Promise<boolean> {
	const lock = await client.getMailboxLock(sourcePath);
	try {
		if (selectedUidValidity(client) !== uidValidity) return false;
		if (!trashPath || sourcePath === trashPath) {
			await client.messageDelete(String(uid), { uid: true });
		} else {
			await client.messageMove(String(uid), trashPath, { uid: true });
		}
		return true;
	} finally {
		lock.release();
	}
}
