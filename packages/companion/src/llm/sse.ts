/** SSE data events, including multi-line data, CR/LF splits and UTF-8 split across reads. */
export async function* readSse(body: ReadableStream<Uint8Array>, onBytes: () => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let line = '';
  let event: string | undefined;
  let data = '';
  let afterCr = false;
  try {
    for (;;) {
      const chunk = await reader.read();
      // SSE does not dispatch an unfinished event at EOF.
      if (chunk.done) return;
      onBytes();
      for (const char of decoder.decode(chunk.value, { stream: true })) {
        const skipLf = afterCr;
        afterCr = char === '\r';
        if (skipLf && char === '\n') continue;
        if (char !== '\n' && char !== '\r') {
          line += char;
          if (line.length > 1_048_576) throw new Error('SSE line exceeds limit');
          continue;
        }
        if (!line) {
          if (data) yield { event, data: data.slice(0, -1) };
          event = undefined;
          data = '';
          continue;
        }
        const colon = line.indexOf(':');
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
        if (field === 'event') event = value;
        if (field === 'data') {
          data += value + '\n';
          if (data.length > 1_048_576) throw new Error('SSE event exceeds limit');
        }
        line = '';
      }
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
