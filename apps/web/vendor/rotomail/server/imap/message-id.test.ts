// Copyright (c) 2026 Rotomic. Licensed under the Apache 2.0 license.

import { describe, expect, test } from "bun:test";
import { decodeMessageId, encodeMessageId } from "./message-id";

describe("message id codec", () => {
	test("encodes folder:uidvalidity:uid", () => {
		expect(encodeMessageId("inbox", 1234567890, 42)).toBe("inbox:1234567890:42");
	});

	test("round-trips a simple id", () => {
		const id = encodeMessageId("inbox", 1234567890, 42);
		expect(decodeMessageId(id)).toEqual({ folderId: "inbox", uidValidity: 1234567890, uid: 42 });
	});

	test("accepts a bigint uidvalidity (as ImapFlow returns)", () => {
		expect(encodeMessageId("sent", 4294967295n, 7)).toBe("sent:4294967295:7");
	});

	test("preserves folder ids that themselves contain colons or slashes", () => {
		const id = encodeMessageId("Archive/2024:Q1", 100, 9);
		const decoded = decodeMessageId(id);
		expect(decoded).toEqual({ folderId: "Archive/2024:Q1", uidValidity: 100, uid: 9 });
	});

	test("returns null for malformed ids", () => {
		expect(decodeMessageId("")).toBeNull();
		expect(decodeMessageId("inbox")).toBeNull();
		expect(decodeMessageId("inbox:42")).toBeNull();
		expect(decodeMessageId("inbox:notanumber:42")).toBeNull();
		expect(decodeMessageId("inbox:100:notanumber")).toBeNull();
	});
});
