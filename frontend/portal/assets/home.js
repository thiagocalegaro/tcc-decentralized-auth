fetch('/portal-public/config').then(response => response.json()).then(({ demos }) => {
  for (const demo of demos) {
    const link = document.createElement('a'); link.href = demo.url; link.textContent = `Testar ${demo.name} →`;
    document.querySelector('#demos').append(link);
  }
}).catch(() => { document.querySelector('#demos').textContent = 'Demonstrações indisponíveis neste momento.'; });
