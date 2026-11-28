export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Keep the blob alive until Chromium has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
