import { useState } from "react";
import { Mail, User } from "lucide-react";
import AuthLayout from "./AuthLayout.jsx";
import PasswordField from "./PasswordField.jsx";
import { saveSession } from "../lib/session.js";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_NAME_LENGTH = 4;
const MIN_PASSWORD_LENGTH = 6;

function validate({ name, email, password, confirmPassword }) {
  const errors = {};

  if (name.trim().length < MIN_NAME_LENGTH) {
    errors.name = `O nome precisa ter mais de ${MIN_NAME_LENGTH - 1} caracteres.`;
  }
  if (!EMAIL_REGEX.test(email.trim())) errors.email = "Informe um e-mail válido.";
  if (password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `A senha precisa ter ao menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  }
  if (confirmPassword !== password) errors.confirmPassword = "As senhas não coincidem.";

  return errors;
}

export default function SignUp({ onNavigate, onAuthenticated }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setSubmitError("");

    const nextErrors = validate({ name, email, password, confirmPassword });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setLoading(true);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.ok) {
        setSubmitError(data?.message || "Não foi possível criar a conta.");
        return;
      }

      saveSession(data.token, data.user);
      onAuthenticated?.(data.user);

      setSuccess(true);
      window.setTimeout(() => onNavigate("/"), 900);
    } catch {
      setSubmitError("Falha ao conectar ao servidor. Tente novamente.");
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
        <h1>Criar conta</h1>
        <p className="muted">Crie sua conta para organizar e acessar suas salas.</p>

        {success ? <div className="success-banner">Conta criada! Redirecionando...</div> : null}
        {submitError ? <div className="error-banner inline">{submitError}</div> : null}

        <div className="field">
          <label htmlFor="signup-name">Nome</label>
          <div className="input-group">
            <User size={16} />
            <input
              id="signup-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Bigodes"
              maxLength={60}
              autoFocus
            />
          </div>
          {errors.name ? <span className="field-error">{errors.name}</span> : null}
        </div>

        <div className="field">
          <label htmlFor="signup-email">E-mail</label>
          <div className="input-group">
            <Mail size={16} />
            <input
              id="signup-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="bigodes@pixia.com"
              maxLength={190}
            />
          </div>
          {errors.email ? <span className="field-error">{errors.email}</span> : null}
        </div>

        <div className="field">
          <label htmlFor="signup-password">Senha</label>
          <PasswordField
            id="signup-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={`Mínimo de ${MIN_PASSWORD_LENGTH} caracteres`}
          />
          {errors.password ? <span className="field-error">{errors.password}</span> : null}
        </div>

        <div className="field">
          <label htmlFor="signup-confirm-password">Confirmar senha</label>
          <PasswordField
            id="signup-confirm-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="Repita a senha"
          />
          {errors.confirmPassword ? (
            <span className="field-error">{errors.confirmPassword}</span>
          ) : null}
        </div>

        <button className="primary-button" type="submit" disabled={loading}>
          {loading ? "Criando conta..." : "Criar conta"}
        </button>

        <p className="legal-notice">
          Ao continuar, você concorda com nossos{" "}
          <button type="button" className="link-button inline" onClick={() => onNavigate("/termos")}>
            Termos de Uso
          </button>{" "}
          e com nossa{" "}
          <button type="button" className="link-button inline" onClick={() => onNavigate("/privacidade")}>
            Política de Privacidade
          </button>
          .
        </p>

        <p className="auth-switch">
          Já tem conta?{" "}
          <button type="button" onClick={() => onNavigate("/entrar")}>
            Entrar
          </button>
        </p>

        <button type="button" className="link-button" onClick={() => onNavigate("/")}>
          Voltar
        </button>
      </form>
    </AuthLayout>
  );
}
