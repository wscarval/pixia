# Pixia — React + WebRTC + Socket.IO + Docker

MVP local de sala de áudio, chat e compartilhamento de tela.

## Subir tudo

Na raiz do projeto:

```bash
docker compose up --build
```

Acesse:

- Aplicação: http://localhost/ — escolha "Gerar sala pública aleatória" ou "Criar sala particular" (as salas são sempre criadas pelo servidor, não dá mais pra digitar um `/r/nome-qualquer` direto na URL).
- Health do backend pelo Nginx: http://localhost/health

> O backend não publica mais a porta 3001 no host (só é alcançável pelo Nginx, via rede interna do Compose). Isso é proposital: expor a API direto puxava tudo que o Nginx (e a Cloudflare, em produção) filtram, incluindo o limite de salas por IP. Pra debugar direto no backend, use `docker compose exec backend sh` ou rode `docker compose logs -f backend`.

Copie o link gerado e abra em outro navegador/perfil para simular um segundo participante, entrando com um nome diferente.

> Cuidado com microfonia se testar duas abas no mesmo computador. Use fones ou silencie uma das saídas.

## Parar

```bash
docker compose down
```

## Logs

```bash
docker compose logs -f backend frontend
```

## Reconstruir após alterar código

```bash
docker compose up --build
```

## TURN opcional

O primeiro teste em localhost não precisa do Coturn.

O Compose inclui um perfil opcional:

```bash
docker compose --profile turn up --build
```

Mas para uso real pela Internet o TURN precisa ser configurado com o IP/domínio público correto, portas liberadas e credenciais seguras. O `turnserver.conf` incluído é apenas um ponto de partida de desenvolvimento.

A credencial de TURN não fica mais fixa no bundle do cliente (ficaria exposta pra sempre em texto puro no JS público). Em vez disso, `coturn/turnserver.conf` usa `use-auth-secret` e o backend gera uma credencial de curta duração (1h) por sessão em `GET /api/turn-credentials`, assinada com o mesmo segredo. Pra habilitar em produção:

1. **Firewall do servidor** (fora do Docker, no firewall do provedor/VPS também): libere TCP e UDP na porta `3478`, e UDP no intervalo `49160-49200` (portas de relay, uma por chamada).
2. Em `coturn/turnserver.conf`, troque `static-auth-secret` por um valor forte, e preencha `external-ip` com **`IP_PUBLICO/IP_INTERNO_DO_CONTAINER`** (os dois, separados por `/`). Só o IP público sozinho não basta atrás do NAT do Docker: o coturn continua anunciando o IP interno da rede do Compose nos candidatos de relay, e ninguém de fora consegue usar. Para achar o IP interno atual do container: `docker inspect webrtc-coturn --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'` (pode mudar se o container for recriado — nesse caso, atualize o valor e reinicie o coturn).
3. No `.env`, defina `TURN_SECRET` com o **mesmo** valor do `static-auth-secret`, `TURN_URL` com o endereço público do coturn (ex: `turn:SEU_DOMINIO_OU_IP:3478?transport=udp`), e `VITE_TURN_ENABLED=true`.
4. Suba com o profile `turn` e reconstrua (o `VITE_TURN_ENABLED` é build-time do frontend):
   ```bash
   docker compose --profile turn up --build -d
   ```
   **O profile precisa ser repetido toda vez** que a stack for recriada (`docker compose up -d` sem `--profile turn` não sobe o coturn). Se em algum momento os participantes pararem de conseguir se conectar entre si, o primeiro passo é `docker ps` pra confirmar que o `webrtc-coturn` está `Up` — é comum ele simplesmente não ter subido numa atualização.
5. Confirme que o coturn está de pé: `docker ps` deve listar `webrtc-coturn`. Depois, `curl https://seu-dominio/api/turn-credentials` deve devolver `{"ok":true,"urls":"...","username":"...","credential":"..."}` — mas atenção, essa resposta só confirma que o **backend** tem `TURN_SECRET`/`TURN_URL` configurados, não que o coturn está rodando nem que o segredo bate com o `static-auth-secret` dele. Pra testar de ponta a ponta de verdade, use o cliente de teste que já vem na imagem do coturn:
   ```bash
   docker exec webrtc-coturn turnutils_uclient -u USERNAME -w CREDENTIAL -p 3478 -y SEU_IP_INTERNO
   ```
   (usando o `username`/`credential` que saíram do curl acima, e o IP interno do passo 2). Se aparecer `success` e `Received relay addr: SEU_IP_PUBLICO:...`, está tudo certo. Um erro de autenticação ali normalmente é `TURN_SECRET` (.env) diferente de `static-auth-secret` (turnserver.conf).

## Arquitetura

```text
Browser A ─┐
           ├── WebRTC P2P (áudio/tela/áudio da tela)
Browser B ─┘
    │
    └── HTTP/WebSocket -> Nginx -> Node.js + Socket.IO (signaling/chat/presença)
                                        │
                                        └── Prisma -> PostgreSQL (contas de usuário)
```

O Nginx serve o build React e encaminha `/socket.io/` e `/api/` para o container `backend` usando o nome do serviço Docker.

## Contas de usuário

Cadastro (`/cadastro`) e login (`/entrar`) com endpoints reais no backend:

- `POST /api/auth/register` — cria a conta (senha com hash bcrypt) e devolve um token JWT.
- `POST /api/auth/login` — autentica e devolve um token JWT.
- `GET /api/auth/me` — valida o token (`Authorization: Bearer <token>`).

Os usuários ficam em um banco PostgreSQL (serviço `postgres` no Compose, dados persistidos no volume `postgres-data`), acessado pelo backend via Prisma. As migrações em `backend/prisma/migrations` rodam automaticamente (`prisma migrate deploy`) toda vez que o container do backend sobe. Configure `JWT_SECRET` e as credenciais do Postgres no `.env` com valores fortes antes de qualquer uso real — veja `.env.example`.

A entrada na sala em si não exige conta — continua funcionando por nome + link. Login é só para acessar o painel de links.

## Salas: geração pelo servidor e painel de links

Ao abrir o site sem um link de sala (`/`), aparecem duas opções: **gerar uma sala pública aleatória** ou **criar uma sala particular** (com senha). Em ambos os casos o identificador da sala (`slug`) é sempre gerado pelo servidor — não é mais possível digitar `/r/qualquer-nome` na URL e simplesmente entrar: o backend valida se aquela sala existe de verdade (`POST /api/rooms`, tabela `rooms` via Prisma) antes de aceitar a entrada, tanto na rota HTTP de checagem quanto no próprio handshake do Socket.IO (`join-room`). Um link para uma sala que nunca foi criada (ou que já expirou) mostra "Sala não encontrada".

- **Pública**: qualquer um com o link entra direto. Pode ser criada sem login.
- **Particular**: pede senha antes de entrar (`POST /api/rooms/:slug/verify`, retorna um token de acesso de curta duração usado no `join-room`). **Exige estar logado para criar** — o backend rejeita `POST /api/rooms` com senha se não vier um token de conta válido (`401`).

Quem está logado tem um painel (`/painel`) para ver, criar, excluir e trocar a senha dos links que criou — inclusive transformar um link público em particular (e vice-versa) depois de criado.

### Expiração

- Salas públicas criadas **sem login** (pelo botão na tela inicial) expiram sozinhas em **1 dia** e não têm dono, então não aparecem em nenhum painel.
- Salas criadas **com login** (públicas ou particulares, pelo painel ou pela tela inicial) **nunca expiram** — ficam disponíveis até o dono excluir.
- A expiração é verificada sob demanda (na checagem HTTP e no `join-room`); uma sala vencida é apagada do banco na primeira vez que alguém tenta acessá-la, sem precisar de um job de limpeza separado.

Essa diferença — sala rápida e efêmera vs. sala permanente e privada — é o motivo prático para criar conta.

> Não há limite de taxa (rate limit) na criação de salas anônimas ainda — é uma limitação conhecida, não implementada por enquanto.

## Compartilhamento de tela com áudio

Ao clicar em "Compartilhar minha tela", o navegador pede vídeo e áudio da fonte compartilhada (aba, janela ou tela inteira). Em navegadores baseados em Chromium, marque a opção "Compartilhar áudio" na janela de seleção para que o áudio da transmissão (ex.: um vídeo tocando na aba) também seja enviado aos outros participantes. O áudio da tela é transmitido junto com o vídeo, separado do áudio do microfone.

## Cliente desktop (Electron, Windows)

Em `electron/` há um app desktop que carrega o mesmo site publicado dentro de uma janela nativa. A vantagem sobre o navegador: um módulo nativo captura o áudio de um app específico do Windows (Discord, Spotify, um jogo) para compartilhar na chamada — algo que nenhum navegador consegue fazer sozinho, por limitação da própria plataforma web. Veja `electron/README.md` para detalhes de build e as pegadinhas do WASAPI envolvidas.

O instalador do Windows fica disponível pra qualquer visitante em `/download` (link também na tela inicial). O `.exe` gerado por `npm run build:win` dentro de `electron/` é copiado manualmente para `frontend/public/downloads/Pixia-Setup-<versão>.exe`; ao lançar uma versão nova, gere o instalador de novo, copie o arquivo com o nome atualizado e ajuste `VERSION`/`SIZE_MB`/`INSTALLER_URL` em `frontend/src/components/DownloadApp.jsx`. Por enquanto só Windows tem instalador; macOS e Linux usam o navegador.

## Deploy em pixiaart.com (atrás da Cloudflare)

O Nginx do frontend já está configurado com `server_name pixiaart.com`, publicado na porta `80` do host (`docker-compose.yml`). O TLS é terminado na Cloudflare — este container só serve HTTP e confia no `X-Forwarded-Proto` que ela define (com fallback para o próprio `$scheme` caso o cabeçalho não venha).

Passos para colocar no ar:

1. DNS de `pixiaart.com` na Cloudflare apontando (proxied, nuvem laranja) para o IP público do servidor onde este `docker-compose` roda.
2. O servidor precisa estar de fato acessível pela internet na porta 80 (e 443, se for usar SSL "Full"/"Full strict" — veja abaixo): firewall do SO liberado e, se for uma rede doméstica/NAT, a porta redirecionada no roteador para esta máquina. **Erro 522 da Cloudflare quase sempre significa que ela não conseguiu abrir conexão TCP com a origem** — o mapeamento de porta errado (resolvido) é uma causa comum, mas firewall/roteador bloqueando é outra.
3. Modo de criptografia SSL/TLS da Cloudflare (aba SSL/TLS no painel):
   - **Flexible**: Cloudflare fala HTTPS com o visitante e HTTP puro com a origem — funciona direto com a configuração atual (porta 80).
   - **Full** ou **Full (strict)**: a Cloudflare exige HTTPS também até a origem (porta 443 com certificado válido). Isso ainda não está configurado aqui — avise se for esse o modo, que adiciono TLS na origem (certificado da própria Cloudflare "Origin CA", por exemplo).
4. Defina `CORS_ORIGIN=https://pixiaart.com` no `.env` para que o Socket.IO só aceite conexões vindas desse domínio (já configurado).
5. Troque `JWT_SECRET` e as credenciais do Postgres no `.env` para valores fortes antes de ir ao ar.
6. `docker compose up --build -d`.

Se o `www.pixiaart.com` também precisar funcionar, adicione-o ao `server_name` do `nginx.conf` (hoje configurado só para o domínio raiz).

## Observações

- O chat é apenas em memória e não possui histórico.
- A entrada na sala ainda não exige conta; o identificador da sala é a barreira de entrada.
- A topologia atual é mesh/P2P, adequada para grupos pequenos.
- Para produção, use HTTPS.
- Para redes/NATs restritivos, configure TURN corretamente.

## Diagnóstico WebRTC local

Esta versão não força uma conexão WebRTC vazia ao entrar na sala. O peer só negocia quando há áudio ou compartilhamento de tela para enviar.

Se o ICE entrar em `disconnected`/`failed`, o frontend tenta `restartIce()` automaticamente até duas vezes.

No teste em `localhost`, uma falha persistente não é tratada automaticamente como "TURN obrigatório". Primeiro verifique firewall/VPN e teste em duas abas do mesmo navegador. TURN é necessário principalmente quando os peers estão em redes/NATs que não conseguem estabelecer uma rota direta.

No Console do navegador procure mensagens como:

- `[peer:...] ICE checking`
- `[peer:...] ICE connected`
- `[peer:...] conexão connected`
- `[peer:...] reiniciando ICE (1/2)`

