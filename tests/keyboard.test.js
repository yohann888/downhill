import { describe, expect, it } from 'vitest';
import { getEditableKeyboardTarget } from '../src/keyboard.js';

describe('getEditableKeyboardTarget', () => {
  it.each(['INPUT', 'TEXTAREA', 'SELECT'])('recognizes %s elements', (tagName) => {
    const target = { tagName };
    expect(getEditableKeyboardTarget(target)).toBe(target);
  });

  it('recognizes contenteditable elements and descendants', () => {
    const contentEditable = { isContentEditable: true };
    const descendant = { closest: () => contentEditable };
    expect(getEditableKeyboardTarget(contentEditable)).toBe(contentEditable);
    expect(getEditableKeyboardTarget(descendant)).toBe(contentEditable);
  });

  it('falls back to the focused editable element', () => {
    const activeElement = { tagName: 'INPUT' };
    expect(getEditableKeyboardTarget({ tagName: 'DIV' }, activeElement)).toBe(activeElement);
  });

  it('ignores non-editable targets', () => {
    expect(getEditableKeyboardTarget({ tagName: 'BUTTON' })).toBeNull();
  });
});
