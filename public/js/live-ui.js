/* Keyed DOM updates and interruptible, reduced-motion-aware list transitions. */
(() => {
  "use strict";
  const roots = new WeakMap(), groups = new WeakMap(), pending = new Set();
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const DURATION = 360, EASING = "cubic-bezier(.22,1,.36,1)";
  function enabled() { return !motion.matches && !document.hidden; }
  function stop(element, name) { groups.get(element)?.get(name)?.cancel(); }
  function play(element, name, frames, options = {}, done) {
    stop(element, name);
    if (!enabled() || !element.animate) { done?.(); return null; }
    const animation = element.animate(frames, { duration: DURATION, easing: EASING, ...options });
    animation.id = `fc-live-${name}`;
    let set = groups.get(element); if (!set) groups.set(element, set = new Map());
    set.set(name, animation); pending.add(animation);
    const finish = () => {
      pending.delete(animation);
      if (set.get(name) === animation) { set.delete(name); done?.(); }
    };
    animation.onfinish = finish; animation.oncancel = finish;
    return animation;
  }
  function highlight(element) {
    play(element, "field", [{ opacity: .3, filter: "brightness(1.65)" }, { opacity: 1, filter: "brightness(1)" }], { duration: 300 });
  }
  function removeField(element) {
    if (!element) return;
    if (!enabled()) { element.remove(); return; }
    const rect = element.getBoundingClientRect(), parent = element.closest(".card") || element.offsetParent || element.parentElement, origin = parent.getBoundingClientRect();
    const ghost = element.cloneNode(true); ghost.classList.add("live-field-ghost"); ghost.setAttribute("aria-hidden", "true"); ghost.inert = true;
    Object.assign(ghost.style, { position: "absolute", left: `${rect.left - origin.left}px`, top: `${rect.top - origin.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, margin: "0", pointerEvents: "none" });
    element.remove(); parent.append(ghost);
    play(ghost, "field-exit", [{ opacity: 1 }, { opacity: 0 }], { duration: 180 }, () => ghost.remove());
  }
  function text(element, value, animate = true) {
    if (!element) return false;
    const next = String(value ?? "");
    if (element.textContent === next) return false;
    element.textContent = next;
    if (animate) highlight(element);
    return true;
  }
  function toggle(element, name, value) {
    if (element.classList.contains(name) !== !!value) element.classList.toggle(name, !!value);
  }
  function attribute(element, name, value) {
    if (element.getAttribute(name) !== String(value)) element.setAttribute(name, String(value));
  }
  function scrollAnchor(root, nodes, nextIds, rects, rootRect) {
    let scroller = root.parentElement;
    while (scroller && scroller !== document.body && scroller !== document.documentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(scroller).overflowY) && scroller.scrollHeight > scroller.clientHeight + 1) break;
      scroller = scroller.parentElement;
    }
    if (scroller === document.body || scroller === document.documentElement) scroller = null;
    const viewport = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: innerHeight };
    if (scroller ? scroller.scrollTop < 1 : rootRect.top >= 0) return null;
    for (const [id, node] of nodes) {
      const rect = rects.get(id);
      if (nextIds.has(id) && rect.bottom > viewport.top && rect.top < viewport.bottom) return { node, top: rect.top, scroller };
    }
    return null;
  }
  function keepAnchor(anchor, state) {
    state.stopAnchor?.();
    if (!anchor || !enabled()) return;
    let frame, cancelled = false;
    const until = performance.now() + DURATION + 80;
    const stop = () => {
      cancelled = true; cancelAnimationFrame(frame);
      for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) document.removeEventListener(event, stop, true);
      if (state.stopAnchor === stop) state.stopAnchor = null;
    };
    const tick = () => {
      if (cancelled || !anchor.node.isConnected || performance.now() > until) return stop();
      const delta = anchor.node.getBoundingClientRect().top - anchor.top;
      if (Math.abs(delta) > .5) {
        if (anchor.scroller) anchor.scroller.scrollTop += delta;
        else window.scrollBy({ top: delta, behavior: "instant" });
      }
      frame = requestAnimationFrame(tick);
    };
    state.stopAnchor = stop;
    for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) document.addEventListener(event, stop, { capture: true, passive: true });
    frame = requestAnimationFrame(tick);
  }
  function clearExit(state, id, restore) {
    const exit = state.exiting.get(id); if (!exit) return null;
    state.exiting.delete(id); stop(exit.node, "exit");
    if (!restore) { exit.node.remove(); return null; }
    exit.node.style.cssText = exit.style;
    exit.node.classList.remove("live-leaving"); exit.node.removeAttribute("aria-hidden"); exit.node.inert = false;
    return exit.node;
  }
  function reconcile(root, items, { create, patch, mounted, animate = true, version } = {}) {
    let state = roots.get(root);
    if (!state) roots.set(root, state = { nodes: new Map(), exiting: new Map(), populated: false });
    if (version !== undefined && state.version === version && animate && enabled()) return false;
    state.version = version;
    const ids = new Set(items.map(item => String(item.id)));
    const focused = root.contains(document.activeElement) ? document.activeElement : null;
    const beforeRoot = root.getBoundingClientRect();
    const before = new Map([...state.nodes].map(([id, node]) => [id, node.getBoundingClientRect()]));
    const oldOrder = [...state.nodes.keys()];
    const anchor = scrollAnchor(root, state.nodes, ids, before, beforeRoot);
    const changed = new Set(), added = new Set(), next = new Map();
    for (const item of items) {
      const id = String(item.id);
      let node = state.nodes.get(id);
      if (!node && state.exiting.has(id)) {
        const exiting = state.exiting.get(id).node;
        before.set(id, exiting.getBoundingClientRect()); node = clearExit(state, id, true);
      }
      if (!node) { node = create(item); added.add(id); }
      else if (patch(node, item)) changed.add(id);
      next.set(id, node);
    }
    const removed = [...state.nodes].filter(([id]) => !ids.has(id));
    const orderChanged = oldOrder.length !== items.length || oldOrder.some((id, index) => id !== String(items[index].id));
    const canAnimate = animate && enabled();
    if (!removed.length && !added.size && !changed.size && !orderChanged) {
      if (!canAnimate && state.exiting.size) { for (const id of [...state.exiting.keys()]) clearExit(state, id, false); mounted?.(root); }
      return false;
    }
    state.stopAnchor?.(); stop(root, "size");
    for (const node of state.nodes.values()) {
      for (const name of ["move", "size", "enter"]) stop(node, name);
      node.classList.remove("live-entering");
    }
    if (!canAnimate) for (const id of [...state.exiting.keys()]) clearExit(state, id, false);
    const initial = !state.populated;
    for (const [id, node] of removed) {
      if (!canAnimate || initial) { node.remove(); continue; }
      const rect = before.get(id), style = node.style.cssText;
      node.classList.add("live-leaving"); node.setAttribute("aria-hidden", "true"); node.inert = true;
      Object.assign(node.style, { position: "absolute", left: `${rect.left - beforeRoot.left}px`, top: `${rect.top - beforeRoot.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, margin: "0", pointerEvents: "none" });
      const exit = { node, style }; state.exiting.set(id, exit);
      play(node, "exit", [{ opacity: 1, transform: "translateY(0) scale(1)" }, { opacity: 0, transform: "translateY(-6px) scale(.985)" }], { duration: 220 }, () => {
        if (state.exiting.get(id) !== exit) return;
        state.exiting.delete(id); node.remove(); mounted?.(root);
      });
    }
    // Move only genuinely out-of-order nodes. No-op refreshes never detach a card.
    const nextActive = node => { let next=node?.nextElementSibling; while(next?.classList.contains("live-leaving"))next=next.nextElementSibling; return next || null; };
    let cursor = root.firstElementChild; while(cursor?.classList.contains("live-leaving"))cursor=cursor.nextElementSibling;
    for (const node of next.values()) {
      if (node === cursor) cursor = nextActive(node);
      else root.insertBefore(node, cursor);
    }
    if (focused?.isConnected && !focused.closest(".live-leaving") && document.activeElement !== focused) focused.focus({ preventScroll: true });
    state.nodes = next; if (next.size) state.populated = true;
    if (!canAnimate) { mounted?.(root); return true; }
    const afterRoot = root.getBoundingClientRect();
    const target = new Map([...next].map(([id, node]) => {
      const css = getComputedStyle(node), saved = {};
      for (const name of ["paddingTop", "paddingBottom", "marginTop", "marginBottom", "borderTopWidth", "borderBottomWidth"]) saved[name] = css[name];
      return [id, { rect: node.getBoundingClientRect(), css: saved }];
    }));
    for (const [id, node] of next) {
      const previous = before.get(id), end = target.get(id);
      if (added.has(id) && !initial) {
        node.classList.add("live-entering");
        play(node, "size", [
          { height: "0px", paddingTop: "0px", paddingBottom: "0px", marginTop: "0px", marginBottom: "0px", borderTopWidth: "0px", borderBottomWidth: "0px" },
          { height: `${end.rect.height}px`, paddingTop: end.css.paddingTop, paddingBottom: end.css.paddingBottom, marginTop: end.css.marginTop, marginBottom: end.css.marginBottom, borderTopWidth: end.css.borderTopWidth, borderBottomWidth: end.css.borderBottomWidth },
        ], {}, () => node.classList.remove("live-entering"));
      } else if (previous && Math.abs(previous.height - end.rect.height) > 1) {
        play(node, "size", [{ height: `${previous.height}px` }, { height: `${end.rect.height}px` }]);
      }
    }
    if (!initial && Math.abs(beforeRoot.height - afterRoot.height) > 1) play(root, "size", [{ height: `${beforeRoot.height}px` }, { height: `${afterRoot.height}px` }]);
    // Measure after starting height animations: sibling reflow and FLIP must not double-count each other.
    const current = new Map([...next].map(([id,node])=>[id,{rect:node.getBoundingClientRect(),transform:getComputedStyle(node).transform}]));
    for (const [id, node] of next) {
      const previous = before.get(id), now = current.get(id).rect;
      if (added.has(id)) {
        play(node, "enter", [{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "translateY(0)" }], initial ? { duration: 360, delay: Math.min([...next.keys()].indexOf(id), 5) * 30 } : {});
      } else if (previous) {
        const dx = previous.left - now.left, dy = previous.top - now.top;
        if (Math.abs(dx) > .5 || Math.abs(dy) > .5) {
          const base = current.get(id).transform;
          const end = base === "none" ? "translate(0,0)" : base;
          play(node, "move", [{ transform: `translate(${dx}px,${dy}px) ${base === "none" ? "" : base}` }, { transform: end }]);
        }
      }
    }
    mounted?.(root); keepAnchor(anchor, state);
    return true;
  }
  motion.addEventListener("change", () => { if (motion.matches) for (const animation of [...pending]) animation.finish(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) for (const animation of [...pending]) animation.finish(); });
  window.LiveUI = Object.freeze({ reconcile, text, toggle, attribute, highlight, removeField });
})();
