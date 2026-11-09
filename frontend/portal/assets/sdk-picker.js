const options = [
  { id: 'node', name: 'Node.js', archive: 'ancora-node-0.1.0.tgz',
    install: 'npm install ./ancora-node-0.1.0.tgz',
    code: "import { createAncoraClient } from '@ancora/node';\n\nconst auth = await createAncoraClient(options);\n// Encaminhe as rotas de autenticação para auth.handle(req, res).",
    description: 'Biblioteca de servidor com sessão local em SQLite.' },
  { id: 'python', name: 'Python / Flask', archive: 'ancora-flask-0.1.0.tar.gz',
    install: 'mkdir ancora-flask-sdk\ntar -xzf ancora-flask-0.1.0.tar.gz -C ancora-flask-sdk\npython -m pip install ./ancora-flask-sdk',
    code: 'from ancora_flask import AncoraClient\n\nclient = AncoraClient(app, **config)\n# Na rota de login: return client.login()\n# No callback: identity = client.callback()',
    description: 'Cliente Flask com Authlib. Sua aplicação decide como armazenar a sessão.' },
  { id: 'php', name: 'PHP', archive: 'ancora-php-0.1.0.tar.gz',
    install: 'mkdir sdk-downloads\nmkdir sdk-downloads/ancora-php\ntar -xzf ancora-php-0.1.0.tar.gz -C sdk-downloads/ancora-php\ncomposer config repositories.ancora path ./sdk-downloads/ancora-php\ncomposer require ancora/oidc:0.1.0',
    code: "<?php\nuse Ancora\\Client;\n\n$client = new Client($issuer, $clientId, $secret, $redirectUri);\n// Login: $client->login();\n// Callback: $identity = $client->callback();",
    description: 'Cliente Composer. Inicie a sessão PHP antes de usar as rotas de autenticação.' },
  { id: 'java', name: 'Java / Spring Boot', archive: 'ancora-spring-0.1.0.tar.gz',
    install: 'mkdir ancora-spring-sdk\ntar -xzf ancora-spring-0.1.0.tar.gz -C ancora-spring-sdk\nmvn -f ancora-spring-sdk/pom.xml install\n# Adicione br.ancora:ancora-spring:0.1.0 ao POM do seu site.',
    code: 'import br.ancora.sdk.AncoraLogin;\n\n// Dentro da SecurityFilterChain do seu site:\nAncoraLogin.configure(http, clients, redirectUri, "/minha-conta");',
    description: 'Adaptador para Spring Security 6.5. Configure o registro OIDC no seu aplicativo.' },
];

function add(parent, tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  parent.append(node);
  return node;
}

export function renderSdkPicker() {
  if (document.querySelector('#sdk-picker')) return;
  const section = document.createElement('section');
  section.id = 'sdk-picker';
  section.setAttribute('aria-label', 'SDKs de integração');
  document.querySelector('#app-detail .guide').before(section);
  add(section, 'h3', 'SDKs de integração');
  add(section, 'p', 'Escolha a tecnologia do seu servidor. Os pacotes são distribuídos pelo portal.', 'description');
  const tabs = add(section, 'div', '', 'sdk-tabs');
  tabs.setAttribute('role', 'group');
  tabs.setAttribute('aria-label', 'Linguagem do SDK');
  const panel = add(section, 'div', '', 'sdk-panel');
  const intro = add(panel, 'div', '', 'sdk-panel-intro');
  const summary = add(intro, 'p', '', 'description');
  const download = add(intro, 'a', 'Baixar SDK', 'secondary');
  const feedback = add(panel, 'p', '', 'sdk-feedback');
  feedback.setAttribute('role', 'status');
  const blocks = ['Instalação', 'Uso no backend'].map(title => {
    const line = add(panel, 'div', '', 'sdk-code-label');
    add(line, 'span', title);
    const button = add(line, 'button', 'Copiar', 'secondary');
    button.type = 'button';
    button.setAttribute('aria-label', 'Copiar ' + title.toLowerCase());
    const pre = add(panel, 'pre');
    pre.tabIndex = 0;
    const code = add(pre, 'code');
    button.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(code.textContent); feedback.textContent = 'Código copiado.'; }
      catch { feedback.textContent = 'Selecione o trecho para copiar.'; }
    });
    return code;
  });
  const buttons = options.map(option => {
    const button = add(tabs, 'button', option.name, 'sdk-tab');
    button.type = 'button';
    button.addEventListener('click', () => select(option));
    return button;
  });
  function select(option) {
    buttons.forEach((button, index) => button.setAttribute('aria-pressed', String(options[index] === option)));
    summary.textContent = option.description;
    download.href = '/portal/api/sdk/' + option.id;
    download.download = option.archive;
    blocks[0].textContent = option.install;
    blocks[1].textContent = option.code;
    feedback.textContent = '';
  }
  select(options[0]);
}
