// Copyright (c) 2026 Rotomic. Licensed under the Apache 2.0 license.
//
// IMAP has no native thread id. A message's thread root is its first
// References entry (else In-Reply-To, else its own Message-ID), set as
// thread_id in augmentWithSource. To assemble a thread we SEARCH the main
// folders for messages whose Message-ID / References / In-Reply-To contain
// that root — covering the original plus every reply, across Inbox and Sent.

import type { ImapFlow } from "imapflow";
import type { Email } from "../../app/types";
import { Folders } from "../../shared/folders";
import { resolveFolderPath, type FolderInfo } from "./folders";
import { augmentWithSource, ENVELOPE_QUERY, type FetchedMessage, mapToEmail } from "./messages";

const THREAD_FOLDERS: string[] = [Folders.INBOX, Folders.SENT, Folders.ARCHIVE, Folders.DRAFT];

function threadCriteria(threadId: string): Record<string, unknown> {
	return {
		or: [
			{ header: { "message-id": threadId } },
			{ header: { references: threadId } },
			{ header: { "in-reply-to": threadId } },
		],
	};
}

/** All messages in a thread (with bodies), oldest first. */
export async function getThreadMessages(
	client: ImapFlow,
	infos: FolderInfo[],
	threadId: string,
): Promise<Email[]> {
	const out: Email[] = [];
	for (const fid of THREAD_FOLDERS) {
		const path = resolveFolderPath(fid, infos);
		if (!path) continue;
		const lock = await client.getMailboxLock(path);
		try {
			const uidValidity =
				client.mailbox && typeof client.mailbox !== "boolean" ? client.mailbox.uidValidity : 0;
			const uids = (await client.search(threadCriteria(threadId), { uid: true })) || [];
			if (!uids.length) continue;
			for await (const msg of client.fetch(uids, { ...ENVELOPE_QUERY, source: true }, { uid: true })) {
				const email = mapToEmail(fid, uidValidity, msg as unknown as FetchedMessage);
				await augmentWithSource(email, (msg as unknown as { source: Buffer }).source);
				out.push(email);
			}
		} finally {
			lock.release();
		}
	}
	out.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
	return out;
}

/** Mark every message in a thread as \Seen across the searched folders. */
export async function markThreadRead(
	client: ImapFlow,
	infos: FolderInfo[],
	threadId: string,
): Promise<void> {
	for (const fid of THREAD_FOLDERS) {
		const path = resolveFolderPath(fid, infos);
		if (!path) continue;
		const lock = await client.getMailboxLock(path);
		try {
			const uids = (await client.search(threadCriteria(threadId), { uid: true })) || [];
			if (uids.length) await client.messageFlagsAdd(uids, ["\\Seen"], { uid: true });
		} finally {
			lock.release();
		}
	}
}
