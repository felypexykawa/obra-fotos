// Testes da câmera do app (v7.9) — Chromium real com câmera e microfone FALSOS (nenhuma câmera de verdade é usada).
// Cobre: tela de gravação, barra de tempo, troca automática de parte sem parar de gravar, partes que já nascem no
// tamanho final (sem fila de compactação), espaço do celular acabando, sem câmera / permissão negada (cai na câmera do
// celular), sair do app no meio, cancelar, gravação curta demais, refazer, e a galeria seguindo igual.
// NÃO testa iPhone nem câmera real: isso só se confere num celular de verdade.
//
// Uso (precisa de Node + Playwright instalados, e do app servido por um servidor local em http://127.0.0.1:<porta>):
//   python -m http.server 8765 --bind 127.0.0.1        (dentro da pasta do app, num terminal)
//   node testes/v79_camera_tests.js 8765               (todos)      |  node testes/v79_camera_tests.js 8765 1,2   (só T1 e T2)
// Capturas de tela vão para a pasta temporária (variável SHOTS muda o destino).
const { chromium } = require('playwright');
const PORTA = process.argv[2] || '8765';
const FILTRO = process.argv[3] || '';
const URL = 'http://127.0.0.1:' + PORTA + '/index.html';
const SHOTS = process.env.SHOTS || require('os').tmpdir();
let falhas = 0, passou = 0;
const ok = (nome, cond, extra) => { if (cond) { passou++; console.log('PASS ' + nome + (extra ? '  [' + extra + ']' : '')); } else { falhas++; console.log('FAIL ' + nome + (extra ? '  [' + extra + ']' : '')); } };
const dorme = (ms) => new Promise(r => setTimeout(r, ms));

async function abrir(browser, opcoes) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, opcoes && opcoes.ctx));
  if (opcoes && opcoes.initScript) await ctx.addInitScript(opcoes.initScript);
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', e => erros.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') erros.push('console.error: ' + m.text()); });
  await page.goto(URL);
  await page.waitForFunction(() => window.__obraDebug && document.getElementById('listaAmbientes'), null, { timeout: 15000 });
  await dorme(500);
  // passa por modais de primeira abertura (modo, avisos)
  for (let i = 0; i < 6; i++) {
    const modo = await page.$('#modalModo.aberto');
    if (modo) { await page.click('[data-modo-inicial="construcao"]'); await dorme(200); continue; }
    const gen = await page.$('#modalGenerico.aberto');
    if (gen) { await page.click('#genConfirmar'); await dorme(200); continue; }
    break;
  }
  return { ctx, page, erros };
}

async function prepararPonto(page) {
  // abre o primeiro ambiente e toca no "+" do primeiro ponto
  await page.evaluate(() => { const h = document.querySelector('.ambiente-header'); h && h.click(); });
  await dorme(300);
  const add = await page.$('[data-add]');
  if (!add) throw new Error('sem botão de adicionar no ponto');
  await add.scrollIntoViewIfNeeded();
  const id = await add.getAttribute('data-add');
  await add.click();
  await page.waitForSelector('#modalCaptura.aberto');
  return id;
}

const fotosDoPonto = (page, id) => page.evaluate((id) => {
  const [amb, par] = id.split('|');
  const e = window.__obraDebug.estado();
  const acha = [];
  const varre = (c) => { for (const a of (c.andares || [])) for (const am of (a.ambientes || [])) if (am.id === amb) for (const p of am.paredes) if (p.id === par) acha.push(...p.fotos); };
  for (const emp of e.empreendimentos) { for (const u of emp.unidades || []) varre(u); if (emp.areasComuns) varre(emp.areasComuns); if (emp.equipamentos) varre(emp.equipamentos); }
  return acha.map(f => Object.assign({}, f));
}, id);

// duração real de um blob (webm do MediaRecorder não traz duração: o truque do seek dá)
const duracaoDe = (page, fotoId) => page.evaluate(async (fotoId) => {
  const blob = await window.__obraDebug.idbGet(fotoId);
  if (!blob) return { erro: 'sem blob' };
  const v = document.createElement('video'); v.muted = true; v.preload = 'auto';
  const url = URL.createObjectURL(blob); v.src = url;
  await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('video não abre')); setTimeout(() => rej(new Error('timeout metadata')), 8000); });
  let d = v.duration;
  if (!isFinite(d)) { v.currentTime = 1e101; await new Promise(res => { v.ontimeupdate = () => { v.ontimeupdate = null; res(); }; setTimeout(res, 4000); }); d = v.duration; }
  const r = { size: blob.size, tipo: blob.type, dur: d, w: v.videoWidth, h: v.videoHeight };
  URL.revokeObjectURL(url);
  return r;
}, fotoId);

async function testePartes(browser) {
  console.log('--- T1: gravação em partes (3 s) com troca automática');
  const { ctx, page, erros } = await abrir(browser, { ctx: { permissions: ['camera', 'microphone'] } });
  await page.evaluate(() => window.__obraDebug.setParteMs(3000));
  const id = await prepararPonto(page);
  const antes = (await fotosDoPonto(page, id)).length;
  await page.click('#capVideo');
  await page.waitForFunction(() => document.getElementById('gravEstado').textContent === 'PRONTO', null, { timeout: 15000 });
  ok('T1 abre a tela de gravação pronta', await page.evaluate(() => document.getElementById('telaGravacao').classList.contains('aberta')));
  ok('T1 faixas de cima somem (body.gravando)', await page.evaluate(() => document.body.classList.contains('gravando')));
  ok('T1 botão de gravar habilitado', !(await page.$eval('#gravBotao', b => b.disabled)));
  ok('T1 formato escolhido', true, await page.evaluate(() => window.__obraDebug.gravacao().mime || '(padrão do navegador)'));
  await page.screenshot({ path: SHOTS + '/shot_pronto.png' });
  const t0 = Date.now();
  await page.click('#gravBotao');
  await page.waitForFunction(() => /GRAVANDO/.test(document.getElementById('gravEstado').textContent), null, { timeout: 8000 });
  await dorme(1700);
  const barra1 = await page.evaluate(() => ({ tempo: document.getElementById('gravTempo').textContent, parte: document.getElementById('gravParte').textContent, falta: document.getElementById('gravFalta').textContent, esp: document.getElementById('gravEspaco').textContent, w: document.getElementById('gravBarraPreench').style.width, cls: document.getElementById('gravBarra').className }));
  console.log('   barra @1,7s:', JSON.stringify(barra1));
  ok('T1 tempo corre', /^00:0[1-3]$/.test(barra1.tempo), barra1.tempo);
  ok('T1 parte 1', barra1.parte === 'Parte 1', barra1.parte);
  ok('T1 texto de quanto falta', /^Faltam 00:0[0-2] para fechar esta parte/.test(barra1.falta), barra1.falta);
  ok('T1 barra preenchendo', parseInt(barra1.w) > 20 && parseInt(barra1.w) < 100, barra1.w);
  ok('T1 fim de parte não pinta a barra de vermelho/amarelo', barra1.cls === 'grav-barra', barra1.cls);
  await page.waitForFunction(() => document.getElementById('gravParte').textContent === 'Parte 3', null, { timeout: 15000 });
  await dorme(2200);
  const barra2 = await page.evaluate(() => ({ tempo: document.getElementById('gravTempo').textContent, parte: document.getElementById('gravParte').textContent, esp: document.getElementById('gravEspaco').textContent }));
  console.log('   barra @7,3s:', JSON.stringify(barra2));
  ok('T1 virou para a parte 3 sozinha', barra2.parte === 'Parte 3', barra2.parte);
  await page.screenshot({ path: SHOTS + '/shot_gravando.png' });
  console.log('   registro antes de parar:', JSON.stringify(await page.evaluate(() => window.__obraDebug.gravacao())));
  await page.click('#gravBotao');
  await dorme(150);
  console.log('   registro ao parar:', JSON.stringify(await page.evaluate(() => window.__obraDebug.gravacao())));
  await page.waitForFunction(() => !document.getElementById('telaGravacao').classList.contains('aberta'), null, { timeout: 20000 });
  const total = (Date.now() - t0) / 1000;
  await dorme(500);
  ok('T1 tela fecha ao parar', true);
  ok('T1 body sem a marca de gravando', !(await page.evaluate(() => document.body.classList.contains('gravando'))));
  const fotos = (await fotosDoPonto(page, id)).slice(antes);
  console.log('   fotos novas:', JSON.stringify(fotos.map(f => ({ tipo: f.tipo, comp: f.comprimido, compactando: f.compactando, tam: f.tamanho }))));
  ok('T1 três partes entraram no ponto', fotos.length === 3, String(fotos.length));
  ok('T1 todas são vídeo', fotos.every(f => f.tipo === 'video'));
  ok('T1 já nascem no tamanho final (comprimido, sem fila)', fotos.every(f => f.comprimido === true && !f.compactando));
  let soma = 0;
  for (const f of fotos) {
    const d = await duracaoDe(page, f.id);
    console.log('   parte:', JSON.stringify(d));
    ok('T1 arquivo da parte abre e tem imagem', !d.erro && d.size > 5000 && d.w > 0 && d.h > 0, JSON.stringify(d));
    if (isFinite(d.dur)) soma += d.dur;
  }
  console.log('   soma das partes ' + soma.toFixed(2) + ' s; tempo de parede ' + total.toFixed(2) + ' s (inclui abrir/fechar)');
  ok('T1 nenhum pedaço sumiu entre as partes (soma ≥ tempo gravado, com emenda sobreposta de <1 s por troca)', soma >= total - 1.2 && soma < total + 2.5, 'soma ' + soma.toFixed(2) + ' s, parede ' + total.toFixed(2) + ' s');
  const copia = await page.evaluate(() => localStorage.getItem('obraFotosCopiaCelular'));
  ok('T1 sem erros de página', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

async function testeEspaco(browser) {
  console.log('--- T2: espaço do celular acabando para a gravação sozinha');
  const init = () => {
    let n = 0;
    const real = navigator.storage && navigator.storage.estimate ? navigator.storage.estimate.bind(navigator.storage) : null;
    navigator.storage.estimate = async () => {
      n++;
      if (n <= 2) return { quota: 2e9, usage: 1e8 };           // abrir e começar: sobra muito
      return { quota: 1e9, usage: 1e9 - 150e6 - 183000 * 6 };    // depois: cabem ~6 s além da reserva
    };
  };
  const { ctx, page, erros } = await abrir(browser, { ctx: { permissions: ['camera', 'microphone'] }, initScript: init });
  const id = await prepararPonto(page);
  const antes = (await fotosDoPonto(page, id)).length;
  await page.click('#capVideo');
  await page.waitForFunction(() => document.getElementById('gravEstado').textContent === 'PRONTO', null, { timeout: 15000 });
  await page.click('#gravBotao');
  await page.waitForFunction(() => /GRAVANDO/.test(document.getElementById('gravEstado').textContent), null, { timeout: 8000 });
  let viuEspaco = false, texto = '';
  const limite = Date.now() + 30000;
  while (Date.now() < limite) {
    const s = await page.evaluate(() => ({ aberta: document.getElementById('telaGravacao').classList.contains('aberta'), cls: document.getElementById('gravBarra').className, falta: document.getElementById('gravFalta').textContent }));
    if (s.cls.includes('espaco')) { viuEspaco = true; texto = s.falta; }
    if (!s.aberta) break;
    await dorme(300);
  }
  ok('T2 a barra passou a mostrar o limite do espaço', viuEspaco, texto);
  ok('T2 texto "Só cabe mais"', /^Só cabe mais \d\d:\d\d no celular/.test(texto), texto);
  await page.waitForSelector('#modalGenerico.aberto', { timeout: 15000 });
  const titulo = await page.textContent('#genTitulo');
  ok('T2 aviso de que parou por falta de espaço', /sem espaço/.test(titulo), titulo);
  await page.click('#genConfirmar');
  const fotos = (await fotosDoPonto(page, id)).slice(antes);
  ok('T2 o que foi gravado ficou salvo', fotos.length >= 1 && fotos[0].tipo === 'video', String(fotos.length));
  ok('T2 sem erros de página', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

async function testeSemCamera(browser) {
  console.log('--- T3: sem câmera nenhuma → vai direto para a câmera do celular (seletor de arquivo)');
  const { ctx, page, erros } = await abrir(browser, { ctx: { permissions: ['camera', 'microphone'] } });
  await prepararPonto(page);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 8000 }).catch(e => null), page.click('#capVideo')]);
  ok('T3 abriu o seletor do input da câmera do celular', !!chooser);
  if (chooser) ok('T3 era o campo de vídeo (capture)', await chooser.element().evaluate(el => el.id === 'inputVideoCam'));
  await dorme(300);
  ok('T3 tela de gravação fechou', !(await page.evaluate(() => document.getElementById('telaGravacao').classList.contains('aberta'))));
  await ctx.close();
}

async function testePermissaoNegada(browser) {
  console.log('--- T4: permissão negada → mensagem + botão "Usar a câmera do celular"');
  const { ctx, page, erros } = await abrir(browser, { initScript: () => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')); } });
  await prepararPonto(page);
  await page.click('#capVideo');
  await page.waitForFunction(() => document.getElementById('gravEstado').textContent === 'SEM CÂMERA', null, { timeout: 15000 });
  const msg = await page.textContent('#gravMsg');
  console.log('   mensagem:', msg.replace(/\n/g, ' / '));
  ok('T4 explica como liberar', /não deixou o app usar a câmera/.test(msg));
  ok('T4 botão da câmera do celular aparece', !(await page.$eval('#gravNativa', b => b.hidden)));
  ok('T4 botão de gravar desabilitado', await page.$eval('#gravBotao', b => b.disabled));
  await page.screenshot({ path: SHOTS + '/shot_negada.png' });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 8000 }).catch(e => null), page.click('#gravNativa')]);
  ok('T4 o botão abre o seletor da câmera do celular', !!chooser);
  ok('T4 tela fechou', !(await page.evaluate(() => document.getElementById('telaGravacao').classList.contains('aberta'))));
  // o arquivo escolhido ainda cai no ponto (pendente restaurado)
  await ctx.close();
}

async function testeSaiuDoApp(browser) {
  console.log('--- T5: sair do app no meio da gravação fecha e salva a parte');
  const { ctx, page, erros } = await abrir(browser, { ctx: { permissions: ['camera', 'microphone'] } });
  const id = await prepararPonto(page);
  const antes = (await fotosDoPonto(page, id)).length;
  await page.click('#capVideo');
  await page.waitForFunction(() => document.getElementById('gravEstado').textContent === 'PRONTO', null, { timeout: 15000 });
  await page.click('#gravBotao');
  await page.waitForFunction(() => /GRAVANDO/.test(document.getElementById('gravEstado').textContent), null, { timeout: 8000 });
  await dorme(2500);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForSelector('#modalGenerico.aberto', { timeout: 15000 });
  const titulo = await page.textContent('#genTitulo');
  ok('T5 avisa que a gravação foi encerrada', /Gravação encerrada/.test(titulo), titulo);
  await page.click('#genConfirmar');
  const fotos = (await fotosDoPonto(page, id)).slice(antes);
  ok('T5 a parte gravada ficou salva', fotos.length === 1 && fotos[0].comprimido === true, String(fotos.length));
  ok('T5 tela de gravação fechou', !(await page.evaluate(() => document.getElementById('telaGravacao').classList.contains('aberta'))));
  await ctx.close();
}

async function testeCurta(browser) {
  console.log('--- T6: cancelar na prévia não grava nada; toque curto demais não salva');
  const { ctx, page, erros } = await abrir(browser, { ctx: { permissions: ['camera', 'microphone'] } });
  const id = await prepararPonto(page);
  const antes = (await fotosDoPonto(page, id)).length;
  await page.click('#capVideo');
  await page.waitForFunction(() => document.getElementById('gravEstado').textContent === 'PRONTO', null, { timeout: 15000 });
  await page.click('#gravCancelar');
  await dorme(300);
  ok('T6 cancelar fecha a tela', !(await page.evaluate(() => document.getElementById('telaGravacao').classList.contains('aberta'))));
  ok('T6 câmera desligada (sem faixas vivas)', await page.evaluate(() => !document.getElementById('gravPrevia').srcObject));
  ok('T6 nada foi salvo', (await fotosDoPonto(page, id)).length === antes);
  // abre de novo, grava e para na hora
  await page.evaluate(() => document.querySelector('[data-add]').click());
  await page.waitForSelector('#modalCaptura.aberto');
  await page.click('#capVideo');
  await page.waitForFunction(() => document.getElementById('gravEstado').textContent === 'PRONTO', null, { timeout: 15000 });
  await page.click('#gravBotao');
  await page.waitForFunction(() => /GRAVANDO/.test(document.getElementById('gravEstado').textContent), null, { timeout: 8000 });
  await dorme(150);
  await page.click('#gravBotao');
  await page.waitForFunction(() => !document.getElementById('telaGravacao').classList.contains('aberta'), null, { timeout: 15000 });
  await dorme(400);
  ok('T6 gravação de menos de 1 s não vira vídeo', (await fotosDoPonto(page, id)).length === antes);
  ok('T6 sem erros de página', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

async function testeRegressao(browser) {
  console.log('--- T7: galeria continua igual (foto comprimida; vídeo de galeria ainda vai para a fila de compactação)');
  const { ctx, page, erros } = await abrir(browser, {});
  const id = await prepararPonto(page);
  const antes = (await fotosDoPonto(page, id)).length;
  // 1x1 png
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.click('#capGaleria');
  await page.setInputFiles('#inputFoto', [{ name: 'a.png', mimeType: 'image/png', buffer: png }]);
  await page.waitForFunction(([id, n]) => { const e = window.__obraDebug.estado(); let t = 0; const [amb, par] = id.split('|'); const v = (c) => { for (const a of (c.andares || [])) for (const am of (a.ambientes || [])) if (am.id === amb) for (const p of am.paredes) if (p.id === par) t += p.fotos.length; }; for (const emp of e.empreendimentos) { for (const u of emp.unidades || []) v(u); if (emp.areasComuns) v(emp.areasComuns); if (emp.equipamentos) v(emp.equipamentos); } return t > n; }, [id, antes], { timeout: 10000 });
  const f1 = (await fotosDoPonto(page, id)).slice(antes);
  ok('T7 foto da galeria entrou', f1.length === 1 && f1[0].tipo === 'foto');
  // vídeo de galeria: sem jaCompacto → entra com compactando=true
  await page.evaluate(() => document.querySelector('[data-add]').click());
  await page.waitForSelector('#modalCaptura.aberto');
  await page.click('#capGaleria');
  await page.setInputFiles('#inputFoto', [{ name: 'v.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(20000, 1) }]);
  await dorme(300);
  const f2 = (await fotosDoPonto(page, id)).slice(antes + 1);
  ok('T7 vídeo da galeria entrou como vídeo', f2.length === 1 && f2[0].tipo === 'video', JSON.stringify(f2.map(f => ({ t: f.tipo, c: f.compactando, k: f.comprimido }))));
  ok('T7 vídeo da galeria NÃO recebe a marca de comprimido', f2.length === 1 && !f2[0].comprimido);
  ok('T7 sem erros de página', erros.length === 0, erros.join(' | '));
  await ctx.close();
}


async function testeRefazer(browser) {
  console.log('--- T8: refazer uma foto com vídeo da câmera do app troca o registro (e as partes seguintes entram como novas)');
  const { ctx, page, erros } = await abrir(browser, { ctx: { permissions: ['camera', 'microphone'] } });
  await page.evaluate(() => window.__obraDebug.setParteMs(2500));
  const id = await prepararPonto(page);
  const antes = (await fotosDoPonto(page, id)).length;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.click('#capGaleria');
  await page.setInputFiles('#inputFoto', [{ name: 'a.png', mimeType: 'image/png', buffer: png }]);
  await page.waitForFunction(([id, n]) => { const e = window.__obraDebug.estado(); let t = 0; const [amb, par] = id.split('|'); const v = (c) => { for (const a of (c.andares || [])) for (const am of (a.ambientes || [])) if (am.id === amb) for (const p of am.paredes) if (p.id === par) t += p.fotos.length; }; for (const emp of e.empreendimentos) { for (const u of emp.unidades || []) v(u); if (emp.areasComuns) v(emp.areasComuns); if (emp.equipamentos) v(emp.equipamentos); } return t > n; }, [id, antes], { timeout: 10000 });
  const fotoAntiga = (await fotosDoPonto(page, id)).slice(antes)[0];
  await page.evaluate(() => { const r = document.querySelector('[data-retake]'); r.scrollIntoView(); r.click(); });
  await page.waitForSelector('#modalCaptura.aberto');
  await page.click('#capVideo');
  await page.waitForFunction(() => document.getElementById('gravEstado').textContent === 'PRONTO', null, { timeout: 15000 });
  await page.click('#gravBotao');
  await page.waitForFunction(() => document.getElementById('gravParte').textContent === 'Parte 2', null, { timeout: 15000 });
  await dorme(2200);
  await page.click('#gravBotao');
  await page.waitForFunction(() => !document.getElementById('telaGravacao').classList.contains('aberta'), null, { timeout: 20000 });
  await dorme(500);
  const agora = (await fotosDoPonto(page, id)).slice(antes);
  console.log('   registros:', JSON.stringify(agora.map(f => ({ tipo: f.tipo, comp: f.comprimido, antigo: f.id === fotoAntiga.id }))));
  ok('T8 a foto antiga saiu (refazer) e entraram 2 vídeos (parte 1 trocou, parte 2 é nova)', agora.length === 2 && agora.every(f => f.tipo === 'video' && f.comprimido === true) && !agora.some(f => f.id === fotoAntiga.id));
  ok('T8 o arquivo da foto antiga foi apagado', !(await page.evaluate((id) => window.__obraDebug.idbGet(id), fotoAntiga.id)));
  ok('T8 sem erros de página', erros.length === 0, erros.join(' | '));
  await ctx.close();
}

(async () => {
  const flags = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'];
  const sem = ['--use-fake-ui-for-media-stream'];
  const quero = (n) => !FILTRO || FILTRO.split(',').includes(n);
  let b = await chromium.launch({ args: flags });
  try {
    if (quero('1')) await testePartes(b);
    if (quero('2')) await testeEspaco(b);
    if (quero('5')) await testeSaiuDoApp(b);
    if (quero('6')) await testeCurta(b);
    if (quero('7')) await testeRegressao(b);
    if (quero('8')) await testeRefazer(b);
  } finally { await b.close(); }
  if (quero('3')) { b = await chromium.launch({ args: sem }); try { await testeSemCamera(b); } finally { await b.close(); } }
  if (quero('4')) { b = await chromium.launch({ args: ['--use-fake-device-for-media-stream'] }); try { await testePermissaoNegada(b); } finally { await b.close(); } }
  console.log('\n' + passou + ' passaram, ' + falhas + ' falharam');
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error('ERRO', e); process.exit(2); });
