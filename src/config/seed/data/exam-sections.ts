export interface ExamSectionSeedRow {
  skillSlug: string;
  slug: string;
  name: string;
  description: string;
  maxScore: number | null;
  defaultDurationMinutes: number | null;
}

export const EXAM_SECTIONS_SEED: ExamSectionSeedRow[] = [
  // Use of English (Parts 1-4)
  {
    skillSlug: 'use-of-english',
    slug: 'uoe-part-1',
    name: 'Part 1 - Multiple Choice Cloze',
    description: 'Choose the correct word for 8 gaps in a text (1 mark each)',
    maxScore: 8,
    defaultDurationMinutes: 15,
  },
  {
    skillSlug: 'use-of-english',
    slug: 'uoe-part-2',
    name: 'Part 2 - Open Cloze',
    description: 'Fill 8 gaps with a single word each (1 mark each)',
    maxScore: 8,
    defaultDurationMinutes: 15,
  },
  {
    skillSlug: 'use-of-english',
    slug: 'uoe-part-3',
    name: 'Part 3 - Word Formation',
    description: 'Transform 8 root words to fit the context (1 mark each)',
    maxScore: 8,
    defaultDurationMinutes: 15,
  },
  {
    skillSlug: 'use-of-english',
    slug: 'uoe-part-4',
    name: 'Part 4 - Key Word Transformation',
    description: 'Rewrite 6 sentences using a key word (up to 2 marks each)',
    maxScore: 12,
    defaultDurationMinutes: 20,
  },
  // Reading (Parts 5-7)
  {
    skillSlug: 'reading',
    slug: 'reading-part-5',
    name: 'Part 5 - Multiple Choice',
    description: 'Read a long text and answer 6 multiple choice questions (1 mark each)',
    maxScore: 6,
    defaultDurationMinutes: 20,
  },
  {
    skillSlug: 'reading',
    slug: 'reading-part-6',
    name: 'Part 6 - Gapped Text',
    description: 'Restore 6 sentences removed from a text (2 marks each)',
    maxScore: 6,
    defaultDurationMinutes: 20,
  },
  {
    skillSlug: 'reading',
    slug: 'reading-part-7',
    name: 'Part 7 - Multiple Matching',
    description: 'Match 10 statements to sections of a text (1 mark each)',
    maxScore: 10,
    defaultDurationMinutes: 15,
  },
  // Writing (Parts 1-2)
  {
    skillSlug: 'writing',
    slug: 'writing-part-1',
    name: 'Part 1 - Essay',
    description: 'Write a discursive essay of 140-190 words using two given ideas (mandatory)',
    maxScore: 20,
    defaultDurationMinutes: 40,
  },
  {
    skillSlug: 'writing',
    slug: 'writing-part-2',
    name: 'Part 2 - Situational Writing',
    description: 'Write an article, email, letter, report or review of 140-190 words (choice)',
    maxScore: 20,
    defaultDurationMinutes: 40,
  },
  // Listening (Parts 1-4)
  {
    skillSlug: 'listening',
    slug: 'listening-part-1',
    name: 'Part 1 - Multiple Choice',
    description: '8 short recordings, 1 multiple choice question each (1 mark each)',
    maxScore: 8,
    defaultDurationMinutes: 8,
  },
  {
    skillSlug: 'listening',
    slug: 'listening-part-2',
    name: 'Part 2 - Sentence Completion',
    description: 'Complete 10 sentences while listening to a long monologue (1 mark each)',
    maxScore: 10,
    defaultDurationMinutes: 8,
  },
  {
    skillSlug: 'listening',
    slug: 'listening-part-3',
    name: 'Part 3 - Multiple Matching',
    description: 'Match 5 speakers to 8 options (1 mark each)',
    maxScore: 5,
    defaultDurationMinutes: 6,
  },
  {
    skillSlug: 'listening',
    slug: 'listening-part-4',
    name: 'Part 4 - Multiple Choice Interview',
    description: '7 multiple choice questions about an interview (1 mark each)',
    maxScore: 7,
    defaultDurationMinutes: 8,
  },
  // Speaking (Parts 1-4)
  {
    skillSlug: 'speaking',
    slug: 'speaking-part-1',
    name: 'Part 1 - Interview',
    description: 'Answer examiner questions about yourself and your opinions',
    maxScore: null,
    defaultDurationMinutes: 2,
  },
  {
    skillSlug: 'speaking',
    slug: 'speaking-part-2',
    name: 'Part 2 - Long Turn',
    description: "Talk for 1 minute about 2-3 photos, then briefly comment on partner's photos",
    maxScore: null,
    defaultDurationMinutes: 4,
  },
  {
    skillSlug: 'speaking',
    slug: 'speaking-part-3',
    name: 'Part 3 - Collaborative Task',
    description: 'Discuss visual prompts with partner, negotiate and reach a decision',
    maxScore: null,
    defaultDurationMinutes: 4,
  },
  {
    skillSlug: 'speaking',
    slug: 'speaking-part-4',
    name: 'Part 4 - Discussion',
    description: 'Discuss broader questions related to the topic of Part 3',
    maxScore: null,
    defaultDurationMinutes: 5,
  },
];
