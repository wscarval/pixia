// Duas listas de sala de uma conta logada: as que ela criou (dono) e as de
// outras pessoas que ela já entrou (ver RoomVisit no backend). Reusado pelo
// painel de links e pelo select da tela inicial, ambos precisam das duas.
import { authFetch } from "./session.js";

export async function fetchCreatedRooms() {
  const { response, data } = await authFetch("/api/rooms");
  if (!response.ok || !data?.ok) {
    throw new Error(data?.message || "Não foi possível carregar suas salas.");
  }
  return data.rooms;
}

export async function fetchVisitedRooms() {
  const { response, data } = await authFetch("/api/rooms/visited");
  if (!response.ok || !data?.ok) {
    throw new Error(data?.message || "Não foi possível carregar suas salas.");
  }
  return data.rooms;
}
