// Nome automático pra quem entra numa sala sem conta: uma raça de gato mais
// um número, só pra reduzir a chance de duas visitas anônimas colidirem na
// mesma sala. Só quem tem conta escolhe o próprio nome (ver Account.jsx) —
// não existe mais campo de nome editável na entrada da sala.
const CAT_BREEDS = [
  "Persa",
  "Siamês",
  "Maine Coon",
  "Bengal",
  "Sphynx",
  "Ragdoll",
  "Angorá",
  "Munchkin",
  "Abissínio",
  "Birmanês",
  "Bombaim",
  "Chartreux",
  "Himalaio",
  "Siberiano",
  "Scottish Fold",
  "British Shorthair",
  "Devon Rex",
  "Manx",
];

export function randomGuestName() {
  const breed = CAT_BREEDS[Math.floor(Math.random() * CAT_BREEDS.length)];
  const suffix = Math.floor(Math.random() * 900) + 100;
  return `${breed} ${suffix}`;
}
