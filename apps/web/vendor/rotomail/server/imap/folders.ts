// Copyright (c) 2026 Rotomic. Licensed under the Apache 2.0 license.
//
// Maps between the app's canonical folder IDs (shared/folders.ts) and real IMAP
// mailbox paths. System folders are identified via the IMAP SPECIAL-USE flags
// that mailcow/Dovecot expose (\Sent \Drafts \Junk \Trash \Archive) plus INBOX;
// any other selectable mailbox is a "custom" folder whose ID is base64url(path)
// — URL-safe and free of ':' so it survives both react-router routes and the
// folder:uidvalidity:uid message-id scheme.

import type { ImapFlow } from "imapflow";
import type { Folder } from "../../app/types";
import {
	Folders,
	getFolderDisplayName,
	SYSTEM_FOLDER_IDS,
} from "../../shared/folders";

const SPECIAL_USE_TO_ID: Record<string, string> = {
	"\\Sent": Folders.SENT,
	"\\Drafts": Folders.DRAFT,
	"\\Junk": Folders.SPAM,
	"\\Trash": Folders.TRASH,
	"\\Archive": Folders.ARCHIVE,
};

// Canonical IDs that map to system mailboxes (sidebar order + spam).
const CANONICAL_IDS = new Set<string>([...SYSTEM_FOLDER_IDS, Folders.SPAM]);

export interface FolderInfo {
	id: string;
	path: string;
	name: string;
}

function encodePathId(path: string): string {
	return Buffer.from(path, "utf8").toString("base64url");
}

function decodePathId(id: string): string {
	return Buffer.from(id, "base64url").toString("utf8");
}

/** Enumerate selectable mailboxes and assign each a stable app folder ID. */
export async function readFolders(client: ImapFlow): Promise<FolderInfo[]> {
	const boxes = await client.list();
	const infos: FolderInfo[] = [];
	for (const box of boxes) {
		if (box.flags?.has("\\Noselect")) continue;
		let id: string;
		if (box.path.toUpperCase() === "INBOX") {
			id = Folders.INBOX;
		} else if (box.specialUse && SPECIAL_USE_TO_ID[box.specialUse]) {
			id = SPECIAL_USE_TO_ID[box.specialUse]!;
		} else {
			id = encodePathId(box.path);
		}
		// First match wins for a canonical ID (avoid duplicate system folders).
		if (CANONICAL_IDS.has(id) && infos.some((i) => i.id === id)) continue;
		infos.push({ id, path: box.path, name: box.name });
	}
	return infos;
}

/** Resolve an app folder ID to its IMAP path, or null if it doesn't exist. */
export function resolveFolderPath(folderId: string, infos: FolderInfo[]): string | null {
	const found = infos.find((i) => i.id === folderId);
	if (found) return found.path;
	// A canonical ID with no matching mailbox means the server lacks that folder.
	if (CANONICAL_IDS.has(folderId)) return null;
	// Otherwise assume it's a base64url-encoded custom path.
	try {
		return decodePathId(folderId) || null;
	} catch {
		return null;
	}
}

async function unseenCount(client: ImapFlow, path: string): Promise<number> {
	try {
		const status = await client.status(path, { unseen: true });
		return status ? (status.unseen ?? 0) : 0;
	} catch {
		return 0;
	}
}

/** Build the Folder[] the frontend expects: system folders first, then custom. */
export async function listFoldersForApi(client: ImapFlow): Promise<Folder[]> {
	const infos = await readFolders(client);
	const result: Folder[] = [];

	const systemOrder = [
		Folders.INBOX,
		Folders.SENT,
		Folders.DRAFT,
		Folders.ARCHIVE,
		Folders.TRASH,
		Folders.SPAM,
	];
	for (const sysId of systemOrder) {
		const info = infos.find((i) => i.id === sysId);
		if (!info) continue;
		result.push({
			id: sysId,
			name: getFolderDisplayName(sysId),
			unreadCount: await unseenCount(client, info.path),
		});
	}

	for (const info of infos) {
		if (CANONICAL_IDS.has(info.id)) continue;
		result.push({
			id: info.id,
			name: info.name,
			unreadCount: await unseenCount(client, info.path),
		});
	}

	return result;
}
