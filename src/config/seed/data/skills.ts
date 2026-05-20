export interface SkillSeedRow {
  name: string;
  slug: string;
  description: string;
}

export const SKILLS_SEED: SkillSeedRow[] = [
  {
    name: 'Reading',
    slug: 'reading',
    description: 'Reading comprehension for B2 First',
  },
  {
    name: 'Use of English',
    slug: 'use-of-english',
    description: 'Grammar and vocabulary for B2 First',
  },
  {
    name: 'Writing',
    slug: 'writing',
    description: 'Written production for B2 First',
  },
  {
    name: 'Listening',
    slug: 'listening',
    description: 'Listening comprehension for B2 First',
  },
  {
    name: 'Speaking',
    slug: 'speaking',
    description: 'Spoken interaction and production for B2 First',
  },
];
