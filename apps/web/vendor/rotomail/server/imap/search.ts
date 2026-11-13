// Copyright (c) 2026 Rotomic. Licensed under the Apache 2.0 license.
//
// IMAP SEARCH. Structured filters map directly to SEARCH keys; free text uses
// TEXT (fast only if Dovecot FTS is enabled, otherwise a server-side scan).
// has_attachment has no native SEARCH key, so we post-filter matches by
// BODYSTRUCTURE (capped, and the cap is reported, never silently dropped).
// With no in:folder operator we search the main readable folders and merge.

import type { ImapFlow } from "imapflow";
import type { Email } from "../../app/types";
import { Folders } from "../../shared/folders";
import { resolveFolderPath, type FolderInfo } from "./folders";
import { ENVELOPE_QUERY, type FetchedMessage, mapToEmail } from "./messages";

export interface SearchOptions {
	query?: string;
	from?: string;
	to?: string;
	subject?: string;
	folder?: string;
	date_start?: string;
	date_end?: string;
	is_read?: boolean;
	is_starred?: boolean;
	has_attachment?: boolean;
}

const DEFAULT_SEARCH_FOLDERS: string[] = [Folders.INBOX, Folders.SENT, Folders.ARCHIVE];
const HAS_ATTACHMENT_SCAN_CAP = 300;
// Upper bound on how many matching messages we fetch envelopes for per folder.
// A broad query (e.g. a single common letter) can match thousands; without this
// the `limit`/pagination only trims the response AFTER fetching every envelope,
// which hammers the mail server. We keep the most recent matches and report it.
const ENVELOPE_FETCH_CAP = 500;

function buildCriteria(o: SearchOptions): Record<string, unknown> {
	const c: Record<string, unknown> = {};
	if (o.query) c.text = o.query;
	if (o.from) c.from = o.from;
	if (o.to) c.to = o.to;
	if (o.subject) c.subject = o.subject;
	if (o.is_read === true) c.seen = true;
	else if (o.is_read === false) c.seen = false;
	if (o.is_starred === true) c.flagged = true;
	else if (o.is_starred === false) c.flagged = false;
	if (o.date_start) {
		const d = new Date(o.date_start);
		if (!Number.isNaN(d.getTime())) c.since = d;
	}
	if (o.date_end) {
		const d = new Date(o.date_end);
		if (!Number.isNaN(d.getTime())) c.before = d;
	}
	return Object.keys(c).length ? c : { all: true };
}

interface BodyStructureNode {
	disposition?: string | null;
	childNodes?: BodyStructureNode[];
}

function nodeHasAttachment(node: BodyStructureNode | undefined): boolean {
	if (!node) return false;
	if ((node.disposition || "").toLowerCase() === "attachment") return true;
	return Array.isArray(node.childNodes) && node.childNodes.some(nodeHasAttachment);
}

export interface SearchResult {
	emails: Email[];
	totalCount: number;
	/** True if has_attachment filtering scanned only the most recent matches. */
	truncatedAttachmentScan: boolean;
	/** True if a folder had more matches than ENVELOPE_FETCH_CAP (older ones skipped). */
	truncatedResults: boolean;
}

export async function searchMessages(
	client: ImapFlow,
	infos: FolderInfo[],
	opts: SearchOptions,
	page: number,
	limit: number,
): Promise<SearchResult> {
	const folderIds = opts.folder ? [opts.folder] : DEFAULT_SEARCH_FOLDERS;
	const criteria = buildCriteria(opts);
	const all: Email[] = [];
	let truncatedAttachmentScan = false;
	let truncatedResults = false;

	for (const fid of folderIds) {
		const path = resolveFolderPath(fid, infos);
		if (!path) continue;
		const lock = await client.getMailboxLock(path);
		try {
			const uidValidity =
				client.mailbox && typeof client.mailbox !== "boolean" ? client.mailbox.uidValidity : 0;
			let uids = (await client.search(criteria, { uid: true })) || [];
			if (!uids.length) continue;

			if (opts.has_attachment) {
				const scan = uids.slice(-HAS_ATTACHMENT_SCAN_CAP);
				if (scan.length < uids.length) truncatedAttachmentScan = true;
				const keep: number[] = [];
				for await (const msg of client.fetch(scan, { uid: true, bodyStructure: true }, { uid: true })) {
					const m = msg as unknown as { uid: number; bodyStructure?: BodyStructureNode };
					if (nodeHasAttachment(m.bodyStructure)) keep.push(m.uid);
				}
				uids = keep;
			}
			if (!uids.length) continue;

			// Bound the envelope fetch to the most recent matches per folder.
			if (uids.length > ENVELOPE_FETCH_CAP) {
				truncatedResults = true;
				uids = uids.slice(-ENVELOPE_FETCH_CAP);
			}
			for await (const msg of client.fetch(uids, ENVELOPE_QUERY, { uid: true })) {
				all.push(mapToEmail(fid, uidValidity, msg as unknown as FetchedMessage));
			}
		} finally {
			lock.release();
		}
	}

	all.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
	const start = (page - 1) * limit;
	return {
		emails: all.slice(start, start + limit),
		totalCount: all.length,
		truncatedAttachmentScan,
		truncatedResults,
	};
}
