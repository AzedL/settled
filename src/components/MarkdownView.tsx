import Markdown from "react-markdown";
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
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function MarkdownView({ content }: MarkdownViewProps) {
  if (!content.trim()) {
    return null;
  }

  return (
    <div className="st-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children, ...props }) => (
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
