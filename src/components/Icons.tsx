import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Base({ size = 18, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconDatabase = (props: IconProps) => (
  <Base {...props}>
    <ellipse cx="12" cy="5" rx="8" ry="3" />
    <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
    <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
  </Base>
);

export const IconTable = (props: IconProps) => (
  <Base {...props}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 10h18M9 10v10" />
  </Base>
);

export const IconSearch = (props: IconProps) => (
  <Base {...props}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.2-3.2" />
  </Base>
);

export const IconRelations = (props: IconProps) => (
  <Base {...props}>
    <circle cx="6" cy="6" r="2.6" />
    <circle cx="18" cy="6" r="2.6" />
    <circle cx="12" cy="18" r="2.6" />
    <path d="M8.6 6h6.8M7.4 8.2l3.2 7.6M16.6 8.2l-3.2 7.6" />
  </Base>
);

export const IconCode = (props: IconProps) => (
  <Base {...props}>
    <path d="m8 8-5 4 5 4M16 8l5 4-5 4M13.5 5l-3 14" />
  </Base>
);

export const IconChart = (props: IconProps) => (
  <Base {...props}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </Base>
);

export const IconHome = (props: IconProps) => (
  <Base {...props}>
    <path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M9 21v-8h6v8" />
  </Base>
);

export const IconSun = (props: IconProps) => (
  <Base {...props}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Base>
);

export const IconMoon = (props: IconProps) => (
  <Base {...props}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5" />
  </Base>
);

export const IconGlobe = (props: IconProps) => (
  <Base {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.7 3.8 5.8 3.8 9S14.5 18.3 12 21c-2.5-2.7-3.8-5.8-3.8-9S9.5 5.7 12 3" />
  </Base>
);

export const IconUpload = (props: IconProps) => (
  <Base {...props}>
    <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
    <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </Base>
);

export const IconFile = (props: IconProps) => (
  <Base {...props}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </Base>
);

export const IconDownload = (props: IconProps) => (
  <Base {...props}>
    <path d="M12 4v12m0 0 4.5-4.5M12 16l-4.5-4.5" />
    <path d="M4 18v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1" />
  </Base>
);

export const IconChevronDown = (props: IconProps) => (
  <Base {...props}>
    <path d="m6 9 6 6 6-6" />
  </Base>
);

export const IconChevronRight = (props: IconProps) => (
  <Base {...props}>
    <path d="m9 6 6 6-6 6" />
  </Base>
);

export const IconArrowRight = (props: IconProps) => (
  <Base {...props}>
    <path d="M5 12h14m0 0-6-6m6 6-6 6" />
  </Base>
);

export const IconClose = (props: IconProps) => (
  <Base {...props}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Base>
);

export const IconCopy = (props: IconProps) => (
  <Base {...props}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
  </Base>
);

export const IconPlay = (props: IconProps) => (
  <Base {...props}>
    <path d="M7 4.5v15l12-7.5z" />
  </Base>
);

export const IconFilter = (props: IconProps) => (
  <Base {...props}>
    <path d="M3 5h18l-7 8v6l-4 2v-8z" />
  </Base>
);

export const IconSort = (props: IconProps) => (
  <Base {...props}>
    <path d="M8 5v14m0 0-3-3m3 3 3-3M16 19V5m0 0-3 3m3-3 3 3" />
  </Base>
);

export const IconRefresh = (props: IconProps) => (
  <Base {...props}>
    <path d="M20 11a8 8 0 1 0-1.6 5.6" />
    <path d="M20 5v6h-6" />
  </Base>
);

export const IconWarning = (props: IconProps) => (
  <Base {...props}>
    <path d="M12 4 2.5 20h19z" />
    <path d="M12 10v4M12 17.5v.5" />
  </Base>
);

export const IconKey = (props: IconProps) => (
  <Base {...props}>
    <circle cx="8" cy="15" r="4" />
    <path d="m11 12 8-8m0 0v3m0-3h-3" />
  </Base>
);

export const IconSpark = (props: IconProps) => (
  <Base {...props}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" />
  </Base>
);

export const IconPin = (props: IconProps) => (
  <Base {...props}>
    <path d="M9 4h6l-1 6 3 3H7l3-3-1-6z" />
    <path d="M12 13v7" />
  </Base>
);

export const IconGrid = (props: IconProps) => (
  <Base {...props}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
  </Base>
);

export const IconRows = (props: IconProps) => (
  <Base {...props}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 9.5h18M3 15h18" />
  </Base>
);

export const IconCheck = (props: IconProps) => (
  <Base {...props}>
    <path d="m4 12 5 5L20 6" />
  </Base>
);

export const IconFit = (props: IconProps) => (
  <Base {...props}>
    <path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4" />
    <path d="M9 12h6" />
  </Base>
);

export const IconCompare = (props: IconProps) => (
  <Base {...props}>
    <path d="M12 3v18" />
    <path d="M7 7 3 12l4 5" />
    <path d="m17 7 4 5-4 5" />
  </Base>
);

export const IconKeyboard = (props: IconProps) => (
  <Base {...props}>
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
  </Base>
);

export const IconShare = (props: IconProps) => (
  <Base {...props}>
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4" />
  </Base>
);

export const IconPackage = (props: IconProps) => (
  <Base {...props}>
    <path d="M21 8v8a2 2 0 0 1-1 1.73l-7 4a2 2 0 0 1-2 0l-7-4A2 2 0 0 1 3 16V8a2 2 0 0 1 1-1.73l7-4a2 2 0 0 1 2 0l7 4A2 2 0 0 1 21 8Z" />
    <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
  </Base>
);

export const IconTrash = (props: IconProps) => (
  <Base {...props}>
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
  </Base>
);
