#!/bin/sh
# PUBLICAR — carimbo de versão do RELÓGIO, nunca digitado à mão (regra da skill 21-fabrica-apps).
#
# Por que existe: a doença nº 1 deste app foi "janela com versão antiga". Sem carimbo na tela o dono não
# sabe qual versão está vendo; sem versao.json no ar o app não sabe avisar que existe uma mais nova.
#
# Ordem, e ABORTA em qualquer falha (desfazendo o carimbo quando aborta antes do commit):
#   1. carimbo de `date` nos DOIS lugares a partir da MESMA variável (BUILD_TAG/BUILD_TS no index.html
#      e versao.json), ts sempre crescente;
#   2. travas: carimbos batem; checks-app.js (sintaxe bloco a bloco + capacidades + --contra o app NO AR:
#      nada que o ar tem pode sumir); bateria de caminhos do usuário (harness da skill 21.1, Playwright +
#      Chrome real) quando existir nesta máquina — sem ela, avisa e DEIXA REGISTRADO no commit;
#   3. commit (o pre-commit em .githooks roda o checks-app de novo) + push (push recusado = commit ficou
#      só aqui, e o script diz isso; nunca force);
#   4. conferência: o lib/ está no commit; o ar do GitHub Pages passa a ter o MESMO sha256 do index e o
#      MESMO carimbo no versao.json (até 6 min; o cache do Pages ignora query — quem limpa é o deploy).
#      Resultado gravado em C:\Users\USER\.claude\health\obra-fotos-publicacoes.jsonl (conferido sim/não).
#
# Uso:  sh publicar.sh "mensagem do commit"
#       PULAR_BATERIA=1  pula a bateria de navegador (fica registrado no commit)
#       PODE_REMOVER="nomeA,nomeB" (ou tudo) libera remoção proposital de peça que o ar tem
set -e
cd "$(dirname "$0")"
MSG=${1:-"app: atualizacao"}
LOG="C:/Users/USER/.claude/health/obra-fotos-publicacoes.jsonl"
ORIGEM=$(git remote get-url origin 2>/dev/null || echo "sem-remoto")
case "$ORIGEM" in *github.com*felypexykawa/obra-fotos*) ;; *) LOG="/tmp/obra-fotos-publicacoes-teste.jsonl"; echo "[publicar] remoto de TESTE ($ORIGEM): o log vai para $LOG, nao para o livro de producao";; esac
HARNESS="${HARNESS_DIR:-C:/Users/USER/.claude/skills/21.1-fabrica-apps-obras/resources/harness}"   # HARNESS_DIR= só para testar a rota com bateria falsa
FASE="no inicio"; CARIMBADO=""; COMMITADO=""; PUBLICADO=""
# duas publicações ao mesmo tempo (duas sessões) subiam lixo pro ar e uma desfazia o carimbo da outra: trava por pasta
# (mkdir é atômico), com validade de 30 min para trava de rota que morreu
LOCK="/tmp/obra-fotos-publicar.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +30 2>/dev/null)" ]; then rmdir "$LOCK" 2>/dev/null || true; mkdir "$LOCK" 2>/dev/null || { echo "ABORTADO no inicio: outra publicacao esta rodando agora (trava $LOCK)"; exit 1; }
  else echo "ABORTADO no inicio: outra publicacao esta rodando agora (trava $LOCK). Espere ela terminar; se ela morreu, apague essa pasta."; exit 1; fi
fi
BAKDIR=$(mktemp -d 2>/dev/null || { mkdir -p "/tmp/obra-fotos-pub-$$" && echo "/tmp/obra-fotos-pub-$$"; })
BAK_IDX="$BAKDIR/index.html"; BAK_VER="$BAKDIR/versao.json"   # fora do repo: 'git add -A' nunca os vê
desfaz_carimbo() { if [ -n "$CARIMBADO" ] && [ -z "$COMMITADO" ]; then cp "$BAK_IDX" index.html; cp "$BAK_VER" versao.json 2>/dev/null || true; echo "[publicar] carimbo desfeito (nada foi publicado)"; fi; }
# encerra SO o servidor que esta rota abriu (pelo PID do Windows que ele mesmo gravou); 'kill $!' nao mata no Git Bash
RAIZ=""
mata_servidor(){ PIDN=$(cat "$RAIZ/.pid" 2>/dev/null || true); [ -n "$PIDN" ] && taskkill //PID "$PIDN" //F >/dev/null 2>&1; :; }
# roda em TODA saída (inclusive as que o set -e provoca): servidor morto, raiz de teste apagada, trava liberada.
# set +e aqui dentro: um 'cat' de .pid que já sumiu matava a limpeza antes do rmdir e a trava ficava presa (pego pelo pub_tests I)
limpa() { set +e; [ -n "$RAIZ" ] && { mata_servidor; rm -rf "$RAIZ"; }; rm -rf "$BAKDIR"; rmdir "$LOCK" 2>/dev/null; :; }
trap limpa EXIT
aborta() { echo "ABORTADO $FASE: $1"; desfaz_carimbo; exit 1; }
interrompe() {
  trap - INT TERM
  case "$FASE" in
    "na conferencia do ar") echo "[publicar] interrompido na conferencia do ar: a publicacao JA FOI FEITA (commit e push). Confira o ar em alguns minutos." ;;
    "no push") echo "[publicar] interrompido no push: pode ter subido ou nao. Confira no GitHub antes de publicar de novo." ;;
    "no commit") echo "[publicar] interrompido no commit: se o commit ficou feito, ficou so neste computador (nao subiu)." ;;
    *) echo "[publicar] interrompido $FASE. Nada foi publicado."; desfaz_carimbo ;;
  esac
  exit 130
}
trap interrompe INT TERM

[ -n "$(git config user.name)" ] || git config user.name "Felype"
[ -n "$(git config user.email)" ] || git config user.email "felype@local"
[ "$(git config core.hooksPath)" = ".githooks" ] || { git config core.hooksPath .githooks; echo "trava de commit instalada (.githooks)"; }

# 1) carimbo nos dois lugares, da MESMA variável (com cópia para desfazer se abortar)
FASE="no carimbo"
cp index.html "$BAK_IDX"; cp versao.json "$BAK_VER" 2>/dev/null || echo '{"tag": "dev", "ts": 0}' > "$BAK_VER"
TAG=$(date '+%d/%m %Hh%M')
python - "$TAG" <<'PY' || { echo "ABORTADO no carimbo"; exit 1; }
import io, re, sys, time, json
tag = sys.argv[1]
s = io.open('index.html', encoding='utf-8').read()
ms = int(time.time()*1000)
try:
    ant = int(json.load(io.open('versao.json', encoding='utf-8')).get('ts', 0))
except Exception:
    ant = 0
if ant > ms + 86400000:
    print('AVISO: versao.json com ts no futuro (%d) - ignorado, carimbo = relogio' % ant); ant = 0
if ms <= ant:
    print('AVISO: relogio nao passou do carimbo anterior - usando anterior+1s'); ms = ant + 1000
novo, n1 = re.subn(r"const BUILD_TAG='[^']*'", "const BUILD_TAG='%s'" % tag, s, count=1)
novo, n2 = re.subn(r"const BUILD_TS=\d+", "const BUILD_TS=%d" % ms, novo, count=1)
if n1 != 1 or n2 != 1:
    raise SystemExit('ERRO: BUILD_TAG/BUILD_TS nao encontrados no index.html - nada foi gravado')
io.open('index.html', 'w', encoding='utf-8', newline='').write(novo)
io.open('versao.json', 'w', encoding='utf-8', newline='').write('{"tag": "%s", "ts": %d}' % (tag, ms))
print('carimbo:', tag, ms)
PY
CARIMBADO=1
TS=$(python -c "import json,io; print(json.load(io.open('versao.json',encoding='utf-8'))['ts'])")

# 2) travas
FASE="nas travas"
node -e "
const fs=require('fs');
const idx=fs.readFileSync('index.html','utf8');
const tag=(idx.match(/const BUILD_TAG='([^']*)'/)||[])[1]; const ts=+((idx.match(/const BUILD_TS=(\d+)/)||[])[1]);
const vj=JSON.parse(fs.readFileSync('versao.json','utf8'));
if(tag!==vj.tag||ts!==vj.ts||!ts){console.error('carimbo divergente',tag,ts,vj);process.exit(1);}
console.log('carimbo confere:',tag,ts);
" || aborta "carimbo divergente entre index.html e versao.json"
NOAR=$(mktemp 2>/dev/null || echo "/tmp/obra-noar-$$.html"); PULOU_CONTRA=""
if curl -fsS "https://felypexykawa.github.io/obra-fotos/index.html?cb=$$" -o "$NOAR" 2>/dev/null && [ -s "$NOAR" ] && grep -q "obraFotosEstado_v" "$NOAR"; then
  node checks-app.js index.html --contra "$NOAR" || { rm -f "$NOAR"; aborta "checks-app reprovou (capacidade, sintaxe ou peça que sumiu em relacao ao ar)"; }
else
  echo "[publicar] nao consegui baixar o app do ar — SEM a conferencia de linha paralela (fica no commit)"; PULOU_CONTRA=1
  node checks-app.js index.html || { rm -f "$NOAR"; aborta "checks-app reprovou (capacidade ou sintaxe)"; }
fi
rm -f "$NOAR"
# 2.5) caminhos do usuario — o app aberto num Chrome de verdade (harness da skill 21.1). Fail-open de ambiente, fail-closed de achado.
FASE="na bateria de navegador"; PULOU_BATERIA=""
if [ -z "$PULAR_BATERIA" ] && [ -f "$HARNESS/v7b_sanity.js" ] && [ -f "$HARNESS/v72_tests.js" ] && [ -f "$HARNESS/v76_tests.js" ] && [ -f "$HARNESS/v77_tests.js" ] && [ -d "C:/Users/USER/AppData/Roaming/npm/node_modules/playwright" ]; then
  RAIZ=$(mktemp -d 2>/dev/null || echo "/tmp/obra-raiz-$$"); mkdir -p "$RAIZ/lib"; cp lib/*.js "$RAIZ/lib/"
  sed "s/const BUILD_TAG='[^']*'; const BUILD_TS=[0-9]*;/const BUILD_TAG='teste'; const BUILD_TS=1000;/" index.html > "$RAIZ/index.html"
  git show 15c3404:index.html > "$RAIZ/v5.html" 2>/dev/null || cp index.html "$RAIZ/v5.html"
  echo '{"tag":"dev","ts":0}' > "$RAIZ/versao.json"
  RAIZW=$(cd "$RAIZ" && pwd -W 2>/dev/null || pwd)
  PORTA=$(python -c "import socket; s=socket.socket(); s.bind(('127.0.0.1',0)); print(s.getsockname()[1]); s.close()")
  ( cd "$HARNESS" && node serve.js "$RAIZW" "$PORTA" "$RAIZ/.pid" >/dev/null 2>&1 & )   # o servidor grava o PROPRIO PID do Windows em .pid
  # o servidor tem de estar servindo a CÓPIA carimbada desta bateria (não outro serve.js esquecido noutra raiz)
  ESPERADO=$(sha256sum "$RAIZ/index.html" | cut -c1-64); SERVIDO=""
  for i in 1 2 3 4 5 6 7 8 9 10; do SERVIDO=$(curl -s "http://127.0.0.1:$PORTA/index.html" | sha256sum | cut -c1-64); [ "$SERVIDO" = "$ESPERADO" ] && break; sleep 1; done
  if [ "$SERVIDO" != "$ESPERADO" ]; then echo "publicar: ABORTADO — o servidor da bateria não está servindo a cópia carimbada (porta $PORTA)"; mata_servidor; desfaz_carimbo; exit 1; fi
  sleep 2
  BAT_OK=1
  # o status de um pipeline é o do grep: linha FAIL casava e a bateria "passava". Agora: exit do node E nenhum FAIL.
  # 'cmd; RC=$?' NAO sobrevive ao set -e (o script morria no exit do node com o carimbo aplicado e o servidor vivo):
  # a forma que sobrevive e o 'if !'. As cinco baterias (v76 = casas geminadas, fachadas e campo de unidades, desde 21/09/2026; v77 = destaque do empreendimento, molde de andar de lazer, tela andar a andar automática e baixar quantidade, desde 23/09/2026), inclusive a corrida de duas abas (8 rodadas).
  for BAT in "v7b_sanity.js" "v72_tests.js $RAIZW" "v76_tests.js $RAIZW" "v77_tests.js $RAIZW" "v7b_tests.js"; do
    if ! ( cd "$HARNESS" && PORTA=$PORTA node $BAT ) > "$RAIZ/bat.log" 2>&1; then RCB=1; else RCB=0; fi
    grep -E "PASS|FAIL|TUDO|ERRO|Error" "$RAIZ/bat.log" || true
    if [ $RCB -ne 0 ] || grep -q "FAIL" "$RAIZ/bat.log"; then BAT_OK=""; echo "[publicar] bateria $BAT reprovou (exit=$RCB)"; fi
  done
  mata_servidor
  rm -rf "$RAIZ"
  [ -n "$BAT_OK" ] || aborta "bateria de navegador reprovou (veja as linhas FAIL acima)"
else
  echo "[publicar] bateria de navegador PULADA (harness ou Playwright ausentes nesta maquina, ou PULAR_BATERIA=1) — fica registrado no commit"; PULOU_BATERIA=1
fi

# 3) commit + push
FASE="no commit"
git add -A
N_LIB=$(git ls-files --cached lib/ | wc -l | tr -d ' ')
[ "$N_LIB" -ge 2 ] || { git reset -q; aborta "lib/ nao vai no commit ($N_LIB arquivo(s)) — o worker de video ficaria sem as bibliotecas no ar"; }
TRAILER="Carimbo: $TAG"
[ -z "$PULOU_CONTRA" ] || TRAILER="$TRAILER
Sem-contra-no-ar: sim"
[ -z "$PULOU_BATERIA" ] || TRAILER="$TRAILER
Sem-bateria: sim"
git commit -q -m "$MSG

$TRAILER" || aborta "commit falhou ou nao havia nada para commitar"
COMMITADO=1
echo "commit: $(git log --oneline -1)"
FASE="no push"
if ! git push -q origin HEAD 2>&1; then
  echo "PUSH RECUSADO: o commit $(git rev-parse --short HEAD) ficou feito SO NESTE COMPUTADOR e nao subiu. Provavelmente alguem publicou por outra porta. Faca 'git pull --rebase origin main' e rode o publicar de novo. NUNCA force o push."
  exit 1
fi
PUBLICADO=1; echo "push feito"

# 4) conferência do ar (o cache do Pages ignora query; quem limpa é o deploy — por isso a espera longa)
FASE="na conferencia do ar"
SHA_LOCAL=$(sha256sum index.html | cut -c1-64); OK=""; i=0; SHA_AR=""; TAG_AR=""
[ -z "$PULAR_AR" ] || { echo "[publicar] conferencia do ar PULADA (PULAR_AR=1 — so para teste da rota com remoto local); fica registrado como NAO conferido"; i=36; }
while [ $i -lt 36 ]; do
  sleep 10; i=$((i+1))
  SHA_AR=$(curl -fsS "https://felypexykawa.github.io/obra-fotos/index.html" 2>/dev/null | sha256sum | cut -c1-64)
  TAG_AR=$(curl -fsS "https://felypexykawa.github.io/obra-fotos/versao.json" 2>/dev/null | python -c "import sys,json; j=json.load(sys.stdin); print(str(j.get('tag',''))+'|'+str(j.get('ts','')))" 2>/dev/null || echo "")
  if [ "$SHA_AR" = "$SHA_LOCAL" ] && [ "$TAG_AR" = "$TAG|$TS" ]; then OK=1; break; fi
done
COMMIT=$(git rev-parse --short HEAD)
python - "$LOG" "$TAG" "$COMMIT" "$OK" "$i" "$PULOU_CONTRA" "$PULOU_BATERIA" "$ORIGEM" "$TS" <<'PY'
import sys, json, time, io
log, tag, commit, ok, i, pc, pb, origem, ts = sys.argv[1:10]
try:
    io.open(log, 'a', encoding='utf-8').write(json.dumps({"ts": int(time.time()*1000), "tag": tag, "build_ts": int(ts or 0), "commit": commit, "conferido_no_ar": bool(ok), "espera_s": int(i)*10, "sem_contra": bool(pc), "sem_bateria": bool(pb), "origem": origem}, ensure_ascii=False) + "\n")
except Exception as e:
    print('aviso: nao consegui gravar o log de publicacao:', e)
PY
if [ -n "$OK" ]; then
  echo "NO AR igual ao disco apos ~$((i*10))s: index sha256 ${SHA_LOCAL%"${SHA_LOCAL#????????????????}"}, versao.json '$TAG_AR', commit $COMMIT"
else
  echo "ATENCAO: publicado (commit $COMMIT, push feito), mas em 6 min o ar ainda nao bateu com o disco (index igual: $([ "$SHA_AR" = "$SHA_LOCAL" ] && echo sim || echo nao); versao.json no ar: '$TAG_AR'). Registrado como NAO conferido em $LOG. Confira de novo em alguns minutos."
  exit 2
fi
