/**
 * The marketing site is a self-contained, responsive document supplied by the
 * business. Keeping it as a public document lets its page-level animation and
 * mobile styles run exactly as designed, while the portal itself remains the
 * React application behind /login and the protected routes.
 */
export default function Landing() {
  return (
    <iframe
      title="Get Hired Global"
      src="/get-hired-global.html"
      className="block h-[100dvh] w-full border-0"
      style={{ minHeight: '100dvh' }}
    />
  );
}
