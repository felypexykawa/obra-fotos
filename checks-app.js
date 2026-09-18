// checks-app.js — trava de CAPACIDADE do app Fotos da Obra (regra da skill 21-fabrica-apps).
// "JS parseia" não diz nada sobre o que o app SABE FAZER: um index.html com 85% do conteúdo apagado
// parseia e publica. Este arquivo exercita a lista de capacidades e, com --contra <arquivo do ar>,
// exige que nada que o ar tem tenha sumido (proteção contra escrever por cima de uma cópia antiga).
//
// Uso:  node checks-app.js index.html [--contra ar.html]
// Remoção proposital: PODE_REMOVER="nomeA,nomeB" node checks-app.js ...   (ou PODE_REMOVER=tudo)
const fs = require('fs');
const arq = process.argv[2] || 'index.html';
const iContra = process.argv.indexOf('--contra');
const contra = iContra > 0 ? process.argv[iContra + 1] : null;
const podeRemover = new Set((process.env.PODE_REMOVER || '').split(',').map(s => s.trim()).filter(Boolean));
const s = fs.readFileSync(arq, 'utf8');
let falhas = 0;
const falha = (m) => { console.error('  FALHA ' + m); falhas++; };

// 1) todo bloco <script> inline parseia (um por um — o regex guloso comia do primeiro ao último)
const blocos = [...s.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (!blocos.length) falha('nenhum <script> inline encontrado');
blocos.forEach((b, i) => { try { new Function(b); } catch (e) { falha('bloco <script> #' + (i + 1) + ' com erro de sintaxe: ' + e.message); } });

// 2) capacidades que este app precisa ter (nome → o que a ausência significaria para o Felype)
const CAPACIDADES = {
  'comprimirVideoRapido': 'vídeo não compacta (WebCodecs)', 'CODIGO_WORKER_VIDEO': 'worker de vídeo', 'function comprimirVideo(': 'rota antiga de vídeo',
  'agendarCompactacao': 'fila de compactação', 'retomarCompactacoes': 'retomada ao abrir', 'tentativas': 'limite de tentativas do vídeo', 'guardarCopiaNoCelular': 'cópia no celular (Download) do que a câmera do app tira', 'ehExemploIntocado': 'exemplo de fábrica sem nome de projeto real', 'mostrarAvisoExemplo': 'aviso do exemplo alcança quem já tinha modo salvo', 'btnEditarEmp': 'renomear/excluir empreendimento', 'parseListaNumeros': 'garagem marcada andar a andar', 'ehAndarGaragem': 'garagem exclui unidade automatica',
  'fundirEstados': 'junção de backups/abas', 'function casar(': 'junção por nome', 'marcarRemovido': 'lápides', 'podarLapides': 'poda por lápide',
  'absorverChaveAntiga': 'absorção da versão antiga', 'LS_CARIMBO': 'carimbo entre abas', 'reverterParaDisco': 'desfazer sem espaço',
  'varrerOrfaos': 'faxina de órfãos', 'avisarEspaco': 'aviso de armazenamento', 'idbTodasChaves': 'listagem do IndexedDB',
  'gerarUnidadesPorAndar': 'unidades 301/302', 'moldeAreasComuns': 'wizard de prédio', 'btnEtapasPorPavimento': 'etapas por pavimento',
  'garantirVisivel': 'filtro não esconde foto nova', 'modalGenericoAgora': 'fila de modais', 'nomeNorm': 'normalização de nome (sem acento/caixa)', 'nomeLivre': 'guarda de nome repetido (criar/renomear)', 'desduplicarNomes': 'irmãos homônimos juntados no funil (carga e união)', 'coberturaAplicada': 'Cobertura da casa entra uma vez (respeita lápide)', 'modalCaptura': 'escolha tirar/gravar/galeria',
  'btnExportar': 'backup', 'inputImportar': 'importar backup', 'multiple': 'importar vários arquivos', 'LIMITE_PARTE': 'backup em partes',
  "BUILD_TAG='": 'carimbo de versão', 'BUILD_TS=': 'ts de versão', 'checarVersao': 'aviso de versão nova', 'id="buildTag"': 'versão na tela',
  'id="avisoVersao"': 'banner de versão', 'lib/mp4box.all.min.js': 'demuxer', 'lib/mp4-muxer.min.js': 'muxer', 'id="progressoVideo"': 'faixa de progresso',
  'id="inputFoto"': 'botão de foto', 'obraFotosEstado_v4': 'chave de dados da versão',
};
for (const [k, v] of Object.entries(CAPACIDADES)) if (!s.includes(k)) falha('capacidade ausente: ' + k + ' (' + v + ')');

// 3) --contra: nada que o ar tem pode sumir (função, const de nível de módulo, id de elemento), salvo PODE_REMOVER
function nomesDe(t) {
  const n = new Set();
  for (const m of t.matchAll(/^\s{2}(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)\s*\(/gm)) n.add('fn:' + m[1]);
  for (const m of t.matchAll(/^\s{2}(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/gm)) n.add('var:' + m[1]);
  for (const m of t.matchAll(/\sid="([A-Za-z][\w-]*)"/g)) n.add('id:' + m[1]);
  return n;
}
if (contra) {
  const ar = fs.readFileSync(contra, 'utf8');
  if (!/BUILD_TAG=|obraFotosEstado_v|todasParedes/.test(ar)) { console.log('  aviso: o arquivo --contra não parece ser o app (página de erro?); conferência de linha paralela pulada'); }
  else {
    const antes = nomesDe(ar), agora = nomesDe(s);
    // uma const que virou function (ou vice-versa) não é remoção: o que conta é o NOME continuar existindo no código
    const nomeSemTipo = new Set([...agora].filter(x => !x.startsWith('id:')).map(x => x.split(':')[1]));
    const sumiram = [...antes].filter(x => !agora.has(x) && !(x.startsWith('fn:') || x.startsWith('var:') ? nomeSemTipo.has(x.split(':')[1]) : false) && !podeRemover.has('tudo') && !podeRemover.has(x.split(':')[1]));
    if (sumiram.length) falha('linha paralela: ' + sumiram.length + ' peça(s) que o ar tem sumiram deste arquivo: ' + sumiram.slice(0, 12).join(', ') + (sumiram.length > 12 ? '…' : '') + ' — se for remoção proposital: PODE_REMOVER="nome1,nome2"');
    const razao = s.length / ar.length;
    if (razao < 0.7 && !podeRemover.has('tudo')) falha('arquivo encolheu para ' + Math.round(razao * 100) + '% do que está no ar — app oco ou cópia antiga');
    console.log('  contra o ar: ' + antes.size + ' peças no ar, ' + agora.size + ' aqui, tamanho ' + Math.round(razao * 100) + '%');
  }
}
console.log(falhas ? ('checks-app: ' + falhas + ' falha(s)') : ('checks-app: OK (' + blocos.length + ' bloco(s) de script, ' + Object.keys(CAPACIDADES).length + ' capacidades)'));
process.exit(falhas ? 1 : 0);
