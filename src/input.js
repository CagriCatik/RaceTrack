/**
 * Keyboard state with edge detection.
 *
 * `pressedKeys` keeps the live set (what the vehicle reads every physics step).
 * `wasPressed(code)` reports a key that went down since the last `endFrame()`, which
 * replaces the six hand-rolled `xToggleHeld` booleans the game loop used to carry.
 */
export const pressedKeys = new Set();

const justPressed = new Set();

/** Keys we own: stops the page from scrolling / activating browser shortcuts. */
const OWNED = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'Backspace',
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'KeyC', 'KeyF', 'KeyG', 'KeyH', 'KeyL', 'KeyM', 'KeyN', 'KeyO', 'KeyP', 'KeyR', 'KeyT', 'KeyV',
]);

let enabled = true;

function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function onKeyDown(event) {
  if (!enabled || isTypingTarget(event.target)) return;
  if (OWNED.has(event.code)) event.preventDefault();
  if (event.repeat) return;
  pressedKeys.add(event.code);
  justPressed.add(event.code);
}

function onKeyUp(event) {
  if (OWNED.has(event.code)) event.preventDefault();
  pressedKeys.delete(event.code);
}

/** Without this, Cmd+Tab / alt-tab leaves keys stuck down and the car drives off alone. */
function releaseAll() {
  pressedKeys.clear();
  justPressed.clear();
}

window.addEventListener('keydown', onKeyDown);
window.addEventListener('keyup', onKeyUp);
window.addEventListener('blur', releaseAll);
window.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });

/** True on the frame a key went down. Non-consuming: several systems may ask. */
export function wasPressed(code) {
  return justPressed.has(code);
}

/** Call once per frame, after all `wasPressed` checks. */
export function endFrame() {
  justPressed.clear();
}

export function setInputEnabled(next) {
  enabled = !!next;
  if (!enabled) releaseAll();
}

export { releaseAll };
