import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { openExternalUrl } from "../api/tauri";

interface MarkdownViewProps {
  content: string;
}

function isAllowedExternalHref(href: string | undefined): href is string {
  if (!href) {
    return false;
  }
  try {
    const parsed = new URL(href);
    return (
      parsed.protocol === "http:" ||
      parsed.protocol === "https:" ||
      parsed.protocol === "mailto:" ||
      parsed.protocol === "tel:"
    );
  } catch {
    return false;
  }
}

function transformMarkdownUrl(url: string): string {
  if (/^tel:/i.test(url.trim())) {
    return url.trim();
  }
  return defaultUrlTransform(url);
}

export function MarkdownView({ content }: MarkdownViewProps) {
  if (!content.trim()) {
    return null;
  }

  return (
    <div className="st-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        urlTransform={transformMarkdownUrl}
        components={{
          a: ({ node: _node, href, children, ...props }) => (
            <a
              {...props}
              href={href}
              rel="noreferrer noopener"
              onClick={(event) => {
                event.preventDefault();
                if (isAllowedExternalHref(href)) {
                  void openExternalUrl(href).catch(() => {});
                }
              }}
            >
              {children}
            </a>
          ),
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}
