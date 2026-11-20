// Copyright (c) 2026 Rotomic. Licensed under the Apache 2.0 license.
//
// Fetch IMAP messages and map them to the frontend's Email shape (app/types).
// List uses envelopes only (fast, no bodies); get fetches the full RFC822 and
// parses it with mailparser. Thread fields are left null until the threads
// phase — the frontend tolerates their absence.

import type { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { Email } from "../../app/types";
import { encodeMessageId } from "./message-id";

interface AddressLike {
	address?: string | null;
}

function joinAddresses(list: AddressLike[] | undefined): string {
	if (!list) return "";
	return list
		.map((a) => a.address)
		.filter((a): a is string => Boolean(a))
		.join(", ");
}

function toIso(value: unknown): string {
	if (value instanceof Date) return value.toISOString();
	if (typeof value === "string") {
		const d = new Date(value);
		if (!Number.isNaN(d.getTime())) return d.toISOString();
	}
	return new Date(0).toISOString();
}

export interface FetchedMessage {
	uid: number;
	flags?: Set<string>;
	envelope?: {
		subject?: string;
		date?: Date;
		from?: AddressLike[];
		to?: AddressLike[];
		cc?: AddressLike[];
		bcc?: AddressLike[];
		messageId?: string;
		inReplyTo?: string;
	};
	internalDate?: Date;
	/** Raw fetched header section (when specific headers were requested). */
	headers?: Buffer;
}

/** Strip surrounding angle brackets from a Message-ID. */
function bareId(id: string | undefined | null): string | null {
	if (!id) return null;
	return id.replace(/^</, "").replace(/>$/, "").trim() || null;
}

/** Map an envelope-level fetch result to an Email (no body). */
export function mapToEmail(folderId: string, uidValidity: number | bigint, msg: FetchedMessage): Email {
	const env = msg.envelope ?? {};
	const flags = msg.flags ?? new Set<string>();
	return {
		id: encodeMessageId(folderId, uidValidity, msg.uid),
		thread_id: null,
		folder_id: folderId,
		subject: env.subject ?? "",
		sender: env.from?.[0]?.address ?? "",
		recipient: joinAddresses(env.to),
		cc: joinAddresses(env.cc) || undefined,
		bcc: joinAddresses(env.bcc) || undefined,
		date: toIso(env.date ?? msg.internalDate),
		read: flags.has("\\Seen"),
		starred: flags.has("\\Flagged"),
		snippet: null,
		body: null,
		message_id: env.messageId ?? null,
		in_reply_to: env.inReplyTo ?? null,
	};
}

export const ENVELOPE_QUERY = { uid: true, flags: true, envelope: true, internalDate: true } as const;

/**
 * Augment an envelope-mapped Email with the parsed RFC822 source: body,
 * snippet, references, raw headers, attachment metadata, and the thread root.
 */
export async function augmentWithSource(email: Email, source: Buffer): Promise<Email> {
	const parsed = await simpleParser(source);

	email.body = parsed.html || parsed.textAsHtml || parsed.text || "";
	const text = (parsed.text ?? "").replace(/\s+/g, " ").trim();
	email.snippet = text ? text.slice(0, 200) : null;

	const refs = parsed.references;
	const refList = refs ? (Array.isArray(refs) ? refs : [refs]) : [];
	email.email_references = refList.length ? JSON.stringify(refList) : null;

	// Thread root: first reference, else In-Reply-To, else this message's own id.
	email.thread_id =
		bareId(refList[0]) ?? bareId(parsed.inReplyTo) ?? bareId(parsed.messageId) ?? email.message_id;

	email.raw_headers = JSON.stringify(
		(parsed.headerLines ?? []).map(({ key, line }) => {
			const colon = line.indexOf(":");
			return { key, value: colon >= 0 ? line.slice(colon + 1).trim() : line };
		}),
	);

	email.attachments = (parsed.attachments ?? []).map((att, i) => ({
		id: String(i),
		filename: att.filename || "attachment",
		mimetype: att.contentType || "application/octet-stream",
		size: att.size ?? (att.content ? att.content.length : 0),
		content_id: att.cid || undefined,
		disposition: att.contentDisposition || (att.related ? "inline" : "attachment"),
	}));

	return email;
}

export interface ListResult {
	emails: Email[];
	totalCount: number;
}

/** List a page of a folder's messages, newest first. */
export async function listMessages(
	client: ImapFlow,
	path: string,
	folderId: string,
	page: number,
	limit: number,
): Promise<ListResult> {
	const lock = await client.getMailboxLock(path);
	try {
		const total = client.mailbox && typeof client.mailbox !== "boolean" ? client.mailbox.exists : 0;
		const uidValidity =
			client.mailbox && typeof client.mailbox !== "boolean" ? client.mailbox.uidValidity : 0;
		if (!total) return { emails: [], totalCount: 0 };

		// Messages are sequence 1..total in arrival order; page newest-first.
		const end = total - (page - 1) * limit;
		if (end < 1) return { emails: [], totalCount: total };
		const start = Math.max(1, end - limit + 1);

		const emails: Email[] = [];
		for await (const msg of client.fetch(`${start}:${end}`, ENVELOPE_QUERY)) {
			emails.push(mapToEmail(folderId, uidValidity, msg as FetchedMessage));
		}
		emails.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
		return { emails, totalCount: total };
	} finally {
		lock.release();
	}
}

export function msgTime(m: FetchedMessage): number {
	const d = m.envelope?.date ?? m.internalDate;
	return d instanceof Date ? d.getTime() : 0;
}

function parseReferencesHeader(headers: Buffer | undefined): string[] {
	if (!headers) return [];
	const text = headers.toString("utf8");
	const ids: string[] = [];
	const re = /<([^>]+)>/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) ids.push(m[1]!.trim());
	return ids;
}

/** Determine a message's thread root key from References / In-Reply-To / Message-ID. */
function threadRootOf(m: FetchedMessage): string {
	const refs = parseReferencesHeader(m.headers);
	if (refs.length) return refs[0]!;
	return bareId(m.envelope?.inReplyTo) ?? bareId(m.envelope?.messageId) ?? `uid:${m.uid}`;
}

export interface ThreadedListResult extends ListResult {
	/** True if the folder had more messages than the grouping window. */
	truncated: boolean;
}

/**
 * List a folder as conversations: group the most recent `window` messages by
 * thread root, return one representative (latest) per thread with thread_count
 * / thread_unread_count / participants, paginated over threads newest-first.
 */
export async function listThreadedMessages(
	client: ImapFlow,
	path: string,
	folderId: string,
	page: number,
	limit: number,
	window: number,
): Promise<ThreadedListResult> {
	const lock = await client.getMailboxLock(path);
	try {
		const total = client.mailbox && typeof client.mailbox !== "boolean" ? client.mailbox.exists : 0;
		const uidValidity =
			client.mailbox && typeof client.mailbox !== "boolean" ? client.mailbox.uidValidity : 0;
		if (!total) return { emails: [], totalCount: 0, truncated: false };

		const start = Math.max(1, total - window + 1);
		const truncated = start > 1;

		const groups = new Map<string, FetchedMessage[]>();
		for await (const raw of client.fetch(`${start}:${total}`, {
			uid: true,
			flags: true,
			envelope: true,
			internalDate: true,
			headers: ["references"],
		})) {
			const m = raw as unknown as FetchedMessage;
			const root = threadRootOf(m);
			const group = groups.get(root);
			if (group) group.push(m);
			else groups.set(root, [m]);
		}

		const threads: Email[] = [];
		for (const [root, group] of groups) {
			group.sort((a, b) => msgTime(a) - msgTime(b));
			const rep = group[group.length - 1];
			const email = mapToEmail(folderId, uidValidity, rep!);
			email.thread_id = root;
			email.thread_count = group.length;
			email.thread_unread_count = group.filter((x) => !(x.flags?.has("\\Seen"))).length;
			const senders = Array.from(
				new Set(
					group
						.map((x) => x.envelope?.from?.[0]?.address)
						.filter((a): a is string => Boolean(a)),
				),
			);
			email.participants = senders.join(", ");
			threads.push(email);
		}

		threads.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
		const startIdx = (page - 1) * limit;
		return {
			emails: threads.slice(startIdx, startIdx + limit),
			totalCount: threads.length,
			truncated,
		};
	} finally {
		lock.release();
	}
}

function uidValidityMatches(client: ImapFlow, expected: number): boolean {
	if (!client.mailbox || typeof client.mailbox === "boolean") return false;
	return Number(client.mailbox.uidValidity) === expected;
}

/** Fetch one message with its parsed body, attachments metadata, and headers. */
export async function getMessage(
	client: ImapFlow,
	path: string,
	folderId: string,
	uidValidity: number,
	uid: number,
): Promise<Email | null> {
	const lock = await client.getMailboxLock(path);
	try {
		if (!uidValidityMatches(client, uidValidity)) return null;
		const msg = await client.fetchOne(String(uid), { ...ENVELOPE_QUERY, source: true }, { uid: true });
		if (!msg || typeof msg === "boolean") return null;

		const email = mapToEmail(folderId, uidValidity, msg as FetchedMessage);
		return augmentWithSource(email, (msg as { source: Buffer }).source);
	} finally {
		lock.release();
	}
}

export interface AttachmentPart {
	filename: string;
	mimetype: string;
	content: Buffer;
}

/** Fetch one attachment's bytes by its parse-order index (the attachment id). */
export async function getAttachmentPart(
	client: ImapFlow,
	path: string,
	uidValidity: number,
	uid: number,
	attachmentId: string,
): Promise<AttachmentPart | null> {
	const lock = await client.getMailboxLock(path);
	try {
		if (!uidValidityMatches(client, uidValidity)) return null;
		const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
		if (!msg || typeof msg === "boolean") return null;

		const parsed = await simpleParser((msg as { source: Buffer }).source);
		const index = Number(attachmentId);
		const att = Number.isInteger(index) ? parsed.attachments?.[index] : undefined;
		if (!att) return null;

		return {
			filename: att.filename || "attachment",
			mimetype: att.contentType || "application/octet-stream",
			content: att.content as Buffer,
		};
	} finally {
		lock.release();
	}
}

/** Set/clear \Seen and \Flagged on a message; returns the updated Email. */
export async function setMessageFlags(
	client: ImapFlow,
	path: string,
	folderId: string,
	uidValidity: number,
	uid: number,
	changes: { read?: boolean; starred?: boolean },
): Promise<Email | null> {
	const lock = await client.getMailboxLock(path);
	try {
		if (!uidValidityMatches(client, uidValidity)) return null;
		const target = String(uid);
		const opts = { uid: true } as const;

		if (changes.read !== undefined) {
			if (changes.read) await client.messageFlagsAdd(target, ["\\Seen"], opts);
			else await client.messageFlagsRemove(target, ["\\Seen"], opts);
		}
		if (changes.starred !== undefined) {
			if (changes.starred) await client.messageFlagsAdd(target, ["\\Flagged"], opts);
			else await client.messageFlagsRemove(target, ["\\Flagged"], opts);
		}

		const msg = await client.fetchOne(target, ENVELOPE_QUERY, opts);
		if (!msg || typeof msg === "boolean") return null;
		return mapToEmail(folderId, uidValidity, msg as FetchedMessage);
	} finally {
		lock.release();
	}
}
