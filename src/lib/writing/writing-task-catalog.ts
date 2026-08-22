import { WritingTaskType } from '@models/enums';

export interface WritingTaskFormatEntry {
  part: 1 | 2;
  /** Short label shown in the UI and used in prompts (e.g. "Article"). */
  label: string;
  /**
   * Real Cambridge B2 First format requirements for this task type,
   * injected into the generation prompt's {{formatBrief}} slot — the LLM
   * has no other source for what a real exam paper of this type looks like.
   */
  formatBrief: string;
  minWords: number;
  maxWords: number;
  timeLimitSeconds: number;
}

// All 5 types share the same 140-190 word range and 40-minute timer — this
// matches the real Cambridge B2 First Writing paper (both Part 1 and Part 2
// tasks are 140-190 words) and the countdown convention already established
// for Part 1. Only the generation brief differs per type.
const MIN_WORDS = 140;
const MAX_WORDS = 190;
const TIME_LIMIT_SECONDS = 2400;

const WRITING_TASK_CATALOG: Readonly<Record<WritingTaskType, WritingTaskFormatEntry>> = {
  [WritingTaskType.ESSAY]: {
    part: 1,
    label: 'Essay',
    formatBrief:
      'a short essay title/topic, some input notes or a brief context (an opinion the student must discuss, agree or disagree with, or a question to answer), and two content points the essay must address, with room for the student to add a third point of their own',
    minWords: MIN_WORDS,
    maxWords: MAX_WORDS,
    timeLimitSeconds: TIME_LIMIT_SECONDS,
  },
  [WritingTaskType.ARTICLE]: {
    part: 2,
    label: 'Article',
    formatBrief:
      "a prompt asking for an article for a magazine, website, or the student's school/college magazine, giving a short context (e.g. a magazine is inviting readers to submit articles on a topic) and 2-3 content points to address (for example: describe an experience, give opinions, or make recommendations). Suggest an engaging title/topic appropriate for an article's readership",
    minWords: MIN_WORDS,
    maxWords: MAX_WORDS,
    timeLimitSeconds: TIME_LIMIT_SECONDS,
  },
  [WritingTaskType.EMAIL]: {
    part: 2,
    label: 'Email/Letter',
    formatBrief:
      "a prompt giving a short input (e.g. an excerpt from an email, notice, or advert) the student must respond to with an email or letter, with 2-3 content points to cover. Specify who the recipient is (a friend, a stranger, an organisation, etc.) so the required register (informal or formal) is clear from context, without stating the register explicitly",
    minWords: MIN_WORDS,
    maxWords: MAX_WORDS,
    timeLimitSeconds: TIME_LIMIT_SECONDS,
  },
  [WritingTaskType.REPORT]: {
    part: 2,
    label: 'Report',
    formatBrief:
      "a prompt asking for a report for a specific reader (e.g. a school principal, college manager, or class teacher), with 2-3 content points to cover (for example: describe the current situation, evaluate options, and recommend a course of action). The task should make clear this needs a formal register and clear organisation, with headings encouraged but not mandatory",
    minWords: MIN_WORDS,
    maxWords: MAX_WORDS,
    timeLimitSeconds: TIME_LIMIT_SECONDS,
  },
  [WritingTaskType.REVIEW]: {
    part: 2,
    label: 'Review',
    formatBrief:
      'a prompt asking for a review (of a film, book, restaurant, product, or event) for a magazine or website, with 2-3 content points to cover (for example: describe it, give a personal opinion, and recommend it — or not — to a specific readership)',
    minWords: MIN_WORDS,
    maxWords: MAX_WORDS,
    timeLimitSeconds: TIME_LIMIT_SECONDS,
  },
};

export function getWritingTaskFormat(taskType: WritingTaskType): WritingTaskFormatEntry {
  return WRITING_TASK_CATALOG[taskType];
}

export { WRITING_TASK_CATALOG };
