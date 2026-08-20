import { useState } from "react";
import { Mail } from "lucide-react";
import AuthLayout from "./AuthLayout.jsx";
import PasswordField from "./PasswordField.jsx";
import { saveSession } from "../lib/session.js";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Login({ onNavigate, onAuthenticated }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError("");

    if (!EMAIL_REGEX.test(email.trim()) || !password) {
      setError("Informe um e-mail válido e a senha.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.ok) {
        setError(data?.message || "Não foi possível entrar.");
        return;
      }

      saveSession(data.token, data.user);
      onAuthenticated(data.user);
      onNavigate("/painel");
    } catch {
      setError("Falha ao conectar ao servidor. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout>
      <form className="join-card" onSubmit={submit} noValidate>
        <div className="brand-mark">
          <img src="/pixia.png" alt="Pixia" />
        </div>
        <h1>Entrar na conta</h1>
        <p className="muted">Acesse seu painel de links salvos.</p>

        {error ? <div className="error-banner inline">{error}</div> : null}

        <div className="field">
          <label htmlFor="login-email">E-mail</label>
          <div className="input-group">
            <Mail size={16} />
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="bigodes@pixia.com"
              maxLength={190}
              autoFocus
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="login-password">Senha</label>
          <PasswordField
            id="login-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Sua senha"
          />
        </div>

        <button className="primary-button" type="submit" disabled={loading}>
          {loading ? "Entrando..." : "Entrar"}
        </button>

        <p className="auth-switch">
          Ainda não tem conta?{" "}
          <button type="button" onClick={() => onNavigate("/cadastro")}>
            Criar conta
          </button>
        </p>

        <button type="button" className="link-button" onClick={() => onNavigate("/")}>
          Voltar
        </button>
      </form>
    </AuthLayout>
  );
}
