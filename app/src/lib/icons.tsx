// Minimal stroke icons (Lucide-style, 1.6 stroke). Ported from icons.jsx.

import { CSSProperties, ReactNode } from "react";

type IconProps = {
  size?: number;
  color?: string;
  style?: CSSProperties;
  className?: string;
};

function Ico({ size = 16, color = "currentColor", style, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      className={className}
    >
      {children}
    </svg>
  );
}

export const IconServer = (p: IconProps) => <Ico {...p}><rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M7 7.5h.01M7 16.5h.01" /></Ico>;
export const IconBox = (p: IconProps) => <Ico {...p}><path d="M3 7l9-4 9 4-9 4-9-4z" /><path d="M3 7v10l9 4 9-4V7" /><path d="M12 11v10" /></Ico>;
export const IconChart = (p: IconProps) => <Ico {...p}><path d="M3 21h18" /><path d="M5 17V9" /><path d="M10 17V5" /><path d="M15 17v-6" /><path d="M20 17v-9" /></Ico>;
export const IconDisk = (p: IconProps) => <Ico {...p}><ellipse cx="12" cy="6" rx="9" ry="3" /><path d="M3 6v6c0 1.66 4 3 9 3s9-1.34 9-3V6" /><path d="M3 12v6c0 1.66 4 3 9 3s9-1.34 9-3v-6" /></Ico>;
export const IconNet = (p: IconProps) => <Ico {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" /></Ico>;
export const IconGear = (p: IconProps) => <Ico {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1A1.7 1.7 0 004.6 9a1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z" /></Ico>;
export const IconPlus = (p: IconProps) => <Ico {...p}><path d="M12 5v14M5 12h14" /></Ico>;
export const IconSearch = (p: IconProps) => <Ico {...p}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></Ico>;
export const IconChevR = (p: IconProps) => <Ico {...p}><path d="M9 6l6 6-6 6" /></Ico>;
export const IconChevL = (p: IconProps) => <Ico {...p}><path d="M15 6l-6 6 6 6" /></Ico>;
export const IconChevD = (p: IconProps) => <Ico {...p}><path d="M6 9l6 6 6-6" /></Ico>;
export const IconArrowUp = (p: IconProps) => <Ico {...p}><path d="M12 19V5M5 12l7-7 7 7" /></Ico>;
export const IconArrowDn = (p: IconProps) => <Ico {...p}><path d="M12 5v14M5 12l7 7 7-7" /></Ico>;
export const IconCheck = (p: IconProps) => <Ico {...p}><path d="M4 12l5 5L20 6" /></Ico>;
export const IconX = (p: IconProps) => <Ico {...p}><path d="M18 6L6 18M6 6l12 12" /></Ico>;
export const IconPlay = (p: IconProps) => <Ico {...p}><polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none" /></Ico>;
export const IconPause = (p: IconProps) => <Ico {...p}><rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" /><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" /></Ico>;
export const IconStop = (p: IconProps) => <Ico {...p}><rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" stroke="none" /></Ico>;
export const IconRefresh = (p: IconProps) => <Ico {...p}><path d="M21 12a9 9 0 11-3-6.7L21 8" /><path d="M21 3v5h-5" /></Ico>;
export const IconUpload = (p: IconProps) => <Ico {...p}><path d="M12 3v13" /><path d="M7 8l5-5 5 5" /><path d="M5 21h14" /></Ico>;
export const IconGithub = (p: IconProps) => <Ico {...p}><path d="M9 19c-4.3 1.4-4.3-2.2-6-2.7M15 21v-3.5a3 3 0 00-.9-2.4c2.9-.3 5.9-1.4 5.9-6.4a5 5 0 00-1.4-3.5c.2-.5.6-2-.2-4 0 0-1.1-.4-3.7 1.3a12.6 12.6 0 00-6.5 0C5.6 0 4.5.4 4.5.4c-.8 2-.4 3.5-.2 4A5 5 0 002.9 8c0 5 3 6 5.9 6.4-.6.5-1 1.5-1 2.5V21" /></Ico>;
export const IconDocker = (p: IconProps) => <Ico {...p}><rect x="3" y="11" width="3" height="3" rx="0.4" /><rect x="7" y="11" width="3" height="3" rx="0.4" /><rect x="11" y="11" width="3" height="3" rx="0.4" /><rect x="7" y="7" width="3" height="3" rx="0.4" /><rect x="11" y="7" width="3" height="3" rx="0.4" /><rect x="11" y="3" width="3" height="3" rx="0.4" /><path d="M22 13c-.5-1.5-2-2-2-2s.5 1.5 0 2.5" /><path d="M2 16c2 2 6 2 9 2 6 0 9-2 11-5" /></Ico>;
export const IconCompose = (p: IconProps) => <Ico {...p}><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" /></Ico>;
export const IconTerm = (p: IconProps) => <Ico {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9l3 3-3 3M13 15h4" /></Ico>;
export const IconLogs = (p: IconProps) => <Ico {...p}><path d="M4 6h16M4 12h10M4 18h13" /></Ico>;
export const IconKey = (p: IconProps) => <Ico {...p}><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M16 7l3 3" /></Ico>;
export const IconUser = (p: IconProps) => <Ico {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0116 0" /></Ico>;
export const IconBolt = (p: IconProps) => <Ico {...p}><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" /></Ico>;
export const IconCommand = (p: IconProps) => <Ico {...p}><path d="M9 6V4.5A2.5 2.5 0 116.5 7H9zM9 6v12M9 18v1.5A2.5 2.5 0 116.5 17H9zM15 18v1.5A2.5 2.5 0 1017.5 17H15zM15 18V6M15 6V4.5A2.5 2.5 0 1117.5 7H15z" /></Ico>;
export const IconGlobe = (p: IconProps) => <Ico {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" /></Ico>;
export const IconCloud = (p: IconProps) => <Ico {...p}><path d="M17 17a4 4 0 100-8 5 5 0 00-9.6 1.4A3.5 3.5 0 007 17h10z" /></Ico>;
export const IconShield = (p: IconProps) => <Ico {...p}><path d="M12 3l8 3v6c0 4.5-3.4 8.4-8 9-4.6-.6-8-4.5-8-9V6l8-3z" /></Ico>;
export const IconDots = (p: IconProps) => <Ico {...p}><circle cx="5" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="19" cy="12" r="1.2" fill="currentColor" /></Ico>;
export const IconFolder = (p: IconProps) => <Ico {...p}><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" /></Ico>;
export const IconHeart = (p: IconProps) => <Ico {...p}><path d="M12 21s-7-4.5-9-9.5C1.5 7 5 4 8 5.5c1.5.7 2.5 1.9 4 4 1.5-2.1 2.5-3.3 4-4 3-1.5 6.5 1.5 5 6-2 5-9 9.5-9 9.5z" /></Ico>;
export const IconLink = (p: IconProps) => <Ico {...p}><path d="M10 14a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1" /><path d="M14 10a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1" /></Ico>;
export const IconRegion = (p: IconProps) => <Ico {...p}><path d="M12 22s8-7 8-13a8 8 0 10-16 0c0 6 8 13 8 13z" /><circle cx="12" cy="9" r="3" /></Ico>;
