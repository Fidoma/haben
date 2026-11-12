// Copyright (c) 2026 Rotomic. Licensed under the Apache 2.0 license.

import { Button } from "@cloudflare/kumo";
import { PaperclipIcon, XIcon } from "@phosphor-icons/react";
import { useRef } from "react";
import type { ComposeAttachment } from "~/hooks/useComposeForm";

function formatSize(bytes: number) {
	return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function ComposeAttachments({ attachments, onAdd, onRemove, disabled }: { attachments: ComposeAttachment[]; onAdd: (files: FileList) => void; onRemove: (id: string) => void; disabled?: boolean }) {
	const input = useRef<HTMLInputElement>(null);
	return (
		<div className="flex flex-wrap items-center gap-2 rounded-md border border-kumo-line bg-kumo-fill/30 p-2">
			<input ref={input} type="file" multiple className="hidden" onChange={(event) => { if (event.target.files) onAdd(event.target.files); event.target.value = ""; }} />
			<Button type="button" variant="secondary" size="sm" icon={<PaperclipIcon size={15} />} onClick={() => input.current?.click()} disabled={disabled || attachments.length >= 10}>
				Attach files
			</Button>
			{attachments.length > 0 && (
				<div className="flex min-w-0 flex-1 flex-wrap gap-2" aria-label="Attachments">
					{attachments.map((attachment) => (
						<div key={attachment.id} className="flex items-center gap-2 rounded-full border border-kumo-line bg-kumo-fill px-3 py-1 text-xs text-kumo-default">
							<PaperclipIcon size={13} className="shrink-0" />
							<span className="max-w-48 truncate">{attachment.filename}</span>
							<span className="text-kumo-subtle">{formatSize(attachment.size)}</span>
							<button type="button" className="rounded-full p-0.5 text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default" onClick={() => onRemove(attachment.id)} aria-label={`Remove ${attachment.filename}`}>
								<XIcon size={13} />
							</button>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
