// Keep focus inside the click gesture so mobile browsers can open their keyboard.
// Remember selection before native focus: a first tap on a crossing must not toggle it.
export function bindCellActivation(input, { isActive, select }) {
  let pointerStarted = false, wasActive = false;
  input.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.isPrimary === false) return;
    pointerStarted = true; wasActive = isActive();
  });
  input.addEventListener('pointercancel', () => { pointerStarted = false; });
  input.addEventListener('focus', () => { if (!isActive()) select(false, false); });
  input.addEventListener('click', () => {
    const toggle = pointerStarted && wasActive;
    pointerStarted = false;
    select(toggle, true);
  });
}
