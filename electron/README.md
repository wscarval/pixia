# Pixia — Desktop (Electron)

Cliente desktop que carrega o site já publicado (`https://pixiaart.com` por padrão) dentro de uma janela nativa, sem depender de nenhum backend próprio — é só um "shell". A vantagem sobre o navegador comum é o módulo nativo de captura de áudio por processo (Windows), que permite compartilhar o áudio de um app específico (Discord, Spotify, um jogo, etc.) na chamada, algo que nenhum navegador consegue fazer sozinho.

## Rodar em desenvolvimento

```bash
cd electron
npm install
npm run rebuild-native   # compila o módulo nativo (Windows apenas)
npm start
```

Por padrão abre `https://pixiaart.com`. Para apontar para outro endereço (ex.: um ambiente local):

```bash
WORKROOM_URL=http://localhost npm start
```

## O módulo nativo (`native/`)

Usa a API de *process loopback* do WASAPI (Windows 10 2004+, build 19041+) para capturar o áudio renderizado por um processo específico:

- `listAudioSessions()` — lista os processos com uma sessão de áudio ativa (equivalente ao mixer de volume do Windows).
- `ProcessLoopbackCapture(pid, onChunk)` — captura o áudio daquele processo (e da árvore de processos filhos), entregando blocos PCM brutos via callback.

Requer Visual Studio Build Tools (workload "Desenvolvimento para desktop com C++") e o Windows SDK 10.0.19041.0 ou mais novo — é de onde vem `audioclientactivationparams.h`, que define a ativação por processo.

Duas pegadinhas do WASAPI que custaram para descobrir, documentadas no código:

1. **`IAgileObject`**: o handler de `ActivateAudioInterfaceAsync` precisa implementar essa interface marcadora, senão a chamada falha de forma síncrona com `E_ILLEGAL_METHOD_CALL` (`0x8000000E`) — o COM não sabe que pode chamá-lo de qualquer thread sem marshaling.
2. **Formato de captura**: o `IAudioClient` virtual do process-loopback não implementa `GetMixFormat` (`E_NOTIMPL`). É preciso pegar o formato do dispositivo de saída padrão real — é o mecanismo de mixagem que o loopback espelha — e usar exatamente esse formato no `Initialize()`. Loopback não reamostra implicitamente: um formato arbitrário faz o `Initialize` "funcionar" mas nunca entrega nenhum frame depois.

Depois de qualquer alteração em `native/src/*.cc`, recompile com `npm run rebuild-native` (compila contra a ABI do Electron instalado, não a do Node do sistema).

## Ponte com o site (`frontend/src/lib/electronAppAudio.js`)

O site (mesmo React app publicado em pixiaart.com) detecta `window.workroomDesktop` — exposto só quando roda dentro deste shell — e usa os blocos PCM recebidos por IPC para montar um `MediaStreamTrack` de verdade via `AudioWorkletNode` + `AudioContext.createMediaStreamDestination()` (worklet em `frontend/public/electron-audio-worklet.js`). Essa track entra no seletor de microfone da sala como mais uma opção, agrupada separadamente ("Áudio de um app").

## Escolha de tela/janela (`src/picker.html`, `src/picker-preload.js`)

O `getDisplayMedia()` do site é atendido por `session.defaultSession.setDisplayMediaRequestHandler` em `main.js`, que abre uma janela própria de seleção (com miniaturas reais das telas e janelas abertas, via `desktopCapturer.getSources`) em vez de escolher uma fonte automaticamente. Existe porque `useSystemPicker` (delegar para o seletor nativo do Windows) não é garantido em toda combinação de Windows/Electron — com uma janela própria, a escolha sempre funciona, em qualquer versão.

Cancelar a seleção não rejeita com `NotAllowedError` como no navegador — vira um erro genérico ("Invalid capture constraints"). O frontend (`useRoomWebRTC.js`) já trata os dois casos como cancelamento silencioso.

### Áudio ao compartilhar uma janela específica

Compartilhar uma **janela** (não a tela inteira) não usa o loopback de áudio do sistema inteiro — só o áudio daquele processo. O `id` de fontes do tipo janela no Windows vem no formato `window:<hwnd>:<id>`; extraímos o HWND, achamos o PID dono via `getWindowProcessId` (novo export do módulo nativo, usa `GetWindowThreadProcessId`) e o frontend captura só aquele processo, reaproveitando o mesmo mecanismo do seletor de microfone (`electronAppAudio.js`). O PID fica disponível via `window.workroomDesktop.getScreenShareWindowPid()`, consultado logo depois do `getDisplayMedia()` resolver.

Compartilhar a **tela inteira** continua usando o loopback normal do Electron (áudio do sistema todo) — é o comportamento esperado nesse caso, já que não há um processo único a isolar.

## Empacotar

```bash
npm run build:win
```

Gera o instalador NSIS via `electron-builder` (config em `package.json`).
