export function Icon({ name, size = 22 }: { name: string; size?: number }) {
  const paths: Record<string, string> = {
    tower: 'M5 21V8H3V3H7V6H10V3H14V6H17V3H21V8H19V21ZM10 21V15H14V21',
    build: 'M12 4V20M4 12H20',
    upgrade: 'M5 14L12 7L19 14M5 20L12 13L19 20',
    expand: 'M4 9V4H9M15 4H20V9M20 15V20H15M9 20H4V15',
    attack:
      'M12 2V6M12 18V22M2 12H6M18 12H22M19 12A7 7 0 1 1 5 12A7 7 0 1 1 19 12M14 12A2 2 0 1 1 10 12A2 2 0 1 1 14 12',
    close: 'M6 6L18 18M18 6L6 18',
    arrow: 'M5 12H19M13 6L19 12L13 18',
    copy: 'M9 5H5V19H15V16M9 2H20V15H9Z',
    check: 'M5 12L10 17L19 7',
    help: 'M9 8A3 3 0 0 1 15 8C15 10 12 10 12 13M12 17H12.01M22 12A10 10 0 1 1 2 12A10 10 0 1 1 22 12',
    minus: 'M5 12H19',
    clock: 'M12 6V12L16 14M22 12A10 10 0 1 1 2 12A10 10 0 1 1 22 12',
    home: 'M3 11L12 3L21 11M5 10V21H10V15H14V21H19V10',
    shield: 'M12 3L21 7V12C21 17 16 20 12 22C8 20 3 17 3 12V7Z',
    eye: 'M2 12C7 3 17 3 22 12C17 21 7 21 2 12ZM15 12A3 3 0 1 1 9 12A3 3 0 1 1 15 12',
    star: 'M12 2L15 8L22 9L17 14L18 21L12 18L6 21L7 14L2 9L9 8Z',
    circle: 'M18 12A6 6 0 1 1 6 12A6 6 0 1 1 18 12',
    crown: 'M3 6L7 10L12 3L17 10L21 6L19 19H5ZM5 22H19',
    diamond: 'M12 3L21 12L12 21L3 12Z',
    square: 'M5 5H19V19H5Z',
    triangle: 'M12 3L22 21H2Z',
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.star} />
    </svg>
  );
}
