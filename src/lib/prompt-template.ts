/**
 * Renders a `.md` prompt template loaded via `import x from './foo.md'`.
 * Placeholders use `{{name}}` syntax; every placeholder in the template must
 * have a matching value, and every value must be used — this catches typos
 * in either the template or the call site instead of silently passing raw
 * template text through to the model.
 */
export function renderPromptTemplate(template: string, values: Record<string, string>): string {
  const usedKeys = new Set<string>();

  const rendered = template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if (!(key in values)) {
      throw new Error(`Missing value for prompt placeholder "{{${key}}}"`);
    }
    usedKeys.add(key);
    return values[key];
  });

  for (const key of Object.keys(values)) {
    if (!usedKeys.has(key)) {
      throw new Error(`Unused prompt value "${key}" was not referenced by the template`);
    }
  }

  return rendered.trim();
}
