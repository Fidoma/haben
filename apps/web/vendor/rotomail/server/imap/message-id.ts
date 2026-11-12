// Copyright (c) 2026 Rotomic. Licensed under the Apache 2.0 license.
//
// Hazard #1 from the design doc: the frontend assumes a stable string `id` per
// message, but IMAP only gives a UID that is unique within one folder and valid
// for a given UIDVALIDITY (and changes on move). So a message id is the triple
// `folder:uidvalidity:uid`, decoded on every route. Move returns a NEW id.
//
// The folder component may itself contain ':' or '/' (custom folder paths), so
// we parse the two trailing numeric components from the right and treat
// everything before them as the folder id.

export interface DecodedMessageId {
	folderId: string;
	uidValidity: number;
	uid: number;
}

export function encodeMessageId(
	folderId: string,
	uidValidity: number | bigint,
	uid: number,
): string {
	return `${folderId}:${uidValidity}:${uid}`;
}

export function decodeMessageId(id: string): DecodedMessageId | null {
	if (!id) return null;
	const parts = id.split(":");
	if (parts.length < 3) return null;

	const uid = Number(parts.pop());
	const uidValidity = Number(parts.pop());
	const folderId = parts.join(":");

	if (!folderId) return null;
	if (!Number.isInteger(uid) || !Number.isInteger(uidValidity)) return null;

	return { folderId, uidValidity, uid };
}
