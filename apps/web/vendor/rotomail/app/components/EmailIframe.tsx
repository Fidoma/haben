// Copyright (c) 2026 Cloudflare, Inc. Licensed under the Apache 2.0 license.
// Modifications Copyright (c) 2026 Haben contributors. Licensed under Apache 2.0.

import DOMPurify from "dompurify";
import { useEffect, useRef } from "react";

interface EmailBodyProps {
  body: string;
  autoSize?: boolean;
}

const BASE_STYLE = `
  :host { display: block; width: 100%; height: 100%; overflow: auto; background: #fff; color: #1a1a1a; }
  .body { box-sizing: border-box; padding: 24px; font: 14px/1.6 system-ui, sans-serif; overflow-wrap: anywhere; }
  a { color: #2563eb; } img { max-width: 100%; height: auto; }
  blockquote { border-left: 3px solid #d1d5db; padding-left: 1em; margin-left: 0; color: #6b7280; }
  pre { background: #f3f4f6; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 13px; }
  table { border-collapse: collapse; max-width: 100%; } td, th { padding: 4px 8px; }
`;

/**
 * Stellt bereinigtes Mail-HTML in einem Shadow Root dar. Damit braucht die integrierte Oberfläche kein iframe und
 * fremde Mail-Styles gelangen nicht in Haben. Externe Bilder werden vor dem Einfügen entfernt; data:-Bilder bleiben.
 */
export default function EmailIframe({ body, autoSize }: EmailBodyProps) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!host.current) return;
    const root = host.current.shadowRoot ?? host.current.attachShadow({ mode: "open" });
    const clean = DOMPurify.sanitize(body, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["script", "style", "form", "object", "embed", "svg", "math"],
      FORBID_ATTR: ["srcdoc", "formaction"],
    });
    const template = document.createElement("template");
    template.innerHTML = clean;
    for (const image of template.content.querySelectorAll("img")) {
      const source = image.getAttribute("src") ?? "";
      if (!source.startsWith("data:") && !source.startsWith("/api/webmail/")) image.removeAttribute("src");
    }
    for (const link of template.content.querySelectorAll("a")) {
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
    }
    root.replaceChildren();
    const style = document.createElement("style");
    style.textContent = BASE_STYLE;
    const content = document.createElement("div");
    content.className = "body";
    if (autoSize) content.style.padding = "0";
    content.append(template.content);
    root.append(style, content);
  }, [body, autoSize]);

  return <div ref={host} className="block w-full" style={autoSize ? undefined : { height: "100%" }} aria-label="E-Mail-Inhalt" />;
}
