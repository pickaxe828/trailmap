export function webUrl(input: string): URL | null {
  const url = URL.parse(input);
  return url?.protocol === 'https:' || url?.protocol === 'http:' ? url : null;
}
