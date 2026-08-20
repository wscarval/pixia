export default function AuthLayout({ children }) {
  return (
    <main className="auth-page">
      <div className="auth-glow" />
      <section className="auth-panel">{children}</section>
    </main>
  );
}
