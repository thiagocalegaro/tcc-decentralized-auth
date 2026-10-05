import { renderIntegrationGuides } from './integration-guides.js';
const $ = selector => document.querySelector(selector);
const form = $('#application-form');
let state = { me: null, applications: [], selected: null, editing: false };
function status(message = '', error = false) { $('#status').textContent = message; $('#status').classList.toggle('error', error); }
async function api(path, method = 'GET', data) {
  const response = await fetch(`/portal/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(state.me ? { 'X-CSRF-Token': state.me.csrf } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
  const result = await response.json();
  if (!response.ok) { if (response.status === 401) showWelcome(); throw new Error(result.error || 'Não foi possível concluir.'); }
  return result;
}
function showWelcome() { state.me = null; $('#welcome').hidden = false; $('#dashboard').hidden = true; $('#logout').hidden = true; }
const selected = () => state.applications.find(app => app.id === state.selected);
function renderList() {
  $('#app-count').textContent = `${state.applications.length} de 25 aplicações`;
  $('#app-list').replaceChildren();
  if (!state.applications.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'Nenhuma aplicação cadastrada. Comece pelo formulário ao lado.'; $('#app-list').append(empty); }
  for (const app of state.applications) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'app-item'; button.setAttribute('aria-current', String(app.id === state.selected));
    const name = document.createElement('strong'); name.textContent = app.name;
    const origin = document.createElement('span'); origin.textContent = `${app.enabled ? '' : 'Desativada · '}${app.appUrl}`;
    button.append(name, origin); button.addEventListener('click', () => detail(app.id)); $('#app-list').append(button);
  }
}
function edit(existing = false) {
  state.editing = existing; if (!existing) state.selected = null;
  form.reset(); const app = selected();
  if (existing && app) { form.elements.name.value = app.name; form.elements.appUrl.value = app.appUrl; form.elements.callbackPath.value = new URL(app.redirectUri).pathname; form.elements.logoutPath.value = new URL(app.logoutUri).pathname; }
  $('#form-title').textContent = existing ? 'Configurações da aplicação' : 'Conecte seu site';
  $('#form-kicker').textContent = existing ? 'Edição' : 'Cadastro'; $('#save-app').textContent = existing ? 'Salvar alterações' : 'Criar aplicação';
  $('#cancel-edit').hidden = !existing; $('#editor').hidden = false; $('#app-detail').hidden = true; renderList();
}
function detail(id) {
  state.selected = id; const app = selected(); if (!app) return edit();
  $('#editor').hidden = true; $('#app-detail').hidden = false; renderList();
  $('#detail-title').textContent = app.name; $('#app-state').textContent = app.enabled ? 'Aplicação ativa' : 'Aplicação desativada';
  $('#client-id').textContent = app.id; $('#redirect-uri').textContent = app.redirectUri; $('#logout-uri').textContent = app.logoutUri;
  renderIntegrationGuides(app, state.me.issuer);
  $('#toggle-app').textContent = app.enabled ? 'Desativar aplicação' : 'Reativar aplicação';
  const base = new URL(app.redirectUri).pathname.replace(/\/callback$/, '');
  const logoutPath = new URL(app.logoutUri).pathname;
  $('#configuration').textContent = `ANCORA_ISSUER=${state.me.issuer}\nANCORA_CLIENT_ID=${app.id}\nANCORA_CLIENT_SECRET=COLOQUE_O_SEGREDO_AQUI\nAPP_URL=${app.appUrl}`;
  $('#integration').textContent = `import { createAncoraClient } from '@ancora/node';\n\nconst auth = await createAncoraClient({\n  issuer: process.env.ANCORA_ISSUER,\n  clientId: process.env.ANCORA_CLIENT_ID,\n  clientSecret: process.env.ANCORA_CLIENT_SECRET,\n  appUrl: process.env.APP_URL,\n  database: './private/sessions.sqlite',\n  allowInsecureLocalhost: ${app.appUrl.startsWith('http:') || state.me.issuer.startsWith('http:')},\n  authBasePath: ${JSON.stringify(base)},\n  afterLogin: '/minha-conta',\n  afterLogout: ${JSON.stringify(logoutPath)},\n  onLogin: async identity => {\n    const user = await findOrCreateUser({\n      issuer: identity.issuer,\n      sub: identity.sub,\n      address: identity.address,\n      chainId: identity.chainId,\n    });\n    return { userId: user.id };\n  },\n});`;
  $('#login-link').textContent = `<a href="${base}/login">Entrar com Âncora</a>`;
}
async function refresh(id = state.selected) { state.applications = (await api('/applications')).applications; id ? detail(id) : edit(); }
function showSecret(value) { $('#new-secret').value = value; $('#secret-status').textContent = ''; $('#secret-dialog').showModal(); }
$('#secret-dialog').addEventListener('close', () => { $('#new-secret').value = ''; $('#secret-status').textContent = ''; });
$('#close-secret').addEventListener('click', () => $('#secret-dialog').close());
async function copy(value, target) { try { await navigator.clipboard.writeText(value); target('Copiado.'); } catch { target('Não foi possível copiar. Selecione o texto e copie manualmente.'); } }
$('#copy-secret').addEventListener('click', () => copy($('#new-secret').value, value => { $('#secret-status').textContent = value; }));
$('#copy-config').addEventListener('click', () => copy($('#configuration').textContent, value => status(value)));
$('#new-app').addEventListener('click', () => { edit(); form.elements.name.focus(); });
$('#edit-app').addEventListener('click', () => edit(true));
$('#cancel-edit').addEventListener('click', () => detail(state.selected));
form.addEventListener('submit', async event => {
  event.preventDefault(); $('#save-app').disabled = true; status();
  try {
    const input = Object.fromEntries(new FormData(form));
    const result = await api(state.editing ? `/applications/${state.selected}` : '/applications', state.editing ? 'PATCH' : 'POST', input);
    await refresh(result.application.id); status('Aplicação salva. A configuração já está em vigor.');
    if (result.clientSecret) showSecret(result.clientSecret);
  } catch (error) { status(error.message, true); } finally { $('#save-app').disabled = false; }
});
function confirm(title, message) {
  return new Promise(resolve => { const dialog = $('#confirm-dialog'); $('#confirm-title').textContent = title; $('#confirm-message').textContent = message;
    dialog.returnValue = 'cancel'; dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }); dialog.showModal();
  });
}
async function manage(action, button) {
  const app = selected(); if (!app) return;
  button.disabled = true;
  try {
    const approved = await confirm(action === 'rotate' ? 'Trocar o segredo?' : action === 'disable' ? 'Desativar esta aplicação?' : 'Reativar esta aplicação?', action === 'rotate' ? 'O segredo atual deixará de funcionar. Atualize o backend do seu site com o novo valor.' : action === 'disable' ? 'Novos logins serão bloqueados. As sessões locais já abertas no site continuarão válidas.' : 'Esta aplicação voltará a aceitar novos logins.');
    if (!approved) return;
    const result = await api(`/applications/${app.id}/${action}`, 'POST', {}); await refresh(app.id);
    status('Alteração aplicada.'); if (result.clientSecret) showSecret(result.clientSecret);
  } catch (error) { status(error.message, true); } finally { button.disabled = false; }
}
$('#rotate-secret').addEventListener('click', event => manage('rotate', event.currentTarget));
$('#toggle-app').addEventListener('click', event => manage(selected()?.enabled ? 'disable' : 'enable', event.currentTarget));
try {
  const response = await fetch('/portal/api/me');
  if (response.status === 401) { showWelcome(); status(); }
  else { if (!response.ok) throw new Error('Portal indisponível. Atualize a página para tentar novamente.');
    state.me = await response.json(); $('#owner').textContent = state.me.user.address; $('#dashboard').hidden = false; $('#logout').hidden = false;
    await refresh(); if (state.applications.length) detail(state.applications[0].id); status();
  }
} catch (error) { status(error.message, true); }
