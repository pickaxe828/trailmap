import { Link } from '@astryxdesign/core/Link';
import { Markdown } from '@astryxdesign/core/Markdown';
import { Text } from '@astryxdesign/core/Text';
import { webUrl } from '../ui/web-url';

const components: NonNullable<Parameters<typeof Markdown>[0]['components']> = {
  // Merely opening a note must not contact sites named in Markdown images.
  image: ({ alt }) => <Text>{alt}</Text>,
  link: ({ href, children }) => {
    const url = webUrl(href);
    return url ? <Link href={url.href} target="_blank" rel="noopener noreferrer">{children}</Link> : <>{children}</>;
  },
};

export function FieldNotesMarkdown({ children }: { children: string }) {
  return <Markdown density="compact" headingLevelStart={3} components={components}>{children}</Markdown>;
}
