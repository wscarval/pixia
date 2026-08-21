import { useState } from "react";
import { Mail, User } from "lucide-react";
import AuthLayout from "./AuthLayout.jsx";
import PasswordField from "./PasswordField.jsx";
import { saveSession } from "../lib/session.js";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { IconInput } from "@/components/ui/icon-input";
import { Alert, AlertDescription } from "@/components/ui/alert";

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
      <Card className="w-[min(420px,100%)] rounded-3xl border-white/8 bg-linear-to-b from-card/95 to-card/80 p-9 shadow-2xl backdrop-blur-xl">
        <form onSubmit={submit} noValidate className="grid gap-5">
          <div className="mx-auto aspect-video w-2/3 max-w-56">
            <img src="/pixia.png" alt="Pixia" className="h-full w-full object-contain" />
          </div>

          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Criar conta</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Crie sua conta para organizar e acessar suas salas.
            </p>
          </div>

          {success ? (
            <Alert className="border-success/25 bg-success/10 text-success">
              <AlertDescription className="text-success/90">
                Conta criada! Redirecionando...
              </AlertDescription>
            </Alert>
          ) : null}
          {submitError ? (
            <Alert variant="destructive">
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-2">
            <Label htmlFor="signup-name">Nome</Label>
            <IconInput
              icon={User}
              id="signup-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Bigodes"
              maxLength={60}
              autoFocus
            />
            {errors.name ? <span className="text-xs text-destructive">{errors.name}</span> : null}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="signup-email">E-mail</Label>
            <IconInput
              icon={Mail}
              id="signup-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="bigodes@pixia.com"
              maxLength={190}
            />
            {errors.email ? <span className="text-xs text-destructive">{errors.email}</span> : null}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="signup-password">Senha</Label>
            <PasswordField
              id="signup-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={`Mínimo de ${MIN_PASSWORD_LENGTH} caracteres`}
            />
            {errors.password ? <span className="text-xs text-destructive">{errors.password}</span> : null}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="signup-confirm-password">Confirmar senha</Label>
            <PasswordField
              id="signup-confirm-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Repita a senha"
            />
            {errors.confirmPassword ? (
              <span className="text-xs text-destructive">{errors.confirmPassword}</span>
            ) : null}
          </div>

          <Button type="submit" size="lg" className="h-11 w-full rounded-xl text-sm" disabled={loading}>
            {loading ? "Criando conta..." : "Criar conta"}
          </Button>

          <p className="text-center text-xs leading-relaxed text-muted-foreground">
            Ao continuar, você concorda com nossos{" "}
            <button
              type="button"
              className="text-primary hover:underline"
              onClick={() => onNavigate("/termos")}
            >
              Termos de Uso
            </button>{" "}
            e com nossa{" "}
            <button
              type="button"
              className="text-primary hover:underline"
              onClick={() => onNavigate("/privacidade")}
            >
              Política de Privacidade
            </button>
            .
          </p>

          <p className="text-center text-sm text-muted-foreground">
            Já tem conta?{" "}
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => onNavigate("/entrar")}
            >
              Entrar
            </button>
          </p>

          <Button type="button" variant="link" className="mx-auto" onClick={() => onNavigate("/")}>
            Voltar
          </Button>
        </form>
      </Card>
    </AuthLayout>
  );
}
