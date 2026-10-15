import Markdown from 'react-markdown';

export default function ChatReplyContent({ text }: { text: string }) {
  return (
    <div className="chat-reply-content">
      <Markdown
        skipHtml
        allowedElements={[
          'p',
          'br',
          'strong',
          'em',
          'ul',
          'ol',
          'li',
          'h1',
          'h2',
          'h3',
          'h4',
          'h5',
          'h6',
          'blockquote',
          'pre',
          'code',
        ]}
        unwrapDisallowed
      >
        {text}
      </Markdown>
    </div>
  );
}
