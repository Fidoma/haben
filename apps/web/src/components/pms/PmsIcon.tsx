/** Die zwei ausschließlich im PMS verwendeten Symbole bleiben im Modul. */
export function PmsIcon({ name, size = 18 }: { name: "room" | "search"; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "room" ? (
        <>
          <path d="M4 21V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v17M2 21h20" />
          <path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2" />
        </>
      ) : (
        <>
          <circle cx="11" cy="11" r="7" />
          <path d="M16 16l5 5" />
        </>
      )}
    </svg>
  );
}
