import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  Copy,
  Globe,
  History,
  Home,
  Lock,
  LogOut,
  Plus,
  Trash2,
  Unlock,
  User,
  Users,
} from "lucide-react";
import PasswordField from "./PasswordField.jsx";
import { authFetch, clearSession } from "../lib/session.js";
import { fetchCreatedRooms, fetchVisitedRooms } from "../lib/roomsApi.js";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const MIN_ROOM_PASSWORD_LENGTH = 6;

function RoomRow({ room, onDelete, onUpdatePassword, onNavigate }) {
  const [editingPassword, setEditingPassword] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const roomUrl = `${window.location.origin}/r/${room.slug}`;

  async function copyLink() {
    await navigator.clipboard.writeText(roomUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  async function savePassword(event) {
    event.preventDefault();
    setError("");

    if (passwordInput && passwordInput.length < MIN_ROOM_PASSWORD_LENGTH) {
      setError(`A senha precisa ter ao menos ${MIN_ROOM_PASSWORD_LENGTH} caracteres.`);
      return;
    }

    setSaving(true);
    try {
      const ok = await onUpdatePassword(room.id, passwordInput);
      if (ok) {
        setEditingPassword(false);
        setPasswordInput("");
      } else {
        setError("Não foi possível salvar a senha.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function removePassword() {
    setSaving(true);
    try {
      await onUpdatePassword(room.id, "");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="gap-3 rounded-2xl border-white/8 bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Badge
          variant="outline"
          className={
            room.isPublic
              ? "gap-1.5 border-success/25 bg-success/10 text-success"
              : "gap-1.5 border-primary/25 bg-primary/10 text-primary"
          }
        >
          {room.isPublic ? <Globe size={13} /> : <Lock size={13} />}
          {room.isPublic ? "Público" : "Privado"}
        </Badge>

        {room.participantCount > 0 ? (
          <Badge variant="outline" className="gap-1.5 border-white/10 text-muted-foreground">
            <Users size={13} />
            {room.participantCount}
          </Badge>
        ) : null}

        <div className="mr-auto min-w-0">
          <strong className="block truncate text-sm font-semibold text-foreground">
            {room.name || "Sala sem nome"}
          </strong>
          <span className="block truncate text-xs text-muted-foreground">/r/{room.slug}</span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onNavigate(`/r/${room.slug}`)}
            title="Entrar na sala"
          >
            <ArrowRight size={15} />
          </Button>

          <Button variant="ghost" size="icon" onClick={copyLink} title="Copiar link">
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </Button>

          {room.isPublic ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setEditingPassword((current) => !current)}
              title="Definir senha (tornar privado)"
            >
              <Lock size={15} />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              onClick={removePassword}
              disabled={saving}
              title="Remover senha (tornar público)"
            >
              <Unlock size={15} />
            </Button>
          )}

          <Button
            variant="ghost"
            size="icon"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setConfirmingDelete(true)}
            title="Excluir link"
          >
            <Trash2 size={15} />
          </Button>
        </div>
      </div>

      {editingPassword ? (
        <form className="flex flex-wrap items-start gap-2 border-t border-white/5 pt-3" onSubmit={savePassword}>
          <div className="min-w-40 flex-1">
            <PasswordField
              value={passwordInput}
              onChange={(event) => setPasswordInput(event.target.value)}
              placeholder="Definir senha para a sala"
              autoFocus
            />
          </div>
          <Button type="submit" className="h-11 rounded-xl" disabled={saving}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
          {error ? <span className="w-full text-xs text-destructive">{error}</span> : null}
        </form>
      ) : null}

      <Dialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir este link?</DialogTitle>
            <DialogDescription>
              A sala "{room.name || "Sala sem nome"}" (/r/{room.slug}) vai parar de existir. Quem
              tiver o link não vai mais conseguir entrar.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmingDelete(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmingDelete(false);
                onDelete(room.id);
              }}
            >
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// Sala de outra pessoa que essa conta já entrou (não tem senha/exclusão
// pra gerenciar aqui, só entrar de novo).
function VisitedRoomRow({ room, onNavigate }) {
  return (
    <Card className="gap-3 rounded-2xl border-white/8 bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Badge
          variant="outline"
          className={
            room.isPublic
              ? "gap-1.5 border-success/25 bg-success/10 text-success"
              : "gap-1.5 border-primary/25 bg-primary/10 text-primary"
          }
        >
          {room.isPublic ? <Globe size={13} /> : <Lock size={13} />}
          {room.isPublic ? "Público" : "Privado"}
        </Badge>

        {room.participantCount > 0 ? (
          <Badge variant="outline" className="gap-1.5 border-white/10 text-muted-foreground">
            <Users size={13} />
            {room.participantCount}
          </Badge>
        ) : null}

        <div className="mr-auto min-w-0">
          <strong className="block truncate text-sm font-semibold text-foreground">
            {room.name || "Sala sem nome"}
          </strong>
          <span className="block truncate text-xs text-muted-foreground">/r/{room.slug}</span>
        </div>

        <Button variant="ghost" size="icon" onClick={() => onNavigate(`/r/${room.slug}`)} title="Entrar na sala">
          <ArrowRight size={15} />
        </Button>
      </div>
    </Card>
  );
}

export default function LinksPanel({ user, onNavigate, onLogout }) {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [visitedRooms, setVisitedRooms] = useState([]);
  const [visitedLoading, setVisitedLoading] = useState(true);

  const [newName, setNewName] = useState("");
  const [makePrivate, setMakePrivate] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  async function loadRooms(options = {}) {
    const { silent = false } = options;
    if (!silent) {
      setLoading(true);
      setLoadError("");
    }
    try {
      const data = await fetchCreatedRooms();
      setRooms(data);
    } catch (error) {
      if (!silent) setLoadError(error.message || "Falha ao conectar ao servidor.");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function loadVisitedRooms(options = {}) {
    const { silent = false } = options;
    if (!silent) setVisitedLoading(true);
    try {
      setVisitedRooms(await fetchVisitedRooms());
    } catch {
      // Silencioso: essa lista é secundária, não acumula outro banner de erro.
    } finally {
      if (!silent) setVisitedLoading(false);
    }
  }

  useEffect(() => {
    loadRooms();
    loadVisitedRooms();

    // Sem socket dedicado pra isso aqui: mantém a contagem de participantes
    // "ao vivo" só buscando as duas listas de novo enquanto o painel está aberto.
    const interval = window.setInterval(() => {
      loadRooms({ silent: true });
      loadVisitedRooms({ silent: true });
    }, 10000);

    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createRoom(event) {
    event.preventDefault();
    setCreateError("");

    if (makePrivate && newPassword.length < MIN_ROOM_PASSWORD_LENGTH) {
      setCreateError(`A senha precisa ter ao menos ${MIN_ROOM_PASSWORD_LENGTH} caracteres.`);
      return;
    }

    setCreating(true);
    try {
      const { response, data } = await authFetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          password: makePrivate ? newPassword : "",
        }),
      });

      if (!response.ok || !data?.ok) {
        setCreateError(data?.message || "Não foi possível criar o link.");
        return;
      }

      setRooms((current) => [data.room, ...current]);
      setNewName("");
      setNewPassword("");
      setMakePrivate(false);
    } catch {
      setCreateError("Falha ao conectar ao servidor.");
    } finally {
      setCreating(false);
    }
  }

  async function deleteRoom(id) {
    const previous = rooms;
    setRooms((current) => current.filter((room) => room.id !== id));

    const { response, data } = await authFetch(`/api/rooms/${id}`, { method: "DELETE" });
    if (!response.ok || !data?.ok) {
      setRooms(previous);
    }
  }

  async function updatePassword(id, password) {
    const { response, data } = await authFetch(`/api/rooms/${id}/password`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (!response.ok || !data?.ok) return false;

    setRooms((current) => current.map((room) => (room.id === id ? data.room : room)));
    return true;
  }

  function logout() {
    clearSession();
    onLogout();
    onNavigate("/");
  }

  return (
    <main className="min-h-screen">
      <header className="border-b border-white/5 px-6 py-4">
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-18 shrink-0 overflow-hidden rounded-xl">
              <img src="/pixia.png" alt="Pixia" className="h-full w-full object-contain" />
            </div>
            <div className="min-w-0">
              <strong className="block text-sm font-semibold text-foreground">Meus links</strong>
              <span className="block truncate text-xs text-muted-foreground">{user?.name}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => onNavigate("/conta")}>
              <User size={16} />
              Minha conta
            </Button>
            <Button variant="secondary" onClick={() => onNavigate("/")}>
              <Home size={16} />
              Ir para entrada
            </Button>
            <Button variant="secondary" onClick={logout}>
              <LogOut size={16} />
              Sair
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-4xl grid-cols-[minmax(0,320px)_1fr] items-start gap-6 p-6 max-lg:grid-cols-1">
        <Card className="rounded-2xl border-white/8 bg-linear-to-b from-card/95 to-card/80 p-6">
          <form onSubmit={createRoom} className="grid gap-4">
            <h2 className="text-base font-semibold text-foreground">Criar novo link</h2>

            <div className="grid gap-2">
              <Label htmlFor="room-name">Nome (opcional)</Label>
              <Input
                id="room-name"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="Sala Sobre Gatinhos"
                maxLength={80}
                className="h-11 rounded-xl bg-input/30"
              />
            </div>

            <label className="flex cursor-pointer items-center gap-2.5 text-sm text-muted-foreground">
              <Checkbox
                checked={makePrivate}
                onCheckedChange={(checked) => setMakePrivate(Boolean(checked))}
              />
              Tornar privado (exigir senha para entrar)
            </label>

            {makePrivate ? (
              <div className="grid gap-2">
                <Label htmlFor="room-password">Senha</Label>
                <PasswordField
                  id="room-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder={`Mínimo de ${MIN_ROOM_PASSWORD_LENGTH} caracteres`}
                />
              </div>
            ) : null}

            {createError ? (
              <Alert variant="destructive">
                <AlertDescription>{createError}</AlertDescription>
              </Alert>
            ) : null}

            <Button type="submit" size="lg" className="h-11 w-full rounded-xl text-sm" disabled={creating}>
              <Plus size={17} />
              {creating ? "Criando..." : "Criar link"}
            </Button>
          </form>
        </Card>

        <div className="grid gap-3">
          {loading ? <p className="text-sm text-muted-foreground">Carregando...</p> : null}
          {loadError ? (
            <Alert variant="destructive">
              <AlertDescription>{loadError}</AlertDescription>
            </Alert>
          ) : null}

          {!loading && !loadError && rooms.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Você ainda não criou nenhum link. Crie o primeiro ao lado.
            </p>
          ) : null}

          {rooms.map((room) => (
            <RoomRow
              key={room.id}
              room={room}
              onDelete={deleteRoom}
              onUpdatePassword={updatePassword}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      </div>

      {visitedRooms.length > 0 || visitedLoading ? (
        <div className="mx-auto grid w-full max-w-4xl gap-3 px-6 pb-6">
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <History size={17} />
            Salas acessadas de outros usuários
          </h2>

          {visitedLoading ? <p className="text-sm text-muted-foreground">Carregando...</p> : null}

          {visitedRooms.map((room) => (
            <VisitedRoomRow key={room.id} room={room} onNavigate={onNavigate} />
          ))}
        </div>
      ) : null}
    </main>
  );
}
