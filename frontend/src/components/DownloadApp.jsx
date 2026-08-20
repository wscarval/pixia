import { Check, Download, Monitor } from "lucide-react";
import AuthLayout from "./AuthLayout.jsx";
import { isElectronDesktop } from "../lib/electronAppAudio.js";

const INSTALLER_URL = "/downloads/Pixia-Setup-1.0.0.exe";
const VERSION = "1.0.0";
const SIZE_MB = "99 MB";

export default function DownloadApp({ onNavigate }) {
  const alreadyInApp = isElectronDesktop();

  return (
    <AuthLayout>
      <div className="join-card wide legal-card">
        <div className="brand-mark">
          <img src="/pixia.png" alt="Pixia" />
        </div>
        <h1>Baixar o Pixia para Windows</h1>

        {alreadyInApp ? (
          <div className="download-note already-installed">
            <Check size={16} />
            <span>Você já está usando o app desktop do Pixia, não precisa baixar de novo.</span>
          </div>
        ) : (
          <>
            <p className="muted">
              O app desktop carrega a mesma sala do navegador, mas com um truque a mais: captura o
              áudio de um app específico do Windows (Discord, Spotify, um jogo) para compartilhar
              na chamada, algo que nenhum navegador consegue fazer sozinho.
            </p>

            <a
              className="primary-button download-button"
              href={INSTALLER_URL}
              download
            >
              <Download size={18} />
              Baixar para Windows
            </a>

            <p className="muted small download-meta">
              Versão {VERSION} · {SIZE_MB} · Windows 10 ou 11, 64 bits
            </p>

            <div className="download-note">
              <Monitor size={16} />
              <span>macOS e Linux ainda não têm app desktop. Use o Pixia direto pelo navegador.</span>
            </div>
          </>
        )}

        <button className="link-button" type="button" onClick={() => onNavigate("/")}>
          Voltar
        </button>
      </div>
    </AuthLayout>
  );
}
