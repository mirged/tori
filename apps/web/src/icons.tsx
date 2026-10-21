import type { CSSProperties } from 'react';
const paths: Record<string, React.ReactNode> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
  plus: <path d="M12 5v14M5 12h14"/>, arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
  play: <path d="m9 5 11 7-11 7Z"/>, search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></>,
  down: <path d="m6 9 6 6 6-6"/>, up: <path d="m6 15 6-6 6 6"/>, upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/></>,
  download: <><path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  people: <><circle cx="9" cy="8" r="3"/><path d="M3 20v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v2"/></>,
  help: <><circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 4 3c-1 .4-1 1-1 2m0 3h.01"/></>,
  leaf: <><path d="M20 3C9 1 1 8 5 16s17 4 15-13ZM4 21 16 9"/></>,
  check: <path d="m5 12 4 4L19 6"/>, close: <path d="m6 6 12 12M6 18 18 6"/>,
  edit: <><path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14Z"/></>,
  copy: <><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/></>,
  trash: <><path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/></>,
  back: <path d="M20 12H4m6-6-6 6 6 6"/>, more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  trophy: <><path d="M7 3h10v6a5 5 0 0 1-10 0ZM7 5H3v3a4 4 0 0 0 5 4m9-7h4v3a4 4 0 0 1-5 4M12 14v6m-5 1h10"/></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/></>,
  unlock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.5-2M12 15v2"/></>,
  monitor: <><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M12 17v4m-5 0h10"/></>,
  pause: <><path d="M8 4v16M16 4v16"/></>, sound: <><path d="m11 4-6 5H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></>,
  mute: <><path d="m11 4-6 5H2v6h3l6 5Zm5 5 5 6m-5 0 5-6"/></>,
  spark: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4m-2-2h4"/></>,
  file: <><path d="M14 2H4v20h16V8Zm0 0v6h6M8 13h8m-8 4h6"/></>,
  expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5m11-5v5h-5"/>, shrink: <path d="M9 4v5H4m11-5v5h5M9 20v-5H4m11 5v-5h5"/>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M4.9 4.9 7 7m10 10 2.1 2.1M2 12h3m14 0h3M4.9 19.1 7 17M17 7l2.1-2.1"/></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></>,
  warning: <><path d="M12 3 2 20h20Z"/><path d="M12 10v4m0 3h.01"/></>,
  skip: <><path d="m5 5 9 7-9 7Z"/><path d="M18 5v14"/></>,
  motion: <><path d="M3 12h4l3-8 4 16 3-8h4"/></>,
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
  grip: <><circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/></>,
  link: <><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></>,
};
export function Icon({ name, size = 20, style }: { name: string; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>{paths[name] || paths.spark}</svg>;
}

/** The classic answer shapes: triangle, diamond, circle, square, pentagon, star. */
const shapePaths = [
  <path d="M12 2.5 22.5 21h-21Z"/>,
  <path d="M12 1.5 22.5 12 12 22.5 1.5 12Z"/>,
  <circle cx="12" cy="12" r="10"/>,
  <rect x="2.5" y="2.5" width="19" height="19" rx="1"/>,
  <path d="m12 1.8 10.2 7.4-3.9 12H5.7l-3.9-12Z"/>,
  <path d="m12 1.5 3.1 6.6 7.2.9-5.3 5 1.4 7.1L12 17.6 5.6 21.1 7 14l-5.3-5 7.2-.9Z"/>,
];
export const shapeNames = ['Triangle', 'Diamond', 'Circle', 'Square', 'Pentagon', 'Star'];
export function Shape({ index, size = 24 }: { index: number; size?: number }) {
  return <svg className="shape" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">{shapePaths[index % shapePaths.length]}</svg>;
}

export function Brand({ light = false }: { light?: boolean }) {
  return <span className={`brand${light ? ' light' : ''}`}>Tori<span className="brand-bang">!</span></span>;
}

const coverShapes: [number, number, number, number, number][] = [[40, 30, 70, -12, 0], [300, 20, 60, 18, 1], [70, 130, 54, 8, 2], [310, 120, 74, -8, 3], [190, 150, 34, 30, 0]];
export function Cover({ kind, small = false }: { kind: string; small?: boolean }) {
  return <div className={`cover cover-${kind}${small ? ' small' : ''}`} aria-hidden="true">
    <svg viewBox="0 0 400 210" fill="#fff">
      {coverShapes.map(([x, y, s, r, i], n) => <g key={n} opacity={n === 4 ? .22 : .16} transform={`translate(${x} ${y}) rotate(${r} ${s / 2} ${s / 2}) scale(${s / 24})`}>{shapePaths[i]}</g>)}
      <circle cx="200" cy="100" r="54" fill="#fff" opacity=".95"/>
      <path d="M182 84c3-15 37-16 37 5 0 13-17 14-17 28" fill="none" stroke="currentColor" strokeWidth="12" strokeLinecap="round"/>
      <circle cx="202" cy="134" r="7.5" fill="currentColor"/>
    </svg>
  </div>;
}
