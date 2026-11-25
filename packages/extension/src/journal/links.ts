const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function formatExpeditionDate(timestamp: number): string {
  return dateFormat.format(timestamp);
}

export function expeditionHref(id: string): string {
  const url = new URL(chrome.runtime.getURL('/expedition.html'));
  url.searchParams.set('id', id);
  return url.href;
}
