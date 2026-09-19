/**
 * The canonical brand mark, inline exactly as it appears in
 * btg-ai-landing/index.html. Inline rather than an <img> because the design
 * uses two fills: indigo tile in the header, violet tile in the footer.
 */
export function BrandMark({ size = 30, variant = "header" }: { size?: number; variant?: "header" | "footer" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="30" height="30" rx="7" fill={variant === "footer" ? "#7C3AED" : "#1E1B4B"} />
      <path
        d="M10 8h6.5c3.4 0 5.6 1.9 5.6 4.7 0 2-1.1 3.4-2.9 4 2.2.6 3.6 2.3 3.6 4.6 0 3.1-2.5 5.2-6 5.2H10V8Zm3 6.4h3c1.6 0 2.5-.8 2.5-2.1 0-1.3-.9-2.1-2.5-2.1h-3v4.2Zm0 7.4h3.4c1.8 0 2.9-.9 2.9-2.4 0-1.5-1.1-2.4-2.9-2.4H13v4.8Z"
        fill="#F8FAFC"
      />
    </svg>
  );
}
