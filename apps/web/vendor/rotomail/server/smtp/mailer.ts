// Copyright (c) 2026 Rotomic. Licensed under the Apache 2.0 license.
//
// SMTP submission to mailcow's Postfix (port 587 STARTTLS) authenticated with
// the session's own credentials. Sending alone does NOT file a copy in Sent —
// callers APPEND the returned raw message to the Sent folder themselves (see
// imap/mutations.ts), exactly as the design doc requires.

import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import type { Account } from "../accounts";
import { config } from "../config";

export type FromAddress = string | { email: string; name?: string };
export type RecipientList = string | string[] | undefined;

export interface OutgoingMessage {
	to: RecipientList;
	cc?: RecipientList;
	bcc?: RecipientList;
	from: FromAddress;
	subject?: string;
	html?: string;
	text?: string;
	inReplyTo?: string;
	references?: string[];
	attachments?: Array<{ filename: string; contentType: string; contentBase64: string }>;
}

function mailAttachments(input: OutgoingMessage["attachments"]) {
	if (!input?.length) return undefined;
	if (input.length > 10) throw new Error("Too many attachments");
	let total = 0;
	return input.map((file) => {
		if (!file || typeof file.filename !== "string" || typeof file.contentType !== "string" || typeof file.contentBase64 !== "string") throw new Error("Invalid attachment");
		const content = Buffer.from(file.contentBase64, "base64");
		total += content.length;
		if (total > 10 * 1024 * 1024) throw new Error("Attachments too large");
		return { filename: file.filename.replace(/[\r\n\\/]/g, "_").slice(0, 255) || "attachment", contentType: file.contentType.slice(0, 200), content };
	});
}

function normalizeFrom(from: FromAddress) {
	if (typeof from === "string") return from;
	return from.name ? { name: from.name, address: from.email } : from.email;
}

function emptyToUndef(v: RecipientList): RecipientList {
	if (v == null) return undefined;
	if (Array.isArray(v)) return v.length ? v : undefined;
	return v.trim() ? v : undefined;
}

// SMTP auth from an account: XOAUTH2 access token (oidc) or password. With
// type:"OAuth2" + a precomputed accessToken, nodemailer emits the XOAUTH2 SASL
// string itself (no client id / token endpoint round-trip needed here).
function smtpAuth(account: Account) {
	if (account.oauth) {
		return { type: "OAuth2" as const, user: account.email, accessToken: account.oauth.accessToken };
	}
	return { user: account.smtp?.username ?? account.username ?? account.email, pass: account.smtp?.password ?? account.password ?? "" };
}

function createTransport(account: Account) {
	return nodemailer.createTransport({
		host: account.smtp?.host ?? config.smtp.host,
		port: account.smtp?.port ?? config.smtp.port,
		secure: account.smtp?.secure ?? config.smtp.secure, // false on 587 -> STARTTLS via requireTLS
		requireTLS:
			!(account.smtp?.secure ?? config.smtp.secure) &&
			process.env.HABEN_WEBMAIL_ALLOW_PRIVATE_HOSTS !== "true",
		auth: smtpAuth(account),
		tls: { rejectUnauthorized: config.tls.rejectUnauthorized, servername: account.smtp?.servername },
	});
}

export interface SentMessage {
	/** Raw RFC822 bytes to APPEND to the Sent folder (includes Bcc header). */
	raw: Buffer;
	messageId: string;
}

/**
 * Send a message via SMTP submission and return the raw bytes for a Sent copy.
 * nodemailer strips Bcc from the transmitted DATA (it only goes in the
 * envelope); the raw we return keeps the Bcc header for the stored Sent copy.
 */
export async function sendMessage(account: Account, msg: OutgoingMessage): Promise<SentMessage> {
	const domain = account.email.split("@")[1] || "localhost";
	const messageId = `<${crypto.randomUUID()}@${domain}>`;

	const mailOptions = {
		from: normalizeFrom(msg.from),
		to: emptyToUndef(msg.to),
		cc: emptyToUndef(msg.cc),
		bcc: emptyToUndef(msg.bcc),
		subject: msg.subject || "",
		html: msg.html || undefined,
		text: msg.text || undefined,
		inReplyTo: msg.inReplyTo || undefined,
		references: msg.references && msg.references.length ? msg.references : undefined,
		attachments: mailAttachments(msg.attachments),
		messageId,
	};

	const raw = (await new MailComposer(mailOptions).compile().build()) as Buffer;
	await createTransport(account).sendMail(mailOptions);
	return { raw, messageId };
}

/** Build raw RFC822 for a draft (no send). */
export async function buildDraftRaw(msg: OutgoingMessage): Promise<Buffer> {
	const mailOptions = {
		from: normalizeFrom(msg.from),
		to: emptyToUndef(msg.to),
		cc: emptyToUndef(msg.cc),
		bcc: emptyToUndef(msg.bcc),
		subject: msg.subject || "",
		html: msg.html || undefined,
		text: msg.text || undefined,
		inReplyTo: msg.inReplyTo || undefined,
		references: msg.references && msg.references.length ? msg.references : undefined,
		attachments: mailAttachments(msg.attachments),
	};
	return (await new MailComposer(mailOptions).compile().build()) as Buffer;
}
