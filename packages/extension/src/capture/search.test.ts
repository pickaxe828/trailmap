import { expect, test } from 'bun:test';
import { parseSearchQuery } from './search';

test.each([
  ['https://www.google.com/search?q=crdt+deletes&sourceid=chrome', 'google', 'crdt deletes'],
  ['https://www.google.co.uk/search?q=C%2B%2B', 'google', 'C++'],
  ['https://www.bing.com/search?q=vector%20clocks', 'bing', 'vector clocks'],
  ['https://duckduckgo.com/?q=causal+history&t=ffab', 'duckduckgo', 'causal history'],
  ['https://lite.duckduckgo.com/lite/?q=causal+history', 'duckduckgo', 'causal history'],
  ['https://kagi.com/search?q=%E5%88%86%E6%95%A3', 'kagi', '分散'],
  ['https://m.youtube.com/results?search_query=database+internals', 'youtube', 'database internals'],
  ['https://en.wikipedia.org/w/index.php?search=logical+clock&title=Special%3ASearch', 'wikipedia', 'logical clock'],
  ['https://en.m.wikipedia.org/wiki/Special:Search/Vector_clock', 'wikipedia', 'Vector clock'],
])('parses the search at %s', (url, engine, q) => {
  expect(parseSearchQuery(url)).toEqual({ engine, q });
});

test.each([
  'https://google.com.example.test/search?q=crdt',
  'https://google.io/search?q=crdt',
  'https://www.google.com/url?q=https%3A%2F%2Fexample.test',
  'https://www.google.com/search?q=+',
  'https://www.youtube.com/watch?v=123&search_query=crdt',
  'https://en.wikipedia.org/w/index.php?title=Example&search=crdt',
  'not a URL',
])('ignores the non-search URL %s', (url) => {
  expect(parseSearchQuery(url)).toBeNull();
});
