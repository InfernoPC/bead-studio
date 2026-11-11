/** 鍵盤快捷鍵共用的小工具 */

/** 焦點在文字輸入（input、textarea、select、contenteditable）上：單鍵快捷鍵要讓給輸入 */
export function isTyping(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
}

/** 快捷鍵提示裡的修飾鍵：Mac／iOS 是「⌘」，其他平台是「Ctrl+」 */
export const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
