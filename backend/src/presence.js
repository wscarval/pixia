// Ponte pequena entre o servidor de signaling (server.js, dono da instância
// do Socket.IO) e as rotas REST (rooms.js), que precisam saber "quantas
// pessoas estão nessa sala agora" sem depender uma da outra por import
// direto (rooms.js já é importado por server.js).
let ioInstance = null;

export function setIo(io) {
  ioInstance = io;
}

// Síncrono de propósito: o adapter em memória do Socket.IO já mantém esse
// Set atualizado, então não precisa do fetchSockets() assíncrono (que existe
// pra suportar adapters distribuídos, não é o caso aqui). Isso deixa barato
// chamar isso uma vez por sala ao listar várias de uma vez.
export function getRoomParticipantCount(roomId) {
  if (!ioInstance || !roomId) return 0;
  return ioInstance.sockets.adapter.rooms.get(roomId)?.size || 0;
}
