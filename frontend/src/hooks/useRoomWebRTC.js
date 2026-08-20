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
  setPreferredAudioInputId,
  setPreferredMicEnabled,
} from "../lib/preferences.js";

export const ELECTRON_APP_PREFIX = "electron-app:";

function buildIceServers() {
  const servers = [];

  const stunUrl = import.meta.env.VITE_STUN_URL;
  if (stunUrl) {
    servers.push({ urls: stunUrl });
  }

  if (String(import.meta.env.VITE_TURN_ENABLED) === "true") {
    const turnUrl = import.meta.env.VITE_TURN_URL;
    const username = import.meta.env.VITE_TURN_USERNAME;
    const credential = import.meta.env.VITE_TURN_CREDENTIAL;

    if (turnUrl && username && credential) {
      servers.push({
        urls: turnUrl,
        username,
        credential,
      });
    }
  }

  return servers;
}

export default function useRoomWebRTC({ roomId, name, roomToken, avatarId }) {
  const socketRef = useRef(null);
  const selfIdRef = useRef(null);
  const peersRef = useRef(new Map());
  const microphoneStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const screenAppAudioActiveRef = useRef(false);

  const [connected, setConnected] = useState(false);
  const [participants, setParticipants] = useState([]);
  const [remoteMedia, setRemoteMedia] = useState({});
  const [micEnabled, setMicEnabled] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [localScreenStream, setLocalScreenStream] = useState(null);
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState("");
  const [audioInputDevices, setAudioInputDevices] = useState([]);
  const [appAudioSources, setAppAudioSources] = useState([]);
  const [selectedAudioInputId, setSelectedAudioInputId] = useState(getPreferredAudioInputId);
  const [pingMs, setPingMs] = useState(null);
  const [requiresPassword, setRequiresPassword] = useState(false);
  const autoEnableMicRef = useRef(getPreferredMicEnabled());

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
      iceServers: buildIceServers(),
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

    const micTrack = microphoneStreamRef.current?.getAudioTracks()?.[0];
    if (micTrack) {
      peer.micSender = pc.addTrack(micTrack, microphoneStreamRef.current);
    }

    const screenTrack = screenStreamRef.current?.getVideoTracks()?.[0];
    if (screenTrack) {
      peer.screenSender = pc.addTrack(screenTrack, screenStreamRef.current);
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
            : "O WebRTC não conseguiu criar uma rota entre os participantes. Nesta rede, configure um servidor TURN."
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

    const measurePing = () => {
      if (!socket.connected) return;
      const start = Date.now();
      socket.emit("ping-check", () => {
        if (!active) return;
        setPingMs(Date.now() - start);
      });
    };

    const pingInterval = window.setInterval(measurePing, 4000);

    socket.on("connect", () => {
      if (!active) return;

      selfIdRef.current = socket.id;
      setConnected(true);
      setError("");
      measurePing();

      socket.emit("join-room", { roomId, name, roomToken, avatarId }, (response) => {
        if (!active) return;

        if (!response?.ok) {
          setError(response?.message || "Não foi possível entrar na sala.");
          if (response?.requiresPassword) setRequiresPassword(true);
          return;
        }

        setRequiresPassword(false);
        selfIdRef.current = response.selfId;
        const existing = response.participants || [];
        setParticipants(existing);

        // Salas particulares guardam o histórico no banco; ao (re)conectar,
        // o servidor manda de volta o que já foi trocado nesta sala.
        if (response.messages) setMessages(response.messages);

        // O novo participante inicia a conexão com quem já estava na sala.
        existing.forEach((participant) => {
          createPeer(participant.id);
        });
      });
    });

    socket.on("disconnect", () => {
      if (!active) return;

      setConnected(false);
      setPingMs(null);
      setParticipants([]);
      setRemoteMedia({});

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

    socket.on("connect_error", (socketError) => {
      if (!active) return;
      setError(`Falha ao conectar ao servidor: ${socketError.message}`);
    });

    socket.on("user-joined", (participant) => {
      if (!active) return;
      upsertParticipant(participant);
      // Mantemos o RTCPeerConnection preparado, mas sem forçar uma
      // negociação vazia. A primeira mídia adicionada dispara a oferta.
      createPeer(participant.id);
    });

    socket.on("user-left", ({ id }) => {
      if (!active) return;
      removePeer(id);
    });

    socket.on("media-state", ({ id, micEnabled: remoteMic, screenSharing: remoteScreen }) => {
      if (!active) return;

      updateParticipant(id, {
        micEnabled: remoteMic,
        screenSharing: remoteScreen,
      });
    });

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
    createPeer,
    handleSignal,
    name,
    removePeer,
    roomId,
    roomToken,
    updateParticipant,
    upsertParticipant,
  ]);

  const toggleMicrophone = useCallback(async () => {
    try {
      setError("");

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Seu navegador não disponibilizou getUserMedia.");
      }

      if (!microphoneStreamRef.current) {
        const stream = await openAudioInputStream(selectedAudioInputId || undefined);

        microphoneStreamRef.current = stream;
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
  }, [openAudioInputStream, refreshAudioInputDevices, selectedAudioInputId]);

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

        nextTrack.onended = () => {
          setMicEnabled(false);
          socketRef.current?.emit("media-state", { micEnabled: false });
        };
      } catch (deviceError) {
        console.error(deviceError);
        setError(`Não foi possível trocar a entrada de áudio: ${deviceError.message}`);
      }
    },
    [openAudioInputStream]
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
  }, []);

  const startScreenShare = useCallback(async () => {
    try {
      setError("");

      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error("Seu navegador não disponibilizou compartilhamento de tela.");
      }

      if (screenStreamRef.current) return;

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 30, max: 60 },
        },
        audio: true,
      });

      const track = stream.getVideoTracks()[0];
      let audioTrack = stream.getAudioTracks()[0];

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
    const clean = String(message || "").trim();
    if (!clean) return;

    socketRef.current?.emit("chat-message", { message: clean });
  }, []);

  return {
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
    toggleScreenShare,
    sendMessage,
  };
}
