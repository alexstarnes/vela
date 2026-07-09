type TaskLike = {
  title: string;
  description?: string | null;
};

type RepoMapLike = {
  likelyFiles?: string[];
  dependencyNotes?: string[];
  summary?: string;
};

const STOPWORDS = new Set([
  'the',
  'and',
  'with',
  'from',
  'that',
  'this',
  'into',
  'between',
  'there',
  'their',
  'home',
  'page',
  'homepage',
  'bottom',
  'section',
  'update',
  'adjust',
  'spacing',
  'small',
  'little',
  'widget',
  'area',
  'correct',
  'change',
  'changes',
  'please',
  'find',
  'make',
  'add',
  'section',
]);

function taskText(task: TaskLike): string {
  return `${task.title}\n${task.description ?? ''}`.toLowerCase();
}

export function extractTaskSearchTerms(task: TaskLike): string[] {
  const text = taskText(task);
  const terms: string[] = [];

  const preferredTerms = [
    'turnstile',
    'cloudflare',
    'captcha',
    'verification',
    'waitlist',
    'signup',
    'email',
    'footer',
    'form',
  ];

  for (const term of preferredTerms) {
    if (text.includes(term)) {
      terms.push(term);
    }
  }

  const tokens = text.match(/[a-z0-9][a-z0-9_-]{3,}/g) ?? [];
  for (const token of tokens) {
    if (!STOPWORDS.has(token)) {
      terms.push(token);
    }
  }

  return [...new Set(terms)].slice(0, 8);
}

/**
 * Detect tasks whose goal is creating brand-new file(s) rather than editing an
 * existing target. For these, "no repository matches" is expected and must not
 * be treated as target-not-found.
 */
export function isFileCreationTask(task: TaskLike): boolean {
  const text = taskText(task);
  if (/\bnew (file|page|component|document|script)\b/.test(text)) {
    return true;
  }

  // Strong create verbs plus an explicit file name ("Create hello-world.html").
  // "add"-style edit phrasing alone does not count — editing tasks often name
  // the file they touch.
  return (
    /\b(create|generate|scaffold)\b/.test(text) &&
    /[a-z0-9_-]+\.(html|css|js|jsx|ts|tsx|md|mdx|json|txt|svg|py|sh)\b/.test(text)
  );
}

/** Explicit file names mentioned in the task text (e.g. "hello-world.html"). */
export function extractExplicitFileTargets(task: TaskLike): string[] {
  const text = taskText(task);
  const matches =
    text.match(/[a-z0-9_./-]*[a-z0-9_-]+\.(html|css|js|jsx|ts|tsx|md|mdx|json|txt|svg|py|sh)\b/g) ?? [];
  return [...new Set(matches)].slice(0, 6);
}

function buildCreationPlan(task: TaskLike): string {
  const targets = extractExplicitFileTargets(task);

  return [
    'Implementation plan:',
    '- This task creates new file(s); finding no existing matches in the repository is expected.',
    '- Create exactly the requested file(s) with complete, concrete content using write_workspace_file.',
    '- Do not modify existing files unless the task explicitly requires it.',
    '- Do not write placeholder content; produce the final requested content directly.',
    '',
    'Files to create:',
    ...(targets.length > 0
      ? targets.map((target) => `- \`${target}\``)
      : ['- Derive the file name and location from the task description']),
    '',
    'Smallest useful verification sequence:',
    '- Confirm the new file exists with the requested content (e.g. read it back)',
  ].join('\n');
}

export function buildLowRiskDeterministicPlan(
  task: TaskLike,
  repoMap?: RepoMapLike,
): string {
  if (isFileCreationTask(task)) {
    return buildCreationPlan(task);
  }

  const likelyFiles = repoMap?.likelyFiles ?? [];
  const dependencyNotes = repoMap?.dependencyNotes ?? [];
  const searchTerms = extractTaskSearchTerms(task);
  const noDirectMatch = likelyFiles.length === 0;

  return [
    'Implementation plan:',
    '- Search for the exact target using concrete task terms before browsing nearby files.',
    '- Read only the most likely existing file(s) that directly match the target UI or widget names.',
    '- If no exact target exists, stop and report target-not-found instead of editing a nearby section.',
    '- Make the smallest existing-layout change possible; do not create placeholder UI or move the widget.',
    '',
    'Likely files/modules to inspect first:',
    ...(likelyFiles.length > 0
      ? likelyFiles.slice(0, 6).map((filePath) => `- \`${filePath}\``)
      : [
          `- Search terms: ${searchTerms.length > 0 ? searchTerms.join(', ') : 'task title keywords'}`,
          '- No direct target file has been identified yet',
        ]),
    '',
    'Boundary notes:',
    ...(dependencyNotes.length > 0
      ? dependencyNotes.slice(0, 4).map((note) => `- ${note}`)
      : noDirectMatch
        ? ['- Do not modify unrelated components as a fallback when the exact target cannot be found']
        : ['- Stay within the matched target files unless one clearly imports the target component']),
    '',
    'Smallest useful verification sequence:',
    '- Run only the smallest relevant build/lint gate for the touched files',
  ].join('\n');
}
