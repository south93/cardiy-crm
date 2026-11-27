import type { SVGProps } from 'react';

export type MarketIconName =
  | 'pin'
  | 'headset'
  | 'user'
  | 'calendar'
  | 'search'
  | 'tire'
  | 'oil'
  | 'shock'
  | 'car'
  | 'chevron'
  | 'chevron-down'
  | 'bolt'
  | 'clock'
  | 'shield'
  | 'badge'
  | 'people'
  | 'sparkles'
  | 'mail';

/** Bộ icon nét mảnh 1.7px đồng bộ theo thiết kế giao diện sàn CARDIY. */
export function MarketIcon({
  name,
  className = 'h-5 w-5',
  ...props
}: SVGProps<SVGSVGElement> & { name: MarketIconName }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
      {...props}
    >
      {name === 'pin' && (
        <>
          <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
          <circle cx="12" cy="10" r="3" />
        </>
      )}
      {name === 'headset' && <path d="M3 14v-3a9 9 0 0 1 18 0v5q0 5-7 5M3 12h4v7H3zM17 12h4v7h-4z" />}
      {name === 'user' && (
        <>
          <circle cx="12" cy="7" r="4" />
          <path d="M3 22v-3a6 6 0 0 1 6-6h6a6 6 0 0 1 6 6v3Z" />
        </>
      )}
      {name === 'calendar' && (
        <>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M7 2v6m10-6v6M3 11h18m-13 4h2m4 0h2" />
        </>
      )}
      {name === 'search' && (
        <>
          <circle cx="10" cy="10" r="7" />
          <path d="m15 15 7 7" />
        </>
      )}
      {name === 'tire' && (
        <>
          <ellipse cx="12" cy="12" rx="7" ry="10" />
          <ellipse cx="14" cy="12" rx="4" ry="7" />
          <path d="m6 5 3 1M5 10l3 1m-3 4 3 1m0 4 3 1" />
        </>
      )}
      {name === 'oil' && <path d="M2 9h4l2 3h8l5-5-3 12H7L4 12H2Zm6-3h7M11 6v5m11 3s-3 4-1 6 4-1 1-6Z" />}
      {name === 'shock' && (
        <g transform="rotate(35 12 12)">
          <path d="M12 1v22M8 5h8M8 8h8M8 11h8M8 14h8M8 17h8M10 3h4m-4 18h4" />
        </g>
      )}
      {name === 'car' && (
        <path d="m4 11 2-6h12l2 6 2 3v6h-4v-3H6v3H2v-6Zm0 0h16M5 14h3m8 0h3M3 2v5M1 4h4m16-3v4m-2-2h4" />
      )}
      {name === 'chevron' && <path d="m9 5 7 7-7 7" />}
      {name === 'chevron-down' && <path d="m6 9 6 6 6-6" />}
      {name === 'bolt' && <path d="m14 1-12 13h8l-1 9 13-14h-9Z" />}
      {name === 'clock' && (
        <>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 5v7l6 3" />
        </>
      )}
      {name === 'shield' && (
        <>
          <path d="m12 2 9 4v7c0 5-9 10-9 10s-9-5-9-10V6Z" />
          <path d="m7 12 3 3 7-7" />
        </>
      )}
      {name === 'badge' && (
        <>
          <path d="m12 2 3 2 4 0 1 4 2 4-2 3-1 4-4 0-3 3-4-3-4 0-1-4-2-3 2-4 1-4h4Z" />
          <path d="m7 12 3 3 7-7" />
        </>
      )}
      {name === 'people' && (
        <>
          <circle cx="12" cy="7" r="4" />
          <path d="M5 22v-4a7 7 0 0 1 14 0v4ZM4 5a4 4 0 0 0 0 8M20 5a4 4 0 0 1 0 8M3 15a5 5 0 0 0-2 4v2m20-6a5 5 0 0 1 2 4v2" />
        </>
      )}
      {name === 'sparkles' && (
        <>
          <path d="m12 3 1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3Z" />
          <path d="M5 3v4M3 5h4M19 17v4m-2-2h4" />
        </>
      )}
      {name === 'mail' && (
        <>
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <path d="m22 7-10 6L2 7" />
        </>
      )}
    </svg>
  );
}
