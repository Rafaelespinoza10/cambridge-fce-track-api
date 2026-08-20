/**
 * Topic bank injected into practice-exercise and writing-task generation
 * prompts so the LLM doesn't converge on a handful of "safe" scenarios
 * (cafés, generic environment small talk) every time it's asked for B2
 * First material. Topics mirror the subject areas genuine Cambridge B2
 * First Reading/Use of English and Writing papers draw on. Pure, in-memory,
 * no DB — same pattern as practice-exam-catalog.ts.
 */

export const EXAM_TOPICS: readonly string[] = [
  'travel and tourism',
  'working abroad or studying abroad',
  'technology and the internet',
  'social media and online communication',
  'artificial intelligence and automation',
  'the environment and climate change',
  'wildlife and conservation',
  'renewable energy',
  'sport and fitness',
  'extreme sports and outdoor adventure',
  'health and wellbeing',
  'sleep and daily habits',
  'food, cooking, and culinary trends',
  'education and learning styles',
  'apprenticeships and career choices',
  'remote work and changing workplaces',
  'volunteering and community projects',
  'friendship and family relationships',
  'generational differences',
  'hobbies and free time activities',
  'music and the film industry',
  'books, reading, and libraries',
  'theatre, dance, and the arts',
  'photography and visual arts',
  'video games and esports',
  'fashion and personal style',
  'shopping and consumer trends',
  'money, saving, and personal finance',
  'transport and travel innovations',
  'city life versus country life',
  'urban development and housing',
  'festivals and celebrations around the world',
  'museums and historical monuments',
  'ancient civilisations and archaeology',
  'space exploration',
  'scientific discoveries and inventions',
  'robotics',
  'animals as pets and animal behaviour',
  'national parks and nature reserves',
  'natural disasters and extreme weather',
  'recycling and sustainable living',
  'plastic pollution and waste reduction',
  'migration and multiculturalism',
  'language learning',
  'journalism and the media',
  'advertising and marketing',
  'minimalism and lifestyle choices',
  'mountaineering and exploration',
  'ocean exploration and marine life',
  'gap years and life-changing trips',
];

/**
 * Random pick, not user-visible — callers pass the result straight into a
 * prompt template placeholder. Uses Math.random rather than a seeded RNG:
 * generation is a one-shot LLM call, not something that needs to be
 * deterministic across retries.
 */
export function pickRandomExamTopic(): string {
  const index = Math.floor(Math.random() * EXAM_TOPICS.length);
  return EXAM_TOPICS[index];
}
