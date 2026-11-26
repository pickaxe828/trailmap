const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function formatExpeditionDate(timestamp: number): string {
  return dateFormat.format(timestamp);
}

function reviewHref(page: 'expedition' | 'thread', id: string, stop?: string): string {
  const url = new URL(chrome.runtime.getURL(`/${page}.html`));
  url.searchParams.set('id', id);
  if (stop) url.searchParams.set('stop', stop);
  return url.href;
}

export const expeditionHref = (id: string, stop?: string) => reviewHref('expedition', id, stop);
export const threadHref = (id: string) => reviewHref('thread', id);
