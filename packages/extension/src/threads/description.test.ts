import { expect, test } from 'bun:test';
import { buildDescription, foundSummary } from './description';

const fieldNotes = '## Question\n\nWhy?\n\n## What you found\n\nThe [erector spinae](https://a.test/x) holds the spine upright.\nIt is the largest group.\n\n## Key ideas\n\n- Idea (https://a.test/y)\n';

test('the summary is the "What you found" paragraph, without links or other sections', () => {
  expect(foundSummary(fieldNotes)).toBe('The erector spinae holds the spine upright. It is the largest group.');
  expect(foundSummary(null)).toBe('');
  expect(foundSummary('## Question\n\nOnly this')).toBe('');
});

test('the description orders title, question, My notes, concepts, then the generated summary', () => {
  const parts = { title: 'Back muscles', drivingQuestion: 'Which muscles?', myNotes: 'my own words', fieldNotes, concepts: ['Erector spinae', 'Multifidus'] };
  expect(buildDescription(parts, true)).toBe(['Back muscles', 'Which muscles?', 'my own words', 'Erector spinae', 'Multifidus',
    'The erector spinae holds the spine upright. It is the largest group.'].join('\n'));
  expect(buildDescription(parts, false)).not.toContain('my own words');
});
