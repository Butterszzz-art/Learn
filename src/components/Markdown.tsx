import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Long-form markdown in the app's reading style. Links open in a new tab. */
export function Markdown({ children, className = "" }: { children: string; className?: string }) {
  return (
    <div
      className={`prose max-w-none text-neuron-text prose-headings:font-display prose-headings:text-neuron-text prose-p:leading-relaxed prose-a:text-neuron-accent prose-strong:text-neuron-text prose-code:text-neuron-accent2 prose-blockquote:border-neuron-accent prose-blockquote:text-neuron-muted prose-li:marker:text-neuron-muted prose-th:text-neuron-text prose-td:border-neuron-border prose-hr:border-neuron-border ${className}`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
