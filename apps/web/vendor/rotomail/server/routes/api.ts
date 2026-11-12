// Copyright (c) 2026 Rotomic. Licensed under the Apache 2.0 license.
//
// The /api/v1 surface the React frontend (app/services/api.ts) depends on.
// Implemented so far: config, the two mailbox GETs (collapsed to the logged-in
// account), folders, and the email read experience (list + get + read/star
// flags). Everything else is a labelled 501 stub, filled in over the build
// order in agentic-inbox-imap-backend-map.md.

import { Hono } from "hono";
import type { Context } from "hono";
import type { ImapFlow } from "imapflow";
import type { Mailbox } from "../../app/types";
import { config } from "../config";
import { imapPool } from "../imap/pool";
import { listFoldersForApi, readFolders, resolveFolderPath } from "../imap/folders";
import { decodeMessageId } from "../imap/message-id";
import {
	getAttachmentPart,
	getMessage,
	listMessages,
	listThreadedMessages,
	setMessageFlags,
} from "../imap/messages";
import { appendMessage, deleteMessage, moveMessage } from "../imap/mutations";
import { searchMessages, type SearchOptions } from "../imap/search";
import { getThreadMessages, markThreadRead } from "../imap/threads";
import { buildDraftRaw, sendMessage, type FromAddress, type OutgoingMessage } from "../smtp/mailer";
import { Folders } from "../../shared/folders";
import { findAccount, type Account } from "../accounts";
import type { AppEnv } from "../types";

const api = new Hono<AppEnv>();

function stub(c: Context, route: string) {
	return c.json({ error: "Not Implemented", route }, 501);
}

/** Get the warm IMAP connection for the request's resolved account. */
async function getClient(c: Context<AppEnv>): Promise<ImapFlow> {
	return imapPool.getConnection(c.var.session.sid, c.var.account);
}

// Upper bound on page size, so a hostile `?limit=…` can't drive an unbounded
// envelope fetch (resource exhaustion).
const MAX_LIMIT = 200;

function intParam(c: Context, key: string, fallback: number, max = Infinity): number {
	const v = c.req.query(key);
	if (!v) return fallback;
	const n = Number(v);
	if (!Number.isInteger(n) || n <= 0) return fallback;
	return Math.min(n, max);
}

// Content types a browser will render and execute inline. Attachment bytes and
// their declared type both come from untrusted email, so these are downgraded
// to a non-executable type before we serve them.
const ACTIVE_MIME_RE = /(text\/html|svg|xml|xhtml)/i;

function safeAttachmentType(mimetype: string): string {
	return ACTIVE_MIME_RE.test(mimetype) ? "application/octet-stream" : mimetype;
}

/** Wrap an IMAP-backed handler, mapping connection errors to a clean 502. */
async function withImap(
	c: Context<AppEnv>,
	fn: (client: ImapFlow) => Promise<Response>,
): Promise<Response> {
	try {
		const client = await getClient(c);
		return await fn(client);
	} catch (err) {
		// Der Fehlertext kann Server- oder Kontodaten enthalten und wird daher
		// weder protokolliert noch an den Browser weitergereicht.
		console.error(`IMAP error on ${c.req.method} ${c.req.path}`, (err as Error).name);
		return c.json({ error: "Mail server error" }, 502);
	}
}

function accountMailbox(email: string): Mailbox {
	const name = email.split("@")[0] || email;
	return { id: email, email, name, settings: {} };
}

function mailboxForAccount(account: Account): Mailbox {
	const mailbox = accountMailbox(account.email);
	mailbox.name = account.displayName || mailbox.name;
	mailbox.settings = { fromName: account.displayName || mailbox.name };
	return mailbox;
}

/** Force the From address to the account doing the sending (Postfix submission
 * requires it); keep any display name the client supplied. */
function resolveFrom(account: Account, provided: unknown): FromAddress {
	const name =
		provided && typeof provided === "object" && "name" in provided
			? (provided as { name?: string }).name
			: undefined;
	return name ? { email: account.email, name } : account.email;
}

function parseReferences(json: string | null | undefined): string[] {
	if (!json) return [];
	try {
		const v = JSON.parse(json);
		return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
	} catch {
		return [];
	}
}

/** Send via SMTP, then APPEND the raw copy to Sent. APPEND failure never fails
 * the send (the mail already went out) — it's logged instead. */
async function sendAndFileSent(
	client: ImapFlow,
	account: Account,
	outgoing: OutgoingMessage,
): Promise<void> {
	const { raw } = await sendMessage(account, outgoing);
	const infos = await readFolders(client);
	const sentPath = resolveFolderPath(Folders.SENT, infos);
	if (!sentPath) return;
	try {
		await appendMessage(client, Folders.SENT, sentPath, raw, ["\\Seen"]);
	} catch (err) {
		console.warn("Sent APPEND failed", (err as Error).name);
	}
}

// -- Config ---------------------------------------------------------
api.get("/config", (c) => {
	return c.json({
		domains: config.domains,
		emailAddresses: c.var.session.accounts.map((a) => a.email),
	});
});

// -- Mailboxes (one per signed-in account) --------------------------
api.get("/mailboxes", (c) =>
	c.json(c.var.session.accounts.map(mailboxForAccount)),
);
api.post("/mailboxes", (c) => stub(c, "POST /mailboxes"));

// Resolve which signed-in account the :mailboxId refers to; 403 if not one.
api.use("/mailboxes/:mailboxId/*", async (c, next) => {
	const mailboxId = c.req.param("mailboxId");
	const account = mailboxId ? findAccount(c.var.session.accounts, mailboxId) : undefined;
	if (!account) return c.json({ error: "Forbidden: not your mailbox" }, 403);
	// In OIDC mode, refresh a stale access token (and re-seal the cookie) before
	// it's used to open a mail connection. A failed refresh = re-login needed.
	c.set("account", account);
	await next();
});

api.get("/mailboxes/:mailboxId", (c) => c.json(mailboxForAccount(c.var.account)));
api.put("/mailboxes/:mailboxId", async (c) => {
	const body = (await c.req.json().catch(() => ({}))) as { settings?: { fromName?: unknown } };
	const name = typeof body.settings?.fromName === "string" ? body.settings.fromName.trim().slice(0, 200) : "";
	await c.var.account.saveDisplayName?.(name);
	c.var.account.displayName = name;
	return c.json(mailboxForAccount(c.var.account));
});
api.delete("/mailboxes/:mailboxId", (c) => stub(c, "DELETE /mailboxes/:id"));

// -- Folders --------------------------------------------------------
api.get("/mailboxes/:mailboxId/folders", (c) =>
	withImap(c, async (client) => c.json(await listFoldersForApi(client))),
);
api.post("/mailboxes/:mailboxId/folders", (c) => stub(c, "POST /mailboxes/:id/folders"));
api.put("/mailboxes/:mailboxId/folders/:id", (c) => stub(c, "PUT /mailboxes/:id/folders/:id"));
api.delete("/mailboxes/:mailboxId/folders/:id", (c) => stub(c, "DELETE /mailboxes/:id/folders/:id"));

// -- Emails: list ---------------------------------------------------
api.get("/mailboxes/:mailboxId/emails", (c) =>
	withImap(c, async (client) => {
		const folder = c.req.query("folder");
		if (!folder) {
			// The frontend only lists by folder; without one there's nothing to open.
			return c.json({ emails: [], totalCount: 0 });
		}
		const infos = await readFolders(client);
		const path = resolveFolderPath(folder, infos);
		if (!path) return c.json({ error: "Folder not found" }, 404);

		const page = intParam(c, "page", 1);
		const limit = intParam(c, "limit", 25, MAX_LIMIT);
		const threaded = c.req.query("threaded") === "true" || c.req.query("threaded") === "1";

		if (threaded) {
			const result = await listThreadedMessages(
				client,
				path,
				folder,
				page,
				limit,
				config.threadListWindow,
			);
			if (result.truncated) {
				console.warn(
					`Threaded list for "${folder}" grouped only the most recent ${config.threadListWindow} messages.`,
				);
			}
			return c.json({ emails: result.emails, totalCount: result.totalCount });
		}

		const result = await listMessages(client, path, folder, page, limit);
		return c.json(result);
	}),
);
api.post("/mailboxes/:mailboxId/emails", (c) =>
	withImap(c, async (client) => {
		const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
		if (!body.to || (Array.isArray(body.to) && body.to.length === 0)) {
			return c.json({ error: "At least one recipient is required" }, 400);
		}
		await sendAndFileSent(client, c.var.account, {
			to: body.to as OutgoingMessage["to"],
			cc: body.cc as OutgoingMessage["cc"],
			bcc: body.bcc as OutgoingMessage["bcc"],
			from: resolveFrom(c.var.account, body.from),
			subject: body.subject as string | undefined,
			html: body.html as string | undefined,
			text: body.text as string | undefined,
		});
		return c.json({ status: "sent" });
	}),
);

api.post("/mailboxes/:mailboxId/drafts", (c) =>
	withImap(c, async (client) => {
		const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
		const infos = await readFolders(client);
		const draftPath = resolveFolderPath(Folders.DRAFT, infos);
		if (!draftPath) return c.json({ error: "Drafts folder not found" }, 404);

		// Updating a draft = delete the old one, then append the new version.
		if (typeof body.draft_id === "string") {
			const old = decodeMessageId(body.draft_id);
			const oldPath = old && resolveFolderPath(old.folderId, infos);
			if (old && oldPath) {
				await deleteMessage(client, oldPath, old.uidValidity, old.uid, null).catch(() => {});
			}
		}

		const raw = await buildDraftRaw({
			to: body.to as OutgoingMessage["to"],
			cc: body.cc as OutgoingMessage["cc"],
			bcc: body.bcc as OutgoingMessage["bcc"],
			from: c.var.account.email,
			subject: body.subject as string | undefined,
			html: body.body as string | undefined,
		});
		const draftId = await appendMessage(client, Folders.DRAFT, draftPath, raw, ["\\Draft"]);
		return c.json({ draft_id: draftId ?? "" }, 201);
	}),
);

// -- Emails: get one ------------------------------------------------
api.get("/mailboxes/:mailboxId/emails/:id", (c) =>
	withImap(c, async (client) => {
		const decoded = decodeMessageId(c.req.param("id")!);
		if (!decoded) return c.json({ error: "Invalid email id" }, 400);
		const infos = await readFolders(client);
		const path = resolveFolderPath(decoded.folderId, infos);
		if (!path) return c.json({ error: "Folder not found" }, 404);

		const email = await getMessage(client, path, decoded.folderId, decoded.uidValidity, decoded.uid);
		if (!email) return c.json({ error: "Email not found" }, 404);
		return c.json(email);
	}),
);

// -- Emails: update flags (read / starred) --------------------------
api.put("/mailboxes/:mailboxId/emails/:id", (c) =>
	withImap(c, async (client) => {
		const decoded = decodeMessageId(c.req.param("id")!);
		if (!decoded) return c.json({ error: "Invalid email id" }, 400);
		const { read, starred } = (await c.req.json().catch(() => ({}))) as {
			read?: boolean;
			starred?: boolean;
		};
		const infos = await readFolders(client);
		const path = resolveFolderPath(decoded.folderId, infos);
		if (!path) return c.json({ error: "Folder not found" }, 404);

		const email = await setMessageFlags(
			client,
			path,
			decoded.folderId,
			decoded.uidValidity,
			decoded.uid,
			{ read, starred },
		);
		if (!email) return c.json({ error: "Email not found" }, 404);
		return c.json(email);
	}),
);

api.delete("/mailboxes/:mailboxId/emails/:id", (c) =>
	withImap(c, async (client) => {
		const decoded = decodeMessageId(c.req.param("id")!);
		if (!decoded) return c.json({ error: "Invalid email id" }, 400);
		const infos = await readFolders(client);
		const path = resolveFolderPath(decoded.folderId, infos);
		if (!path) return c.json({ error: "Folder not found" }, 404);
		const trashPath = resolveFolderPath(Folders.TRASH, infos);
		const ok = await deleteMessage(client, path, decoded.uidValidity, decoded.uid, trashPath);
		if (!ok) return c.json({ error: "Email not found" }, 404);
		return c.body(null, 204);
	}),
);

api.post("/mailboxes/:mailboxId/emails/:id/move", (c) =>
	withImap(c, async (client) => {
		const decoded = decodeMessageId(c.req.param("id")!);
		if (!decoded) return c.json({ error: "Invalid email id" }, 400);
		const { folderId } = (await c.req.json().catch(() => ({}))) as { folderId?: string };
		if (!folderId) return c.json({ error: "folderId is required" }, 400);
		const infos = await readFolders(client);
		const sourcePath = resolveFolderPath(decoded.folderId, infos);
		const targetPath = resolveFolderPath(folderId, infos);
		if (!sourcePath || !targetPath) return c.json({ error: "Folder not found" }, 400);
		const ok = await moveMessage(client, sourcePath, decoded.uidValidity, decoded.uid, targetPath);
		if (!ok) return c.json({ error: "Email not found" }, 404);
		return c.json({ status: "moved" });
	}),
);

api.post("/mailboxes/:mailboxId/emails/:id/reply", (c) =>
	withImap(c, async (client) => {
		const decoded = decodeMessageId(c.req.param("id")!);
		if (!decoded) return c.json({ error: "Invalid email id" }, 400);
		const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

		// Thread the reply off the original's Message-ID + References.
		let inReplyTo: string | undefined;
		let references: string[] | undefined;
		const infos = await readFolders(client);
		const origPath = resolveFolderPath(decoded.folderId, infos);
		if (origPath) {
			const orig = await getMessage(client, origPath, decoded.folderId, decoded.uidValidity, decoded.uid);
			if (orig?.message_id) {
				inReplyTo = orig.message_id;
				references = [...parseReferences(orig.email_references), orig.message_id];
			}
		}

		await sendAndFileSent(client, c.var.account, {
			to: body.to as OutgoingMessage["to"],
			cc: body.cc as OutgoingMessage["cc"],
			bcc: body.bcc as OutgoingMessage["bcc"],
			from: resolveFrom(c.var.account, body.from),
			subject: body.subject as string | undefined,
			html: body.html as string | undefined,
			text: body.text as string | undefined,
			inReplyTo,
			references,
		});
		return c.json({ status: "sent" });
	}),
);

api.post("/mailboxes/:mailboxId/emails/:id/forward", (c) =>
	withImap(c, async (client) => {
		// The forwarded body is composed client-side; send it as a new message.
		const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
		if (!body.to || (Array.isArray(body.to) && body.to.length === 0)) {
			return c.json({ error: "At least one recipient is required" }, 400);
		}
		await sendAndFileSent(client, c.var.account, {
			to: body.to as OutgoingMessage["to"],
			cc: body.cc as OutgoingMessage["cc"],
			bcc: body.bcc as OutgoingMessage["bcc"],
			from: resolveFrom(c.var.account, body.from),
			subject: body.subject as string | undefined,
			html: body.html as string | undefined,
			text: body.text as string | undefined,
		});
		return c.json({ status: "sent" });
	}),
);

// -- Threads --------------------------------------------------------
api.get("/mailboxes/:mailboxId/threads/:threadId", (c) =>
	withImap(c, async (client) => {
		const infos = await readFolders(client);
		const emails = await getThreadMessages(client, infos, c.req.param("threadId")!);
		return c.json(emails);
	}),
);
api.post("/mailboxes/:mailboxId/threads/:threadId/read", (c) =>
	withImap(c, async (client) => {
		const infos = await readFolders(client);
		await markThreadRead(client, infos, c.req.param("threadId")!);
		return c.json({ status: "marked_read" });
	}),
);

// -- Attachments ----------------------------------------------------
api.get("/mailboxes/:mailboxId/emails/:emailId/attachments/:attachmentId", (c) =>
	withImap(c, async (client) => {
		const decoded = decodeMessageId(c.req.param("emailId")!);
		if (!decoded) return c.json({ error: "Invalid email id" }, 400);
		const infos = await readFolders(client);
		const path = resolveFolderPath(decoded.folderId, infos);
		if (!path) return c.json({ error: "Folder not found" }, 404);

		const att = await getAttachmentPart(
			client,
			path,
			decoded.uidValidity,
			decoded.uid,
			c.req.param("attachmentId")!,
		);
		if (!att) return c.json({ error: "Attachment not found" }, 404);

		const safe = att.filename.replace(/[\x00-\x1f"\\]/g, "_");
		return new Response(att.content as unknown as BodyInit, {
			headers: {
				// The mimetype is attacker-controlled (it comes straight from the
				// email). Force a safe type for anything the browser could render
				// and execute inline (HTML/SVG/XML), and stop content sniffing, so
				// a malicious attachment can't run script in our origin.
				"Content-Type": safeAttachmentType(att.mimetype),
				"X-Content-Type-Options": "nosniff",
				"Content-Disposition": `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(att.filename)}`,
			},
		});
	}),
);

// -- Search ---------------------------------------------------------
api.get("/mailboxes/:mailboxId/search", (c) =>
	withImap(c, async (client) => {
		const boolQuery = (key: string): boolean | undefined => {
			const v = c.req.query(key);
			if (v === undefined || v === "") return undefined;
			return v === "true" || v === "1";
		};
		const opts: SearchOptions = {
			query: c.req.query("query") || undefined,
			from: c.req.query("from") || undefined,
			to: c.req.query("to") || undefined,
			subject: c.req.query("subject") || undefined,
			folder: c.req.query("folder") || undefined,
			date_start: c.req.query("date_start") || undefined,
			date_end: c.req.query("date_end") || undefined,
			is_read: boolQuery("is_read"),
			is_starred: boolQuery("is_starred"),
			has_attachment: boolQuery("has_attachment"),
		};
		const page = intParam(c, "page", 1);
		const limit = intParam(c, "limit", 25, MAX_LIMIT);
		const result = await searchMessages(client, await readFolders(client), opts, page, limit);
		if (result.truncatedAttachmentScan) {
			console.warn("Search has_attachment scan was capped; some older matches not checked.");
		}
		if (result.truncatedResults) {
			console.warn("Search matched more messages than the per-folder fetch cap; older matches omitted.");
		}
		return c.json({ emails: result.emails, totalCount: result.totalCount });
	}),
);

export default api;
