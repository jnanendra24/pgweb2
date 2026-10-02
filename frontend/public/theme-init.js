try {
  var t = localStorage.getItem('pgweb2.theme');
  if (t === 'dark' || ((t !== 'light') && matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.classList.add('dark');
} catch (e) {}
