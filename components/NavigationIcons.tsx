type IconProps = { className?: string };

export function AtlasIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m3.5 5.5 5.5-2 6 2 5.5-2v15l-5.5 2-6-2-5.5 2v-15Z" />
      <path d="M9 3.5v15M15 5.5v15" />
      <path d="m6 9 1.2 1.2L10 7.5" />
    </svg>
  );
}

export function NavigatorIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 17a8 8 0 0 1 16 0" />
      <path d="M6 17h12" />
      <path d="M12 9v8" />
      <path d="m8.5 13.5 7-4" />
      <circle cx="12" cy="17" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}
