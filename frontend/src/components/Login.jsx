import { useState } from "react";
import { Mail } from "lucide-react";
import AuthLayout from "./AuthLayout.jsx";
import PasswordField from "./PasswordField.jsx";
import { saveSession } from "../lib/session.js";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { IconInput } from "@/components/ui/icon-input";
import { Alert, AlertDescription } from "@/components/ui/alert";

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
      <Card className="w-[min(420px,100%)] gap-5 rounded-3xl border-white/8 bg-linear-to-b from-card/95 to-card/80 p-9 shadow-2xl backdrop-blur-xl">
        <form onSubmit={submit} noValidate className="grid gap-5">
          <div className="mx-auto aspect-video w-2/3 max-w-56">
            <img src="/pixia.png" alt="Pixia" className="h-full w-full object-contain" />
          </div>

          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Entrar na conta</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Acesse seu painel de links salvos.
            </p>
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-2">
            <Label htmlFor="login-email">E-mail</Label>
            <IconInput
              icon={Mail}
              id="login-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="bigodes@pixia.com"
              maxLength={190}
              autoFocus
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="login-password">Senha</Label>
            <PasswordField
              id="login-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Sua senha"
            />
          </div>

          <Button type="submit" size="lg" className="h-11 w-full rounded-xl text-sm" disabled={loading}>
            {loading ? "Entrando..." : "Entrar"}
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            Ainda não tem conta?{" "}
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => onNavigate("/cadastro")}
            >
              Criar conta
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
