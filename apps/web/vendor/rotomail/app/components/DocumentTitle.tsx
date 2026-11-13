// Copyright (c) 2026 Rotomic. Licensed under the Apache 2.0 license.
//
// Gmail-style document title: "<context> - <account email> - Rotomail".
// Context is the open message's subject, "Search", "Settings", or the current
// folder with its unread count (e.g. "Inbox (3)").

import { useEffect } from "react";
import { useLocation, useParams } from "react-router";
import { getFolderDisplayName } from "shared/folders";
import { useEmail } from "~/queries/emails";
import { useFolders } from "~/queries/folders";
import { useUIStore } from "~/hooks/useUIStore";

const APP_NAME = "Rotomail";

export default function DocumentTitle() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const location = useLocation();
	const { selectedEmailId } = useUIStore();
	const { data: folders } = useFolders(mailboxId);
	const { data: openEmail } = useEmail(mailboxId, selectedEmailId ?? undefined);

	useEffect(() => {
		const path = location.pathname;
		let context: string;

		if (selectedEmailId && openEmail?.subject !== undefined) {
			context = openEmail.subject || "(no subject)";
		} else if (path.includes("/search")) {
			context = "Search";
		} else if (path.includes("/settings")) {
			context = "Settings";
		} else {
			const match = path.match(/\/emails\/([^/]+)/);
			const folderId = match ? decodeURIComponent(match[1]!) : "inbox";
			const name = getFolderDisplayName(folderId);
			const unread = folders?.find((f) => f.id === folderId)?.unreadCount ?? 0;
			context = unread > 0 ? `${name} (${unread})` : name;
		}

		document.title = [context, mailboxId, APP_NAME].filter(Boolean).join(" - ");
	}, [location.pathname, selectedEmailId, openEmail?.subject, folders, mailboxId]);

	return null;
}
