import { useEffect, useState } from "react";
import { Check, Copy, Globe, Lock, LogOut, Plus, Trash2, Unlock } from "lucide-react";
import PasswordField from "./PasswordField.jsx";
import { authFetch, clearSession } from "../lib/session.js";

const MIN_ROOM_PASSWORD_LENGTH = 6;

function RoomRow({ room, onDelete, onUpdatePassword }) {
  const [editingPassword, setEditingPassword] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

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
    <div className="room-card">
      <div className="room-card-main">
        <div className={`room-badge ${room.isPublic ? "public" : "private"}`}>
          {room.isPublic ? <Globe size={13} /> : <Lock size={13} />}
          {room.isPublic ? "Público" : "Privado"}
        </div>

        <div className="room-card-copy">
          <strong>{room.name || "Sala sem nome"}</strong>
          <span>/r/{room.slug}</span>
        </div>

        <div className="room-card-actions">
          <button className="ghost-button compact" onClick={copyLink} title="Copiar link">
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>

          {room.isPublic ? (
            <button
              className="ghost-button compact"
              onClick={() => setEditingPassword((current) => !current)}
              title="Definir senha (tornar privado)"
            >
              <Lock size={15} />
            </button>
          ) : (
            <button
              className="ghost-button compact"
              onClick={removePassword}
              disabled={saving}
              title="Remover senha (tornar público)"
            >
              <Unlock size={15} />
            </button>
          )}

          <button
            className="ghost-button compact danger"
            onClick={() => onDelete(room.id)}
            title="Excluir link"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {editingPassword ? (
        <form className="room-password-form" onSubmit={savePassword}>
          <PasswordField
            value={passwordInput}
            onChange={(event) => setPasswordInput(event.target.value)}
            placeholder="Definir senha para a sala"
            autoFocus
          />
          <button className="primary-button compact" type="submit" disabled={saving}>
            {saving ? "Salvando..." : "Salvar"}
          </button>
          {error ? <span className="field-error">{error}</span> : null}
        </form>
      ) : null}
    </div>
  );
}

export default function LinksPanel({ user, onNavigate, onLogout }) {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [newName, setNewName] = useState("");
  const [makePrivate, setMakePrivate] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  async function loadRooms() {
    setLoading(true);
    setLoadError("");
    try {
      const { response, data } = await authFetch("/api/rooms");
      if (!response.ok || !data?.ok) {
        setLoadError(data?.message || "Não foi possível carregar seus links.");
        return;
      }
      setRooms(data.rooms);
    } catch {
      setLoadError("Falha ao conectar ao servidor.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRooms();
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
    <main className="panel-page">
      <header className="panel-header">
        <div className="brand-area">
          <div className="brand-mark small">
            <img src="/pixia.png" alt="Pixia" />
          </div>
          <div>
            <strong>Meus links</strong>
            <span>{user?.name}</span>
          </div>
        </div>

        <div className="topbar-actions">
          <button className="ghost-button" onClick={() => onNavigate("/conta")}>
            Minha conta
          </button>
          <button className="ghost-button" onClick={() => onNavigate("/")}>
            Ir para entrada
          </button>
          <button className="ghost-button" onClick={logout}>
            <LogOut size={16} />
            Sair
          </button>
        </div>
      </header>

      <div className="panel-body">
        <form className="create-room-card" onSubmit={createRoom}>
          <h2>Criar novo link</h2>

          <div className="field">
            <label htmlFor="room-name">Nome (opcional)</label>
            <input
              id="room-name"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Sala Sobre Gatinhos"
              maxLength={80}
            />
          </div>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={makePrivate}
              onChange={(event) => setMakePrivate(event.target.checked)}
            />
            Tornar privado (exigir senha para entrar)
          </label>

          {makePrivate ? (
            <div className="field">
              <label htmlFor="room-password">Senha</label>
              <PasswordField
                id="room-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder={`Mínimo de ${MIN_ROOM_PASSWORD_LENGTH} caracteres`}
              />
            </div>
          ) : null}

          {createError ? <div className="error-banner inline">{createError}</div> : null}

          <button className="primary-button" type="submit" disabled={creating}>
            <Plus size={17} />
            {creating ? "Criando..." : "Criar link"}
          </button>
        </form>

        <div className="room-list">
          {loading ? <p className="muted">Carregando...</p> : null}
          {loadError ? <div className="error-banner inline">{loadError}</div> : null}

          {!loading && !loadError && rooms.length === 0 ? (
            <p className="muted">Você ainda não criou nenhum link. Crie o primeiro ao lado.</p>
          ) : null}

          {rooms.map((room) => (
            <RoomRow
              key={room.id}
              room={room}
              onDelete={deleteRoom}
              onUpdatePassword={updatePassword}
            />
          ))}
        </div>
      </div>
    </main>
  );
}
