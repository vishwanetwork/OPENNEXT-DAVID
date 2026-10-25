/**
 * Hero and auth illustrations (legacy `capacityIllustration`). Native SVG motion and the
 * visible line reference the very same route in SVG user coordinates, so packets travel
 * start to end and restart; they never reverse direction.
 */

function point(x: number, y: number, ux: number, uy: number, vx: number, vy: number) {
  return (u: number, v: number, z = 0) => `${+(x + ux * u + vx * v).toFixed(2)} ${+(y + uy * u + vy * v + z).toFixed(2)}`;
}

function CapacityPlane({ x, y, ux, uy, vx, vy, depth }: { x: number; y: number; ux: number; uy: number; vx: number; vy: number; depth: number }) {
  const p = point(x, y, ux, uy, vx, vy);
  const outline = `M${p(0, 0)} L${p(1, 0)} L${p(1, 1)} L${p(0, 1)} Z`;
  const frontFace = `M${p(0, 0)} L${p(1, 0)} L${p(1, 0, depth)} L${p(0, 0, depth)} Z`;
  const sideFace = `M${p(1, 0)} L${p(1, 1)} L${p(1, 1, depth)} L${p(1, 0, depth)} Z`;
  const roof = Array.from({ length: 11 }, (_, i) => {
    const v = (i + 1) / 12;
    return `M${p(0, v)} L${p(1, v)}`;
  }).join(' ');
  const panels = Array.from({ length: 31 }, (_, i) => {
    const u = i / 30;
    return `M${p(u, 0)} L${p(u, 0, depth)}`;
  }).join(' ');
  const side = Array.from({ length: 17 }, (_, i) => {
    const v = i / 16;
    return `M${p(1, v)} L${p(1, v, depth)}`;
  }).join(' ');
  const louvers = [0.25, 0.5, 0.75].map((z) => `M${p(0, 0, depth * z)} L${p(1, 0, depth * z)}`).join(' ');
  return (
    <g className="public-flow-building">
      <path className="public-flow-base" d={`M${p(-0.015, -0.015, depth + 10)} L${p(1.015, -0.015, depth + 10)} L${p(1.015, 1.015, depth + 10)}`} />
      <path className="public-flow-face public-flow-front-face" d={frontFace} />
      <path className="public-flow-face public-flow-side-face" d={sideFace} />
      <path className="public-flow-plane" d={outline} />
      <path className="public-flow-detail" d={`${roof} ${panels} ${side} ${louvers}`} />
    </g>
  );
}

function NetworkArtwork() {
  const floor = 'M70 646 L1780 338 M70 719 L1780 411 M70 792 L1780 484 M406 805 L1780 557 M780 812 L1780 630';
  // All three rectangular enclosures share the same axonometric projection.
  const building = (x: number, y: number, width: number, length: number, depth: number) => (
    <CapacityPlane x={x} y={y} ux={width} uy={width * 0.22} vx={length} vy={length * -0.32} depth={depth} />
  );
  return (
    <>
      <g className="public-flow-ground">
        <path d={floor} />
      </g>
      {building(985, 413, 475, 172, 28)}
      {building(630, 476, 520, 193, 31)}
      {building(210, 605, 440, 383, 39)}
    </>
  );
}

const COAST =
  'M1176 171 L1210 145 1227 119 1264 113 1282 125 1304 116 1324 130 1310 154 1285 167 1280 185 1300 201 1294 226 1271 239 1251 274 1221 287 1215 313 1234 337 1238 359 1264 373 1274 396 1250 392 1236 378 1218 375 1201 351 1184 342 1176 314 1159 297 1147 269 1164 250 1160 228 1178 206 Z M1285 429 L1313 437 1336 452 1362 460 1378 486 1365 517 1343 535 1340 568 1324 592 1315 624 1297 650 1285 641 1281 609 1265 582 1262 550 1250 535 1246 502 1237 482 1252 453 Z M1536 184 L1560 180 1577 168 1599 183 1616 182 1645 199 1650 223 1673 242 1678 261 1700 285 1709 312 1680 306 1664 323 1654 353 1630 351 1615 371 1598 355 1588 332 1567 315 1554 293 1537 291 1518 278 1530 259 1513 245 1520 224 Z M1553 361 L1581 365 1595 383 1617 392 1632 421 1628 451 1612 477 1601 510 1580 531 1569 523 1560 491 1545 472 1538 441 1523 423 1529 398 Z M1678 539 L1697 525 1717 530 1733 549 1721 566 1697 571 1681 561 Z';

function GlobalArtwork() {
  const nodes: [number, number][] = [
    [265, 272],
    [190, 443],
    [355, 621],
  ];
  return (
    <>
      <g className="public-flow-node-grid">
        <path d="M92 190H496 M92 360H496 M92 531H496 M92 702H496 M116 139V744 M265 139V744 M415 139V744" />
      </g>
      <g className="public-flow-globe">
        <ellipse className="public-flow-globe-outline" cx="1404" cy="420" rx="357" ry="357" />
        <g className="public-flow-graticule">
          <ellipse cx="1404" cy="420" rx="225" ry="357" />
          <ellipse cx="1404" cy="420" rx="87" ry="357" />
          <ellipse cx="1404" cy="420" rx="357" ry="104" />
          <ellipse cx="1404" cy="420" rx="357" ry="246" />
          <path d="M1047 420H1761 M1404 63V777" />
        </g>
        <g className="public-flow-coast">
          <path d={COAST} />
        </g>
      </g>
      {nodes.map(([x, y]) => (
        <g className="public-flow-node" key={`${x}-${y}`}>
          <rect x={x - 38} y={y - 38} width="76" height="76" rx="8" />
          <rect className="public-flow-node-core" x={x - 14} y={y - 14} width="28" height="28" rx="2" />
          <path className="public-flow-detail" d={`M${x - 18} ${y - 47} v9 M${x} ${y - 47} v9 M${x + 18} ${y - 47} v9 M${x - 18} ${y + 38} v9 M${x} ${y + 38} v9 M${x + 18} ${y + 38} v9`} />
        </g>
      ))}
      <g className="public-flow-exchange">
        <path d="M758 401 L777 420 758 439 739 420 Z" />
        <path className="public-flow-exchange-inner" d="M751 420H765 M758 413V427" />
      </g>
    </>
  );
}

type Route = [d: string, duration: number, delay: number];

const NETWORK_ROUTES: Route[] = [
  ['M388 553 C424 406 675 375 822 287 C1001 210 1168 292 1243 450', 15, -3],
  ['M486 526 C535 380 735 393 822 287 C935 122 1050 131 1228 194 C1388 244 1501 365 1564 464', 18, -7],
  ['M849 435 C927 228 1111 124 1227 90 C1451 7 1668 10 1810 119', 20, -11],
  ['M939 644 C1021 404 1160 274 1321 216 C1517 145 1706 148 1760 403', 19, -13],
  ['M822 451 L822 287', 7, -2],
  ['M1227 383 L1227 90', 9, -5],
  ['M1272 390 L1272 215', 7, -4],
];
const GLOBAL_ROUTES: Route[] = [
  ['M303 272 C506 264 525 420 758 420 C944 420 1015 186 1242 219', 17, -3],
  ['M228 443 C446 443 548 420 758 420 C1041 420 1340 310 1660 373', 20, -9],
  ['M393 621 C551 621 568 420 758 420 C956 420 1053 600 1321 559', 18, -14],
];

export function CapacityIllustration({ kind }: { kind: 'network' | 'global' }) {
  const network = kind === 'network';
  const id = `public-${kind}-motion`;
  const paths = network ? NETWORK_ROUTES : GLOBAL_ROUTES;
  const label = network
    ? 'Capacity flowing between connected compute locations'
    : 'Compute nodes connecting through OpenNEXT to global destinations';
  return (
    <figure className={`public-flow-figure ${network ? 'public-hero-visual' : 'public-auth-visual'}`} aria-label={label}>
      {network ? null : (
        <input className="public-flow-toggle" type="checkbox" id={id} aria-label="Pause capacity flow animation" />
      )}
      <div className="public-flow-art">
        <svg className="public-flow-drawing" viewBox="0 0 1860 846" aria-hidden="true" focusable="false">
          <defs>
            {paths.map(([d], i) => (
              <path id={`${id}-route-${i}`} d={d} pathLength={1000} key={i} />
            ))}
          </defs>
          {network ? <NetworkArtwork /> : <GlobalArtwork />}
          <g className="public-flow-routes">
            {paths.map((_, i) => (
              <use className="public-flow-line" href={`#${id}-route-${i}`} key={i} />
            ))}
          </g>
          <g className="public-flow-packets">
            {paths.flatMap(([, duration, delay], i) =>
              [0, 0.5].map((phase) => {
                const begin = delay - duration * phase;
                return (
                  <circle className="public-flow-packet" data-route={`${id}-route-${i}`} cx="0" cy="0" r="4.5" key={`${i}-${phase}`}>
                    <animateMotion dur={`${duration}s`} begin={`${begin}s`} calcMode="paced" repeatCount="indefinite">
                      <mpath href={`#${id}-route-${i}`} />
                    </animateMotion>
                    <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.02;0.98;1" dur={`${duration}s`} begin={`${begin}s`} repeatCount="indefinite" />
                  </circle>
                );
              }),
            )}
          </g>
        </svg>
      </div>
      {network ? null : (
        <figcaption className="public-flow-caption">
          <span>Local nodes. Global reach.</span>
          <label className="public-flow-control" htmlFor={id}>
            <span className="public-flow-pause" aria-hidden="true">Ⅱ</span>
            <span className="public-flow-play" aria-hidden="true">▷</span>
            <span className="public-flow-running-label">Pause motion</span>
            <span className="public-flow-paused-label">Resume motion</span>
          </label>
        </figcaption>
      )}
    </figure>
  );
}
