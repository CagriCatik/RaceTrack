export function createWaypointDebugController(objects = [], initialVisible = false) {
  let visible = initialVisible;
  let toggleHeld = false;

  const applyVisibility = () => {
    for (const obj of objects) obj.visible = visible;
  };
  applyVisibility();

  function update(keys) {
    const togglePressed = keys.has('KeyV');
    if (togglePressed && !toggleHeld) {
      visible = !visible;
      applyVisibility();
    }
    toggleHeld = togglePressed;
  }

  return {
    update,
    isVisible: () => visible,
  };
}
