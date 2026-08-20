import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Copy,
  Globe,
  Link2,
  Lock,
  LogOut,
  Maximize,
  Mic,
  MicOff,
  Minimize,
  MonitorOff,
  MonitorUp,
  Send,
  User,
  Users,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
} from "lucide-react";
import useRoomWebRTC, { ELECTRON_APP_PREFIX } from "./hooks/useRoomWebRTC.js";
import { RemoteAudio, StreamVideo } from "./components/MediaElements.jsx";
import SignUp from "./components/SignUp.jsx";
import Login from "./components/Login.jsx";
import LinksPanel from "./components/LinksPanel.jsx";
import Account from "./components/Account.jsx";
import AuthLayout from "./components/AuthLayout.jsx";
import TermsOfUse from "./components/TermsOfUse.jsx";
import PrivacyPolicy from "./components/PrivacyPolicy.jsx";
import DownloadApp from "./components/DownloadApp.jsx";
import PasswordField from "./components/PasswordField.jsx";
import {
  authFetch,
  clearRoomSession,
  clearSession,
  getRoomSession,
  getStoredUser,
  getToken,
  saveRoomSession,
} from "./lib/session.js";
import { getStoredParticipantVolume, setStoredParticipantVolume } from "./lib/preferences.js";
import { isElectronDesktop } from "./lib/electronAppAudio.js";
import { randomGuestName } from "./lib/catNames.js";

const AVATAR_PALETTE = [
  ["#8b5cf6", "#6d28d9"],
  ["#22d3ee", "#0e7490"],
  ["#f472b6", "#be185d"],
  ["#34d399", "#047857"],
  ["#fbbf24", "#b45309"],
  ["#60a5fa", "#1d4ed8"],
];

const isFirefox = typeof navigator !== "undefined" && /firefox/i.test(navigator.userAgent);
const MIN_ROOM_PASSWORD_LENGTH = 6;
// Fotos de perfil fixas: 4 gatinhos em /public/profiles_cats (sem upload).
// Quem tem conta escolhe o seu; visitantes sem conta recebem um sorteado
// (ver Room, abaixo).
const AVATAR_COUNT = 4;

function catAvatarUrl(avatarId) {
  const id = Number.isInteger(avatarId) && avatarId >= 1 && avatarId <= AVATAR_COUNT ? avatarId : 1;
  return `/profiles_cats/cat${id}.png`;
}

function hashToAvatarId(seed) {
  let hash = 0;
  const text = String(seed || "");
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }

  return (hash % AVATAR_COUNT) + 1;
}

function avatarGradient(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }

  const [from, to] = AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
  return `linear-gradient(145deg, ${from}, ${to})`;
}

// As salas são sempre criadas pelo servidor (POST /api/rooms) — não geramos
// mais um id aleatório no cliente. Isso só extrai o slug de /r/<slug>; se a
// URL não bater com esse formato, roomId fica null e a tela de escolha
// (Landing) é exibida.
function getRoomIdFromPath(pathname) {
  const match = pathname.match(/^\/r\/([a-zA-Z0-9_-]{1,100})\/?$/);
  return match?.[1] || null;
}

// Aceita tanto um link completo colado (com domínio) quanto só o caminho
// /r/<slug> ou o slug cru, pra o campo "Colar link" da tela inicial.
function extractRoomSlug(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;

  let path = trimmed;
  try {
    path = new URL(trimmed).pathname;
  } catch {
    // Não é uma URL absoluta: tenta como caminho ou slug cru mesmo.
  }

  const pathMatch = path.match(/\/r\/([a-zA-Z0-9_-]{1,100})/);
  if (pathMatch) return pathMatch[1];

  return /^[a-zA-Z0-9_-]{1,100}$/.test(trimmed) ? trimmed : null;
}

function Landing({ onNavigate, currentUser }) {
  const [creatingPublic, setCreatingPublic] = useState(false);
  const [showPrivateForm, setShowPrivateForm] = useState(false);
  const [privatePassword, setPrivatePassword] = useState("");
  const [creatingPrivate, setCreatingPrivate] = useState(false);
  const [pastedLink, setPastedLink] = useState("");
  const [pasteError, setPasteError] = useState("");
  const [error, setError] = useState("");

  async function createRoom(password) {
    // Sala particular exige login (backend rejeita senha sem token) — usa
    // authFetch pra mandar o Bearer quando o usuário estiver logado.
    const { response, data } = await authFetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: password || "" }),
    });

    if (!response.ok || !data?.ok) {
      throw new Error(data?.message || "Não foi possível criar a sala.");
    }

    return data.room;
  }

  async function handlePublic() {
    setError("");
    setCreatingPublic(true);
    try {
      const room = await createRoom();
      onNavigate(`/r/${room.slug}`);
    } catch (createError) {
      setError(createError.message);
    } finally {
      setCreatingPublic(false);
    }
  }

  async function handlePrivateSubmit(event) {
    event.preventDefault();
    setError("");

    if (privatePassword.length < MIN_ROOM_PASSWORD_LENGTH) {
      setError(`A senha precisa ter ao menos ${MIN_ROOM_PASSWORD_LENGTH} caracteres.`);
      return;
    }

    setCreatingPrivate(true);
    try {
      const room = await createRoom(privatePassword);
      onNavigate(`/r/${room.slug}`);
    } catch (createError) {
      setError(createError.message);
    } finally {
      setCreatingPrivate(false);
    }
  }

  function handlePasteSubmit(event) {
    event.preventDefault();
    setPasteError("");

    const slug = extractRoomSlug(pastedLink);
    if (!slug) {
      setPasteError("Não reconheci esse link. Cole o link completo da sala.");
      return;
    }

    onNavigate(`/r/${slug}`);
  }

  return (
    <AuthLayout>
      <div className="join-card">
        <div className="brand-mark">
          <img src="/pixia.png" alt="Pixia" />
        </div>
        <h1>Começar uma sala</h1>
        <p className="muted">Escolha como quer criar a sua.</p>

        {error ? <div className="error-banner inline">{error}</div> : null}

        <button
          className="primary-button"
          type="button"
          onClick={handlePublic}
          disabled={creatingPublic}
        >
          {creatingPublic ? "Gerando..." : "Gerar sala pública aleatória"}
        </button>

        {!currentUser ? (
          <p className="muted small">Salas particulares exigem conta.</p>
        ) : showPrivateForm ? (
          <form className="field" onSubmit={handlePrivateSubmit}>
            <label htmlFor="landing-private-password">Senha da sala particular</label>
            <PasswordField
              id="landing-private-password"
              value={privatePassword}
              onChange={(event) => setPrivatePassword(event.target.value)}
              placeholder={`Mínimo de ${MIN_ROOM_PASSWORD_LENGTH} caracteres`}
              autoFocus
            />
            <button className="primary-button" type="submit" disabled={creatingPrivate}>
              {creatingPrivate ? "Criando..." : "Criar sala particular"}
            </button>
          </form>
        ) : (
          <button
            className="link-button"
            type="button"
            onClick={() => setShowPrivateForm(true)}
          >
            Criar sala particular
          </button>
        )}

        <div className="landing-divider">
          <span>ou</span>
        </div>

        <form className="field" onSubmit={handlePasteSubmit}>
          <label htmlFor="paste-link">Já tem um link?</label>
          <div className="input-group">
            <Link2 size={16} />
            <input
              id="paste-link"
              value={pastedLink}
              onChange={(event) => setPastedLink(event.target.value)}
              placeholder="Cole o link da sala aqui"
              maxLength={300}
            />
          </div>
          {pasteError ? <span className="field-error">{pasteError}</span> : null}
          <button className="primary-button" type="submit" disabled={!pastedLink.trim()}>
            Entrar no link
          </button>
        </form>

        {!currentUser ? (
          <p className="auth-switch">
            Já tem conta?{" "}
            <button type="button" onClick={() => onNavigate("/entrar")}>
              Entrar
            </button>
            {" · "}
            <button type="button" onClick={() => onNavigate("/cadastro")}>
              Criar conta
            </button>
          </p>
        ) : (
          <p className="auth-switch">
            <button type="button" onClick={() => onNavigate("/painel")}>
              Meus links
            </button>
          </p>
        )}

        {!isElectronDesktop() ? (
          <button type="button" className="link-button" onClick={() => onNavigate("/download")}>
            Baixar app desktop (Windows)
          </button>
        ) : null}

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
      </div>
    </AuthLayout>
  );
}

function JoinRoom({ roomId, onJoin, onNavigate, currentUser }) {
  // Nome custom é privilégio de quem tem conta (e só muda em /conta). Quem
  // não está logado entra com um nome de visitante sorteado, sem campo pra
  // digitar nada — sorteado uma vez só, não muda a cada re-render.
  const guestName = useMemo(() => randomGuestName(), []);
  const displayName = currentUser?.name || guestName;

  const [password, setPassword] = useState("");
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [roomNotFound, setRoomNotFound] = useState(false);
  const [roomLabel, setRoomLabel] = useState("");
  const [checkingRoom, setCheckingRoom] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    setCheckingRoom(true);
    setRoomNotFound(false);

    fetch(`/api/rooms/${roomId}/info`)
      .then((response) => response.json())
      .then((data) => {
        if (!active) return;
        setRoomNotFound(!data?.exists);
        setRequiresPassword(Boolean(data?.requiresPassword));
        setRoomLabel(data?.name || "");
      })
      .catch(() => {})
      .finally(() => {
        if (active) setCheckingRoom(false);
      });

    return () => {
      active = false;
    };
  }, [roomId]);

  if (!checkingRoom && roomNotFound) {
    return (
      <AuthLayout>
        <div className="join-card">
          <div className="brand-mark">
            <img src="/pixia.png" alt="Pixia" />
          </div>
          <h1>Sala não encontrada</h1>
          <p className="muted">
            Este link não existe ou a sala já foi encerrada. Salas são sempre criadas pelo Pixia,
            não é possível entrar num endereço digitado à mão.
          </p>
          <button className="primary-button" type="button" onClick={() => onNavigate("/")}>
            Criar uma sala nova
          </button>
        </div>
      </AuthLayout>
    );
  }

  async function submit(event) {
    event.preventDefault();
    setError("");

    if (!requiresPassword) {
      onJoin(displayName);
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`/api/rooms/${roomId}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.ok) {
        setError(data?.message || "Senha incorreta.");
        return;
      }

      onJoin(displayName, data.roomToken);
    } catch {
      setError("Falha ao conectar ao servidor.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      <form className="join-card" onSubmit={submit}>
        <div className="brand-mark">
          <img src="/pixia.png" alt="Pixia" />
        </div>
        <h1>Entrar na conversa</h1>
        <p className="muted">
          {currentUser
            ? "Confirme sua entrada nesta sala."
            : "Você entra com um nome de visitante sorteado."}
        </p>

        <div className="room-preview">
          <span>{roomLabel || "Sala"}</span>
          <strong>/r/{roomId}</strong>
        </div>

        {!checkingRoom ? (
          <div className={`room-visibility ${requiresPassword ? "private" : "public"}`}>
            {requiresPassword ? <Lock size={12} /> : <Globe size={12} />}
            {requiresPassword ? "Sala privada" : "Sala pública"}
          </div>
        ) : null}

        <div className="field">
          <label htmlFor="display-name">Seu nome</label>
          <div className="input-group">
            <User size={16} />
            <div id="display-name" className="static-value">
              {displayName}
            </div>
          </div>
          {currentUser ? (
            <span className="hint-text">
              É o nome da sua conta. Pra mudar, acesse{" "}
              <button type="button" className="link-button inline" onClick={() => onNavigate("/conta")}>
                Minha conta
              </button>
              .
            </span>
          ) : (
            <span className="hint-text">
              Nome de visitante sorteado. Crie uma conta pra escolher o seu.
            </span>
          )}
        </div>

        {requiresPassword ? (
          <div className="field">
            <label htmlFor="room-password">Senha da sala</label>
            <PasswordField
              id="room-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Esta sala é privada"
              autoFocus
            />
          </div>
        ) : null}

        {error ? <span className="field-error">{error}</span> : null}

        <button className="primary-button" type="submit" disabled={checkingRoom || submitting}>
          {submitting ? "Entrando..." : "Entrar na sala"}
        </button>

        <p className="auth-switch">
          {currentUser ? (
            <button type="button" onClick={() => onNavigate("/painel")}>
              Ver meus links
            </button>
          ) : (
            <>
              Ainda não tem conta?{" "}
              <button type="button" onClick={() => onNavigate("/cadastro")}>
                Criar conta
              </button>
            </>
          )}
        </p>
      </form>
    </AuthLayout>
  );
}

function Room({ roomId, name, roomToken, currentUser, onLeave, onNeedsPassword }) {
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [participantVolumes, setParticipantVolumes] = useState({});
  const [roomInfo, setRoomInfo] = useState(null);
  const [focusedShareId, setFocusedShareId] = useState(null);
  const stageRef = useRef(null);

  // Quem tem conta usa o avatar escolhido; visitante sem conta ganha um
  // sorteado uma vez por sessão (não persiste, não tem conta pra guardar).
  const randomAvatarId = useMemo(() => Math.floor(Math.random() * AVATAR_COUNT) + 1, []);
  const myAvatarId = currentUser?.avatarId ?? randomAvatarId;

  useEffect(() => {
    let active = true;

    fetch(`/api/rooms/${roomId}/info`)
      .then((response) => response.json())
      .then((data) => {
        if (active) setRoomInfo(data);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [roomId]);

  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  // "Tela cheia" fullscreena o palco (o vídeo compartilhado), não o app
  // inteiro, já que só faz sentido quando tem uma transmissão rolando.
  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      stageRef.current?.requestFullscreen().catch(() => {});
    }
  }

  function setParticipantVolume(participantName, participantId, volume) {
    setParticipantVolumes((current) => ({ ...current, [participantId]: volume }));
    setStoredParticipantVolume(participantName, volume);
  }

  function toggleParticipantMute(participantName, participantId) {
    setParticipantVolumes((current) => {
      const previous = current[participantId] ?? getStoredParticipantVolume(participantName) ?? 1;
      const next = previous > 0 ? 0 : 1;
      setStoredParticipantVolume(participantName, next);
      return { ...current, [participantId]: next };
    });
  }

  const {
    connected,
    pingMs,
    participants,
    remoteMedia,
    micEnabled,
    screenSharing,
    localScreenStream,
    messages,
    error,
    requiresPassword,
    audioInputDevices,
    appAudioSources,
    selectedAudioInputId,
    changeAudioInput,
    toggleMicrophone,
    screenQuality,
    changeScreenQuality,
    toggleScreenShare,
    sendMessage,
  } = useRoomWebRTC({ roomId, name, roomToken, avatarId: myAvatarId });

  // O roomToken guardado (ou o cadastro pra reentrada automática após um F5)
  // não vale mais para uma sala particular: volta pra tela de senha.
  useEffect(() => {
    if (requiresPassword) onNeedsPassword();
  }, [requiresPassword, onNeedsPassword]);

  const allParticipants = useMemo(
    () => [
      {
        id: "self",
        name,
        avatarId: myAvatarId,
        micEnabled,
        screenSharing,
      },
      ...participants,
    ],
    [micEnabled, myAvatarId, name, participants, screenSharing]
  );

  const participantNameById = useMemo(
    () => Object.fromEntries(participants.map((participant) => [participant.id, participant.name])),
    [participants]
  );

  const remoteSharers = participants.filter(
    (participant) => participant.screenSharing && remoteMedia[participant.id]?.screenStream
  );

  const activeShares = [
    ...(localScreenStream
      ? [
          {
            id: "local",
            name: "Você",
            stream: localScreenStream,
            local: true,
          },
        ]
      : []),
    ...remoteSharers.map((participant) => ({
      id: participant.id,
      name: participant.name,
      stream: remoteMedia[participant.id].screenStream,
      local: false,
    })),
  ];

  // Com mais de uma tela sendo compartilhada, mostra só uma por vez em
  // destaque (em vez de espremer todas numa grade) e deixa escolher qual.
  // Se a escolhida sumir (a pessoa parou de compartilhar) ou nunca foi
  // escolhida, cai pra primeira disponível sozinho.
  const focusedShare =
    activeShares.find((share) => share.id === focusedShareId) ?? activeShares[0] ?? null;

  // Se a transmissão acaba enquanto está em tela cheia, sai sozinho: o botão
  // só existe enquanto tem algo sendo compartilhado.
  useEffect(() => {
    if (activeShares.length === 0 && document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  }, [activeShares.length]);

  const connectionHealth = !connected
    ? { label: "Sem conexão", tone: "bad" }
    : pingMs === null
      ? { label: "Medindo...", tone: "unknown" }
      : pingMs < 120
        ? { label: "Boa conexão", tone: "good" }
        : pingMs < 300
          ? { label: "Conexão instável", tone: "ok" }
          : { label: "Conexão ruim", tone: "bad" };

  async function copyRoom() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  function handleSend() {
    const clean = message.trim();
    if (!clean) return;

    sendMessage(clean);
    setMessage("");
  }

  function handleMessageKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  return (
    <main className="app-shell">
      {Object.entries(remoteMedia).map(([peerId, media]) =>
        media.audioStream ? (
          <RemoteAudio
            key={peerId}
            stream={media.audioStream}
            volume={
              participantVolumes[peerId] ??
              getStoredParticipantVolume(participantNameById[peerId]) ??
              1
            }
          />
        ) : null
      )}

      <header className="topbar">
        <div className="brand-area">
          <div className="brand-mark small">
            <img src="/pixia.png" alt="Pixia" />
          </div>
          <div>
            <strong>
              {roomInfo ? (roomInfo.requiresPassword ? "Sala privada" : "Sala pública") : "Sala"}
            </strong>
            <span>/r/{roomId}</span>
          </div>
          <div className="connection-status">
            <div className={connected ? "connection online" : "connection offline"}>
              {connected ? <Wifi size={15} /> : <WifiOff size={15} />}
              {connected ? "Conectado" : "Reconectando"}
            </div>
            <div className={`connection-health tone-${connectionHealth.tone}`}>
              <span className="health-dot" />
              {pingMs !== null ? `${pingMs}ms · ` : ""}
              {connectionHealth.label}
            </div>
          </div>
        </div>

        <div className="topbar-actions">
          {activeShares.length > 0 ? (
            <button
              className="ghost-button"
              onClick={toggleFullscreen}
              title={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
            >
              {isFullscreen ? <Minimize size={17} /> : <Maximize size={17} />}
              {isFullscreen ? "Sair" : "Tela cheia"}
            </button>
          ) : null}

          <button className="ghost-button" onClick={copyRoom}>
            {copied ? <Check size={17} /> : <Copy size={17} />}
            {copied ? "Copiado" : "Copiar link"}
          </button>
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="workspace">
        <aside className="participants-panel">
          <div className="panel-title">
            <Users size={16} />
            <span>Participantes</span>
            <b>{allParticipants.length}</b>
          </div>

          <div className="participant-list">
            {allParticipants.map((participant) => {
              const isSelf = participant.id === "self";
              const volume =
                participantVolumes[participant.id] ??
                getStoredParticipantVolume(participant.name) ??
                1;

              return (
                <div className="participant" key={participant.id}>
                  <div className="participant-row">
                    <div className="avatar" style={{ background: avatarGradient(participant.id) }}>
                      <img
                        className="avatar-img"
                        src={catAvatarUrl(participant.avatarId ?? hashToAvatarId(participant.id))}
                        alt=""
                      />
                    </div>
                    <div className="participant-copy">
                      <strong>{participant.name}</strong>
                      <span>
                        {isSelf ? "Você · " : ""}
                        {participant.micEnabled ? "Microfone ativo" : "Microfone desligado"}
                      </span>
                    </div>
                    <div className="participant-icons">
                      {participant.screenSharing ? <MonitorUp size={15} /> : null}
                      {participant.micEnabled ? <Mic size={15} /> : <MicOff size={15} />}
                    </div>
                  </div>

                  <div className={`volume-row${isSelf ? " volume-row-hidden" : ""}`} aria-hidden={isSelf}>
                    <button
                      className="volume-mute"
                      tabIndex={isSelf ? -1 : 0}
                      onClick={() => toggleParticipantMute(participant.name, participant.id)}
                      title={volume > 0 ? "Silenciar" : "Ativar áudio"}
                    >
                      {volume > 0 ? <Volume2 size={14} /> : <VolumeX size={14} />}
                    </button>
                    <input
                      type="range"
                      className="volume-slider"
                      min="0"
                      max="1"
                      step="0.05"
                      value={volume}
                      tabIndex={isSelf ? -1 : 0}
                      onChange={(event) =>
                        setParticipantVolume(participant.name, participant.id, Number(event.target.value))
                      }
                      title={`Volume: ${Math.round(volume * 100)}%`}
                    />
                    <span className="volume-value">{Math.round(volume * 100)}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        <section className="stage-column">
          <div className="stage" ref={stageRef}>
            {activeShares.length === 0 ? (
              <div className="empty-stage">
                <div className="empty-icon">
                  <MonitorUp size={34} />
                </div>
                <h2>Nenhuma tela compartilhada</h2>
                <p>Converse por áudio e compartilhe uma janela, aba ou monitor quando precisar.</p>
                <button className="primary-button compact" onClick={toggleScreenShare}>
                  <MonitorUp size={18} />
                  Compartilhar minha tela
                </button>
                <p className="hint-text">
                  {isFirefox
                    ? "No Firefox, escolha \"Tela inteira\" (não uma janela ou aba) para ter a opção de compartilhar áudio, e só no Windows ou Linux; no macOS o Firefox ainda não oferece áudio do sistema."
                    : "Para levar o áudio da aba ou da tela junto, marque a opção de compartilhar áudio na janela que o navegador abrir."}
                  {!isElectronDesktop() ? (
                    <>
                      {" "}
                      Quer o áudio de um app específico (tipo Discord ou Spotify)?{" "}
                      <a href="/download" className="link-button inline">
                        Baixe o app desktop do Pixia
                      </a>
                      , ele captura isso direto, sem configuração.
                    </>
                  ) : null}
                </p>
              </div>
            ) : (
              <>
                {activeShares.length > 1 ? (
                  <div className="stage-selector">
                    <MonitorUp size={14} />
                    <select
                      value={focusedShare?.id ?? ""}
                      onChange={(event) => setFocusedShareId(event.target.value)}
                      title="Escolher tela"
                    >
                      {activeShares.map((share) => (
                        <option key={share.id} value={share.id}>
                          {share.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                <div className="share-grid shares-1">
                  {focusedShare ? (
                    <article className="share-card" key={focusedShare.id}>
                      <StreamVideo stream={focusedShare.stream} muted={focusedShare.local} />
                      <div className="share-label">
                        <span className="live-dot" />
                        {focusedShare.name} está compartilhando
                      </div>
                    </article>
                  ) : null}
                </div>
              </>
            )}
          </div>

          <footer className="call-controls">
            <button
              className={`round-control ${micEnabled ? "active" : "danger-soft"}`}
              onClick={toggleMicrophone}
              title={micEnabled ? "Desligar microfone" : "Ligar microfone"}
            >
              {micEnabled ? <Mic size={21} /> : <MicOff size={21} />}
            </button>

            <select
              className="device-select"
              value={selectedAudioInputId}
              onChange={(event) => changeAudioInput(event.target.value)}
              title="Escolher microfone"
            >
              <option value="">Microfone padrão</option>
              {audioInputDevices.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Entrada de áudio ${index + 1}`}
                </option>
              ))}
              {appAudioSources.length > 0 ? (
                <optgroup label="Áudio de um app (desktop)">
                  {appAudioSources.map((source) => (
                    <option key={source.pid} value={`${ELECTRON_APP_PREFIX}${source.pid}`}>
                      {source.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>

            <select
              className="device-select"
              value={screenQuality}
              onChange={(event) => changeScreenQuality(event.target.value)}
              disabled={screenSharing}
              title={
                screenSharing
                  ? "Pare o compartilhamento pra trocar a qualidade"
                  : "Qualidade do compartilhamento de tela"
              }
            >
              <option value="720p">720p</option>
              <option value="1080p">1080p</option>
            </select>

            <button
              className={`share-control ${screenSharing ? "sharing" : ""}`}
              onClick={toggleScreenShare}
            >
              {screenSharing ? <MonitorOff size={20} /> : <MonitorUp size={20} />}
              {screenSharing ? "Parar compartilhamento" : "Compartilhar tela"}
            </button>

            <button className="round-control leave" onClick={onLeave} title="Sair da sala">
              <LogOut size={21} />
            </button>
          </footer>
        </section>

        <aside className="chat-panel">
          <div className="chat-header">
            <strong>Chat da sala</strong>
            <span>{messages.length} mensagens</span>
          </div>

          <div className="messages">
            {messages.length === 0 ? (
              <div className="chat-empty">As mensagens desta sala aparecerão aqui.</div>
            ) : (
              messages.map((item) => (
                <article className="message" key={item.id}>
                  <div>
                    <strong>{item.user}</strong>
                    <time>
                      {new Date(item.timestamp).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                  <p>{item.message}</p>
                </article>
              ))
            )}
          </div>

          <div className="chat-input-area">
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={handleMessageKeyDown}
              placeholder="Digite uma mensagem..."
              rows={1}
              maxLength={2000}
            />
            <button onClick={handleSend} title="Enviar mensagem">
              <Send size={18} />
            </button>
          </div>
        </aside>
      </section>
    </main>
  );
}

const SPECIAL_ROUTES = [
  "/cadastro",
  "/entrar",
  "/painel",
  "/conta",
  "/termos",
  "/privacidade",
  "/download",
];

export default function App() {
  const [pathname, setPathname] = useState(() => window.location.pathname);
  // Se o usuário já tinha entrado nesta sala (nome + token, se privada), o
  // F5 volta direto pra sala em vez de pedir o nome de novo.
  const [session, setSession] = useState(() => {
    const initialRoomId = getRoomIdFromPath(window.location.pathname);
    const stored = initialRoomId ? getRoomSession(initialRoomId) : null;
    return stored ? { name: stored.name, roomToken: stored.roomToken } : { name: null, roomToken: null };
  });
  const [currentUser, setCurrentUser] = useState(() => getStoredUser());

  useEffect(() => {
    function handlePopState() {
      setPathname(window.location.pathname);
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Confirma que a sessão salva (se existir) ainda é válida — evita ficar
  // "logado" na UI com um token expirado ou revogado.
  useEffect(() => {
    if (!getToken()) return;

    authFetch("/api/auth/me").then(({ response, data }) => {
      if (!response.ok || !data?.ok) {
        clearSession();
        setCurrentUser(null);
        return;
      }
      setCurrentUser(data.user);
    });
  }, []);

  function navigate(path) {
    window.history.pushState({}, "", path);
    setPathname(path);
  }

  function handleJoin(name, roomToken) {
    setSession({ name, roomToken: roomToken || null });
    if (roomId) saveRoomSession(roomId, name, roomToken || null);
  }

  function handleNeedsPassword() {
    if (roomId) clearRoomSession(roomId);
    setSession({ name: null, roomToken: null });
  }

  useEffect(() => {
    if ((pathname === "/painel" || pathname === "/conta") && !currentUser) {
      navigate("/entrar");
    }

    // Já logado, não faz sentido mostrar a tela de login de novo.
    if (pathname === "/entrar" && currentUser) {
      navigate("/painel");
    }
  }, [pathname, currentUser]);

  const isSpecialRoute = SPECIAL_ROUTES.includes(pathname);
  const roomId = useMemo(
    () => (isSpecialRoute ? null : getRoomIdFromPath(pathname)),
    [isSpecialRoute, pathname]
  );

  if (pathname === "/termos") {
    return <TermsOfUse onNavigate={navigate} />;
  }

  if (pathname === "/privacidade") {
    return <PrivacyPolicy onNavigate={navigate} />;
  }

  if (pathname === "/download") {
    return <DownloadApp onNavigate={navigate} />;
  }

  if (pathname === "/cadastro") {
    return <SignUp onNavigate={navigate} onAuthenticated={setCurrentUser} />;
  }

  if (pathname === "/entrar") {
    if (currentUser) return null;
    return <Login onNavigate={navigate} onAuthenticated={setCurrentUser} />;
  }

  if (pathname === "/painel") {
    if (!currentUser) return null;
    return (
      <LinksPanel user={currentUser} onNavigate={navigate} onLogout={() => setCurrentUser(null)} />
    );
  }

  if (pathname === "/conta") {
    if (!currentUser) return null;
    return <Account user={currentUser} onNavigate={navigate} onUserUpdated={setCurrentUser} />;
  }

  if (!roomId) {
    return <Landing onNavigate={navigate} currentUser={currentUser} />;
  }

  if (!session.name) {
    return (
      <JoinRoom
        roomId={roomId}
        onJoin={handleJoin}
        onNavigate={navigate}
        currentUser={currentUser}
      />
    );
  }

  return (
    <Room
      roomId={roomId}
      name={session.name}
      roomToken={session.roomToken}
      currentUser={currentUser}
      onLeave={() => {
        clearRoomSession(roomId);
        window.location.reload();
      }}
      onNeedsPassword={handleNeedsPassword}
    />
  );
}
