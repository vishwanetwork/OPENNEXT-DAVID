import { useEffect, useRef } from 'react';

// The photo remains the hardware visual. This canvas renders the live routing
// diagram only: resource endpoints, candidate paths and travelling signals.
type Route = { end: [number, number]; bend: [number, number, number, number] };
type Point = [number, number];
const routes: Route[] = [
  { end: [0.07, 0.27], bend: [0.18, 0.24, 0.32, 0.56] },
  { end: [0.27, 0.09], bend: [0.24, 0.27, 0.42, 0.4] },
  { end: [0.84, 0.13], bend: [0.88, 0.32, 0.72, 0.43] },
  { end: [0.95, 0.56], bend: [0.92, 0.75, 0.75, 0.66] },
  { end: [0.77, 0.92], bend: [0.62, 0.96, 0.59, 0.76] },
  { end: [0.1, 0.82], bend: [0.19, 0.94, 0.35, 0.75] },
];
const routeOrder = [3, 0, 5, 2, 4, 1];
const fract = (value: number) => value - Math.floor(value);

function point(route: Route, t: number, width: number, height: number): Point {
  const s = 1 - t;
  const [x1, y1, x2, y2] = route.bend;
  return [
    (s ** 3 * 0.55 + 3 * s * s * t * x2 + 3 * s * t * t * x1 + t ** 3 * route.end[0]) * width,
    (s ** 3 * 0.57 + 3 * s * s * t * y2 + 3 * s * t * t * y1 + t ** 3 * route.end[1]) * height,
  ];
}

export function RoutingNetwork({
  phase,
  running,
  reduced,
}: {
  phase: number;
  running: boolean;
  reduced: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const state = useRef({ phase, running, reduced, selected: -1, cycle: 0 });
  const redraw = useRef<(() => void) | null>(null);

  useEffect(() => {
    const previous = state.current.phase;
    if (previous === 2 && phase === 0) state.current.cycle += 1;
    Object.assign(state.current, { phase, running, reduced });
    if (phase === 2)
      state.current.selected = routeOrder[state.current.cycle % routeOrder.length] ?? 0;
    redraw.current?.();
  }, [phase, running, reduced]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let width = 0,
      height = 0,
      raf = 0,
      last = 0,
      elapsed = 0;
    const opacity = routes.map(() => 0.3);
    let paths: Point[][] = [];
    const stroke = (path: Point[], alpha: number, lineWidth = 1) => {
      ctx.beginPath();
      path.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = `rgba(155, 209, 239, ${alpha})`;
      ctx.stroke();
    };
    const dot = (x: number, y: number, radius: number, alpha: number, glow = false) => {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(215, 241, 255, ${alpha})`;
      ctx.shadowBlur = glow ? 12 : 0;
      ctx.shadowColor = '#80c8ff';
      ctx.fill();
      ctx.shadowBlur = 0;
    };
    const signal = (
      route: Route,
      progress: number,
      alpha: number,
      strong: boolean,
      reverse = false,
    ) => {
      const direction = reverse ? -1 : 1;
      const position = reverse ? 1 - progress : progress;
      for (let i = 1; i <= 12; i++) {
        const a = position - direction * i * 0.0045;
        const b = position - direction * (i - 1) * 0.0045;
        if (a < 0 || a > 1 || b < 0 || b > 1) continue;
        stroke(
          [point(route, a, width, height), point(route, b, width, height)],
          alpha * (1 - i / 13),
          strong ? 2.1 : 1.4,
        );
      }
      const [x, y] = point(route, position, width, height);
      dot(x, y, strong ? 2.7 : 1.9, alpha, strong);
    };
    const paint = (time: number) => {
      raf = 0;
      const config = state.current;
      const animate = config.running && !config.reduced && !document.hidden;
      if (animate) elapsed += Math.min(time - (last || time), 70) / 1000;
      last = time;
      ctx.clearRect(0, 0, width, height);
      const indices = width < 480 ? [0, 2, 3, 5] : [0, 1, 2, 3, 4, 5];
      const candidate = routeOrder[config.cycle % routeOrder.length] ?? 0;
      const focus = indices.includes(candidate)
        ? candidate
        : (indices[config.cycle % indices.length] ?? 0);
      const selected =
        config.selected < 0 ? -1 : indices.includes(config.selected) ? config.selected : focus;
      indices.forEach((index, order) => {
        const route = routes[index];
        if (!route) return;
        const chosen = index === selected;
        const matching =
          index === focus || index === indices[(indices.indexOf(focus) + 2) % indices.length];
        const target = chosen ? 0.9 : config.phase === 1 ? (matching ? 0.55 : 0.1) : 0.25;
        opacity[index] =
          (opacity[index] ?? 0.3) + (target - (opacity[index] ?? 0.3)) * (animate ? 0.09 : 1);
        stroke(
          paths[index] ?? [],
          (opacity[index] ?? 0.3) * (chosen ? 0.8 : 0.6),
          chosen ? 1.45 : 0.85,
        );
        // Other routes keep searching even while a selected connection carries traffic.
        if (animate) {
          const progress = fract(elapsed / (chosen ? 2.8 : 4.4) + order * 0.17);
          signal(
            route,
            progress,
            chosen ? 0.95 : config.phase === 1 && !matching ? 0.25 : 0.65,
            chosen,
            config.phase === 1 && !chosen,
          );
          if (chosen) signal(route, fract(progress + 0.5), 0.9, true);
        }
        const x = route.end[0] * width,
          y = route.end[1] * height;
        const pulse = animate ? fract(elapsed / 2.7 + order * 0.16) : 0.35;
        ctx.beginPath();
        ctx.arc(x, y, 12 + pulse * 13, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(133, 200, 241, ${(1 - pulse) * (chosen ? 0.3 : 0.13)})`;
        ctx.lineWidth = 0.8;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, chosen ? 8 : 6, 0, Math.PI * 2);
        ctx.fillStyle = '#102431';
        ctx.fill();
        ctx.strokeStyle = `rgba(169, 222, 250, ${chosen ? 0.85 : 0.35})`;
        ctx.lineWidth = 1;
        ctx.stroke();
        dot(x, y, chosen ? 3 : 2, chosen ? 1 : 0.6, chosen);
      });
      dot(width * 0.55, height * 0.57, 3, 0.9, true);
      if (animate) raf = requestAnimationFrame(tick);
    };
    const tick = (time: number) => {
      // 30 fps is sufficient for subtle signals, without a full-rate canvas loop.
      if (time - last < 30) {
        raf = requestAnimationFrame(tick);
        return;
      }
      paint(time);
    };
    const refresh = () => {
      cancelAnimationFrame(raf);
      last = 0;
      paint(performance.now());
    };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const ratio = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.lineCap = 'round';
      paths = routes.map((route) =>
        Array.from({ length: 65 }, (_, i) => point(route, i / 64, width, height)),
      );
      refresh();
    };
    redraw.current = refresh;
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    document.addEventListener('visibilitychange', refresh);
    resize();
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener('visibilitychange', refresh);
      redraw.current = null;
    };
  }, []);

  return <canvas ref={canvasRef} className="routing-network" aria-hidden="true" />;
}
