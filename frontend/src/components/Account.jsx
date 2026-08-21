import { useState } from "react";
import { Link2, User } from "lucide-react";
import PasswordField from "./PasswordField.jsx";
import { authFetch, updateStoredUser } from "../lib/session.js";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { IconInput } from "@/components/ui/icon-input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

const MIN_NAME_LENGTH = 4;
const MIN_PASSWORD_LENGTH = 6;
// Fotos de perfil fixas: 4 gatinhos em /public/profiles_cats, sem upload.
const AVATAR_COUNT = 4;
const AVATAR_IDS = Array.from({ length: AVATAR_COUNT }, (_, index) => index + 1);

export default function Account({ user, onNavigate, onUserUpdated }) {
  const [avatarId, setAvatarId] = useState(user?.avatarId || 1);
  const [avatarError, setAvatarError] = useState("");
  const [savingAvatar, setSavingAvatar] = useState(false);

  const [name, setName] = useState(user?.name || "");
  const [nameError, setNameError] = useState("");
  const [nameSuccess, setNameSuccess] = useState(false);
  const [savingName, setSavingName] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  async function chooseAvatar(id) {
    if (id === avatarId || savingAvatar) return;

    setAvatarError("");
    setSavingAvatar(true);
    const previous = avatarId;
    setAvatarId(id);

    try {
      const { response, data } = await authFetch("/api/auth/avatar", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarId: id }),
      });

      if (!response.ok || !data?.ok) {
        setAvatarId(previous);
        setAvatarError(data?.message || "Não foi possível salvar o avatar.");
        return;
      }

      updateStoredUser(data.user);
      onUserUpdated(data.user);
    } catch {
      setAvatarId(previous);
      setAvatarError("Falha ao conectar ao servidor.");
    } finally {
      setSavingAvatar(false);
    }
  }

  async function saveName(event) {
    event.preventDefault();
    setNameError("");
    setNameSuccess(false);

    if (name.trim().length < MIN_NAME_LENGTH) {
      setNameError(`O nome precisa ter mais de ${MIN_NAME_LENGTH - 1} caracteres.`);
      return;
    }

    setSavingName(true);
    try {
      const { response, data } = await authFetch("/api/auth/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });

      if (!response.ok || !data?.ok) {
        setNameError(data?.message || "Não foi possível salvar o nome.");
        return;
      }

      updateStoredUser(data.user);
      onUserUpdated(data.user);
      setNameSuccess(true);
    } catch {
      setNameError("Falha ao conectar ao servidor.");
    } finally {
      setSavingName(false);
    }
  }

  async function savePassword(event) {
    event.preventDefault();
    setPasswordError("");
    setPasswordSuccess(false);

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(`A nova senha precisa ter ao menos ${MIN_PASSWORD_LENGTH} caracteres.`);
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError("As senhas não coincidem.");
      return;
    }

    setSavingPassword(true);
    try {
      const { response, data } = await authFetch("/api/auth/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (!response.ok || !data?.ok) {
        setPasswordError(data?.message || "Não foi possível trocar a senha.");
        return;
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordSuccess(true);
    } catch {
      setPasswordError("Falha ao conectar ao servidor.");
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <main className="min-h-screen">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/5 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-18 shrink-0 overflow-hidden rounded-xl">
            <img src="/pixia.png" alt="Pixia" className="h-full w-full object-contain" />
          </div>
          <div className="min-w-0">
            <strong className="block text-sm font-semibold text-foreground">Minha conta</strong>
            <span className="block truncate text-xs text-muted-foreground">{user?.email}</span>
          </div>
        </div>

        <Button variant="secondary" onClick={() => onNavigate("/painel")}>
          <Link2 size={16} />
          Meus links
        </Button>
      </header>

      <div className="grid grid-cols-2 items-start gap-6 p-6 max-lg:grid-cols-1">
        <Card className="col-span-2 gap-4 rounded-2xl border-white/8 bg-card p-6">
          <h2 className="text-base font-semibold text-foreground">Foto de perfil</h2>

          <div className="flex flex-wrap gap-3">
            {AVATAR_IDS.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => chooseAvatar(id)}
                disabled={savingAvatar}
                title={`Gatinho ${id}`}
                className={cn(
                  "size-14 overflow-hidden rounded-full border-2 border-transparent bg-muted p-2 transition-colors hover:border-white/15 disabled:cursor-not-allowed disabled:opacity-60",
                  id === avatarId && "border-primary hover:border-primary"
                )}
              >
                <img src={`/profiles_cats/cat${id}.png`} alt={`Gatinho ${id}`} className="h-full w-full object-contain" />
              </button>
            ))}
          </div>

          {avatarError ? (
            <Alert variant="destructive">
              <AlertDescription>{avatarError}</AlertDescription>
            </Alert>
          ) : null}
        </Card>

        <Card className="rounded-2xl border-white/8 bg-card p-6">
          <form onSubmit={saveName} className="grid gap-4">
            <h2 className="text-base font-semibold text-foreground">Nome de usuário</h2>

            <div className="grid gap-2">
              <Label htmlFor="account-name">Nome</Label>
              <IconInput
                icon={User}
                id="account-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={60}
              />
            </div>

            {nameSuccess ? (
              <Alert className="border-success/25 bg-success/10 text-success">
                <AlertDescription className="text-success/90">Nome atualizado.</AlertDescription>
              </Alert>
            ) : null}
            {nameError ? (
              <Alert variant="destructive">
                <AlertDescription>{nameError}</AlertDescription>
              </Alert>
            ) : null}

            <Button type="submit" className="h-11 w-full rounded-xl text-sm" disabled={savingName}>
              {savingName ? "Salvando..." : "Salvar nome"}
            </Button>
          </form>
        </Card>

        <Card className="rounded-2xl border-white/8 bg-card p-6">
          <form onSubmit={savePassword} className="grid gap-4">
            <h2 className="text-base font-semibold text-foreground">Alterar senha</h2>

            <div className="grid gap-2">
              <Label htmlFor="account-current-password">Senha atual</Label>
              <PasswordField
                id="account-current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="account-new-password">Nova senha</Label>
              <PasswordField
                id="account-new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder={`Mínimo de ${MIN_PASSWORD_LENGTH} caracteres`}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="account-confirm-password">Confirmar nova senha</Label>
              <PasswordField
                id="account-confirm-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </div>

            {passwordSuccess ? (
              <Alert className="border-success/25 bg-success/10 text-success">
                <AlertDescription className="text-success/90">Senha alterada.</AlertDescription>
              </Alert>
            ) : null}
            {passwordError ? (
              <Alert variant="destructive">
                <AlertDescription>{passwordError}</AlertDescription>
              </Alert>
            ) : null}

            <Button type="submit" className="h-11 w-full rounded-xl text-sm" disabled={savingPassword}>
              {savingPassword ? "Salvando..." : "Salvar senha"}
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}
