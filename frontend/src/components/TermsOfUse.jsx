import AuthLayout from "./AuthLayout.jsx";

export default function TermsOfUse({ onNavigate }) {
  return (
    <AuthLayout>
      <div className="join-card wide legal-card">
        <div className="brand-mark small">
          <img src="/pixia.png" alt="Pixia" />
        </div>
        <h1>Termos de Uso</h1>
        <p className="muted">Última atualização: agosto de 2026.</p>

        <div className="legal-content">
          <p>
            Ao usar o Pixia, você concorda com estes termos. Se não concordar, não use o serviço.
          </p>

          <h2>O que é o Pixia</h2>
          <p>
            Pixia é uma ferramenta de videoconferência e compartilhamento de tela. Qualquer pessoa
            pode gerar uma sala pública sem se cadastrar. Criar uma sala particular ou manter um
            painel de links exige uma conta.
          </p>

          <h2>Sua conta</h2>
          <p>
            Você é responsável por manter sua senha em sigilo e por tudo que acontecer usando sua
            conta. Você pode excluir suas salas a qualquer momento pelo painel de links.
          </p>

          <h2>Uso aceitável</h2>
          <p>
            Não use o Pixia para assediar outras pessoas, distribuir conteúdo ilegal ou tentar
            comprometer a segurança do serviço. Podemos remover salas ou contas que violem isso.
          </p>

          <h2>Disponibilidade</h2>
          <p>
            O Pixia é oferecido "como está", sem garantia de disponibilidade contínua. Salas
            públicas geradas sem login expiram automaticamente em 1 dia.
          </p>

          <h2>Contato</h2>
          <p>Dúvidas sobre estes termos podem ser enviadas para o suporte do Pixia.</p>
        </div>

        <button className="primary-button" type="button" onClick={() => onNavigate("/")}>
          Voltar
        </button>
      </div>
    </AuthLayout>
  );
}
