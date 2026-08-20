import { useState } from "react";
import { User } from "lucide-react";
import PasswordField from "./PasswordField.jsx";
import { authFetch, updateStoredUser } from "../lib/session.js";

const MIN_NAME_LENGTH = 4;
const MIN_PASSWORD_LENGTH = 6;

export default function Account({ user, onNavigate, onUserUpdated }) {
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
    <main className="panel-page">
      <header className="panel-header">
        <div className="brand-area">
          <div className="brand-mark small">
            <img src="/pixia.png" alt="Pixia" />
          </div>
          <div>
            <strong>Minha conta</strong>
            <span>{user?.email}</span>
          </div>
        </div>

        <div className="topbar-actions">
          <button className="ghost-button" onClick={() => onNavigate("/painel")}>
            Meus links
          </button>
        </div>
      </header>

      <div className="account-grid">
        <form className="create-room-card" onSubmit={saveName} noValidate>
          <h2>Nome de usuário</h2>

          <div className="field">
            <label htmlFor="account-name">Nome</label>
            <div className="input-group">
              <User size={16} />
              <input
                id="account-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={60}
              />
            </div>
          </div>

          {nameSuccess ? <div className="success-banner">Nome atualizado.</div> : null}
          {nameError ? <div className="error-banner inline">{nameError}</div> : null}

          <button className="primary-button" type="submit" disabled={savingName}>
            {savingName ? "Salvando..." : "Salvar nome"}
          </button>
        </form>

        <form className="create-room-card" onSubmit={savePassword} noValidate>
          <h2>Alterar senha</h2>

          <div className="field">
            <label htmlFor="account-current-password">Senha atual</label>
            <PasswordField
              id="account-current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="account-new-password">Nova senha</label>
            <PasswordField
              id="account-new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder={`Mínimo de ${MIN_PASSWORD_LENGTH} caracteres`}
            />
          </div>

          <div className="field">
            <label htmlFor="account-confirm-password">Confirmar nova senha</label>
            <PasswordField
              id="account-confirm-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </div>

          {passwordSuccess ? <div className="success-banner">Senha alterada.</div> : null}
          {passwordError ? <div className="error-banner inline">{passwordError}</div> : null}

          <button className="primary-button" type="submit" disabled={savingPassword}>
            {savingPassword ? "Salvando..." : "Salvar senha"}
          </button>
        </form>
      </div>
    </main>
  );
}
