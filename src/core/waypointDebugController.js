import { wasPressed } from '../input.js';

/** `V` shows the AI racing line (one instanced marker mesh plus a line loop). */
export function createWaypointDebugController(group, initialVisible = false) {
  let visible = initialVisible;
  if (group) group.visible = visible;

  function update() {
    if (!wasPressed('KeyV')) return;
    visible = !visible;
    if (group) group.visible = visible;
  }

  return { update, isVisible: () => visible };
}
