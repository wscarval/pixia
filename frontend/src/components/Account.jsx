import { useRef, useState } from "react";
import { ArrowLeft, Check, Link2, Loader2, Trash2, Upload, User, X } from "lucide-react";
import PasswordField from "./PasswordField.jsx";
import AvatarCropDialog from "./AvatarCropDialog.jsx";
import { authFetch, updateStoredUser } from "../lib/session.js";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { IconInput } from "@/components/ui/icon-input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

const MIN_NAME_LENGTH = 4;
const MIN_PASSWORD_LENGTH = 6;
// Fotos de perfil fixas: 4 gatinhos em /public/profiles_cats. Quem tem
// conta também pode enviar a própria foto (ver PHOTO_* abaixo) — só conta
// criada tem onde guardar isso, visitante anônimo fica só com os gatinhos.
const AVATAR_COUNT = 4;
const AVATAR_IDS = Array.from({ length: AVATAR_COUNT }, (_, index) => index + 1);
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PHOTO_MIME_ALLOWLIST = ["image/jpeg", "image/png", "image/webp"];

export default function Account({ user, onNavigate, onUserUpdated, pinnedRoom, onReturnToRoom }) {
  // Estado confirmado no servidor.
  const [savedAvatarId, setSavedAvatarId] = useState(user?.avatarId || 1);
  const [savedAvatarUrl, setSavedAvatarUrl] = useState(user?.avatarUrl || null);

  // Escolha ainda não salva: só vira de verdade quando clica em "Salvar
  // foto" — selecionar um gatinho ou recortar uma foto nova não manda nada
  // pro servidor sozinho.
  const [pendingAvatarId, setPendingAvatarId] = useState(null);
  const [pendingPhotoBlob, setPendingPhotoBlob] = useState(null);
  const [pendingPhotoPreview, setPendingPhotoPreview] = useState(null);

  const [avatarError, setAvatarError] = useState("");
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [removingPhoto, setRemovingPhoto] = useState(false);
  // URL local do arquivo escolhido enquanto o editor de recorte está
  // aberto. null = editor fechado.
  const [cropImageSrc, setCropImageSrc] = useState(null);
  const fileInputRef = useRef(null);

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

  const hasPendingChange = pendingAvatarId !== null || pendingPhotoBlob !== null;
  // Se tem uma foto pendente, ela manda. Se escolheu um gatinho pendente,
  // isso desmarca a foto salva na prévia (mesmo sem ter salvo ainda). Sem
  // nada pendente, vale o que já está salvo.
  const photoActive = pendingPhotoPreview
    ? true
    : pendingAvatarId !== null
      ? false
      : Boolean(savedAvatarUrl);
  const displayPhotoSrc = pendingPhotoPreview || savedAvatarUrl;
  const effectiveAvatarId = pendingAvatarId ?? savedAvatarId;

  function discardPendingChange() {
    if (pendingPhotoPreview) URL.revokeObjectURL(pendingPhotoPreview);
    setPendingAvatarId(null);
    setPendingPhotoBlob(null);
    setPendingPhotoPreview(null);
  }

  function chooseAvatar(id) {
    if (id === effectiveAvatarId && !photoActive) return;

    setAvatarError("");
    if (pendingPhotoPreview) URL.revokeObjectURL(pendingPhotoPreview);
    setPendingAvatarId(id);
    setPendingPhotoBlob(null);
    setPendingPhotoPreview(null);
  }

  function handleFileSelected(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setAvatarError("");

    if (!PHOTO_MIME_ALLOWLIST.includes(file.type)) {
      setAvatarError("Envie uma imagem em JPEG, PNG ou WebP.");
      return;
    }

    if (file.size > PHOTO_MAX_BYTES) {
      setAvatarError("A imagem precisa ter até 5MB.");
      return;
    }

    // Abre o editor de recorte primeiro — a foto só vira "pendente" (e
    // ainda assim, só enviada de verdade ao clicar em "Salvar foto") depois
    // de confirmar o recorte.
    setCropImageSrc(URL.createObjectURL(file));
  }

  function cancelCrop() {
    if (cropImageSrc) URL.revokeObjectURL(cropImageSrc);
    setCropImageSrc(null);
  }

  function confirmCrop(blob) {
    if (cropImageSrc) URL.revokeObjectURL(cropImageSrc);
    setCropImageSrc(null);

    if (pendingPhotoPreview) URL.revokeObjectURL(pendingPhotoPreview);
    setPendingAvatarId(null);
    setPendingPhotoBlob(blob);
    setPendingPhotoPreview(URL.createObjectURL(blob));
  }

  async function saveAvatarChange() {
    if (!hasPendingChange || savingAvatar) return;

    setAvatarError("");
    setSavingAvatar(true);

    try {
      let response;
      let data;

      if (pendingPhotoBlob) {
        const formData = new FormData();
        formData.append("photo", pendingPhotoBlob, "avatar.png");
        ({ response, data } = await authFetch("/api/auth/avatar-photo", {
          method: "PUT",
          body: formData,
        }));
      } else {
        ({ response, data } = await authFetch("/api/auth/avatar", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ avatarId: pendingAvatarId }),
        }));
      }

      if (!response.ok || !data?.ok) {
        setAvatarError(data?.message || "Não foi possível salvar a foto.");
        return;
      }

      setSavedAvatarId(data.user.avatarId);
      setSavedAvatarUrl(data.user.avatarUrl);
      updateStoredUser(data.user);
      onUserUpdated(data.user);
      discardPendingChange();
    } catch {
      setAvatarError("Falha ao conectar ao servidor.");
    } finally {
      setSavingAvatar(false);
    }
  }

  async function removePhoto() {
    if (!savedAvatarUrl || removingPhoto) return;

    setAvatarError("");
    setRemovingPhoto(true);

    try {
      const { response, data } = await authFetch("/api/auth/avatar-photo", { method: "DELETE" });

      if (!response.ok || !data?.ok) {
        setAvatarError(data?.message || "Não foi possível remover a foto.");
        return;
      }

      setSavedAvatarId(data.user.avatarId);
      setSavedAvatarUrl(null);
      updateStoredUser(data.user);
      onUserUpdated(data.user);
    } catch {
      setAvatarError("Falha ao conectar ao servidor.");
    } finally {
      setRemovingPhoto(false);
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
      {pinnedRoom ? (
        <div className="border-b border-success/20 bg-success/10 px-6 py-2.5 text-sm text-success">
          <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <span className="size-2 shrink-0 rounded-full bg-success" />
              Conectado em {pinnedRoom.displayName || `/r/${pinnedRoom.roomId}`}
            </span>
            <Button type="button" variant="secondary" size="sm" onClick={onReturnToRoom}>
              <ArrowLeft size={14} />
              Voltar à sala
            </Button>
          </div>
        </div>
      ) : null}

      <header className="border-b border-white/5 px-6 py-4">
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-4">
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
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-4xl grid-cols-2 items-start gap-6 p-6 max-lg:grid-cols-1">
        <Card className="col-span-2 gap-4 rounded-2xl border-white/8 bg-card p-6">
          <h2 className="text-base font-semibold text-foreground">Foto de perfil</h2>

          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileSelected}
              className="hidden"
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Enviar sua própria foto"
              className={cn(
                "relative size-14 shrink-0 overflow-hidden rounded-full border-2 border-transparent bg-muted transition-colors hover:border-white/15",
                photoActive && "border-primary hover:border-primary"
              )}
            >
              {photoActive && displayPhotoSrc ? (
                <img src={displayPhotoSrc} alt="Sua foto" className="h-full w-full object-cover" />
              ) : (
                <span className="grid h-full w-full place-items-center text-muted-foreground">
                  <Upload size={18} />
                </span>
              )}
            </button>

            <div className="h-9 w-px shrink-0 bg-white/10" />

            {AVATAR_IDS.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => chooseAvatar(id)}
                title={`Gatinho ${id}`}
                className={cn(
                  "size-14 shrink-0 overflow-hidden rounded-full border-2 border-transparent bg-muted p-2 transition-colors hover:border-white/15",
                  id === effectiveAvatarId && !photoActive && "border-primary hover:border-primary"
                )}
              >
                <img src={`/profiles_cats/cat${id}.png`} alt={`Gatinho ${id}`} className="h-full w-full object-contain" />
              </button>
            ))}

            {hasPendingChange ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  className="rounded-lg"
                  onClick={saveAvatarChange}
                  disabled={savingAvatar}
                >
                  {savingAvatar ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Check size={14} />
                  )}
                  {savingAvatar ? "Salvando..." : "Salvar foto"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={discardPendingChange}
                  disabled={savingAvatar}
                >
                  <X size={14} />
                  Cancelar
                </Button>
              </>
            ) : savedAvatarUrl ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive"
                onClick={removePhoto}
                disabled={removingPhoto}
              >
                <Trash2 size={14} />
                Remover foto
              </Button>
            ) : null}
          </div>

          <p className="text-xs text-muted-foreground">JPEG, PNG ou WebP, até 5MB.</p>

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

      <AvatarCropDialog
        imageSrc={cropImageSrc}
        saving={false}
        onCancel={cancelCrop}
        onConfirm={confirmCrop}
      />
    </main>
  );
}
