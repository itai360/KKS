// Tabs (.tabs > .tab.on) on every screen: the line under the chosen tab slides to the next one chosen,
// instead of jumping - so the eye follows where it went. One watcher for the whole screen area.

export function slideTabIndicators(root: HTMLElement): () => void {
  let frame = 0;
  const place = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      for (const bar of root.querySelectorAll<HTMLElement>('.tabs')) {
        const on = bar.querySelector<HTMLElement>('.tab.on');
        if (!on) {
          bar.classList.remove('has-ind');
          continue;
        }
        bar.style.setProperty('--tab-x', `${on.offsetLeft}px`);
        bar.style.setProperty('--tab-w', `${on.offsetWidth}px`);
        if (!bar.classList.contains('has-ind')) {
          // placed the first time where it is - no slide in from the side
          bar.classList.add('has-ind', 'ind-still');
          requestAnimationFrame(() => requestAnimationFrame(() => bar.classList.remove('ind-still')));
        }
      }
    });
  };
  const watch = new MutationObserver(place);
  watch.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', place);
  place();
  return () => {
    cancelAnimationFrame(frame);
    watch.disconnect();
    window.removeEventListener('resize', place);
  };
}
