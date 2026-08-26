import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import {
  isElectronDesktop,
  listAppAudioSources,
  startAppAudioCapture,
  stopAppAudioCapture,
} from "../lib/electronAppAudio.js";
import {
  getPreferredAudioInputId,
  getPreferredMicEnabled,
  getPreferredScreenQuality,
  getPreferredScreenShareMode,
  setPreferredAudioInputId,
  setPreferredMicEnabled,
  setPreferredScreenQuality,
  setPreferredScreenShareMode,
} from "../lib/preferences.js";
import { playSoundEffect } from "../lib/soundEffects.js";
import { watchSpeakingLevel } from "../lib/speakingDetector.js";
import { getGuestId, getToken } from "../lib/session.js";

export const ELECTRON_APP_PREFIX = "electron-app:";

// Só resolução/fps — 3 opções fixas de propósito (simplifica o que era uma
// grade de presets independentes de fps). O MODO (ver SCREEN_SHARE_MODES
// abaixo) é o eixo separado que decide como o encoder se comporta sob
// pressão de banda/CPU, não a resolução em si.
const SCREEN_QUALITY_PRESETS = {
  "720p30": { width: 1280, height: 720, frameRate: 30 },
  "1080p60": { width: 1920, height: 1080, frameRate: 60 },
  "1440p60": { width: 2560, height: 1440, frameRate: 60 },
};

// Perfil de qualidade da transmissão: como o RTCRtpSender prioriza
// nitidez x fluidez quando a rede/CPU aperta. Independente da resolução
// escolhida (SCREEN_QUALITY_PRESETS) — essa parte é sobre COMPORTAMENTO do
// encoder, não sobre width/height/fps de captura.
const SCREEN_SHARE_MODES = {
  auto: {
    // Sem dica de conteúdo própria: deixa o navegador decidir sozinho.
    contentHint: "",
    degradationPreference: "balanced",
    maxBitrate: null,
  },
  detail: {
    // Prioriza nitidez (texto, código, planilha) — sacrifica fps antes de
    // borrar a imagem quando precisa cortar banda.
    contentHint: "detail",
    degradationPreference: "maintain-resolution",
    maxBitrate: 7_000_000,
  },
  motion: {
    // Prioriza fluidez (jogos, vídeo, animação).
    contentHint: "motion",
    degradationPreference: "balanced",
    maxBitrate: 12_500_000,
  },
};

// No app desktop Electron, "Automático" sem ajuda nenhuma reproduz um bug
// antigo (perda de FPS: sem aceleração de hardware fácil pro encoder lá,
// ele cai com mais frequência pro "maintain-resolution" default e o efeito
// observado era perder quadros). Só nesse caso específico (modo automático
// + Electron), empresta o comportamento do modo "Jogos e vídeo" pra evitar
// regredir esse fix. Os modos explícitos (Texto/Jogos) não passam por
// aqui — o que a pessoa escolheu vale como está, em qualquer plataforma.
function resolveScreenEncodingConfig(mode) {
  const config = SCREEN_SHARE_MODES[mode] || SCREEN_SHARE_MODES.auto;

  if (mode === "auto" && isElectronDesktop()) {
    return { ...config, contentHint: "motion", degradationPreference: "maintain-framerate" };
  }

  return config;
}

// Aplica bitrate máximo + preferência de degradação no sender de um peer
// específico — precisa ser chamado UMA VEZ POR PEER (cada um tem seu
// próprio RTCRtpSender pra essa mesma track local), tanto ao começar a
// compartilhar quanto quando alguém novo entra enquanto já tem
// compartilhamento ativo (ver createPeer) ou quando o modo muda em tempo
// real (ver changeScreenMode).
async function applyScreenSenderParams(sender, mode) {
  if (!sender) return;

  const config = resolveScreenEncodingConfig(mode);

  try {
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}];
    }
    params.encodings[0].maxBitrate = config.maxBitrate || undefined;
    params.degradationPreference = config.degradationPreference;
    await sender.setParameters(params);
  } catch (error) {
    console.error("[screen-share] falha ao aplicar parâmetros de encoding", error);
  }
}

// O TURN não usa mais credencial fixa embutida no bundle (ela nunca
// mudaria e ficaria visível pra sempre no JS público). Em vez disso, busca
// uma credencial de curta duração do backend (ver GET /api/turn-credentials
// e TURN_SECRET no backend) — cacheada num ref e renovada perto de expirar.
function buildIceServers(turnServer) {
  const servers = [];

  const stunUrl = import.meta.env.VITE_STUN_URL;
  if (stunUrl) {
    servers.push({ urls: stunUrl });
  }

  if (turnServer) {
    servers.push(turnServer);
  }

  return servers;
}

// Ping de verdade é o da mídia (o par de candidatos ICE em uso), não o do
// canal de sinalização: o socket.io passa pelo Cloudflare/Nginx e pode levar
// uma rota bem mais lenta que a conexão P2P/TURN da chamada em si, então
// medir por ali mostrava um número que não refletia a qualidade da chamada.
async function getConnectionRtt(pc) {
  if (!pc || pc.connectionState !== "connected") return null;

  try {
    const stats = await pc.getStats();
    for (const report of stats.values()) {
      if (report.type === "candidate-pair" && report.state === "succeeded" && report.nominated) {
        if (report.currentRoundTripTime != null) {
          return Math.round(report.currentRoundTripTime * 1000);
        }
      }
    }
  } catch {
    // getStats() pode falhar bem no meio de uma renegociação; tenta de novo no próximo tick.
  }

  return null;
}

function randomId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Ver o comentário de clientIdRef mais abaixo: precisa sobreviver a um F5
// pra não parecer uma aba nova a cada recarregamento.
function getOrCreateTabClientId() {
  try {
    let clientId = sessionStorage.getItem("pixia-tab-client-id");
    if (!clientId) {
      clientId = randomId();
      sessionStorage.setItem("pixia-tab-client-id", clientId);
    }
    return clientId;
  } catch {
    // sessionStorage indisponível (modo privado restrito etc.): sem
    // persistência entre F5s, mas não trava o join por causa disso.
    return randomId();
  }
}

export default function useRoomWebRTC({ roomId, name, roomToken, avatarId, avatarUrl }) {
  const socketRef = useRef(null);
  const selfIdRef = useRef(null);
  // Identifica essa aba (não essa pessoa) de forma estável entre
  // reconexões automáticas do socket.io E entre F5s manuais: numa rede
  // instável, ou quando a pessoa recarrega a página, o cliente reconecta
  // com um socket.id novo antes do servidor perceber que o antigo morreu
  // (até 45s de heartbeat), e sem isso a sala mostra a mesma pessoa duas
  // (ou mais, se recarregar várias vezes seguidas) vezes até expirar. Ver
  // roomClientSockets no backend.
  //
  // Precisa ler/escrever em sessionStorage (não só um useRef) porque um F5
  // de verdade destrói e recria a árvore React inteira — um useRef sozinho
  // geraria um UUID novo a cada recarregamento, nunca reconhecido pelo
  // backend como "a mesma aba", e é exatamente isso que causava o bug de
  // duplicar participante ao atualizar a tela várias vezes. sessionStorage
  // sobrevive ao F5 mas não vaza pra outra aba (é por aba, não por
  // navegador inteiro) — mantém intacta a detecção de aba-clone via
  // BroadcastChannel logo abaixo, que depende de cada aba ter o seu.
  const clientIdRef = useRef(getOrCreateTabClientId());
  const peersRef = useRef(new Map());
  // Toca o som de entrada só na primeira vez que a gente entra, não em
  // reconexões automáticas depois de uma rede instável (senão o som toca de
  // novo a cada reconexão, o que fica estranho).
  const hasPlayedEnterSoundRef = useRef(false);
  const microphoneStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const screenAppAudioActiveRef = useRef(false);
  const turnServerRef = useRef(null);
  const screenQualityRef = useRef(getPreferredScreenQuality());
  const screenModeRef = useRef(getPreferredScreenShareMode());
  // Guarda o último "compartilhando tela?" conhecido de cada participante
  // remoto, só pra saber se um media-state é uma mudança de verdade (toca o
  // som) ou só o servidor confirmando um estado que já era esse.
  const remoteScreenSharingRef = useRef(new Map());
  // "self" (mic local) + um por participante remoto que tem áudio chegando.
  const speakingCleanupsRef = useRef(new Map());
  const localSpeakingStreamRef = useRef(null);

  const [connected, setConnected] = useState(false);
  // Diferente de "connected": esse só vira true depois que o servidor
  // confirma o join-room (participantes e histórico de chat, se teve, já
  // chegaram nessa mesma resposta) — "connected" já é true bem antes disso,
  // assim que o transporte do socket.io conecta.
  const [joined, setJoined] = useState(false);
  // Igual a outra aba desse MESMO navegador (não da mesma rede, não da
  // mesma conta) abriu essa sala e assumiu a presença. Ver o useEffect do
  // BroadcastChannel mais abaixo.
  const [supersededByTab, setSupersededByTab] = useState(false);
  const [participants, setParticipants] = useState([]);
  const [remoteMedia, setRemoteMedia] = useState({});
  const [speakingIds, setSpeakingIds] = useState(() => new Set());
  const [micEnabled, setMicEnabled] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [localScreenStream, setLocalScreenStream] = useState(null);
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState("");
  const [audioInputDevices, setAudioInputDevices] = useState([]);
  const [appAudioSources, setAppAudioSources] = useState([]);
  const [selectedAudioInputId, setSelectedAudioInputId] = useState(getPreferredAudioInputId);
  const [pingMs, setPingMs] = useState(null);
  // "websocket" ou "polling". Polling é um long-polling HTTP por baixo dos
  // panos, bem mais lento por natureza (cada pacote é uma requisição HTTP
  // inteira) — se o ping estiver alto e isso aqui disser "polling", o
  // problema é o proxy na frente não estar repassando o Upgrade do
  // websocket direito, não o app em si.
  const [transport, setTransport] = useState(null);
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [banned, setBanned] = useState(false);
  // Só true pra quem está logado E é a conta dona da sala (ver
  // socket.data.isOwner no backend) — habilita o menu de expulsar/banir nos
  // outros participantes.
  const [isOwner, setIsOwner] = useState(false);
  // "kick" | "ban" | null — preenchido quando ESSE cliente é o alvo de uma
  // moderação (ver moderation-action abaixo). A UI usa isso pra mostrar por
  // que a chamada caiu, em vez de um "conexão perdida" genérico.
  const [moderationAction, setModerationAction] = useState(null);
  const [screenQuality, setScreenQuality] = useState(screenQualityRef.current);
  const [screenMode, setScreenMode] = useState(screenModeRef.current);
  const autoEnableMicRef = useRef(getPreferredMicEnabled());

  const changeScreenQuality = useCallback((quality) => {
    const next = SCREEN_QUALITY_PRESETS[quality] ? quality : "720p30";
    screenQualityRef.current = next;
    setScreenQuality(next);
    setPreferredScreenQuality(next);
  }, []);

  // Diferente da resolução (precisa reiniciar a captura pra valer, por
  // isso o seletor de resolução fica desabilitado enquanto compartilha),
  // o MODO só ajusta comportamento do encoder numa track/sender que já
  // existe — dá pra trocar em tempo real, sem parar de compartilhar.
  const changeScreenMode = useCallback((mode) => {
    const next = SCREEN_SHARE_MODES[mode] ? mode : "auto";
    screenModeRef.current = next;
    setScreenMode(next);
    setPreferredScreenShareMode(next);

    const track = screenStreamRef.current?.getVideoTracks()?.[0];
    if (!track) return;

    const config = resolveScreenEncodingConfig(next);
    track.contentHint = config.contentHint;

    peersRef.current.forEach((peer) => {
      if (peer.screenSender) applyScreenSenderParams(peer.screenSender, next);
    });
  }, []);

  const setSpeaking = useCallback((id, speaking) => {
    setSpeakingIds((current) => {
      const has = current.has(id);
      if (speaking === has) return current;

      const next = new Set(current);
      if (speaking) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  // Reaplica o "está falando?" no stream certo do microfone local: chamado
  // depois de ligar o mic (novo stream) ou trocar de dispositivo (outro
  // stream novo). Só recria o observador se o stream mudou de verdade — só
  // mutar/desmutar (.enabled) usa o mesmo stream, e uma track desabilitada
  // já entrega silêncio ao analisador sozinha, sem precisar recriar nada.
  const syncLocalSpeakingWatcher = useCallback(() => {
    const currentStream = microphoneStreamRef.current;
    if (localSpeakingStreamRef.current === currentStream) return;

    speakingCleanupsRef.current.get("self")?.cleanup();
    speakingCleanupsRef.current.delete("self");
    localSpeakingStreamRef.current = currentStream;

    if (!currentStream) {
      setSpeaking("self", false);
      return;
    }

    const cleanup = watchSpeakingLevel(currentStream, (speaking) => setSpeaking("self", speaking));
    speakingCleanupsRef.current.set("self", { stream: currentStream, cleanup });
  }, [setSpeaking]);

  const refreshAudioInputDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setAudioInputDevices(devices.filter((device) => device.kind === "audioinput"));
    } catch (deviceError) {
      console.error("Não foi possível listar dispositivos de áudio:", deviceError);
    }
  }, []);

  const refreshAppAudioSources = useCallback(async () => {
    if (!isElectronDesktop()) return;
    setAppAudioSources(await listAppAudioSources());
  }, []);

  useEffect(() => {
    refreshAudioInputDevices();
    refreshAppAudioSources();

    navigator.mediaDevices?.addEventListener?.("devicechange", refreshAudioInputDevices);
    const appAudioInterval = isElectronDesktop()
      ? window.setInterval(refreshAppAudioSources, 4000)
      : null;

    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", refreshAudioInputDevices);
      if (appAudioInterval) window.clearInterval(appAudioInterval);
    };
  }, [refreshAudioInputDevices, refreshAppAudioSources]);

  // Credencial de TURN de curta duração (backend, não fixa no bundle).
  // Busca de novo pouco antes de expirar; se falhar, os peers seguem só com
  // STUN (funciona na maioria das redes, só perde o fallback pra NAT
  // restritivo).
  useEffect(() => {
    if (String(import.meta.env.VITE_TURN_ENABLED) !== "true") return undefined;

    let active = true;
    let refreshTimer = null;

    const fetchTurnCredentials = async () => {
      try {
        const response = await fetch("/api/turn-credentials");
        const data = await response.json().catch(() => null);
        if (!active || !response.ok || !data?.ok) return;

        turnServerRef.current = {
          urls: data.urls,
          username: data.username,
          credential: data.credential,
        };

        // Renova a uns 2min antes de expirar (nunca antes de 30s).
        const nextFetchMs = Math.max((data.ttl - 120) * 1000, 30000);
        refreshTimer = window.setTimeout(fetchTurnCredentials, nextFetchMs);
      } catch {
        // Sem TURN disponível agora; tenta de novo um pouco depois.
        if (active) refreshTimer = window.setTimeout(fetchTurnCredentials, 30000);
      }
    };

    fetchTurnCredentials();

    return () => {
      active = false;
      if (refreshTimer) window.clearTimeout(refreshTimer);
    };
  }, []);

  // Evita "clones" de quem abre a mesma sala em várias abas DO MESMO
  // navegador (BroadcastChannel só entrega mensagens dentro da mesma
  // origem + mesmo perfil de navegador — nunca cruza pra outro dispositivo
  // ou outro navegador na mesma rede, diferente de tentar resolver isso por
  // IP). Cada aba anuncia um "carimbo" (timestamp) ao entrar; quem ouve um
  // carimbo mais novo que o próprio cede a sala (desconecta, larga
  // mic/tela) e mostra um aviso pra recarregar se quiser retomar aqui.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined" || !roomId) return undefined;

    const channel = new BroadcastChannel(`pixia-room-${roomId}`);
    const myClaimTs = Date.now();
    const myClientId = clientIdRef.current;

    const theirsWins = (theirTs, theirClientId) =>
      theirTs !== myClaimTs ? theirTs > myClaimTs : theirClientId > myClientId;

    channel.onmessage = (event) => {
      const { clientId: theirClientId, ts: theirTs } = event.data || {};
      if (!theirClientId || theirClientId === myClientId) return;
      if (!theirsWins(theirTs, theirClientId)) return;

      setSupersededByTab(true);
      socketRef.current?.disconnect();
      microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      microphoneStreamRef.current = null;
      screenStreamRef.current = null;
      setMicEnabled(false);
      setScreenSharing(false);
      setLocalScreenStream(null);
    };

    channel.postMessage({ clientId: myClientId, ts: myClaimTs });

    return () => {
      channel.close();
    };
  }, [roomId]);

  // Retorna um MediaStream com uma faixa de áudio pronta para uso: um
  // microfone físico normalmente, ou — dentro do app desktop Electron — o
  // áudio de um app específico do sistema, identificado por
  // "electron-app:<pid>" (ver electronAppAudio.js).
  const openAudioInputStream = useCallback(async (deviceId) => {
    if (deviceId?.startsWith(ELECTRON_APP_PREFIX)) {
      const pid = Number(deviceId.slice(ELECTRON_APP_PREFIX.length));
      const track = await startAppAudioCapture(pid);
      return new MediaStream([track]);
    }

    await stopAppAudioCapture();

    return navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      },
      video: false,
    });
  }, []);

  const upsertParticipant = useCallback((participant) => {
    setParticipants((current) => {
      const exists = current.some((item) => item.id === participant.id);

      if (!exists) {
        return [...current, participant];
      }

      return current.map((item) =>
        item.id === participant.id ? { ...item, ...participant } : item
      );
    });
  }, []);

  const updateParticipant = useCallback((id, patch) => {
    setParticipants((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  }, []);

  const removePeer = useCallback((peerId) => {
    const peer = peersRef.current.get(peerId);

    if (peer) {
      try {
        peer.pc.onicecandidate = null;
        peer.pc.ontrack = null;
        peer.pc.onnegotiationneeded = null;
        peer.pc.onconnectionstatechange = null;
        peer.pc.oniceconnectionstatechange = null;
        peer.pc.onicecandidateerror = null;
        if (peer.disconnectTimer) window.clearTimeout(peer.disconnectTimer);
        peer.pc.close();
      } catch {
        // Peer já encerrado.
      }

      peersRef.current.delete(peerId);
    }

    setParticipants((current) => current.filter((item) => item.id !== peerId));

    setRemoteMedia((current) => {
      const next = { ...current };
      delete next[peerId];
      return next;
    });
  }, []);

  const createPeer = useCallback((peerId) => {
    if (!peerId || peerId === selfIdRef.current) return null;

    const existing = peersRef.current.get(peerId);
    if (existing) return existing;

    const socket = socketRef.current;
    if (!socket) return null;

    const pc = new RTCPeerConnection({
      iceServers: buildIceServers(turnServerRef.current),
    });

    const peer = {
      pc,
      polite: String(selfIdRef.current || "").localeCompare(peerId) > 0,
      makingOffer: false,
      ignoreOffer: false,
      isSettingRemoteAnswerPending: false,
      pendingCandidates: [],
      micSender: null,
      screenSender: null,
      screenAudioSender: null,
      iceRestartAttempts: 0,
      disconnectTimer: null,
    };

    peersRef.current.set(peerId, peer);

    // Canal de dados nunca usado (o chat vai por WebSocket, não por aqui):
    // existe só pra garantir que o onnegotiationneeded dispare mesmo quando
    // ninguém ligou mic nem tela ainda. Sem isso, dois participantes que só
    // trocam áudio/tela depois de um tempo nunca negociam ICE/DTLS até lá, e
    // o ping (que lê o candidate-pair do WebRTC) fica "Medindo..." pra
    // sempre nesse meio tempo.
    //
    // Só o lado "impolite" cria o canal: um canal criado por QUALQUER um dos
    // dois lados já estabelece o transporte SCTP pra ambos (não precisa dos
    // dois lados criando). Quando os dois criavam ao mesmo tempo (o caso
    // comum de "alguém já compartilhando tela quando um novo participante
    // entra"), dava glare logo na primeira negociação e o Chrome falhava com
    // "Failed to start SCTP transport" ao processar a segunda oferta — o
    // participante novo nunca recebia a tela de quem já estava compartilhando.
    if (!peer.polite) {
      pc.createDataChannel("keepalive");
    }

    const micTrack = microphoneStreamRef.current?.getAudioTracks()?.[0];
    if (micTrack) {
      peer.micSender = pc.addTrack(micTrack, microphoneStreamRef.current);
    }

    const screenTrack = screenStreamRef.current?.getVideoTracks()?.[0];
    if (screenTrack) {
      peer.screenSender = pc.addTrack(screenTrack, screenStreamRef.current);
      // Quem entra com o compartilhamento já rolando também precisa do
      // bitrate/degradação do modo atual — sem isso, esse peer específico
      // ficaria com os parâmetros padrão do navegador em vez do que foi
      // escolhido (ver applyScreenSenderParams).
      applyScreenSenderParams(peer.screenSender, screenModeRef.current);
    }

    const screenAudioTrack = screenStreamRef.current?.getAudioTracks()?.[0];
    if (screenAudioTrack) {
      peer.screenAudioSender = pc.addTrack(screenAudioTrack, screenStreamRef.current);
    }

    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return;

      socket.emit("signal", {
        to: peerId,
        candidate,
      });
    };

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();

        socket.emit("signal", {
          to: peerId,
          description: pc.localDescription,
        });
      } catch (negotiationError) {
        console.error("Erro na negociação WebRTC:", negotiationError);
      } finally {
        peer.makingOffer = false;
      }
    };

    pc.ontrack = (event) => {
      const track = event.track;
      const stream = event.streams?.[0] || new MediaStream([track]);

      if (track.kind === "video") {
        setRemoteMedia((current) => ({
          ...current,
          [peerId]: {
            ...current[peerId],
            screenStream: stream,
          },
        }));
        return;
      }

      // O áudio da tela chega agrupado (mesmo MediaStream) com o vídeo da
      // tela, já que ambos são adicionados a partir do mesmo `stream` de
      // origem. O elemento <video> que reproduz `screenStream` já toca esse
      // áudio automaticamente, então só tratamos aqui o áudio do microfone.
      const isScreenAudio = stream.getVideoTracks().length > 0;
      if (isScreenAudio) return;

      setRemoteMedia((current) => ({
        ...current,
        [peerId]: {
          ...current[peerId],
          audioStream: stream,
        },
      }));
    };

    const requestIceRestart = () => {
      if (pc.signalingState === "closed") return;

      if (peer.iceRestartAttempts >= 2) {
        const localHost = ["localhost", "127.0.0.1", "::1"].includes(
          window.location.hostname
        );

        setError(
          localHost
            ? "O WebRTC não conseguiu criar uma rota local. Verifique firewall/VPN e teste também em duas abas do mesmo navegador."
            : "O WebRTC não conseguiu criar uma rota entre os participantes. Tentando alternativas..."
        );
        return;
      }

      peer.iceRestartAttempts += 1;
      console.warn(
        `[peer:${peerId}] reiniciando ICE (${peer.iceRestartAttempts}/2)`
      );

      try {
        pc.restartIce();
      } catch (restartError) {
        console.error(`[peer:${peerId}] falha ao reiniciar ICE`, restartError);
      }
    };

    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      console.log(`[peer:${peerId}] ICE ${state}`);

      if (state === "connected" || state === "completed") {
        peer.iceRestartAttempts = 0;
        setError("");

        if (peer.disconnectTimer) {
          window.clearTimeout(peer.disconnectTimer);
          peer.disconnectTimer = null;
        }
      }

      if (state === "disconnected") {
        if (peer.disconnectTimer) {
          window.clearTimeout(peer.disconnectTimer);
        }

        peer.disconnectTimer = window.setTimeout(() => {
          if (pc.iceConnectionState === "disconnected") {
            requestIceRestart();
          }
        }, 3000);
      }

      if (state === "failed") {
        requestIceRestart();
      }
    };

    pc.onicecandidateerror = (event) => {
      // Erros de um STUN específico não significam necessariamente que a conexão falhou;
      // host candidates ainda podem estabelecer a sessão localmente.
      console.warn(`[peer:${peerId}] ICE candidate error`, {
        url: event.url,
        errorCode: event.errorCode,
        errorText: event.errorText,
      });
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log(`[peer:${peerId}] conexão ${state}`);

      if (state === "connected") {
        setError("");
      }
    };

    return peer;
  }, []);

  const handleSignal = useCallback(
    async ({ from, description, candidate }) => {
      const peer = createPeer(from);
      if (!peer) return;

      const { pc } = peer;

      try {
        if (description) {
          const readyForOffer =
            !peer.makingOffer &&
            (pc.signalingState === "stable" || peer.isSettingRemoteAnswerPending);

          const offerCollision = description.type === "offer" && !readyForOffer;

          peer.ignoreOffer = !peer.polite && offerCollision;
          if (peer.ignoreOffer) return;

          peer.isSettingRemoteAnswerPending = description.type === "answer";
          await pc.setRemoteDescription(description);
          peer.isSettingRemoteAnswerPending = false;

          for (const pendingCandidate of peer.pendingCandidates) {
            await pc.addIceCandidate(pendingCandidate);
          }
          peer.pendingCandidates = [];

          if (description.type === "offer") {
            await pc.setLocalDescription();

            socketRef.current?.emit("signal", {
              to: from,
              description: pc.localDescription,
            });
          }
        }

        if (candidate) {
          if (peer.ignoreOffer) return;

          if (pc.remoteDescription) {
            await pc.addIceCandidate(candidate);
          } else {
            peer.pendingCandidates.push(candidate);
          }
        }
      } catch (signalError) {
        if (!peer.ignoreOffer) {
          console.error("Erro processando signaling:", signalError);
        }
      }
    },
    [createPeer]
  );

  useEffect(() => {
    let active = true;

    const socket = io({
      path: "/socket.io",
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;

    const trackTransport = () => {
      if (!active) return;
      setTransport(socket.io.engine?.transport?.name || null);
    };

    socket.io.on("open", () => {
      trackTransport();
      socket.io.engine.on("upgrade", trackTransport);
    });

    const measurePing = async () => {
      const peers = Array.from(peersRef.current.values());
      if (peers.length === 0) {
        if (active) setPingMs(null);
        return;
      }

      const rtts = (await Promise.all(peers.map((peer) => getConnectionRtt(peer.pc)))).filter(
        (rtt) => rtt != null
      );
      if (!active) return;

      setPingMs(
        rtts.length > 0 ? Math.round(rtts.reduce((sum, rtt) => sum + rtt, 0) / rtts.length) : null
      );
    };

    const pingInterval = window.setInterval(measurePing, 4000);

    socket.on("connect", () => {
      if (!active) return;

      selfIdRef.current = socket.id;
      setConnected(true);
      setError("");
      measurePing();

      socket.emit(
        "join-room",
        {
          roomId,
          name,
          roomToken,
          avatarId,
          avatarUrl,
          clientId: clientIdRef.current,
          // Se logado, prova a identidade da conta pro servidor poder
          // derrubar uma aba antiga da MESMA conta nessa sala (ver
          // roomAccountSockets no backend) — abrir várias abas de propósito
          // não devia criar "clones" da mesma pessoa na lista.
          accountToken: getToken(),
          // Só usado se NÃO estiver logado — é o que permite o dono da sala
          // banir um visitante anônimo (ver RoomBan no backend).
          guestId: getToken() ? undefined : getGuestId(),
        },
        (response) => {
          if (!active) return;

          if (!response?.ok) {
            setError(response?.message || "Não foi possível entrar na sala.");
            if (response?.requiresPassword) setRequiresPassword(true);
            if (response?.banned) setBanned(true);
            return;
          }

          setRequiresPassword(false);
          setBanned(false);
          setJoined(true);
          setIsOwner(Boolean(response.isOwner));
          selfIdRef.current = response.selfId;
          const existing = response.participants || [];
          setParticipants(existing);

          if (!hasPlayedEnterSoundRef.current) {
            hasPlayedEnterSoundRef.current = true;
            playSoundEffect("enterRoom");
          }

          // Semeia com quem já estava compartilhando antes da gente entrar,
          // pra não tocar o som de "começou a compartilhar" por engano no
          // primeiro media-state deles depois que a gente chegou.
          remoteScreenSharingRef.current = new Map(
            existing.map((participant) => [participant.id, Boolean(participant.screenSharing)])
          );

          // Salas particulares guardam o histórico no banco; ao (re)conectar,
          // o servidor manda de volta o que já foi trocado nesta sala.
          if (response.messages) setMessages(response.messages);

          // O novo participante inicia a conexão com quem já estava na sala.
          existing.forEach((participant) => {
            createPeer(participant.id);
          });
        }
      );
    });

    socket.on("disconnect", () => {
      if (!active) return;

      setConnected(false);
      setJoined(false);
      setPingMs(null);
      setTransport(null);
      setParticipants([]);
      setRemoteMedia({});
      remoteScreenSharingRef.current.clear();

      peersRef.current.forEach((peer) => {
        try {
          if (peer.disconnectTimer) window.clearTimeout(peer.disconnectTimer);
          peer.pc.close();
        } catch {
          // ignore
        }
      });
      peersRef.current.clear();
    });

    // O dono da sala expulsou/baniu ESSE cliente (ver moderate-participant
    // no backend) — desconecta pela própria vontade (não deixa o socket.io
    // tentar reconectar sozinho, já que pro servidor isso pareceria só mais
    // uma queda de rede) e guarda qual foi a ação pra UI explicar o motivo.
    socket.on("moderation-action", ({ action } = {}) => {
      if (!active) return;
      setModerationAction(action === "ban" ? "ban" : "kick");
      socket.disconnect();
    });

    socket.on("connect_error", (socketError) => {
      if (!active) return;
      setError(`Falha ao conectar ao servidor: ${socketError.message}`);
    });

    socket.on("user-joined", (participant) => {
      if (!active) return;
      upsertParticipant(participant);
      remoteScreenSharingRef.current.set(participant.id, Boolean(participant.screenSharing));
      playSoundEffect("enterRoom");
      // Mantemos o RTCPeerConnection preparado, mas sem forçar uma
      // negociação vazia. A primeira mídia adicionada dispara a oferta.
      createPeer(participant.id);
    });

    socket.on("user-left", ({ id }) => {
      if (!active) return;
      remoteScreenSharingRef.current.delete(id);
      playSoundEffect("leftRoom");
      removePeer(id);
    });

    socket.on(
      "media-state",
      ({ id, micEnabled: remoteMic, screenSharing: remoteScreen, deafened: remoteDeafened }) => {
        if (!active) return;

        if (typeof remoteScreen === "boolean") {
          const wasSharing = remoteScreenSharingRef.current.get(id) ?? false;
          if (remoteScreen !== wasSharing) {
            remoteScreenSharingRef.current.set(id, remoteScreen);
            playSoundEffect(remoteScreen ? "screenShare" : "stopScreenShare");
          }
        }

        updateParticipant(id, {
          micEnabled: remoteMic,
          screenSharing: remoteScreen,
          deafened: remoteDeafened,
        });
      }
    );

    socket.on("chat-message", (chatMessage) => {
      if (!active) return;
      setMessages((current) => [...current, chatMessage]);
    });

    socket.on("signal", handleSignal);

    return () => {
      active = false;
      window.clearInterval(pingInterval);

      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;

      peersRef.current.forEach((peer) => {
        try {
          if (peer.disconnectTimer) window.clearTimeout(peer.disconnectTimer);
          peer.pc.close();
        } catch {
          // ignore
        }
      });
      peersRef.current.clear();

      microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      stopAppAudioCapture();

      microphoneStreamRef.current = null;
      screenStreamRef.current = null;
    };
  }, [
    avatarId,
    avatarUrl,
    createPeer,
    handleSignal,
    name,
    removePeer,
    roomId,
    roomToken,
    updateParticipant,
    upsertParticipant,
  ]);

  // Espelha remoteMedia num observador de fala por participante: cria um
  // watcher quando um audioStream novo aparece, desliga quando o
  // participante some ou troca de stream (evita vazar AudioContext).
  useEffect(() => {
    const activeIds = new Set();

    Object.entries(remoteMedia).forEach(([peerId, media]) => {
      const stream = media?.audioStream;
      if (!stream) return;

      activeIds.add(peerId);
      const existing = speakingCleanupsRef.current.get(peerId);
      if (existing?.stream === stream) return;

      existing?.cleanup();
      const cleanup = watchSpeakingLevel(stream, (speaking) => setSpeaking(peerId, speaking));
      speakingCleanupsRef.current.set(peerId, { stream, cleanup });
    });

    speakingCleanupsRef.current.forEach((entry, id) => {
      if (id === "self" || activeIds.has(id)) return;

      entry.cleanup();
      speakingCleanupsRef.current.delete(id);
      setSpeaking(id, false);
    });
  }, [remoteMedia, setSpeaking]);

  // Ao desmontar o hook (sair da sala de vez), desliga todos os
  // observadores de fala que ainda estiverem de pé (local e remotos).
  useEffect(() => {
    return () => {
      speakingCleanupsRef.current.forEach((entry) => entry.cleanup());
      speakingCleanupsRef.current.clear();
    };
  }, []);

  const toggleMicrophone = useCallback(async () => {
    try {
      setError("");

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Seu navegador não disponibilizou getUserMedia.");
      }

      // Defesa extra: se a track morreu (onended) mas por algum motivo a ref
      // não foi limpa a tempo, trata como "sem stream" em vez de reativar
      // .enabled numa track morta (não faz nada e some o áudio em silêncio).
      if (microphoneStreamRef.current?.getAudioTracks()[0]?.readyState === "ended") {
        microphoneStreamRef.current = null;
      }

      if (!microphoneStreamRef.current) {
        const stream = await openAudioInputStream(selectedAudioInputId || undefined);

        microphoneStreamRef.current = stream;
        syncLocalSpeakingWatcher();
        const track = stream.getAudioTracks()[0];
        track.enabled = true;

        peersRef.current.forEach((peer) => {
          if (!peer.micSender) {
            peer.micSender = peer.pc.addTrack(track, stream);
          } else {
            peer.micSender.replaceTrack(track).catch(console.error);
          }
        });

        track.onended = () => {
          // Sem isso, o próximo clique no botão de mic cai no ramo "já tem
          // stream" (abaixo) e só reativa .enabled numa track já morta —
          // parece ligado na UI, mas nenhum áudio sai. Isso acontece de
          // verdade: troca de dispositivo padrão pelo Windows, outro app
          // pegando o mic com prioridade exclusiva, headset Bluetooth
          // reconectando, etc. Limpar a ref força reabrir o getUserMedia.
          if (microphoneStreamRef.current === stream) microphoneStreamRef.current = null;
          syncLocalSpeakingWatcher();
          setMicEnabled(false);
          socketRef.current?.emit("media-state", { micEnabled: false });
        };

        setMicEnabled(true);
        setPreferredMicEnabled(true);
        socketRef.current?.emit("media-state", { micEnabled: true });
        // Os rótulos dos dispositivos só ficam disponíveis depois que a
        // permissão de áudio é concedida pela primeira vez.
        refreshAudioInputDevices();
        return;
      }

      const track = microphoneStreamRef.current.getAudioTracks()[0];
      const nextEnabled = !track.enabled;
      track.enabled = nextEnabled;

      setMicEnabled(nextEnabled);
      setPreferredMicEnabled(nextEnabled);
      socketRef.current?.emit("media-state", { micEnabled: nextEnabled });
    } catch (mediaError) {
      console.error(mediaError);
      setError(
        mediaError?.name === "NotAllowedError"
          ? "Permissão do microfone negada pelo navegador."
          : `Não foi possível acessar o microfone: ${mediaError.message}`
      );
    }
  }, [openAudioInputStream, refreshAudioInputDevices, selectedAudioInputId, syncLocalSpeakingWatcher]);

  const changeAudioInput = useCallback(
    async (deviceId) => {
      setSelectedAudioInputId(deviceId);
      setPreferredAudioInputId(deviceId);

      // Sem microfone ativo ainda: só guarda a preferência para a próxima vez
      // que o microfone for ligado.
      if (!microphoneStreamRef.current) return;

      try {
        setError("");

        const previousStream = microphoneStreamRef.current;
        const wasEnabled = previousStream.getAudioTracks()[0]?.enabled ?? true;

        const nextStream = await openAudioInputStream(deviceId || undefined);
        const nextTrack = nextStream.getAudioTracks()[0];
        nextTrack.enabled = wasEnabled;

        peersRef.current.forEach((peer) => {
          if (peer.micSender) {
            peer.micSender.replaceTrack(nextTrack).catch(console.error);
          }
        });

        previousStream.getTracks().forEach((track) => {
          track.onended = null;
          track.stop();
        });

        microphoneStreamRef.current = nextStream;
        syncLocalSpeakingWatcher();

        nextTrack.onended = () => {
          // Mesmo motivo do outro onended, em toggleMicrophone: sem limpar a
          // ref, o próximo clique reaproveitaria uma track já morta.
          if (microphoneStreamRef.current === nextStream) microphoneStreamRef.current = null;
          syncLocalSpeakingWatcher();
          setMicEnabled(false);
          socketRef.current?.emit("media-state", { micEnabled: false });
        };
      } catch (deviceError) {
        console.error(deviceError);
        setError(`Não foi possível trocar a entrada de áudio: ${deviceError.message}`);
      }
    },
    [openAudioInputStream, syncLocalSpeakingWatcher]
  );

  // Se o mic estava ligado da última vez, liga de novo sozinho ao entrar,
  // uma única vez por sessão do hook (não repete a cada reconexão do socket).
  useEffect(() => {
    if (!connected || !autoEnableMicRef.current) return;
    autoEnableMicRef.current = false;
    if (!microphoneStreamRef.current) toggleMicrophone();
  }, [connected, toggleMicrophone]);

  const stopScreenShare = useCallback(() => {
    const stream = screenStreamRef.current;
    if (!stream) return;

    peersRef.current.forEach((peer) => {
      if (peer.screenSender) {
        try {
          peer.pc.removeTrack(peer.screenSender);
        } catch {
          // ignore
        }
        peer.screenSender = null;
      }

      if (peer.screenAudioSender) {
        try {
          peer.pc.removeTrack(peer.screenAudioSender);
        } catch {
          // ignore
        }
        peer.screenAudioSender = null;
      }
    });

    stream.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });

    if (screenAppAudioActiveRef.current) {
      screenAppAudioActiveRef.current = false;
      stopAppAudioCapture();
    }

    screenStreamRef.current = null;
    setLocalScreenStream(null);
    setScreenSharing(false);
    socketRef.current?.emit("media-state", { screenSharing: false });
    // O servidor só avisa quem já estava na sala (ver socket.to(roomId) no
    // backend) — sem isso, quem clica no botão não ouvia o próprio som.
    playSoundEffect("stopScreenShare");
  }, []);

  const startScreenShare = useCallback(async () => {
    try {
      setError("");

      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error("Seu navegador não disponibilizou compartilhamento de tela.");
      }

      if (screenStreamRef.current) return;

      // "ideal", não "exact": o navegador ainda pode entregar outra coisa
      // (ex: a tela de origem já é menor que o preset), mas ele tenta
      // capturar/reamostrar nessa resolução em vez de mandar no tamanho nativo.
      const preset = SCREEN_QUALITY_PRESETS[screenQualityRef.current] || SCREEN_QUALITY_PRESETS["720p30"];
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: preset.frameRate, max: preset.frameRate },
          width: { ideal: preset.width },
          height: { ideal: preset.height },
        },
        // Sem isso, o Chrome aplica o mesmo processamento de voz do
        // microfone (cancelamento de eco, ganho automático) no áudio da
        // tela/aba — que quase sempre é música, vídeo ou som de sistema, não
        // voz. O resultado é exatamente o relatado: o ganho automático
        // "bombeia" o volume pra baixo em trechos mais altos, e o
        // cancelamento de eco corta/distorce pedaços sem eco nenhum pra
        // cancelar.
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      const track = stream.getVideoTracks()[0];
      let audioTrack = stream.getAudioTracks()[0];

      // Dica de conteúdo (texto/movimento/nenhuma) pro codec — ver
      // SCREEN_SHARE_MODES/resolveScreenEncodingConfig no topo do arquivo.
      // bitrate/degradação vão pro sender de cada peer só depois de criado
      // (ver o forEach logo abaixo e applyScreenSenderParams).
      track.contentHint = resolveScreenEncodingConfig(screenModeRef.current).contentHint;

      // No app desktop Electron, compartilhar uma janela específica (não a
      // tela inteira) não usa o loopback de áudio do sistema inteiro — ver
      // electron/src/main.js. Em vez disso, buscamos o PID dono daquela
      // janela e capturamos só o áudio dele, com o mesmo mecanismo nativo do
      // seletor de microfone.
      if (isElectronDesktop() && window.workroomDesktop?.getScreenShareWindowPid) {
        try {
          const windowPid = await window.workroomDesktop.getScreenShareWindowPid();
          if (windowPid) {
            audioTrack = await startAppAudioCapture(windowPid);
            stream.addTrack(audioTrack);
            screenAppAudioActiveRef.current = true;
          }
        } catch (appAudioError) {
          console.error("Não foi possível capturar o áudio da janela:", appAudioError);
        }
      }

      screenStreamRef.current = stream;
      setLocalScreenStream(stream);

      peersRef.current.forEach((peer) => {
        if (!peer.screenSender) {
          peer.screenSender = peer.pc.addTrack(track, stream);
        } else {
          peer.screenSender.replaceTrack(track).catch(console.error);
        }
        applyScreenSenderParams(peer.screenSender, screenModeRef.current);

        if (audioTrack) {
          if (!peer.screenAudioSender) {
            peer.screenAudioSender = peer.pc.addTrack(audioTrack, stream);
          } else {
            peer.screenAudioSender.replaceTrack(audioTrack).catch(console.error);
          }
        }
      });

      track.onended = stopScreenShare;
      if (audioTrack) audioTrack.onended = stopScreenShare;

      setScreenSharing(true);
      socketRef.current?.emit("media-state", { screenSharing: true });
      playSoundEffect("screenShare");
    } catch (screenError) {
      // No app desktop Electron, cancelar o seletor próprio de tela (ver
      // electron/src/main.js) não rejeita com NotAllowedError como no
      // navegador — vira um erro genérico de "Invalid capture constraints".
      // Tratamos os dois como o mesmo caso: usuário cancelou, sem exibir erro.
      const userCancelled =
        screenError?.name === "NotAllowedError" ||
        /invalid capture constraints/i.test(screenError?.message || "");

      if (!userCancelled) {
        console.error(screenError);
        setError(`Não foi possível compartilhar a tela: ${screenError.message}`);
      }
    }
  }, [stopScreenShare]);

  const toggleScreenShare = useCallback(() => {
    if (screenStreamRef.current) {
      stopScreenShare();
    } else {
      startScreenShare();
    }
  }, [startScreenShare, stopScreenShare]);

  const sendMessage = useCallback((message) => {
    // Espelha o bloqueio do backend (ver chat-message em server.js): só
    // conta logada manda mensagem, visitante anônimo só lê. Checagem real é
    // a de lá; essa aqui só evita mandar algo que o servidor vai descartar.
    if (!getToken()) return;

    const clean = String(message || "").trim();
    if (!clean) return;

    socketRef.current?.emit("chat-message", { message: clean });
  }, []);

  // Só o dono da sala pode chamar isso (backend confere de novo — ver
  // socket.data.isOwner em moderate-participant). "kick" derruba sem
  // registrar nada; "ban" também grava um RoomBan que barra join-room
  // futuro dessa mesma identidade (conta ou guestId).
  const moderateParticipant = useCallback((targetId, action) => {
    if (!targetId || (action !== "kick" && action !== "ban")) return;
    socketRef.current?.emit("moderate-participant", { targetId, action });
  }, []);

  // Ensurdecer é um controle só de exibição local (não muda nada no
  // WebRTC), mas o resto da sala precisa saber que essa pessoa não está
  // ouvindo ninguém agora — só avisa o servidor, quem decide o volume de
  // verdade continua sendo o próprio App.jsx.
  const broadcastDeafened = useCallback((deafened) => {
    socketRef.current?.emit("media-state", { deafened });
  }, []);

  return {
    connected,
    joined,
    supersededByTab,
    banned,
    isOwner,
    moderationAction,
    pingMs,
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
  };
}
