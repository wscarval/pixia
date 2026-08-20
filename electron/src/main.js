const { app, BrowserWindow, session, desktopCapturer, ipcMain } = require("electron");
const path = require("node:path");

const APP_URL = process.env.WORKROOM_URL || "https://pixiaart.com";
const ICON_PATH = path.join(__dirname, "../build/icon.png");

let audioCapture = null;
try {
  // eslint-disable-next-line global-require
  audioCapture = require("../native/build/Release/process_loopback.node");
} catch (error) {
  console.warn("[audio] módulo nativo de captura por processo indisponível:", error.message);
}

// Abre uma janela para o usuário escolher qual tela/janela compartilhar e
// resolve com o id da fonte escolhida (ou null se cancelado). Existe porque
// `useSystemPicker` não é garantido em toda combinação de Windows/Electron
// — com esta janela própria, a escolha sempre funciona.
function openSourcePicker(sources) {
  return new Promise((resolve) => {
    const parent = BrowserWindow.getFocusedWindow();

    const picker = new BrowserWindow({
      width: 960,
      height: 660,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      modal: Boolean(parent),
      parent: parent || undefined,
      autoHideMenuBar: true,
      title: "Escolher tela ou janela",
      backgroundColor: "#0f0f13",
      icon: ICON_PATH,
      webPreferences: {
        preload: path.join(__dirname, "picker-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    let settled = false;

    const finish = (sourceId) => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener("picker:selected", onSelected);
      ipcMain.removeHandler("picker:get-sources");
      resolve(sourceId || null);
      if (!picker.isDestroyed()) picker.close();
    };

    function onSelected(_event, sourceId) {
      finish(sourceId);
    }

    ipcMain.handle("picker:get-sources", () =>
      sources.map((source) => ({
        id: source.id,
        name: source.name,
        type: source.id.startsWith("screen:") ? "screen" : "window",
        thumbnail: source.thumbnail.toDataURL(),
      }))
    );
    ipcMain.on("picker:selected", onSelected);
    picker.on("closed", () => finish(null));

    picker.loadFile(path.join(__dirname, "picker.html"));
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    autoHideMenuBar: true,
    backgroundColor: "#09090b",
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.loadURL(APP_URL);

  win.webContents.on("did-fail-load", (_event, code, description) => {
    console.error(`[window] falha ao carregar ${APP_URL}:`, code, description);
  });

  return win;
}

let lastWindowSharePid = null;

app.whenReady().then(async () => {
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 300, height: 180 },
    });

    const selectedId = await openSourcePicker(sources);
    const selected = sources.find((source) => source.id === selectedId);

    if (!selected) {
      lastWindowSharePid = null;
      callback({});
      return;
    }

    const isWindow = selected.id.startsWith("window:");

    // Compartilhar uma janela específica não deve levar o áudio do sistema
    // inteiro — só o daquele processo. O id de janelas do desktopCapturer no
    // Windows é "window:<hwnd>:<id>"; a partir do HWND achamos o PID dono e
    // guardamos para o renderer capturar só aquele áudio (mesmo mecanismo do
    // seletor de microfone). Para a tela inteira, o loopback do sistema
    // inteiro é o comportamento esperado mesmo.
    if (isWindow && audioCapture) {
      const match = selected.id.match(/^window:(\d+):/);
      const hwnd = match ? Number(match[1]) : null;
      lastWindowSharePid = hwnd ? audioCapture.getWindowProcessId(hwnd) : null;
    } else {
      lastWindowSharePid = null;
    }

    callback(isWindow ? { video: selected } : { video: selected, audio: "loopback" });
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("audio:list-sessions", async () => {
  if (!audioCapture) return [];
  try {
    return await audioCapture.listAudioSessions();
  } catch (error) {
    console.error("[audio] listAudioSessions falhou:", error);
    return [];
  }
});

let activeCapture = null;

ipcMain.handle("audio:start-capture", async (event, pid) => {
  if (!audioCapture) throw new Error("Captura de áudio nativa indisponível.");

  activeCapture?.stop();

  const sender = event.sender;
  const capture = new audioCapture.ProcessLoopbackCapture(pid, (chunk) => {
    if (sender.isDestroyed()) return;
    sender.send("audio:chunk", chunk);
  });
  activeCapture = capture;
  capture.start();

  // O formato só fica disponível depois que a ativação (assíncrona, na
  // thread nativa) termina — espera um pouco e tenta algumas vezes.
  let format = null;
  for (let attempt = 0; attempt < 20 && !format; attempt += 1) {
    format = capture.getFormat();
    if (!format) await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return { format };
});

ipcMain.handle("audio:stop-capture", () => {
  activeCapture?.stop();
  activeCapture = null;
  return true;
});

ipcMain.handle("screen-share:get-window-pid", () => lastWindowSharePid);
