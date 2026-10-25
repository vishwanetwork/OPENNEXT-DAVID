'use client';

export function AgentAvatar({ id = 'companion' }: { id?: string }) {
  return (
    <svg className="agent-avatar-mark" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <defs>
        <linearGradient
          id={`agent-shell-${id}`}
          x1="17"
          y1="10"
          x2="48"
          y2="55"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#fff" />
          <stop offset=".42" stopColor="#e6ece8" />
          <stop offset="1" stopColor="#a8b9b0" />
        </linearGradient>
        <linearGradient
          id={`agent-glass-${id}`}
          x1="23"
          y1="20"
          x2="39"
          y2="42"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#304d42" />
          <stop offset=".52" stopColor="#122c23" />
          <stop offset="1" stopColor="#071a14" />
        </linearGradient>
        <linearGradient
          id={`agent-rim-${id}`}
          x1="15"
          y1="14"
          x2="49"
          y2="49"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#fff" stopOpacity=".95" />
          <stop offset="1" stopColor="#718c7e" stopOpacity=".5" />
        </linearGradient>
      </defs>
      <ellipse cx="32" cy="54" rx="16" ry="2" fill="#071c14" opacity=".16" />
      <path
        d="M13 25c-2 0-3 2-3 6s1 6 3 6m38-12c2 0 3 2 3 6s-1 6-3 6"
        stroke="#92a99c"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <rect
        x="13"
        y="11"
        width="38"
        height="40"
        rx="15"
        fill={`url(#agent-shell-${id})`}
        stroke={`url(#agent-rim-${id})`}
      />
      <path
        d="M20 17c3-3 7-4 12-4s9 1 12 4"
        stroke="#fff"
        strokeOpacity=".8"
        strokeLinecap="round"
      />
      <rect
        x="18"
        y="20"
        width="28"
        height="21"
        rx="9"
        fill={`url(#agent-glass-${id})`}
        stroke="#647e70"
        strokeWidth=".7"
      />
      <path d="M23 23h18" stroke="#d4ebdf" strokeOpacity=".16" strokeLinecap="round" />
      <g className="agent-avatar-eyes" fill="#b8e8cc">
        <rect x="25" y="27" width="3" height="6" rx="1.5" />
        <rect x="36" y="27" width="3" height="6" rx="1.5" />
      </g>
      <path d="M29 45h6" stroke="#6e8879" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="45" cy="45" r="1" fill="#5b9270" />
    </svg>
  );
}
