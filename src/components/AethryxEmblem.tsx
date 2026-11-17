import React from 'react';

interface AethryxEmblemProps {
  className?: string;
}

export const AethryxEmblem: React.FC<AethryxEmblemProps> = ({ className = 'w-8 h-8' }) => {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <circle cx="20" cy="20" r="17.5" stroke="#0E7490" strokeWidth="1.2" strokeDasharray="3 2.5" />
      <ellipse
        cx="20"
        cy="20"
        rx="16"
        ry="6.5"
        transform="rotate(-24 20 20)"
        stroke="#22D3EE"
        strokeWidth="1.4"
      />
      <path
        d="M20 7.5L29.5 29H25.2L20 16.5L14.8 29H10.5L20 7.5Z"
        fill="#E2E8F0"
      />
      <path d="M15.5 23.5H24.5" stroke="#38BDF8" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="20" cy="7.5" r="2" fill="#22D3EE" />
    </svg>
  );
};
