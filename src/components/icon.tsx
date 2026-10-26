import type { CSSProperties } from "react";

type IconName = "layers" | "home" | "people" | "arrow" | "menu" | "sun" | "moon" | "exit" | "check" | "plus";
const paths: Record<IconName, string[]> = {
  layers: ["M3 4h12v12H3z", "M7 8h12v12H7", "M11 12h12v12H11"],
  home: ["M4 10 12 3l8 7v11H4Z", "M9 21v-7h6v7"],
  people: [
    "M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
    "M2 21v-2a6 6 0 0 1 12 0v2",
    "M16 5a4 4 0 0 1 0 8",
    "M18 16a5 5 0 0 1 4 5",
  ],
  arrow: ["M5 12h14", "m13 6 6 6-6 6"],
  menu: ["M4 6h16M4 12h16M4 18h16"],
  sun: [
    "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z",
    "M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2",
  ],
  moon: ["M20 15a8 8 0 0 1-11-11A9 9 0 1 0 20 15Z"],
  exit: ["M10 4H4v16h6", "M10 12h12m-5-5 5 5-5 5"],
  check: ["m5 12 4 4L20 5"],
  plus: ["M12 4v16M4 12h16"],
};
export function Icon({ name, size = 20, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox={name === "layers" ? "0 0 27 27" : "0 0 24 24"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      {paths[name].map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}
export function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark">
        <Icon name="layers" size={25} />
      </span>
      <span>
        Bloco<span className="brand-dot">.</span>
      </span>
    </span>
  );
}
