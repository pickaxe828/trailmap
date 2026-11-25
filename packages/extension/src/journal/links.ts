const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function formatExpeditionDate(timestamp: number): string {
  return dateFormat.format(timestamp);
}

function reviewHref(page: 'expedition' | 'thread', id: string): string {
  const url = new URL(chrome.runtime.getURL(`/${page}.html`));
  url.searchParams.set('id', id);
  return url.href;
}

export const expeditionHref = (id: string) => reviewHref('expedition', id);
export const threadHref = (id: string) => reviewHref('thread', id);
