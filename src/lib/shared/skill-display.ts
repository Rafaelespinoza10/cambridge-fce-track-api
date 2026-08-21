/** UI accent colors keyed by skill slug (aligned with frontend). */
export const SKILL_ACCENT_COLORS: Readonly<Record<string, string>> = {
  reading: '#60a5fa',
  listening: '#a78bfa',
  writing: '#f472b6',
  speaking: '#fb923c',
  'use-of-english': '#34d399',
  grammar: '#2dd4bf',
  vocabulary: '#fbbf24',
};

const DEFAULT_ACCENT_COLOR = '#94a3b8';

export function getSkillAccentColor(slug: string): string {
  return SKILL_ACCENT_COLORS[slug] ?? DEFAULT_ACCENT_COLOR;
}
