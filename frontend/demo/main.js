const byId = id => document.getElementById(id);
try {
  const response = await fetch('/api/config');
  if (!response.ok) throw new Error('Não foi possível carregar a aplicação.');
  const config = await response.json();
  document.body.classList.toggle('observatory', config.theme === 'observatory');
  document.querySelectorAll('[data-name]').forEach(node => { node.textContent = config.name; });
  document.title = `${location.pathname === '/arearestrita' ? 'Área restrita' : 'Entrar'} · ${config.name}`;
  const peer = byId('peer');
  if (peer) { peer.href = config.peerUrl; peer.hidden = false; }
  if (byId('issuer')) byId('issuer').textContent = config.issuer;
  if (byId('headline')) byId('headline').textContent = config.theme === 'library' ? 'Conhecimento com acesso reservado.' : 'Um novo ponto de observação.';
  if (byId('site-label')) byId('site-label').textContent = `${config.name} · demonstração`;
  if (location.pathname === '/arearestrita') {
    const result = await fetch('/api/private');
    if (result.status === 401) { location.replace('/'); }
    else if (!result.ok) throw new Error('Não foi possível carregar a área restrita.');
    else {
      const data = await result.json();
      byId('address').textContent = data.user.address;
      byId('subject').textContent = data.user.sub;
      byId('local-user').textContent = data.user.userId ?? 'Entre novamente para criar o vínculo local.';
      byId('private-message').textContent = data.message;
    }
  } else {
    if (new URLSearchParams(location.search).get('login') === 'cancelled') byId('status').textContent = 'Você cancelou o login. Nenhuma sessão foi criada.';
    const response = await fetch('/api/session');
    if (!response.ok) throw new Error('Não foi possível consultar a sessão.');
    const session = await response.json();
    byId('resume').hidden = !session.authenticated;
  }
} catch (error) { byId('status').textContent = error.message; byId('status').classList.add('error'); }
