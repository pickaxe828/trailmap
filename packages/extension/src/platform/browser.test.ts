import { expect, test } from 'bun:test';
import { isActiveDocument, trailFavicon } from './browser';

const PAGE = 'https://learn.test/article';
const ICON = 'data:image/png;base64,iVBORw0KGgo=';
const extensionUrl = (path: string) => `chrome-extension://trailmap${path}`;

test('the Chromium Trail keeps using the browser favicon cache', () => {
  expect(trailFavicon(PAGE, 32, ICON, false, extensionUrl)).toBe(
    'chrome-extension://trailmap/_favicon/?pageUrl=https%3A%2F%2Flearn.test%2Farticle&size=32',
  );
});

test('the Gecko Trail uses only a captured raster icon and does not fetch a remote image', () => {
  expect(trailFavicon(PAGE, 32, ICON, true)).toBe(ICON);
  expect(trailFavicon(PAGE, 32, 'https://learn.test/favicon.ico', true)).toBeUndefined();
  expect(trailFavicon(PAGE, 32, 'data:image/svg+xml;base64,AAAA', true)).toBeUndefined();
  expect(trailFavicon(PAGE, 32, undefined, true)).toBeUndefined();
});

test('Gecko admits a document ID without Chrome lifecycle metadata, but not an unidentified document', () => {
  expect(isActiveDocument({ documentId: 'visit-document' }, true)).toBe(true);
  expect(isActiveDocument({}, true)).toBe(false);
  expect(isActiveDocument({ documentId: 'visit-document', documentLifecycle: 'prerender' }, true)).toBe(false);
  expect(isActiveDocument({ documentId: 'visit-document' }, false)).toBe(false);
  expect(isActiveDocument({ documentLifecycle: 'active' }, false)).toBe(true);
});
