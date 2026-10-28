// результат → поменять ширину → должно появиться «размеры изменились»
document.querySelector('#demoBtn').click();
await new Promise(r => setTimeout(r, 800));
document.querySelector('#go').click();
for (let i = 0; i < 600; i++) {
  if (!document.querySelector('#result').hidden) break;
  await new Promise(r => setTimeout(r, 250));
}
const before = { staleHidden: document.querySelector('#stale').hidden };

const w = document.querySelector('#w');
w.value = '260';
w.dispatchEvent(new Event('input', { bubbles: true }));
await new Promise(r => setTimeout(r, 300));
const after = {
  staleHidden: document.querySelector('#stale').hidden,
  staleOn: document.querySelector('#result').classList.contains('stale-on'),
};

// вернуть прежнее значение — пометка должна исчезнуть
w.value = '200';
w.dispatchEvent(new Event('input', { bubbles: true }));
await new Promise(r => setTimeout(r, 300));
const back = {
  staleHidden: document.querySelector('#stale').hidden,
  staleOn: document.querySelector('#result').classList.contains('stale-on'),
};

// сохранение настроек: меняем глубину и перезагружаем страницу
const d = document.querySelector('#d');
d.value = '222';
d.dispatchEvent(new Event('change', { bubbles: true }));
localStorage.setItem('__probe', '1');
return { before, after, back, saved: localStorage.getItem('diobox.v1') };
