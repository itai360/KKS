// Motion as Apple builds it (WWDC 2018, "Designing Fluid Interfaces"): a spring, described by two
// numbers - its damping ratio (1 settles without overshoot, under 1 bounces) and its response (how fast
// it gets there, in seconds - not a duration). A spring starts from where the thing is on screen and
// with the speed it already has, so it can be stopped and redirected at any moment.

export interface SpringRun {
  /** stops it where it is now: its value on screen and its speed, for whatever follows */
  stop: () => { value: number; velocity: number };
}

export function animateSpring(
  from: number,
  to: number,
  {
    damping = 1,
    response = 0.35,
    velocity = 0,
    onUpdate,
    onDone,
  }: { damping?: number; response?: number; velocity?: number; onUpdate: (value: number) => void; onDone?: () => void },
): SpringRun {
  let x = from;
  let v = velocity;
  let frame = 0;
  // reduced motion: no travel - it is simply there
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
    onUpdate(to);
    onDone?.();
    return { stop: () => ({ value: to, velocity: 0 }) };
  }
  const stiffness = (2 * Math.PI / response) ** 2;
  const friction = (4 * Math.PI * damping) / response;
  let last = performance.now();
  const step = (now: number) => {
    let dt = Math.min(0.064, (now - last) / 1000);
    last = now;
    // small fixed steps: the same motion at 60 and 120 frames a second
    while (dt > 0) {
      const h = Math.min(dt, 1 / 240);
      v += (-stiffness * (x - to) - friction * v) * h;
      x += v * h;
      dt -= h;
    }
    if (Math.abs(x - to) < 0.4 && Math.abs(v) < 10) {
      x = to;
      v = 0;
      onUpdate(to);
      onDone?.();
      return;
    }
    onUpdate(x);
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return {
    stop: () => {
      cancelAnimationFrame(frame);
      return { value: x, velocity: v };
    },
  };
}

/** where a flick lands: Apple's projection, the way a scroll decelerates (rate 0.998 as a scroll, 0.99 snappier) */
export function project(velocity: number, rate = 0.998): number {
  return ((velocity / 1000) * rate) / (1 - rate);
}

/** past an edge it follows less and less - a soft limit, never a wall */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/** the speed of a finger, from its last moments (px/s) */
export function velocityOf(points: { y: number; t: number }[]): number {
  const now = points[points.length - 1];
  if (!now) return 0;
  const old = points.find((p) => now.t - p.t <= 100) ?? now;
  return now.t === old.t ? 0 : ((now.y - old.y) / (now.t - old.t)) * 1000;
}
