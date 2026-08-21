import { useEffect, useRef } from "react";

export function RemoteAudio({ stream, volume = 1 }) {
  const audioRef = useRef(null);

  useEffect(() => {
    const element = audioRef.current;
    if (!element) return;

    element.srcObject = stream || null;

    if (stream) {
      element.play().catch(() => {
        // Alguns navegadores podem exigir interação prévia do usuário.
      });
    }

    return () => {
      element.srcObject = null;
    };
  }, [stream]);

  useEffect(() => {
    const element = audioRef.current;
    if (!element) return;

    element.volume = Math.min(1, Math.max(0, volume));
  }, [volume]);

  return <audio ref={audioRef} autoPlay playsInline />;
}

export function StreamVideo({ stream, muted = false, volume = 1 }) {
  const videoRef = useRef(null);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;

    element.srcObject = stream || null;

    if (stream) {
      element.play().catch(() => {});
    }

    return () => {
      element.srcObject = null;
    };
  }, [stream]);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;

    element.volume = Math.min(1, Math.max(0, volume));
  }, [volume]);

  return <video ref={videoRef} autoPlay playsInline muted={muted} className="screen-video" />;
}
