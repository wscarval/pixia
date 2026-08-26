import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Ban,
  Check,
  Clock,
  Copy,
  Crown,
  Globe,
  HeadphoneOff,
  Headphones,
  LayoutGrid,
  Link2,
  Loader2,
  Lock,
  LogOut,
  Maximize,
  Maximize2,
  MessageSquare,
  Settings,
  Mic,
  MicOff,
  Minimize,
  MonitorOff,
  MonitorUp,
  Play,
  Send,
  SlidersHorizontal,
  User,
  Users,
  UserX,
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
import {
  getPreferredScreenShareVolume,
  getStoredParticipantVolume,
  setPreferredScreenShareVolume,
  setStoredParticipantVolume,
} from "./lib/preferences.js";
import { isElectronDesktop } from "./lib/electronAppAudio.js";
import { randomGuestName } from "./lib/catNames.js";
import { fetchCreatedRooms, fetchVisitedRooms } from "./lib/roomsApi.js";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { IconInput } from "@/components/ui/icon-input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

const AVATAR_PALETTE = [
  ["#8b5cf6", "#6d28d9"],
  ["#22d3ee", "#0e7490"],
  ["#f472b6", "#be185d"],
  ["#34d399", "#047857"],
  ["#fbbf24", "#b45309"],
  ["#60a5fa", "#1d4ed8"],
];

// Perfis de qualidade da transmissão de tela — o "o quê" (rótulo/descrição)
// mora aqui na UI; o "como" (contentHint/degradationPreference/bitrate)
// mora em SCREEN_SHARE_MODES, dentro de useRoomWebRTC.js.
const SCREEN_SHARE_MODE_OPTIONS = [
  { id: "auto", label: "Automático", description: "Recomendado para a maioria dos casos" },
  { id: "detail", label: "Texto e trabalho", description: "Mais nitidez para textos e telas" },
  { id: "motion", label: "Jogos e vídeo", description: "Mais fluidez para movimento" },
];

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

// Foto enviada (só quem tem conta) tem prioridade sobre os gatinhos prontos.
function resolveAvatarSrc(participant) {
  if (participant.avatarUrl) return participant.avatarUrl;
  return catAvatarUrl(participant.avatarId ?? hashToAvatarId(participant.id));
}

function avatarGradient(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }

  const [from, to] = AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
  return `linear-gradient(145deg, ${from}, ${to})`;
}

function formatCallDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, "0");

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

// Salas anônimas expiram em 24h (ver ANONYMOUS_ROOM_TTL_MS no backend);
// salas de conta (expiresAt null) nunca expiram sozinhas.
function formatExpiresIn(expiresAt) {
  if (!expiresAt) return "Sem expiração";

  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "Expirando...";

  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) return `Expira em ${hours}h${minutes > 0 ? ` ${minutes}min` : ""}`;
  return `Expira em ${minutes}min`;
}

function formatMessageTimestamp(timestamp) {
  const date = new Date(timestamp);
  const day = date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const time = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${day} ${time}`;
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
  const [createdRooms, setCreatedRooms] = useState([]);
  const [visitedRooms, setVisitedRooms] = useState([]);

  // Só faz sentido pra quem está logado (visitante anônimo não tem sala
  // "criada por mim" nem histórico entre sessões pra listar aqui).
  // Recarrega periodicamente pra manter a contagem de participantes atual.
  useEffect(() => {
    if (!currentUser) {
      setCreatedRooms([]);
      setVisitedRooms([]);
      return undefined;
    }

    let cancelled = false;

    async function load() {
      try {
        const [created, visited] = await Promise.all([fetchCreatedRooms(), fetchVisitedRooms()]);
        if (!cancelled) {
          setCreatedRooms(created);
          setVisitedRooms(visited);
        }
      } catch {
        // Atalho opcional: se falhar, a tela inicial segue funcionando sem ele.
      }
    }

    load();
    const interval = window.setInterval(load, 10000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [currentUser]);

  function handleMyRoomSelect(event) {
    const slug = event.target.value;
    if (slug) onNavigate(`/r/${slug}`);
  }

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
      <Card className="grid w-[min(420px,100%)] gap-5 rounded-3xl border-white/8 bg-linear-to-b from-card/95 to-card/80 p-9 shadow-2xl backdrop-blur-xl">
        <div className="mx-auto aspect-video w-2/3 max-w-56">
          <img src="/pixia.png" alt="Pixia" className="h-full w-full object-cover" />
        </div>

        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Começar uma sala
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Escolha como quer criar a sua.
          </p>
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <Button
          type="button"
          size="lg"
          className="h-11 w-full rounded-xl text-sm"
          onClick={handlePublic}
          disabled={creatingPublic}
        >
          {creatingPublic ? "Gerando..." : "Gerar sala pública aleatória"}
        </Button>

        {!currentUser ? (
          <p className="text-xs text-muted-foreground">Salas particulares exigem conta.</p>
        ) : showPrivateForm ? (
          <form className="grid gap-2" onSubmit={handlePrivateSubmit}>
            <Label htmlFor="landing-private-password">Senha da sala particular</Label>
            <PasswordField
              id="landing-private-password"
              value={privatePassword}
              onChange={(event) => setPrivatePassword(event.target.value)}
              placeholder={`Mínimo de ${MIN_ROOM_PASSWORD_LENGTH} caracteres`}
              autoFocus
            />
            <Button
              type="submit"
              size="lg"
              className="h-11 w-full rounded-xl text-sm"
              disabled={creatingPrivate}
            >
              {creatingPrivate ? "Criando..." : "Criar sala particular"}
            </Button>
          </form>
        ) : (
          <Button type="button" variant="link" className="mx-auto" onClick={() => setShowPrivateForm(true)}>
            Criar sala particular
          </Button>
        )}

        <div className="relative flex items-center">
          <Separator className="flex-1" />
          <span className="px-3 text-xs text-muted-foreground">ou</span>
          <Separator className="flex-1" />
        </div>

        <form className="grid gap-2" onSubmit={handlePasteSubmit}>
          <Label htmlFor="paste-link">Já tem um link?</Label>
          <IconInput
            icon={Link2}
            id="paste-link"
            value={pastedLink}
            onChange={(event) => setPastedLink(event.target.value)}
            placeholder="Cole o link da sala aqui"
            maxLength={300}
          />
          {pasteError ? <span className="text-xs text-destructive">{pasteError}</span> : null}
          <Button
            type="submit"
            size="lg"
            className="h-11 w-full rounded-xl text-sm"
            disabled={!pastedLink.trim()}
          >
            Entrar no link
          </Button>
        </form>

        {currentUser && (createdRooms.length > 0 || visitedRooms.length > 0) ? (
          <div className="grid gap-2">
            <Label htmlFor="my-rooms-select">Minhas salas</Label>
            <select
              id="my-rooms-select"
              value=""
              onChange={handleMyRoomSelect}
              className="h-9 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            >
              <option value="" disabled>
                Escolher uma sala...
              </option>
              {createdRooms.length > 0 ? (
                <optgroup label="Salas criadas">
                  {createdRooms.map((room) => (
                    <option key={room.id} value={room.slug}>
                      {room.name || "Sala sem nome"} — {room.participantCount || 0}{" "}
                      {room.participantCount === 1 ? "participante" : "participantes"}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {visitedRooms.length > 0 ? (
                <optgroup label="Salas acessadas anteriormente">
                  {visitedRooms.map((room) => (
                    <option key={room.id} value={room.slug}>
                      {room.name || "Sala sem nome"} — {room.participantCount || 0}{" "}
                      {room.participantCount === 1 ? "participante" : "participantes"}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </div>
        ) : null}

        {!currentUser ? (
          <p className="text-center text-sm text-muted-foreground">
            Já tem conta?{" "}
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => onNavigate("/entrar")}
            >
              Entrar
            </button>
            {" · "}
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => onNavigate("/cadastro")}
            >
              Criar conta
            </button>
          </p>
        ) : (
          <p className="text-center text-sm text-muted-foreground">
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => onNavigate("/painel")}
            >
              Meus links
            </button>
          </p>
        )}

        {!isElectronDesktop() ? (
          <Button type="button" variant="link" className="mx-auto" onClick={() => onNavigate("/download")}>
            Baixar app desktop (Windows)
          </Button>
        ) : null}

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
      </Card>
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
  const [participantCount, setParticipantCount] = useState(0);
  const [expiresAt, setExpiresAt] = useState(null);
  const [checkingRoom, setCheckingRoom] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    setCheckingRoom(true);
    setRoomNotFound(false);

    function load() {
      fetch(`/api/rooms/${roomId}/info`)
        .then((response) => response.json())
        .then((data) => {
          if (!active) return;
          setRoomNotFound(!data?.exists);
          setRequiresPassword(Boolean(data?.requiresPassword));
          setRoomLabel(data?.name || "");
          setParticipantCount(data?.participantCount || 0);
          setExpiresAt(data?.expiresAt || null);
        })
        .catch(() => {})
        .finally(() => {
          if (active) setCheckingRoom(false);
        });
    }

    load();
    // Contagem de participantes "ao vivo" enquanto a pessoa decide se entra.
    const interval = window.setInterval(load, 10000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [roomId]);

  if (!checkingRoom && roomNotFound) {
    return (
      <AuthLayout>
        <Card className="grid w-[min(420px,100%)] gap-5 rounded-3xl border-white/8 bg-linear-to-b from-card/95 to-card/80 p-9 shadow-2xl backdrop-blur-xl">
          <div className="mx-auto aspect-video w-2/3 max-w-56">
            <img src="/pixia.png" alt="Pixia" className="h-full w-full object-contain" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Sala não encontrada
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Este link não existe ou a sala já foi encerrada. Salas são sempre criadas pelo Pixia,
              não é possível entrar num endereço digitado à mão.
            </p>
          </div>
          <Button size="lg" className="h-11 w-full rounded-xl text-sm" onClick={() => onNavigate("/")}>
            Criar uma sala nova
          </Button>
        </Card>
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
      <Card className="w-[min(420px,100%)] rounded-3xl border-white/8 bg-linear-to-b from-card/95 to-card/80 p-9 shadow-2xl backdrop-blur-xl">
        <form onSubmit={submit} className="grid gap-5">
          <div className="mx-auto aspect-video w-2/3 max-w-56">
            <img src="/pixia.png" alt="Pixia" className="h-full w-full object-contain" />
          </div>

          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Entrar na conversa
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {currentUser
                ? "Confirme sua entrada nesta sala."
                : "Você entra com um nome de visitante sorteado."}
            </p>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/5 bg-muted px-4 py-3.5">
            <span className="truncate text-sm text-muted-foreground">{roomLabel || "Sala"}</span>
            <strong className="truncate text-sm font-semibold text-foreground">/r/{roomId}</strong>
          </div>

          {!checkingRoom ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className={
                  requiresPassword
                    ? "gap-1.5 border-primary/25 bg-primary/10 text-primary"
                    : "gap-1.5 border-success/25 bg-success/10 text-success"
                }
              >
                {requiresPassword ? <Lock size={12} /> : <Globe size={12} />}
                {requiresPassword ? "Sala privada" : "Sala pública"}
              </Badge>

              <Badge variant="outline" className="gap-1.5 border-white/10 text-muted-foreground">
                <Users size={12} />
                {participantCount === 1 ? "1 participante" : `${participantCount} participantes`}
              </Badge>

              <Badge variant="outline" className="gap-1.5 border-white/10 text-muted-foreground">
                <Clock size={12} />
                {formatExpiresIn(expiresAt)}
              </Badge>
            </div>
          ) : null}

          <div className="grid gap-2">
            <Label htmlFor="display-name">Seu nome</Label>
            <IconInput
              icon={User}
              id="display-name"
              value={displayName}
              disabled
              className="font-semibold text-foreground disabled:opacity-100"
            />
            {currentUser ? (
              <span className="text-xs text-muted-foreground">
                É o nome da sua conta. Pra mudar, acesse{" "}
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => onNavigate("/conta")}
                >
                  Minha conta
                </button>
                .
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">
                Nome de visitante sorteado. Crie uma conta pra escolher o seu.
              </span>
            )}
          </div>

          {requiresPassword ? (
            <div className="grid gap-2">
              <Label htmlFor="room-password">Senha da sala</Label>
              <PasswordField
                id="room-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Esta sala é privada"
                autoFocus
              />
            </div>
          ) : null}

          {error ? <span className="text-xs text-destructive">{error}</span> : null}

          <Button type="submit" size="lg" className="h-11 w-full rounded-xl text-sm" disabled={checkingRoom || submitting}>
            {submitting ? "Entrando..." : "Entrar na sala"}
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            {currentUser ? (
              <button
                type="button"
                className="font-medium text-primary hover:underline"
                onClick={() => onNavigate("/painel")}
              >
                Ver meus links
              </button>
            ) : (
              <>
                Ainda não tem conta?{" "}
                <button
                  type="button"
                  className="font-medium text-primary hover:underline"
                  onClick={() => onNavigate("/cadastro")}
                >
                  Criar conta
                </button>
              </>
            )}
          </p>

          <Button
            type="button"
            variant="outline"
            className="h-10 w-full rounded-xl text-sm"
            onClick={() => onNavigate("/")}
          >
            <ArrowLeft size={16} />
            Voltar
          </Button>
        </form>
      </Card>
    </AuthLayout>
  );
}

// Transmissão de outra pessoa começa borrada — só quem está vendo decide
// quando quer parar o que está fazendo pra prestar atenção (a própria
// transmissão de quem compartilha nunca passa por isso, é só pra quem
// assiste). Ver revealedShares/revealShare em Room.
function ShareCard({ share, muted, volume, revealed, onReveal }) {
  const gated = !share.local && !revealed;

  return (
    <article className={`share-card${gated ? " gated" : ""}`}>
      <StreamVideo stream={share.stream} muted={muted} volume={volume} />
      {gated ? (
        <div className="share-gate">
          <button type="button" className="share-gate-button" onClick={onReveal}>
            <Play size={20} />
            Começar a assistir
          </button>
        </div>
      ) : null}
    </article>
  );
}

function Room({ roomId, name, roomToken, currentUser, onLeave, onNeedsPassword, onNavigate, onRoomInfo }) {
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Chat some por padrão pra dar mais espaço pro palco; quem quiser abre
  // pelo botão na topbar.
  const [chatOpen, setChatOpen] = useState(false);
  // Participante que o dono da sala clicou pra abrir o modal de
  // expulsar/banir. { id, name } | null — só existe enquanto o modal está
  // aberto, não precisa sobreviver a re-renders depois disso.
  const [moderationTarget, setModerationTarget] = useState(null);
  // "Ensurdecer": silencia todo mundo de uma vez (mic dos outros + áudio da
  // transmissão), sem sair da sala e sem mexer nos volumes individuais —
  // eles voltam do jeito que estavam ao desativar.
  const [deafened, setDeafened] = useState(false);
  const [participantVolumes, setParticipantVolumes] = useState({});
  const [roomInfo, setRoomInfo] = useState(null);
  const [focusedShareId, setFocusedShareId] = useState(null);
  // "focus" = uma tela grande por vez (como já era); "grid" = todas lado a
  // lado, 2 por linha. Só faz diferença quando tem mais de 1 transmissão.
  const [stageViewMode, setStageViewMode] = useState("focus");
  const [screenShareVolume, setScreenShareVolume] = useState(getPreferredScreenShareVolume);

  function changeScreenShareVolume(volume) {
    setScreenShareVolume(volume);
    setPreferredScreenShareVolume(volume);
  }
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
        if (active) {
          setRoomInfo(data);
          onRoomInfo?.(data);
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    joined,
    supersededByTab,
    banned,
    isOwner,
    moderationAction,
    pingMs,
    transport,
    participants,
    remoteMedia,
    speakingIds,
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
    screenMode,
    changeScreenMode,
    toggleScreenShare,
    sendMessage,
    moderateParticipant,
    broadcastDeafened,
  } = useRoomWebRTC({
    roomId,
    name,
    roomToken,
    avatarId: myAvatarId,
    avatarUrl: currentUser?.avatarUrl || undefined,
  });

  // O roomToken guardado (ou o cadastro pra reentrada automática após um F5)
  // não vale mais para uma sala particular: volta pra tela de senha.
  useEffect(() => {
    if (requiresPassword) onNeedsPassword();
  }, [requiresPassword, onNeedsPassword]);

  // Só true ANTES do primeiro "joined" bem-sucedido — depois disso fica
  // travado em true pro resto da sessão. Existe pra mostrar a tela de
  // carregamento (ver showInitialLoading mais abaixo) só na entrada, nunca
  // de novo numa reconexão no meio da chamada (aí o pequeno indicador
  // "Reconectando" no topo já basta, trocar a tela inteira seria pior).
  const hasJoinedOnceRef = useRef(false);
  useEffect(() => {
    if (joined) hasJoinedOnceRef.current = true;
  }, [joined]);
  const showInitialLoading = !joined && !hasJoinedOnceRef.current;

  // Contador de mensagens não lidas no botão "Chat", pra quem está com o
  // chat fechado perceber que chegou algo novo. seenMessageCountRef marca
  // até onde a pessoa já "viu": zera no primeiro "joined" (nesse ponto o
  // histórico da sala, se teve, já chegou junto — "connected" vira true
  // bem antes disso, só o transporte do socket.io, não dá pra usar aqui)
  // e sobe de novo toda vez que o chat é aberto.
  const [unreadCount, setUnreadCount] = useState(0);
  const seenMessageCountRef = useRef(0);
  const wasJoinedRef = useRef(false);

  useEffect(() => {
    if (joined && !wasJoinedRef.current) {
      wasJoinedRef.current = true;
      seenMessageCountRef.current = messages.length;
      return;
    }

    if (!joined) {
      wasJoinedRef.current = false;
      return;
    }

    if (chatOpen) {
      seenMessageCountRef.current = messages.length;
      setUnreadCount(0);
      return;
    }

    if (messages.length > seenMessageCountRef.current) {
      setUnreadCount(messages.length - seenMessageCountRef.current);
    }
  }, [joined, messages.length, chatOpen]);

  const allParticipants = useMemo(
    () => [
      {
        id: "self",
        name,
        avatarId: myAvatarId,
        avatarUrl: currentUser?.avatarUrl || null,
        micEnabled,
        screenSharing,
        isOwner,
      },
      ...participants,
    ],
    [currentUser?.avatarUrl, isOwner, micEnabled, myAvatarId, name, participants, screenSharing]
  );

  // Tempo total que a sala teve mais de uma pessoa junto (não reseta se
  // cair pra 1 e voltar a subir — é o total acumulado da "chamada", não de
  // cada trecho isolado). Só aparece a partir da segunda pessoa.
  const multiPersonSinceRef = useRef(null);
  const [callDurationLabel, setCallDurationLabel] = useState(null);

  useEffect(() => {
    if (allParticipants.length <= 1) return;
    if (!multiPersonSinceRef.current) multiPersonSinceRef.current = Date.now();
  }, [allParticipants.length]);

  useEffect(() => {
    if (allParticipants.length <= 1) {
      setCallDurationLabel(null);
      return;
    }

    const tick = () => {
      if (!multiPersonSinceRef.current) return;
      setCallDurationLabel(formatCallDuration(Date.now() - multiPersonSinceRef.current));
    };

    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [allParticipants.length]);

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

  // Transmissões de outras pessoas começam borradas (ver ShareCard); quem
  // assiste clica em "Começar a assistir" pra revelar. Guardado por id de
  // participante, não por sala inteira: cada transmissão alheia pede o
  // próprio clique.
  const [revealedShares, setRevealedShares] = useState(() => new Set());

  function revealShare(shareId) {
    setRevealedShares((current) => {
      if (current.has(shareId)) return current;
      const next = new Set(current);
      next.add(shareId);
      return next;
    });
  }

  // Se a pessoa parar de compartilhar, tira ela da lista de "liberado" —
  // assim, se compartilhar de novo depois (mesmo participant.id), conta
  // como uma transmissão nova e volta a pedir o clique.
  const remoteSharingIdsKey = remoteSharers
    .map((participant) => participant.id)
    .sort()
    .join(",");

  useEffect(() => {
    const stillSharing = new Set(remoteSharingIdsKey ? remoteSharingIdsKey.split(",") : []);
    setRevealedShares((current) => {
      let changed = false;
      const next = new Set(current);
      for (const id of next) {
        if (!stillSharing.has(id)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [remoteSharingIdsKey]);

  const connectionHealth = !connected
    ? { label: "Sem conexão", tone: "bad" }
    : participants.length === 0
      ? { label: "Sozinho na sala", tone: "unknown" }
      : pingMs === null
        ? { label: "Medindo...", tone: "unknown" }
        : pingMs < 120
          ? { label: "Excelente conexão", tone: "good" }
          : pingMs < 300
            ? { label: "Conexão instável", tone: "ok" }
            : { label: "Conexão péssima", tone: "bad" };

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

  if (supersededByTab) {
    return (
      <AuthLayout>
        <Card className="grid w-[min(420px,100%)] gap-5 rounded-3xl border-white/8 bg-linear-to-b from-card/95 to-card/80 p-9 text-center shadow-2xl backdrop-blur-xl">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Aberta em outra aba
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Nova janela foi aberta, então esta aqui foi desconectada
              pra evitar entrar duas conexões na mesma sala.
            </p>
          </div>
          <Button
            size="lg"
            className="h-11 w-full rounded-xl text-sm"
            onClick={() => window.location.reload()}
          >
            Reconectar nesta aba
          </Button>
        </Card>
      </AuthLayout>
    );
  }

  if (banned || moderationAction === "ban") {
    return (
      <AuthLayout>
        <Card className="grid w-[min(420px,100%)] gap-5 rounded-3xl border-white/8 bg-linear-to-b from-card/95 to-card/80 p-9 text-center shadow-2xl backdrop-blur-xl">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Você foi banido desta sala
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              O dono da sala removeu você e bloqueou novas entradas com essa conta ou navegador.
            </p>
          </div>
          <Button size="lg" className="h-11 w-full rounded-xl text-sm" onClick={() => onNavigate("/")}>
            Voltar ao início
          </Button>
        </Card>
      </AuthLayout>
    );
  }

  if (moderationAction === "kick") {
    return (
      <AuthLayout>
        <Card className="grid w-[min(420px,100%)] gap-5 rounded-3xl border-white/8 bg-linear-to-b from-card/95 to-card/80 p-9 text-center shadow-2xl backdrop-blur-xl">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Você foi removido da sala
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              O dono da sala encerrou sua participação. Você pode tentar entrar de novo.
            </p>
          </div>
          <Button
            size="lg"
            className="h-11 w-full rounded-xl text-sm"
            onClick={() => window.location.reload()}
          >
            Tentar entrar novamente
          </Button>
        </Card>
      </AuthLayout>
    );
  }

  // Enquanto a conexão inicial ainda não fechou (socket.io conectando +
  // join-room ainda não confirmado), mostra isso em vez da sala em si —
  // sem essa espera, dava pra ver por um instante uma UI incompleta (lista
  // de participantes vazia enchendo aos poucos). Só existe na entrada; ver
  // showInitialLoading acima pra não reaparecer numa reconexão no meio da
  // chamada.
  if (showInitialLoading) {
    const showError = Boolean(error) && !requiresPassword;

    return (
      <AuthLayout>
        <Card className="grid w-[min(420px,100%)] gap-5 rounded-3xl border-white/8 bg-linear-to-b from-card/95 to-card/80 p-9 text-center shadow-2xl backdrop-blur-xl">
          <div className="mx-auto aspect-video w-2/3 max-w-56">
            <img src="/pixia.png" alt="Pixia" className="h-full w-full object-contain" />
          </div>
          {showError ? (
            <>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                  Não foi possível entrar
                </h1>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{error}</p>
              </div>
              <Button size="lg" className="h-11 w-full rounded-xl text-sm" onClick={() => onNavigate("/")}>
                Voltar ao início
              </Button>
            </>
          ) : (
            <>
              <Loader2 size={28} className="mx-auto animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Conectando à sala...</p>
            </>
          )}
        </Card>
      </AuthLayout>
    );
  }

  return (
    <main className="app-shell">
      {Object.entries(remoteMedia).map(([peerId, media]) =>
        media.audioStream ? (
          <RemoteAudio
            key={peerId}
            stream={media.audioStream}
            volume={
              deafened
                ? 0
                : (participantVolumes[peerId] ??
                  getStoredParticipantVolume(participantNameById[peerId]) ??
                  1)
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
            <div
              className={`connection-health tone-${connectionHealth.tone}`}
              title={
                transport
                  ? `Transporte: ${transport}${pingMs !== null ? ` · ${pingMs}ms` : ""}`
                  : undefined
              }
            >
              <span className="health-dot" />
              {connectionHealth.label}
            </div>
          </div>

          {callDurationLabel ? (
            <div className="call-duration" title="Tempo total com mais de 1 participante na sala">
              <Clock size={13} />
              {callDurationLabel}
            </div>
          ) : null}
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

          <button
            className={`ghost-button${chatOpen ? " active" : ""}`}
            onClick={() => setChatOpen((current) => !current)}
            title={chatOpen ? "Ocultar chat" : "Mostrar chat"}
          >
            <MessageSquare size={17} />
            {chatOpen ? "Ocultar chat" : "Chat"}
            {!chatOpen && unreadCount > 0 ? (
              <span className="chat-unread-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>
            ) : null}
          </button>

          <button className="ghost-button" onClick={copyRoom}>
            {copied ? <Check size={17} /> : <Copy size={17} />}
            {copied ? "Copiado" : "Copiar link"}
          </button>

          {currentUser ? (
            <button
              className="ghost-button"
              onClick={() => onNavigate?.("/conta")}
              title="Configurações da conta"
            >
              <Settings size={17} />
              Configurações
            </button>
          ) : null}
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className={`workspace${chatOpen ? "" : " chat-collapsed"}`}>
        <aside className="participants-panel">
          <div className="panel-title">
            <Users size={16} />
            <span>Participantes</span>
            <b>{allParticipants.length}</b>
          </div>

          <div className="participant-list">
            {allParticipants.map((participant) => {
              const isSelf = participant.id === "self";
              const isSpeaking = speakingIds.has(participant.id);
              // Só o dono da sala pode moderar, e nunca a si mesmo (backend
              // já bloqueia isso também, ver moderate-participant).
              const canModerate = isOwner && !isSelf;
              const volume =
                participantVolumes[participant.id] ??
                getStoredParticipantVolume(participant.name) ??
                1;

              return (
                <div className="participant" key={participant.id}>
                  <div className="participant-row">
                    <div
                      className={`avatar${isSpeaking ? " speaking" : ""}${canModerate ? " moderatable" : ""}`}
                      style={{ background: avatarGradient(participant.id) }}
                      onClick={
                        canModerate
                          ? () => setModerationTarget({ id: participant.id, name: participant.name })
                          : undefined
                      }
                      role={canModerate ? "button" : undefined}
                      tabIndex={canModerate ? 0 : undefined}
                      title={canModerate ? `Moderar ${participant.name}` : undefined}
                    >
                      <img
                        className={`avatar-img${participant.avatarUrl ? " photo" : ""}`}
                        src={resolveAvatarSrc(participant)}
                        alt=""
                      />
                    </div>
                    <div className="participant-copy">
                      <strong>
                        {participant.isOwner ? (
                          <Crown size={12} className="owner-crown" title="Dono da sala" />
                        ) : null}
                        <span className="participant-name-text">{participant.name}</span>
                      </strong>
                      <span>
                        {isSelf ? "Você · " : ""}
                        {participant.micEnabled ? "Microfone ativo" : "Microfone desligado"}
                      </span>
                      {participant.screenSharing ? (
                        <span className="participant-sharing">
                          <span className="live-dot" />
                          AO VIVO
                        </span>
                      ) : null}
                    </div>
                    <div className="participant-icons">
                      {participant.screenSharing ? (
                        <MonitorUp size={15} className="sharing-icon" title="Compartilhando tela" />
                      ) : null}
                      {participant.micEnabled ? <Mic size={15} /> : <MicOff size={15} />}
                      {(isSelf ? deafened : participant.deafened) ? (
                        <HeadphoneOff
                          size={15}
                          className="deafened-icon"
                          title={isSelf ? "Você ensurdeceu: não está ouvindo ninguém" : "Não está ouvindo ninguém agora"}
                        />
                      ) : null}
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
              <div className="gallery-grid">
                {allParticipants.map((participant) => (
                  <div className="gallery-tile" key={participant.id}>
                    <div
                      className={`avatar gallery${speakingIds.has(participant.id) ? " speaking" : ""}`}
                      style={{ background: avatarGradient(participant.id) }}
                    >
                      <img
                        className={`avatar-img${participant.avatarUrl ? " photo" : ""}`}
                        src={resolveAvatarSrc(participant)}
                        alt=""
                      />
                      {participant.isOwner ? (
                        <span className="gallery-owner-badge" title="Dono da sala">
                          <Crown size={12} />
                        </span>
                      ) : null}
                    </div>
                    <span className="gallery-name">
                      {participant.id === "self" ? "Você" : participant.name}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <>
                <div className="stage-selector">
                  {activeShares.length > 1 ? (
                    <>
                      {stageViewMode === "focus" ? (
                        <>
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
                        </>
                      ) : null}

                      <div className="view-mode-toggle">
                        <button
                          type="button"
                          className={stageViewMode === "focus" ? "active" : ""}
                          onClick={() => setStageViewMode("focus")}
                          title="Uma tela por vez"
                        >
                          <Maximize2 size={13} />
                          Foco
                        </button>
                        <button
                          type="button"
                          className={stageViewMode === "grid" ? "active" : ""}
                          onClick={() => setStageViewMode("grid")}
                          title="Todas as telas lado a lado"
                        >
                          <LayoutGrid size={13} />
                          Lado a lado
                        </button>
                      </div>
                    </>
                  ) : null}

                  <div className="stage-volume">
                    <button
                      className="volume-mute"
                      onClick={() => changeScreenShareVolume(screenShareVolume > 0 ? 0 : 1)}
                      title={screenShareVolume > 0 ? "Silenciar transmissão" : "Ativar áudio da transmissão"}
                    >
                      {screenShareVolume > 0 ? <Volume2 size={14} /> : <VolumeX size={14} />}
                    </button>
                    <input
                      type="range"
                      className="volume-slider"
                      min="0"
                      max="1"
                      step="0.05"
                      value={screenShareVolume}
                      onChange={(event) => changeScreenShareVolume(Number(event.target.value))}
                      title={`Volume da transmissão: ${Math.round(screenShareVolume * 100)}%`}
                    />
                    <span className="volume-value">{Math.round(screenShareVolume * 100)}%</span>
                  </div>
                </div>

                {stageViewMode === "grid" && activeShares.length > 1 ? (
                  <div className={`share-grid shares-${Math.min(activeShares.length, 4)}`}>
                    {activeShares.map((share) => (
                      <ShareCard
                        key={share.id}
                        share={share}
                        muted={share.local}
                        volume={deafened ? 0 : screenShareVolume}
                        revealed={revealedShares.has(share.id)}
                        onReveal={() => revealShare(share.id)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="share-grid shares-1">
                    {focusedShare ? (
                      <ShareCard
                        key={focusedShare.id}
                        share={focusedShare}
                        muted={focusedShare.local}
                        volume={deafened ? 0 : screenShareVolume}
                        revealed={revealedShares.has(focusedShare.id)}
                        onReveal={() => revealShare(focusedShare.id)}
                      />
                    ) : null}
                  </div>
                )}
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

            <button
              className={`round-control ${deafened ? "danger-soft" : "active"}`}
              onClick={() => {
                const next = !deafened;
                setDeafened(next);
                broadcastDeafened(next);
                // Ensurdecer sem desligar o mic deixa a pessoa falando sem
                // ouvir ninguém responder, o que atrapalha a conversa pros
                // outros. Ao voltar a escutar, o mic continua desligado (tem
                // que ligar de novo na mão), igual outros apps de chamada.
                if (next && micEnabled) toggleMicrophone();
              }}
              title={deafened ? "Voltar a escutar todo mundo" : "Silenciar todo mundo (ensurdecer)"}
            >
              {deafened ? <HeadphoneOff size={21} /> : <Headphones size={21} />}
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

            <Popover>
              <PopoverTrigger asChild>
                <button
                  className="device-select inline-flex items-center justify-center gap-1.5"
                  type="button"
                  title="Qualidade da transmissão"
                >
                  <SlidersHorizontal size={13} />
                  {SCREEN_SHARE_MODE_OPTIONS.find((option) => option.id === screenMode)?.label ||
                    "Automático"}
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-72">
                <PopoverTitle>Qualidade da transmissão</PopoverTitle>
                <RadioGroup value={screenMode} onValueChange={changeScreenMode} className="mt-1.5">
                  {SCREEN_SHARE_MODE_OPTIONS.map((option) => (
                    <label
                      key={option.id}
                      htmlFor={`screen-mode-${option.id}`}
                      className="flex cursor-pointer items-start gap-2.5 rounded-md p-1.5 hover:bg-accent"
                    >
                      <RadioGroupItem id={`screen-mode-${option.id}`} value={option.id} className="mt-0.5" />
                      <span className="grid gap-0.5">
                        <span className="text-sm font-medium text-foreground">{option.label}</span>
                        <span className="text-xs text-muted-foreground">{option.description}</span>
                      </span>
                    </label>
                  ))}
                </RadioGroup>
              </PopoverContent>
            </Popover>

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
              <option value="720p30">720p · 30 FPS</option>
              <option value="1080p60">1080p · 60 FPS</option>
              <option value="1440p60">1440p · 60 FPS</option>
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

        {chatOpen ? (
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
                    <div
                      className="message-avatar"
                      style={{ background: avatarGradient(item.user || item.id) }}
                    >
                      <img
                        className={`avatar-img${item.avatarUrl ? " photo" : ""}`}
                        src={resolveAvatarSrc({ avatarId: item.avatarId, avatarUrl: item.avatarUrl, id: item.id })}
                        alt=""
                      />
                    </div>
                    <div className="message-body">
                      <div>
                        <strong>{item.user}</strong>
                        <time>{formatMessageTimestamp(item.timestamp)}</time>
                      </div>
                      <p>{item.message}</p>
                    </div>
                  </article>
                ))
              )}
            </div>

            {currentUser ? (
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
            ) : (
              <div className="chat-locked">
                <Lock size={14} />
                <span>
                  Somente usuário logados podem enviar mensagens.{" "}
                  <button type="button" onClick={() => onNavigate("/cadastro")}>
                    Criar conta
                  </button>{" "}
                  ou{" "}
                  <button type="button" onClick={() => onNavigate("/entrar")}>
                    entrar
                  </button>
                  .
                </span>
              </div>
            )}
          </aside>
        ) : null}
      </section>

      <Dialog open={Boolean(moderationTarget)} onOpenChange={(next) => !next && setModerationTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Moderar {moderationTarget?.name}</DialogTitle>
            <DialogDescription>Escolha o que fazer com esse participante.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:flex-col sm:gap-2">
            <Button
              type="button"
              variant="secondary"
              className="w-full justify-start"
              onClick={() => {
                moderateParticipant(moderationTarget.id, "kick");
                setModerationTarget(null);
              }}
            >
              <UserX size={16} />
              Expulsar
              <span className="ml-auto text-xs font-normal text-muted-foreground">Só remove da sala</span>
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="w-full justify-start"
              onClick={() => {
                moderateParticipant(moderationTarget.id, "ban");
                setModerationTarget(null);
              }}
            >
              <Ban size={16} />
              Banir
              <span className="ml-auto text-xs font-normal opacity-80">Remove e bloqueia a volta</span>
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={() => setModerationTarget(null)}>
              Cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  // Sala que continua conectada "em segundo plano" quando o usuário abre
  // Configurações (/conta) sem sair da chamada de propósito. Só existe
  // enquanto a pessoa está de fato numa sala; qualquer navegação que não
  // seja pra /conta solta essa referência (ver efeito abaixo).
  const [pinnedRoom, setPinnedRoom] = useState(null);

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

  // Mantém pinnedRoom em dia enquanto o usuário está mesmo numa sala.
  // Só NÃO solta a referência ao navegar pra /conta — qualquer outro
  // destino (Início, outra sala, etc.) conta como "saiu de vez".
  useEffect(() => {
    if (roomId && session.name) {
      setPinnedRoom((current) =>
        current && current.roomId === roomId
          ? { ...current, name: session.name, roomToken: session.roomToken }
          : { roomId, name: session.name, roomToken: session.roomToken, displayName: null }
      );
    } else if (pathname !== "/conta") {
      setPinnedRoom(null);
    }
  }, [roomId, session.name, session.roomToken, pathname]);

  function handleRoomInfo(forRoomId, data) {
    setPinnedRoom((current) =>
      current && current.roomId === forRoomId ? { ...current, displayName: data?.name || null } : current
    );
  }

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

  // A sala pra renderizar agora: a da própria URL (caminho normal) ou,
  // só enquanto pathname === "/conta", a sala pinada (ver efeito acima).
  // Fora do "/conta" isso NUNCA cai pro pinnedRoom — assim navegar pra
  // qualquer lugar que não seja Configurações continua largando a sala
  // de verdade, como antes.
  const roomForRender =
    roomId && session.name
      ? { roomId, name: session.name, roomToken: session.roomToken }
      : pathname === "/conta"
        ? pinnedRoom
        : null;

  if (pathname === "/conta") {
    if (!currentUser) return null;

    if (!roomForRender) {
      return (
        <Account
          user={currentUser}
          onNavigate={navigate}
          onUserUpdated={setCurrentUser}
          pinnedRoom={null}
          onReturnToRoom={() => {}}
        />
      );
    }
    // Sala pinada existe: cai pro bloco unificado abaixo, que também
    // desenha o Account por cima. Ver comentário ali sobre por que isso
    // precisa ser o MESMO ponto da árvore usado pela sala "normal" (fora
    // do /conta) — é isso que evita reconectar ao entrar/sair daqui.
  } else if (!roomForRender) {
    if (!roomId) {
      return <Landing onNavigate={navigate} currentUser={currentUser} />;
    }

    return (
      <JoinRoom
        roomId={roomId}
        onJoin={handleJoin}
        onNavigate={navigate}
        currentUser={currentUser}
      />
    );
  }

  // Ponto único de montagem do <Room>: tanto a visita normal (pathname na
  // própria URL da sala) quanto o desvio por /conta passam por AQUI, com a
  // MESMA posição/forma de árvore (Fragment > [Account-ou-null, div>Room]).
  // Só assim o React reaproveita a mesma instância do Room (e o socket.io
  // por trás dela) ao entrar/sair de Configurações — se cada caso tivesse
  // seu próprio "return <Room/>" separado, o React trataria como
  // desmontar uma e montar outra, derrubando e reconectando a chamada a
  // cada ida e volta.
  return (
    <>
      {pathname === "/conta" ? (
        <Account
          user={currentUser}
          onNavigate={navigate}
          onUserUpdated={setCurrentUser}
          pinnedRoom={pinnedRoom}
          onReturnToRoom={() => navigate(`/r/${roomForRender.roomId}`)}
        />
      ) : null}
      <div className={pathname === "/conta" ? "hidden" : undefined}>
        <Room
          roomId={roomForRender.roomId}
          name={roomForRender.name}
          roomToken={roomForRender.roomToken}
          currentUser={currentUser}
          onNavigate={navigate}
          onRoomInfo={(data) => handleRoomInfo(roomForRender.roomId, data)}
          onLeave={() => {
            clearRoomSession(roomForRender.roomId);
            setPinnedRoom(null);
            window.location.reload();
          }}
          onNeedsPassword={() => {
            clearRoomSession(roomForRender.roomId);
            setSession({ name: null, roomToken: null });
            setPinnedRoom(null);
          }}
        />
      </div>
    </>
  );
}
