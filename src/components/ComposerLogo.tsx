import React, { useId } from "react";

interface ComposerLogoProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

export const ComposerLogo: React.FC<ComposerLogoProps> = ({
  size = 16,
  className,
  style,
}) => {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const clipId = `${uid}-clip`;
  const bgId = `${uid}-bg`;
  const borderId = `${uid}-border`;
  const glowId = `${uid}-glow`;
  const fiberGrad1 = `${uid}-gf1`;
  const fiberGrad2 = `${uid}-gf2`;
  const ribbonId = `${uid}-ribbon`;
  const sheenId = `${uid}-sheen`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
      aria-label="Composer"
    >
      <defs>
        <clipPath id={clipId}>
          <rect x="4" y="4" width="56" height="56" rx="14" />
        </clipPath>

        <linearGradient id={bgId} x1="6" y1="4" x2="58" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#080C18" />
          <stop offset="55%" stopColor="#0E1733" />
          <stop offset="100%" stopColor="#14265A" />
        </linearGradient>

        <linearGradient id={borderId} x1="6" y1="4" x2="58" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#DFF7FF" stopOpacity="0.85" />
          <stop offset="45%" stopColor="#60A5FA" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#2457FF" stopOpacity="0.9" />
        </linearGradient>

        <radialGradient id={glowId} cx="38" cy="34" r="30" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#2457FF" stopOpacity="0.52" />
          <stop offset="65%" stopColor="#00D4FF" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#2457FF" stopOpacity="0" />
        </radialGradient>

        <linearGradient id={fiberGrad1} x1="2" y1="52" x2="62" y2="10" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#2457FF" stopOpacity="0.25" />
          <stop offset="45%" stopColor="#00D4FF" stopOpacity="0.9" />
          <stop offset="80%" stopColor="#DFF7FF" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#2457FF" stopOpacity="0.35" />
        </linearGradient>

        <linearGradient id={fiberGrad2} x1="6" y1="56" x2="62" y2="18" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#2457FF" stopOpacity="0.18" />
          <stop offset="50%" stopColor="#60A5FA" stopOpacity="0.75" />
          <stop offset="100%" stopColor="#DFF7FF" stopOpacity="0.4" />
        </linearGradient>

        <linearGradient id={ribbonId} x1="16" y1="18" x2="47" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#DFF7FF" />
          <stop offset="48%" stopColor="#60A5FA" />
          <stop offset="100%" stopColor="#2457FF" />
        </linearGradient>

        <linearGradient id={sheenId} x1="8" y1="6" x2="46" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Deep Obsidian + Quantum Blue Squircle Container */}
      <rect x="4" y="4" width="56" height="56" rx="14" fill={`url(#${bgId})`} />
      <rect x="4" y="4" width="56" height="56" rx="14" fill={`url(#${glowId})`} />

      {/* Ghost Fiber Twisted Ribbons & Particulate Strands (Behind the C) */}
      <g clipPath={`url(#${clipId})`}>
        {/* Soft ribbon bloom */}
        <path
          d="M 1 51 C 15 41, 22 24, 37 26 C 48 27, 54 15, 63 8"
          stroke={`url(#${fiberGrad1})`}
          strokeWidth="7.5"
          strokeOpacity="0.26"
          strokeLinecap="round"
        />
        {/* Primary sharp twisted fiber */}
        <path
          d="M 2 48 C 16 38, 24 21, 38 24 C 49 26, 54 14, 62 9"
          stroke={`url(#${fiberGrad1})`}
          strokeWidth="1.75"
          strokeLinecap="round"
        />
        {/* Secondary intersecting twist */}
        <path
          d="M 6 57 C 21 44, 24 31, 37 28 C 48 25, 52 18, 63 14"
          stroke={`url(#${fiberGrad2})`}
          strokeWidth="1.35"
          strokeLinecap="round"
        />
        {/* Particulate dotted Ghost Fiber streams */}
        <path
          d="M 3 53 C 17 41, 25 25, 37 26.5 C 47 28, 53 16.5, 61 11"
          stroke="#DFF7FF"
          strokeOpacity="0.88"
          strokeWidth="1.5"
          strokeDasharray="0.2 3.1"
          strokeLinecap="round"
        />
        <path
          d="M 13 58 C 26 46, 33 36, 46 33 C 54 31, 58 25, 63 20"
          stroke="#60A5FA"
          strokeOpacity="0.65"
          strokeWidth="1.3"
          strokeDasharray="0.2 3.4"
          strokeLinecap="round"
        />
      </g>

      {/* Subtle Glass Surface Sheen */}
      <path
        d="M18 5 H46 C53.2 5 59 10.8 59 18 V24 C45 19 25 22 5 30 V18 C5 10.8 10.8 5 18 5 Z"
        fill={`url(#${sheenId})`}
      />

      {/* Platinum / Ice Glass Rim */}
      <rect
        x="4.9"
        y="4.9"
        width="54.2"
        height="54.2"
        rx="13.2"
        stroke={`url(#${borderId})`}
        strokeWidth="1.8"
      />

      {/* Subtle Contrast Halo Separating C from Ghost Fiber Wave */}
      <path
        d="M44.5 21.5 C39.8 16.4 30.8 15.6 24.4 20.1 C17.6 24.9 16.5 35.1 21.8 41.7 C27.1 48.3 37.9 48.7 44.5 42.5"
        stroke="#080C18"
        strokeOpacity="0.5"
        strokeWidth="10.4"
        strokeLinecap="round"
      />

      {/* Primary Ice-Glass -> Quantum Blue Ribbon Monogram */}
      <path
        d="M44.5 21.5 C39.8 16.4 30.8 15.6 24.4 20.1 C17.6 24.9 16.5 35.1 21.8 41.7 C27.1 48.3 37.9 48.7 44.5 42.5"
        stroke={`url(#${ribbonId})`}
        strokeWidth="7.4"
        strokeLinecap="round"
      />

      {/* Crisp Specular Edge Highlight on Ribbon */}
      <path
        d="M42.8 20.3 C37.8 16.2 29.7 16.1 24.3 20.2 C20.3 23.2 18.6 27.6 18.7 32"
        stroke="#FFFFFF"
        strokeOpacity="0.6"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
};

export default ComposerLogo;
