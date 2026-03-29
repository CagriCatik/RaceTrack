export const pressedKeys = new Set();

function init() {
  window.addEventListener('keydown', (e) => {
    pressedKeys.add(e.code);
  });
  window.addEventListener('keyup', (e) => {
    pressedKeys.delete(e.code);
  });
}

init();
