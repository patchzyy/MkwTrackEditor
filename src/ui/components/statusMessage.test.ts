import { describe, expect, it } from 'vitest';
import { classifyStatusMessage, shouldToastStatus, splitStatusMessage } from './statusMessage';

describe('classifyStatusMessage', () => {
  it('treats an empty message as neutral', () => {
    expect(classifyStatusMessage('')).toBe('info');
    expect(classifyStatusMessage('   ')).toBe('info');
  });

  it('recognises failures', () => {
    expect(classifyStatusMessage('Track fetch failed: HTTP 404')).toBe('error');
    expect(classifyStatusMessage('Could not parse course.kmp')).toBe('error');
    expect(classifyStatusMessage('Invalid checkpoint pair')).toBe('error');
  });

  it('recognises work in progress before it recognises success', () => {
    // "Loading Z0.szs..." matches both the progress and the success patterns; progress wins
    // so the status bar shows a spinner instead of a tick while the file is still loading.
    expect(classifyStatusMessage('Loading Z0.szs...')).toBe('progress');
    expect(classifyStatusMessage('Exporting Z0.szs...')).toBe('progress');
  });

  it('recognises finished work', () => {
    expect(classifyStatusMessage('Exported Z0.szs')).toBe('success');
    expect(classifyStatusMessage('Imported Common.szs: 760 game objects')).toBe('success');
  });

  it('recognises warnings', () => {
    expect(classifyStatusMessage('Warning: 3 objects have no model')).toBe('warning');
    expect(classifyStatusMessage('Skipped 2 unreadable archives')).toBe('warning');
  });

  it('falls back to info', () => {
    expect(classifyStatusMessage('Selection: Item Box #4')).toBe('info');
  });
});

describe('shouldToastStatus', () => {
  it('toasts every failure', () => {
    expect(shouldToastStatus('Export failed: archive too large')).toBe(true);
  });

  it('toasts finished imports and exports only', () => {
    expect(shouldToastStatus('Exported Z0.szs')).toBe(true);
    expect(shouldToastStatus('Imported Common.szs: 760 game objects')).toBe(true);
    expect(shouldToastStatus('Loaded Z0.szs: 46 files')).toBe(false);
  });

  it('never toasts progress or plain info', () => {
    expect(shouldToastStatus('Loading Z0.szs...')).toBe(false);
    expect(shouldToastStatus('Selection: Item Box #4')).toBe(false);
    expect(shouldToastStatus('')).toBe(false);
  });
});

describe('splitStatusMessage', () => {
  it('splits on a separator that is far enough into the line', () => {
    expect(splitStatusMessage('Loaded Z0.szs: 46 files, 560 editable track records')).toEqual({
      summary: 'Loaded Z0.szs',
      detail: '46 files, 560 editable track records',
    });
  });

  it('keeps short lines whole', () => {
    expect(splitStatusMessage('Undo: move')).toEqual({ summary: 'Undo: move', detail: '' });
    expect(splitStatusMessage('No track loaded')).toEqual({ summary: 'No track loaded', detail: '' });
  });

  it('trims surrounding whitespace', () => {
    expect(splitStatusMessage('  Exported Z0.szs  ')).toEqual({ summary: 'Exported Z0.szs', detail: '' });
  });
});
