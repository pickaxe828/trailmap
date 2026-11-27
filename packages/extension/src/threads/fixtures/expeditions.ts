import type { DescriptionParts } from '../description';

/**
 * Labelled fixture set for thread-match calibration (PLAN §4.7). `topic` is the label: two Expeditions are a related pair
 * exactly when they share a topic. Several topics sit in the same field (two cooking topics, three programming ones) so the
 * unrelated pairs include hard negatives, not only distant ones. Concepts are in rank order, as `readExpeditionTopConcepts` returns them.
 */
export type FixtureExpedition = { id: string; topic: string; parts: DescriptionParts };

const f = (id: string, topic: string, title: string, drivingQuestion: string, concepts: string[], found: string, myNotes?: string): FixtureExpedition => ({
  id, topic, parts: { title, drivingQuestion, concepts, myNotes, fieldNotes: `## Question\n\n${drivingQuestion}\n\n## What you found\n\n${found}\n\n## Key ideas\n\n- Something (https://learn.test/x)\n` },
});

export const FIXTURE_EXPEDITIONS: FixtureExpedition[] = [
  f('epaxial', 'back-muscles', 'Epaxial musculature', 'What are the epaxial muscles and what do they do?', ['Erector spinae', 'Multifidus', 'Longissimus'],
    'The epaxial muscles lie along the spine and extend and stabilise the trunk; the erector spinae is the largest group.'),
  f('back-group', 'back-muscles', 'Back muscle group', 'Which muscles make up the back?', ['Erector spinae', 'Latissimus dorsi', 'Trapezius'],
    'The back has superficial muscles for shoulder movement and deep muscles, such as the erector spinae, that hold the spine upright.'),
  f('knee', 'knee-ligaments', 'Knee ligaments', 'How do the ACL and meniscus differ?', ['Anterior cruciate ligament', 'Meniscus', 'Patella'],
    'The ACL stops the shin sliding forward, while the meniscus cushions the joint.'),
  f('maillard', 'maillard', 'Maillard reaction', 'Why does searing brown meat?', ['Maillard reaction', 'Amino acids', 'Reducing sugars'],
    'Heat above about 140 degrees makes amino acids and sugars react into brown, savoury compounds.'),
  f('sear', 'maillard', 'Searing steak', 'How hot should the pan be for a good crust?', ['Maillard reaction', 'Smoke point', 'Browning'],
    'A dry surface and a hot pan favour browning; moisture holds the temperature down at the boiling point.'),
  f('sourdough', 'sourdough', 'Sourdough starter', 'How do I keep a starter alive?', ['Wild yeast', 'Lactobacillus', 'Hydration'],
    'A starter is a culture of wild yeast and bacteria fed with flour and water on a regular schedule.'),
  f('edm', 'edm', 'EDM build-ups', 'How do producers build tension before a drop?', ['Riser', 'Snare roll', 'High-pass filter'],
    'Build-ups raise pitch, density and filter cutoff over a few bars, then drop everything for contrast.'),
  f('sidechain', 'edm', 'Sidechain compression', 'How do I make the bass duck under the kick?', ['Sidechain compression', 'Kick drum', 'Compressor'],
    'A compressor on the bass listens to the kick and turns the bass down on each hit, so the kick stays clear.'),
  f('piano', 'jazz-harmony', 'Jazz chord voicings', 'What is a rootless voicing?', ['Rootless voicing', 'Seventh chord', 'Ii-V-I'],
    'Pianists leave out the root and play the third and seventh with extensions, since the bass covers the root.'),
  f('crdt-1', 'crdts', 'Replicated lists', 'How do CRDTs order list inserts?', ['CRDT', 'Tombstone', 'Sequence CRDT'],
    'Each element gets a unique identifier so concurrent inserts converge to the same order on every replica.'),
  f('crdt-2', 'crdts', 'Related list algorithms', 'Which sequence CRDTs exist?', ['CRDT', 'RGA', 'Logoot'],
    'RGA, Logoot and Yjs differ in how they identify elements and how much metadata they keep.'),
  f('crdt-3', 'crdts', 'Collaborative editing garbage', 'When can tombstones be removed?', ['Tombstone', 'Garbage collection', 'CRDT'],
    'Tombstones can be dropped once every replica has seen the delete, which needs some causal stability tracking.'),
  f('raft', 'consensus', 'Raft consensus', 'How does Raft elect a leader?', ['Raft', 'Leader election', 'Quorum'],
    'A follower that hears nothing becomes a candidate and wins with votes from a majority of the servers.'),
  f('borrow', 'rust-ownership', 'Rust borrow checker', 'Why does the borrow checker reject this code?', ['Ownership', 'Lifetime', 'Borrowing'],
    'A mutable borrow cannot overlap with any other borrow of the same value.'),
  f('lifetimes', 'rust-ownership', 'Rust lifetimes', 'When do I need to write lifetime annotations?', ['Lifetime', 'Ownership', 'Elision'],
    'Annotations are needed when the compiler cannot tell which input a returned reference came from.'),
  f('tokio', 'rust-async', 'Tokio runtime', 'How does Tokio schedule tasks?', ['Tokio', 'Async runtime', 'Work stealing'],
    'Tokio runs futures on a work-stealing thread pool and parks idle workers.'),
  f('css-grid', 'css-layout', 'CSS grid', 'How do grid-template-areas work?', ['CSS Grid', 'Grid template areas', 'Flexbox'],
    'Named areas let a layout be written as an ASCII picture of the page.'),
  f('flex', 'css-layout', 'Flexbox alignment', 'What is the difference between align-items and align-content?', ['Flexbox', 'Align items', 'Cross axis'],
    'align-items places items in each line, while align-content spaces whole lines when the container is taller.'),
  f('roman', 'roman-history', 'Roman republic collapse', 'Why did the Roman Republic fall?', ['Julius Caesar', 'Roman Senate', 'Optimates and populares'],
    'Rival generals with loyal armies and a divided Senate ended the Republic.'),
  f('punic', 'roman-history', 'Punic Wars', 'Why did Rome fight Carthage?', ['Hannibal', 'Carthage', 'Roman Senate'],
    'Rival claims over Sicily and trade led to three wars, ending with the destruction of Carthage.'),
  f('flights', 'travel', 'Flights to Lisbon', 'Which airline is cheapest in March?', ['Lisbon', 'Budget airline'],
    'Fares are lowest on Tuesday departures and with hand baggage only.'),
];
