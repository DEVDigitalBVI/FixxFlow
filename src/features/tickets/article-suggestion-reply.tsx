import Link from 'next/link';

/** Only the fixed guide-link format emitted by the trusted automation command. */
export function ArticleSuggestionReply({ body }: { body: string }) {
  return (
    <div className="stack stack-sm">
      {body.split('\n\n').map((block, index) => {
        const guide =
          /^([^\n]+)\nhttps:\/\/fixxflow\.com\/app\/help\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(
            block,
          );
        return guide ? (
          <p key={index}>
            <Link href={`/app/help/${guide[2]}`}>{guide[1]}</Link>
          </p>
        ) : (
          <p key={index}>{block}</p>
        );
      })}
    </div>
  );
}
