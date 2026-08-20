const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("workroomDesktop", {
  isDesktop: true,

  listAudioSessions: () => ipcRenderer.invoke("audio:list-sessions"),

  startProcessAudioCapture: (pid) => ipcRenderer.invoke("audio:start-capture", pid),

  stopProcessAudioCapture: () => ipcRenderer.invoke("audio:stop-capture"),

  getScreenShareWindowPid: () => ipcRenderer.invoke("screen-share:get-window-pid"),

  onAudioChunk: (callback) => {
    const listener = (_event, chunk) => callback(chunk);
    ipcRenderer.on("audio:chunk", listener);
    return () => ipcRenderer.removeListener("audio:chunk", listener);
  },
});
