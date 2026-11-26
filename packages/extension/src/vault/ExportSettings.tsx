import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { strToU8, zipSync } from 'fflate';
import { useState } from 'react';
import { openTrailmapDb } from '../db/db';
import { exportJson, readMarkdownNotes } from './data';

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Keep the blob alive until Chromium has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function ExportSettings() {
  const [error, setError] = useState('');
  const [working, setWorking] = useState<'markdown' | 'json'>();

  async function run(format: 'markdown' | 'json') {
    if (working) return;
    setWorking(format);
    setError('');
    const db = openTrailmapDb();
    try {
      if (format === 'markdown') {
        const notes = await readMarkdownNotes(db);
        const archive = zipSync(Object.fromEntries(notes.map(({ path, markdown }) => [path, strToU8(markdown)])));
        download(new Blob([new Uint8Array(archive)], { type: 'application/zip' }), 'trailmap-markdown.zip');
      } else {
        download(new Blob([await exportJson(db)], { type: 'application/json' }), 'trailmap.json');
      }
    } catch {
      setError('Could not export Trailmap data. Try again.');
    } finally {
      db.close();
      setWorking(undefined);
    }
  }

  return (
    <VStack as="section" id="exports" gap={2} aria-label="Exports">
      <Heading level={2}>Exports</Heading>
      <Text type="supporting">Exports work without the companion. The JSON dump includes browsing data and the model audit log.</Text>
      <HStack gap={2} wrap="wrap">
        <Button label="Export all as Markdown (zip)" isLoading={working === 'markdown'} isDisabled={working === 'json'}
          onClick={() => void run('markdown')} />
        <Button label="Export JSON dump" isLoading={working === 'json'} isDisabled={working === 'markdown'}
          onClick={() => void run('json')} />
      </HStack>
      {error && <Text role="alert">{error}</Text>}
    </VStack>
  );
}
