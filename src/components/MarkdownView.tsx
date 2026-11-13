import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { lang } from "../lang";

interface MarkdownViewProps {
  content: string;
}

export function MarkdownView({ content }: MarkdownViewProps) {
  if (!content.trim()) {
    return (
      <p className="text-[length:var(--st-text-sm)] leading-[var(--st-leading-sm)] text-[color:var(--st-text-muted)] m-0">
        {lang.detail.emptyReadme}
      </p>
    );
  }

  return (
    <div className="st-markdown">
      <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
    </div>
  );
}
