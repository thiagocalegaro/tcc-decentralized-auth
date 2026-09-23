// Only guide progress is stored locally. This page does not connect to wallets or APIs.
const guideChecks = [...document.querySelectorAll('[data-guide-check]')];
const progressKey = 'ancora-docs-integration-v1';
const guideStatus = document.querySelector('#guide-status');
function updateProgress() {
  const done = guideChecks.filter(input => input.checked).length;
  document.querySelector('#guide-progress').value = done;
  document.querySelector('#guide-count').textContent = `${done} de ${guideChecks.length} etapas conferidas`;
}
try {
  const saved = JSON.parse(localStorage.getItem(progressKey) ?? '[]');
  if (Array.isArray(saved)) guideChecks.forEach(input => { input.checked = saved.includes(input.id); });
} catch { /* The guide also works with storage disabled or when opened as a local file. */ }
guideChecks.forEach(input => input.addEventListener('change', () => {
  updateProgress();
  try { localStorage.setItem(progressKey, JSON.stringify(guideChecks.filter(x => x.checked).map(x => x.id))); } catch { /* Optional persistence. */ }
}));
document.querySelector('#guide-reset').addEventListener('click', () => {
  guideChecks.forEach(input => { input.checked = false; });
  try { localStorage.removeItem(progressKey); } catch { /* Optional persistence. */ }
  updateProgress();
  guideStatus.textContent = 'Marcações do guia limpas.';
});
updateProgress();

const setupCommands = {
  windows: "git clone https://github.com/thiagocalegaro/tcc-decentralized-auth.git\nSet-Location -LiteralPath 'tcc-decentralized-auth'\nnpm ci\nnpm run setup\nnpm run dev",
  unix: "git clone https://github.com/thiagocalegaro/tcc-decentralized-auth.git\ncd tcc-decentralized-auth\nnpm ci\nnpm run setup\nnpm run dev",
};
document.querySelectorAll('[data-command-os]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-command-os]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  document.querySelector('#setup-code').textContent = setupCommands[button.dataset.commandOs];
  document.querySelector('#setup-caption').textContent = button.dataset.commandOs === 'windows' ? 'PowerShell · pasta nova' : 'Terminal · pasta nova';
}));

document.querySelectorAll('[data-copy-target]').forEach(button => button.addEventListener('click', async () => {
  const source = document.getElementById(button.dataset.copyTarget);
  const value = source.textContent;
  let copied = false;
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(value); copied = true; }
  } catch { /* Local files may need the selection-based fallback. */ }
  if (!copied) {
    const field = document.createElement('textarea');
    field.value = value;
    field.className = 'sr-only';
    document.body.append(field);
    field.select();
    try { copied = document.execCommand('copy'); } catch { /* Leave manual selection available. */ }
    field.remove();
    button.focus({ preventScroll: true });
  }
  if (!copied) {
    const range = document.createRange();
    range.selectNodeContents(source);
    const selection = window.getSelection();
    selection.removeAllRanges(); selection.addRange(range);
  }
  button.textContent = copied ? 'Copiado' : 'Use Ctrl+C';
  guideStatus.textContent = copied ? 'Exemplo copiado.' : 'Selecionei o exemplo. Use Ctrl+C ou o comando Copiar do navegador.';
  setTimeout(() => { button.textContent = 'Copiar'; }, 1800);
}));
