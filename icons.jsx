// Lightweight inline SVG icons — hand-tuned line weight to match boutique feel
const Icon = ({ name, className = 'ico', style }) => {
  const s = 'currentColor';
  const P = { fill:'none', stroke:s, strokeWidth:1.6, strokeLinecap:'round', strokeLinejoin:'round' };
  const paths = {
    sparkles: <g {...P}><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z"/><path d="M19 14l.7 1.9L21.6 16.6l-1.9.7L19 19l-.7-1.9L16.4 16.6l1.9-.7L19 14z"/></g>,
    template: <g {...P}><rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="12" width="8" height="8" rx="1.5"/><rect x="13" y="12" width="8" height="8" rx="1.5"/></g>,
    photo: <g {...P}><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M4 18l5-5 4 4 3-3 4 4"/></g>,
    settings: <g {...P}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 00.3 1.7l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.7-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.7.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.7 1.6 1.6 0 00-1.5-1H3a2 2 0 110-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.7l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.7.3H9a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.7-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.7V9a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z"/></g>,
    library: <g {...P}><path d="M4 4h4v16H4zM10 6h4v14h-4zM17 8l3.5 1-3 12-3.5-1z"/></g>,
    home: <g {...P}><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></g>,
    users: <g {...P}><path d="M17 21v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8"/></g>,
    search: <g {...P}><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></g>,
    bell: <g {...P}><path d="M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9M13.7 21a2 2 0 01-3.4 0"/></g>,
    plus: <g {...P}><path d="M12 5v14M5 12h14"/></g>,
    edit: <g {...P}><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></g>,
    copy: <g {...P}><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></g>,
    trash: <g {...P}><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></g>,
    eye: <g {...P}><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></g>,
    lock: <g {...P}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></g>,
    check: <g {...P}><path d="M20 6L9 17l-5-5"/></g>,
    upload: <g {...P}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></g>,
    download: <g {...P}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></g>,
    save: <g {...P}><path d="M5 3h12l3 3v15H4V3h1z"/><path d="M7 3v6h8V3M8 21v-6h8v6"/></g>,
    sun: <g {...P}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></g>,
    camera: <g {...P}><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></g>,
    layout: <g {...P}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></g>,
    tag: <g {...P}><path d="M20.6 13.4L13 21a2 2 0 01-3 0l-8-8V2h11l7.6 7.6a2 2 0 010 3z"/><circle cx="7" cy="7" r="1.5"/></g>,
    palette: <g {...P}><path d="M12 22C6.5 22 2 17.5 2 12S6.5 2 12 2s10 4 10 9c0 3-2 5-5 5h-2a2 2 0 00-2 2 2 2 0 01-1 4z"/></g>,
    magic: <g {...P}><path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.7 6.3l1.4-1.4M12.7 11.3l1.4-1.4M3 21l9-9"/></g>,
    refresh: <g {...P}><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M20.5 9A9 9 0 003.5 5.6L1 8M3.5 15A9 9 0 0020.5 18.4L23 16"/></g>,
    grid: <g {...P}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></g>,
    heart: <g {...P}><path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 00-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 000-7.8z"/></g>,
    star: <g {...P}><path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/></g>,
    chevronDown: <g {...P}><path d="M6 9l6 6 6-6"/></g>,
    chevronRight: <g {...P}><path d="M9 6l6 6-6 6"/></g>,
    chevronLeft: <g {...P}><path d="M15 6l-6 6 6 6"/></g>,
    x: <g {...P}><path d="M18 6L6 18M6 6l12 12"/></g>,
    scissors: <g {...P}><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12"/></g>,
    aperture: <g {...P}><circle cx="12" cy="12" r="10"/><path d="M14.3 9.7L20.7 3.3M8.5 8.5L4.5 3.5M9.7 14.3L3.3 20.7M14.3 14.3l6.4 6.4M8.5 15.5L4.5 20.5"/></g>,
    sparkle2: <g {...P}><path d="M12 3v18M3 12h18"/></g>,
    dot3: <g {...P}><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></g>,
    flower: <g {...P}><circle cx="12" cy="12" r="2.5"/><path d="M12 9.5V6a3 3 0 116 0 3 3 0 01-3 3M12 14.5V18a3 3 0 11-6 0 3 3 0 013-3M9.5 12H6a3 3 0 110-6 3 3 0 013 3M14.5 12H18a3 3 0 110 6 3 3 0 01-3-3"/></g>,
    layers: <g {...P}><path d="M12 2l10 6-10 6L2 8l10-6z"/><path d="M2 16l10 6 10-6M2 12l10 6 10-6"/></g>,
    zap: <g {...P}><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></g>,
  };
  return (
    <svg viewBox="0 0 24 24" className={className} style={style}>{paths[name]}</svg>
  );
};

// Watercolor rose logo — simplified inline mark
const RoseLogo = ({ size = 26 }) => (
  <svg viewBox="0 0 40 40" width={size} height={size}>
    <defs>
      <radialGradient id="petal" cx="50%" cy="45%" r="60%">
        <stop offset="0%" stopColor="#FFECF6"/>
        <stop offset="55%" stopColor="#F1CFEA"/>
        <stop offset="100%" stopColor="#C97AB8"/>
      </radialGradient>
      <radialGradient id="leaf" cx="50%" cy="50%" r="60%">
        <stop offset="0%" stopColor="#C8D2BF"/>
        <stop offset="100%" stopColor="#8A9982"/>
      </radialGradient>
    </defs>
    {/* leaves */}
    <path d="M8 22 C 8 14, 14 12, 16 20 C 14 22, 10 24, 8 22 Z" fill="url(#leaf)" opacity=".85"/>
    <path d="M32 22 C 32 14, 26 12, 24 20 C 26 22, 30 24, 32 22 Z" fill="url(#leaf)" opacity=".85"/>
    <path d="M12 30 C 10 26, 14 22, 18 26 C 18 30, 14 32, 12 30 Z" fill="url(#leaf)" opacity=".7"/>
    {/* rose */}
    <circle cx="20" cy="20" r="8.5" fill="url(#petal)"/>
    <path d="M20 14 C 22.5 15.5, 24.5 17, 24 20 C 23 22.5, 21 22.5, 20 21 C 19 22.5, 17 22.5, 16 20 C 15.5 17, 17.5 15.5, 20 14 Z" fill="#B5599F" opacity=".55"/>
    <circle cx="20" cy="19.5" r="1.6" fill="#7A2867"/>
  </svg>
);

Object.assign(window, { Icon, RoseLogo });
