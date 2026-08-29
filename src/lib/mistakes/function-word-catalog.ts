import { MistakeErrorSubtype } from '@models/enums';

/**
 * Which class of function word an Open Cloze (UoE Part 2) gap required.
 *
 * Open Cloze is the one task type where a closed lookup is not a compromise
 * but the correct model: the answer is always a single grammatical word, and
 * English has a finite, well-known inventory of those. Unlike the suffix
 * heuristics elsewhere in this module, a hit here is a fact, not a guess.
 *
 * A word outside the table resolves to null — Open Cloze occasionally
 * accepts a lexical word ("take", "way"), and inventing a class for those
 * would be exactly the false positive this module avoids.
 */

const CLASS_BY_WORD = new Map<string, MistakeErrorSubtype>();

function register(subtype: MistakeErrorSubtype, words: readonly string[]): void {
  for (const word of words) {
    // First registration wins: a word listed under two classes keeps the one
    // declared first below, so the ordering of these calls is the tie-break.
    if (!CLASS_BY_WORD.has(word)) CLASS_BY_WORD.set(word, subtype);
  }
}

// Articles first — tiny, closed, and unambiguous.
register(MistakeErrorSubtype.ARTICLE, ['a', 'an', 'the']);

register(MistakeErrorSubtype.AUXILIARY, [
  'be','am','is','are','was','were','been','being',
  'have','has','had','having',
  'do','does','did',
  'will','would','shall','should','can','could','may','might','must','ought',
  'not',
]);

register(MistakeErrorSubtype.PRONOUN, [
  'i','you','he','she','it','we','they',
  'me','him','her','us','them',
  'my','your','his','its','our','their',
  'mine','yours','hers','ours','theirs',
  'myself','yourself','himself','herself','itself','ourselves','themselves',
  'who','whom','whose','which','that','what',
  'one','ones','there','this','these','those',
  'someone','anyone','everyone','nobody','something','anything','everything','nothing',
]);

register(MistakeErrorSubtype.PREPOSITION, [
  'in','on','at','for','with','by','from','to','of','about','into','onto',
  'over','under','above','below','between','among','through','across','along',
  'against','towards','toward','during','before','after','behind','beyond',
  'within','without','upon','off','out','up','down','around','near','beside',
  'despite','per','via',
]);

register(MistakeErrorSubtype.LINKER, [
  'although','though','however','whereas','while','unless','since','because',
  'therefore','moreover','furthermore','nevertheless','nonetheless','otherwise',
  'besides','instead','meanwhile','hence','thus','so','yet','but','and','or',
  'if','whether','when','where','why','how','once','until','till','as',
]);

register(MistakeErrorSubtype.QUANTIFIER, [
  'much','many','more','most','few','little','less','least','some','any','no',
  'none','all','both','either','neither','each','every','enough','several',
  'plenty','lot','lots','half','another','other','others',
]);

/** The class of function word this answer is, or null when it isn't a known one. */
export function classifyFunctionWord(word: string): MistakeErrorSubtype | null {
  return CLASS_BY_WORD.get(word) ?? null;
}
