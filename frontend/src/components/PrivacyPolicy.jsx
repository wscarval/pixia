import AuthLayout from "./AuthLayout.jsx";

export default function PrivacyPolicy({ onNavigate }) {
  return (
    <AuthLayout>
      <div className="join-card wide legal-card">
        <div className="brand-mark small">
          <img src="/pixia.png" alt="Pixia" />
        </div>
        <h1>Política de Privacidade</h1>
        <p className="muted">Última atualização: agosto de 2026.</p>

        <div className="legal-content">
          <p>Esta política explica quais dados o Pixia coleta e para que usa.</p>

          <h2>O que coletamos</h2>
          <p>
            Se você cria uma conta: nome, email e senha (guardada com hash, nunca em texto puro).
            Se você cria uma sala: um identificador aleatório e, opcionalmente, uma senha de
            acesso (também com hash). Mensagens de chat só são guardadas em salas particulares, para
            não se perderem se a página for recarregada.
          </p>

          <h2>Áudio e vídeo</h2>
          <p>
            Chamadas de voz, vídeo e compartilhamento de tela acontecem direto entre os
            participantes (conexão ponto a ponto). O servidor do Pixia intermedia só a troca
            inicial de conexão, sem gravar ou armazenar o conteúdo da chamada.
          </p>

          <h2>Armazenamento local</h2>
          <p>
            Guardamos no seu navegador (localStorage) preferências simples como microfone
            escolhido, volume de cada participante e a sessão da sala atual, para você não
            perder essas configurações ao recarregar a página. Nada disso sai do seu navegador.
          </p>

          <h2>Compartilhamento com terceiros</h2>
          <p>Não vendemos nem compartilhamos seus dados com terceiros para fins de publicidade.</p>

          <h2>Exclusão de dados</h2>
          <p>
            Você pode excluir suas salas a qualquer momento pelo painel de links. Para excluir sua
            conta ou seus dados por completo, entre em contato com o suporte do Pixia.
          </p>
        </div>

        <button className="primary-button" type="button" onClick={() => onNavigate("/")}>
          Voltar
        </button>
      </div>
    </AuthLayout>
  );
}
