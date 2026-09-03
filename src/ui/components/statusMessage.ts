/**
 * Turns the editor's single free-text status string into something the status bar and the
 * toast stack can present. Pure string work so it can be unit tested.
 */

export type StatusTone = 'info' | 'success' | 'warning' | 'error' | 'progress';

const ERROR_PATTERNS = [/\bfailed\b/i, /\berror\b/i, /could not\b/i, /couldn't\b/i, /\bunable to\b/i, /\brejected\b/i, /\binvalid\b/i];
const WARNING_PATTERNS = [/\bwarning/i, /\bmissing\b/i, /\bskipped\b/i, /\bnot found\b/i, /\bno .* loaded\b/i];
const SUCCESS_PATTERNS = [/\bexported\b/i, /\bexport complete/i, /\bsaved\b/i, /\bloaded\b/i, /\bimported\b/i, /\bdone\b/i];
const PROGRESS_PATTERNS = [/\bloading\b/i, /\bopening\b/i, /\bimporting\b/i, /\bexporting\b/i, /\bpreparing\b/i, /\bbuilding\b/i, /\.\.\.$/];

/** Best-effort severity for a status line. */
export function classifyStatusMessage(message: string): StatusTone {
  const text = message.trim();
  if (text === '') return 'info';
  if (ERROR_PATTERNS.some((pattern) => pattern.test(text))) return 'error';
  if (PROGRESS_PATTERNS.some((pattern) => pattern.test(text))) return 'progress';
  if (WARNING_PATTERNS.some((pattern) => pattern.test(text))) return 'warning';
  if (SUCCESS_PATTERNS.some((pattern) => pattern.test(text))) return 'success';
  return 'info';
}

/**
 * Only errors and completed long operations are worth interrupting the user with a toast;
 * everything else stays in the status bar.
 */
export function shouldToastStatus(message: string): boolean {
  const tone = classifyStatusMessage(message);
  if (tone === 'error') return true;
  if (tone !== 'success') return false;
  return /\bexport/i.test(message) || /\bimport/i.test(message) || /\bsaved\b/i.test(message);
}

/** Splits a long status into a bold summary and a quieter remainder. */
export function splitStatusMessage(message: string): { summary: string; detail: string } {
  const text = message.trim();
  const separator = text.search(/[:·—]|\s-\s/);
  if (separator > 12 && separator < text.length - 2) {
    return {
      summary: text.slice(0, separator).trim(),
      detail: text.slice(separator).replace(/^[:·—\s-]+/, '').trim(),
    };
  }
  return { summary: text, detail: '' };
}
