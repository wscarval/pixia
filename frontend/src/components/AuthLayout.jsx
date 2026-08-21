export default function AuthLayout({ children }) {
  return (
    <main className="relative flex min-h-screen">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(108,94,219,0.16),transparent_42%)]" />
      <section className="relative grid w-full place-items-center p-6">{children}</section>
    </main>
  );
}
