const EDITABLE_TAGS = new Set(['input', 'textarea', 'select']);

function editableElement(target) {
  if (!target) return null;
  if (EDITABLE_TAGS.has(target.tagName?.toLowerCase())) return target;
  const contentEditable = target.getAttribute?.('contenteditable');
  if (contentEditable != null && contentEditable !== 'false') return target;
  return target.closest?.('[contenteditable]:not([contenteditable="false"])')
    || (target.isContentEditable ? target : null);
}

export function getEditableKeyboardTarget(target, activeElement = target) {
  return editableElement(target) || editableElement(activeElement);
}
