/** Shared plain-text rendering for public Pigafetta and the editor assistant.
 * Model text never becomes executable HTML. */
export default function ChatBubble({ content }: { content: string }) {
  return <div className="pig-bubble">{content}</div>;
}
