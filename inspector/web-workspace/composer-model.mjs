/**
 * Pure, framework-free composer model shared by the browser Workspace and the
 * Node test-suite.
 *
 * The chat contract (single-line and multi-line alike) is: the *full* trimmed
 * input is always the Task specification, and the first line is the title.
 * A title is only ever shortened when it exceeds the Runtime's documented
 * title field limit; the specification is never truncated.
 */

export const COMPOSER_TITLE_MAX = 1024;

/**
 * Derive the task authoring parameters from a composer submission.
 *
 * @param {string} raw    raw composer value (may contain newlines)
 * @param {object} [options]
 * @param {number} [options.maxTitle=COMPOSER_TITLE_MAX] safe title length limit
 * @returns {{title: string, spec: string, firstLine: string}|null} null when
 *          the trimmed input is empty (nothing to create).
 */
export function deriveComposerParams(raw, { maxTitle = COMPOSER_TITLE_MAX } = {}) {
  const spec = typeof raw === 'string' ? raw.trim() : '';
  if (!spec) return null;
  const firstLine = spec.split(/\r?\n/, 1)[0].trim();
  const title = firstLine.length > maxTitle ? firstLine.slice(0, maxTitle) : firstLine;
  return { title, spec, firstLine };
}
