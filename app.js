import { abrirStore, cloudEnabled, local, uid, novoCodigo, normalizarCodigo, codigoExiste, criarFamilia } from './store.js';

const INSTAGRAM = '@dt3dstudio';
const DEFAULTS = { kg: 100, watts: 120, kwh: 0.95, desg: 0.30, falha: 10, arred: 0.5, lucro: 100, pix: '', validade: 7, prazoPadrao: 3 };
const QUEM = { Davi: 'var(--davi)', Theo: 'var(--theo)' };
const STATUS = {
  aguardando: { nome: 'Esperando pagar a metade', cor: 'var(--st-agu)' },
  producao: { nome: 'Imprimindo', cor: 'var(--st-pro)' },
  entregue: { nome: 'Entregue', cor: 'var(--st-ent)' },
};

const $ = id => document.getElementById(id);
// Campos de dinheiro estilo app de banco: só números, a vírgula se ajusta sozinha (8 → 0,08 → 0,80).
const fmtMoney = v => (Math.round((+v || 0) * 100) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const brl = v => 'R$ ' + fmtMoney(v);
const ehDinheiro = el => el.dataset.money !== undefined;
// Campo de dinheiro vem como "1.234,56"; campo type=number já vem com ponto decimal ("12.5").
function num(id) {
  const el = $(id);
  const txt = ehDinheiro(el) ? el.value.replace(/\./g, '').replace(',', '.') : el.value;
  const v = parseFloat(txt);
  return isFinite(v) && v >= 0 ? v : 0;
}
function mascaraDinheiro(i) {
  const centavos = parseInt(i.value.replace(/\D/g, '') || '0', 10);
  i.value = fmtMoney(centavos / 100);
  try { i.setSelectionRange(i.value.length, i.value.length); } catch { /* sem cursor */ }
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dataBR = t => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const DIA = 86400000;
const ico = n => `<svg class="ic" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const cfgInputs = [...document.querySelectorAll('[data-cfg]')];

let store = null;
let st = { config: {}, pecas: [], pedidos: [] };
let who = local.get('p3d-who', 'Davi');
let atual = null;          // resultado do último cálculo
let editando = null;       // id do pedido em edição

/* ---------- utilidades de interface ---------- */
let tt;
function toast(t) { const e = $('toast'); e.textContent = t; e.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => e.classList.remove('on'), 2400); }

function perguntar(texto, sim = 'Sim', nao = 'Não') {
  const d = $('dlg');
  if (d.open) return Promise.resolve(false);
  $('dlgTexto').textContent = texto; $('dlgSim').textContent = sim; $('dlgNao').textContent = nao;
  return new Promise(res => {
    const fim = v => { d.close(); $('dlgSim').onclick = $('dlgNao').onclick = null; res(v); };
    $('dlgSim').onclick = () => fim(true);
    $('dlgNao').onclick = () => fim(false);
    d.oncancel = () => fim(false);
    d.showModal();
  });
}

async function copiar(texto, ok) {
  try { await navigator.clipboard.writeText(texto); toast(ok); }
  catch { toast('Não deu para copiar neste aparelho'); }
}

function abrirWhatsApp(texto, fone) {
  let n = String(fone || '').replace(/\D/g, '');
  if (n.length === 10 || n.length === 11) n = '55' + n;
  const url = (n.length >= 12 ? `https://wa.me/${n}` : 'https://wa.me/') + '?text=' + encodeURIComponent(texto);
  window.open(url, '_blank', 'noopener');
}

/* ---------- configurações ---------- */
const cfg = k => (st.config[k] ?? DEFAULTS[k]);

function preencherConfig() {
  for (const i of cfgInputs) if (document.activeElement !== i) i.value = ehDinheiro(i) ? fmtMoney(cfg(i.id)) : cfg(i.id);
}

let tSave;
function salvarConfig() {
  clearTimeout(tSave);
  tSave = setTimeout(() => {
    const c = {};
    for (const i of cfgInputs) c[i.id] = (i.type === 'number' || ehDinheiro(i)) ? num(i.id) : i.value.trim();
    store.saveConfig(c);
  }, 500);
}

/* ---------- calculadora ---------- */
function setWho(k) {
  who = k; local.set('p3d-who', k);
  document.querySelectorAll('#who button').forEach(b => b.setAttribute('aria-pressed', b.dataset.k === k));
}

function syncPresets() {
  const v = String(num('lucro'));
  document.querySelectorAll('#presets button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === v));
}

function calcular() {
  const qtd = Math.max(1, Math.round(num('qtd')) || 1);
  const horas = num('horas') + num('minutos') / 60;
  const fil = num('peso') / 1000 * num('kg') / qtd;
  const ene = num('watts') / 1000 * horas * num('kwh') / qtd;
  const des = horas * num('desg') / qtd;
  const ext = num('extras');
  const falha = (fil + ene + des) * num('falha') / 100; // se a impressão falha, os extras não se perdem
  const custo = fil + ene + des + ext + falha;
  let preco = custo * (1 + num('lucro') / 100);
  const a = num('arred');
  if (a > 0) preco = Math.ceil(preco / a - 1e-9) * a;
  const lucro = Math.max(0, preco - custo);
  return { fil, ene, des, ext, falha, custo, preco, lucro };
}

// Volta a calculadora para o começo (usada ao abrir o app e no botão Limpar).
// Não mexe no catálogo, nos pedidos nem nos Ajustes.
function limparCalculadora() {
  $('nome').value = ''; $('peso').value = ''; $('qtd').value = 1;
  $('horas').value = ''; $('minutos').value = ''; $('extras').value = '0,00';
  mostrarCalculo();
}

function mostrarCalculo() {
  const r = calcular();
  const nm = $('nome').value.trim();
  $('price').textContent = brl(r.preco);
  $('cost').textContent = brl(r.custo);
  $('profit').textContent = brl(r.lucro);
  $('pieceName').textContent = nm ? `${nm} · feita por ${who}` : `Feita por ${who}`;
  const partes = [['Filamento', r.fil, 'var(--c-fil)'], ['Energia', r.ene, 'var(--c-ene)'], ['Desgaste', r.des, 'var(--c-des)'],
    ['Extras', r.ext, 'var(--c-ext)'], ['Falhas', r.falha, 'var(--c-fal)'], ['Seu lucro', r.lucro, 'var(--c-luc)', 'luc']];
  const tot = partes.reduce((s, p) => s + p[1], 0) || 1;
  $('bar').innerHTML = partes.map(p => `<i style="width:${p[1] / tot * 100}%;background:${p[2]}" title="${p[0]}"></i>`).join('');
  $('legend').innerHTML = partes.filter(p => p[1] > 0.004).map(p => `<span class="${p[3] || ''}" style="--d:${p[2]}">${p[0]} ${brl(p[1])}</span>`).join('');
  syncPresets();
  atual = { ...r, nome: nm };
}

/* ---------- catálogo ---------- */
function renderPecas() {
  const ps = st.pecas;
  const vendidas = ps.reduce((s, i) => s + (i.vendidas || 0), 0);
  const ganho = ps.reduce((s, i) => s + (i.vendidas || 0) * i.preco, 0);
  const lucro = ps.reduce((s, i) => s + (i.vendidas || 0) * (i.preco - i.custo), 0);
  $('totPecas').innerHTML = `<div>Vendidas na escola<b>${vendidas}</b></div><div>Dinheiro recebido<b>${brl(ganho)}</b></div><div>Lucro de verdade<b>${brl(lucro)}</b></div>`;
  $('listaPecas').innerHTML = ps.length ? ps.map(i => `<li>
      <div><div class="nm"><span class="dot" style="background:${QUEM[i.who] || 'var(--brand)'}"></span>${esc(i.nome)}</div>
      <div class="meta">${esc(i.who)} · custo ${brl(i.custo)} · vendidas: ${i.vendidas || 0}</div></div>
      <div class="pr">${brl(i.preco)}</div>
      <div class="acts">
        <button class="sold" data-a="vendi" data-id="${i.id}">${ico('moeda')}Vendi uma!</button>
        <button data-a="desfazer" data-id="${i.id}">Desfazer venda</button>
        <button class="go" data-a="orcar" data-id="${i.id}">${ico('aviao')}Mandar o preço</button>
        <button data-a="apagar" data-id="${i.id}">${ico('lixeira')}Apagar</button>
      </div></li>`).join('')
    : '<li class="empty">Nenhuma peça no catálogo ainda. Calcule o preço e toque em “Salvar no catálogo”.</li>';
}

/* ---------- pedidos ---------- */
// Valores do pedido: o desconto sai do subtotal; a metade e o lucro já consideram o desconto.
const subtotalPedido = p => p.itens.reduce((s, i) => s + i.qtd * i.preco, 0);
const descontoPedido = p => Math.min(p.desconto || 0, subtotalPedido(p));
const totalPedido = p => subtotalPedido(p) - descontoPedido(p);
const custoPedido = p => p.itens.reduce((s, i) => s + i.qtd * (i.custo || 0), 0);
const lucroPedido = p => totalPedido(p) - custoPedido(p);
const sinalPedido = p => Math.round(totalPedido(p) * 50) / 100;

function linhaItem(i) {
  return i.qtd > 1 ? `• ${i.qtd}x ${i.nome} — ${brl(i.preco)} cada = ${brl(i.qtd * i.preco)}` : `• 1x ${i.nome} — ${brl(i.preco)}`;
}

function msgOrcamento(p) {
  const total = totalPedido(p), sinal = sinalPedido(p), resto = total - sinal;
  const pix = cfg('pix');
  return [
    '*DT 3D STUDIO* — Orçamento',
    `Cliente: ${p.cliente}`, '',
    ...p.itens.map(linhaItem), '',
    ...(descontoPedido(p) > 0 ? [`Subtotal: ${brl(subtotalPedido(p))}`, `Desconto: − ${brl(descontoPedido(p))}`] : []),
    `*Total: ${brl(total)}*`,
    `Prazo de entrega: ${p.prazo} ${p.prazo === 1 ? 'dia' : 'dias'} após o sinal`,
    `Orçamento válido até ${dataBR(p.criada + cfg('validade') * DIA)}`, '',
    `*Para confirmar o pedido:* envie o sinal de 50% (${brl(sinal)}) pelo Pix e mande o comprovante aqui. O restante (${brl(resto)}) é pago na entrega.`,
    pix ? `Chave Pix: ${pix}` : 'Chave Pix: enviamos em seguida', '',
    `Siga a gente no Instagram: ${INSTAGRAM}`,
  ].join('\n');
}

function msgConfirmacao(p) {
  const sinal = sinalPedido(p), resto = totalPedido(p) - sinal;
  return [
    '*DT 3D STUDIO* — Pedido confirmado! ✅',
    `Oi, ${p.cliente}! Recebemos seu sinal de ${brl(sinal)}.`,
    'Já vamos começar a imprimir suas peças.',
    `Previsão de entrega: ${dataBR(p.sinalEm + p.prazo * DIA)}`,
    `Restante a pagar na entrega: ${brl(resto)}`,
    'Obrigado pela confiança!',
    INSTAGRAM,
  ].join('\n');
}

function renderPedidos() {
  const ps = st.pedidos;
  const recebido = ps.reduce((s, p) => s + (p.status === 'entregue' ? totalPedido(p) : p.status === 'producao' ? sinalPedido(p) : 0), 0);
  const aReceber = ps.filter(p => p.status === 'producao').reduce((s, p) => s + totalPedido(p) - sinalPedido(p), 0);
  const emProd = ps.filter(p => p.status === 'producao').length;
  const lucro = ps.filter(p => p.status === 'entregue').reduce((s, p) => s + lucroPedido(p), 0);
  $('totPedidos').innerHTML = `<div>Para imprimir<b>${emProd}</b></div><div>Já recebido<b>${brl(recebido)}</b></div><div>A receber na entrega<b>${brl(aReceber)}</b></div><div>Lucro dos entregues<b>${brl(lucro)}</b></div>`;
  $('listaPedidos').innerHTML = ps.length ? ps.map(p => {
    const s = STATUS[p.status] || STATUS.aguardando;
    const total = totalPedido(p), sinal = sinalPedido(p);
    const info = p.status === 'aguardando'
      ? `<span>Metade: <b>${brl(sinal)}</b></span><span>Preço vale até <b>${dataBR(p.criada + cfg('validade') * DIA)}</b></span>`
      : p.status === 'producao'
        ? `<span>Metade paga: <b>${brl(sinal)}</b></span><span>Falta: <b>${brl(total - sinal)}</b></span><span>Entrega: <b>${dataBR(p.sinalEm + p.prazo * DIA)}</b></span>`
        : `<span>Pago: <b>${brl(total)}</b></span><span>Entregue em <b>${dataBR(p.entregueEm)}</b></span>`;
    const bts = {
      aguardando: `<button class="wa" data-a="msgOrc" data-id="${p.id}">${ico('aviao')}Mandar preço no WhatsApp</button>
        <button class="go" data-a="sinal" data-id="${p.id}">${ico('metade')}Cliente pagou a metade</button>
        <button data-a="editar" data-id="${p.id}">${ico('lapis')}Editar</button>`,
      producao: `<button class="wa" data-a="msgConf" data-id="${p.id}">${ico('aviao')}Avisar que vamos fazer</button>
        <button class="go" data-a="entregue" data-id="${p.id}">${ico('caixa')}Entreguei e recebi o resto</button>
        <button data-a="voltar" data-id="${p.id}">Ainda não pagou</button>`,
      entregue: `<button data-a="reabrir" data-id="${p.id}">Desfazer entrega</button>`,
    }[p.status] || '';
    return `<li>
      <div class="ph"><div><div class="nm">${esc(p.cliente)}</div><div class="meta">Pedido de ${dataBR(p.criada)}</div></div>
      <span class="st" style="--s:${s.cor}">${s.nome}</span></div>
      <ul class="pl">${p.itens.map(i => `<li><span>${i.qtd}x ${esc(i.nome)}</span><span>${brl(i.qtd * i.preco)}</span></li>`).join('')}
      ${descontoPedido(p) > 0 ? `<li class="desc"><span>Desconto</span><span>− ${brl(descontoPedido(p))}</span></li>` : ''}
      <li><b>Total</b><b>${brl(total)}</b></li></ul>
      <div class="pv">${info}</div>
      <div class="acts">${bts}
        <button data-a="copiarMsg" data-id="${p.id}">${ico('copiar')}Copiar mensagem</button>
        <button data-a="apagarPedido" data-id="${p.id}">${ico('lixeira')}Apagar</button></div></li>`;
  }).join('') : '<li class="empty">Nenhum pedido ainda. Toque em “Novo pedido” ou em “Mandar o preço” no catálogo.</li>';
}

async function enviarOrcamento(p) {
  if (!cfg('pix') && !await perguntar('A chave Pix ainda não foi cadastrada em Ajustes (peça ao papai). Mandar mesmo assim?', 'Mandar', 'Voltar')) return;
  abrirWhatsApp(msgOrcamento(p), p.fone);
}

/* formulário de pedido */
function opcoesPecas(sel) {
  return st.pecas.map(p => `<option value="${p.id}"${p.id === sel ? ' selected' : ''}>${esc(p.nome)} — ${brl(p.preco)}</option>`).join('');
}
function linhaForm(item = {}) {
  const div = document.createElement('div');
  div.className = 'it';
  div.innerHTML = `<select aria-label="Peça">${opcoesPecas(item.pecaId)}</select>
    <input type="number" inputmode="numeric" min="1" step="1" value="${item.qtd || 1}" aria-label="Quantidade">
    <button type="button" aria-label="Tirar peça">×</button>`;
  $('itensForm').appendChild(div);
}
function itensDoForm() {
  return [...$('itensForm').children].map(div => {
    const peca = st.pecas.find(p => p.id === div.querySelector('select').value);
    const qtd = Math.max(1, Math.round(parseFloat(div.querySelector('input').value)) || 1);
    return peca && { pecaId: peca.id, nome: peca.nome, preco: peca.preco, custo: peca.custo, qtd };
  }).filter(Boolean).reduce((lista, i) => {   // a mesma peça escolhida duas vezes vira uma linha só
    const j = lista.find(x => x.pecaId === i.pecaId);
    if (j) j.qtd += i.qtd; else lista.push(i);
    return lista;
  }, []);
}
const pedidoDoForm = () => ({ itens: itensDoForm(), desconto: num('desconto') });
function atualizarTotalForm() {
  const p = pedidoDoForm();
  const desc = descontoPedido(p), lucro = lucroPedido(p);
  $('formSubtotal').textContent = desc > 0 ? `Subtotal ${brl(subtotalPedido(p))} − desconto ${brl(desc)}` : '';
  $('formTotal').textContent = brl(totalPedido(p));
  $('formSinal').textContent = 'Metade para começar: ' + brl(sinalPedido(p));
  // aviso de lucro só aparece quando há desconto: é aí que dá para errar
  const av = $('formLucro');
  if (!(p.desconto > 0)) { av.textContent = ''; av.className = 'aviso'; return; }
  if (p.desconto > subtotalPedido(p)) { av.textContent = 'O desconto é maior que o valor do pedido.'; av.className = 'aviso neg'; return; }
  const [classe, texto] = lucro > 0.004 ? ['ok', `Com esse desconto vocês ainda ganham ${brl(lucro)}.`]
    : lucro > -0.005 ? ['zero', 'Cuidado: assim vocês só pagam o custo, sem lucro nenhum.']
    : ['neg', `Com esse desconto vocês PERDEM ${brl(-lucro)}!`];
  av.textContent = texto; av.className = 'aviso ' + classe;
}
function abrirForm(pedido, pecaId) {
  if (!st.pecas.length) { toast('Primeiro salve uma peça no catálogo'); location.hash = 'calcular'; return; }
  editando = pedido ? pedido.id : null;
  $('formTitulo').textContent = pedido ? 'Editar pedido' : 'Novo pedido';
  $('cliente').value = pedido ? pedido.cliente : '';
  $('fone').value = pedido ? (pedido.fone || '') : '';
  $('prazo').value = pedido ? pedido.prazo : cfg('prazoPadrao');
  $('desconto').value = fmtMoney(pedido ? pedido.desconto || 0 : 0);
  $('itensForm').innerHTML = '';
  (pedido ? pedido.itens : [{ pecaId: pecaId || st.pecas[0].id, qtd: 1 }]).forEach(linhaForm);
  $('formErro').textContent = '';
  $('formPedido').hidden = false;
  atualizarTotalForm();
  $('cliente').focus();
}
function fecharForm() { $('formPedido').hidden = true; editando = null; }

/* ---------- PIN do papai (tranca os Ajustes) ---------- */
// O PIN nunca fica no código: só um hash dele vai para a configuração (sincronizada).
// É uma tranca contra crianças, não uma proteção forte.
let ajustesAbertos = false;
async function hashPin(pin) {
  const dados = new TextEncoder().encode('dt3d:' + (local.get('p3d-codigo', '') || 'local') + ':' + pin);
  const h = await crypto.subtle.digest('SHA-256', dados);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function mostrarAjustes() {
  const temPin = !!st.config.pinHash;
  $('pinBox').hidden = ajustesAbertos;
  $('ajustesConteudo').hidden = !ajustesAbertos;
  if (!ajustesAbertos) {
    $('pinTexto').textContent = temPin ? 'Área do papai. Digite o PIN para abrir.' : 'Crie o PIN do papai (4 a 8 números) para trancar esta área.';
    $('pin2').hidden = temPin;
    $('pinOk').textContent = temPin ? 'Abrir' : 'Criar PIN';
  }
}
function trancar() { ajustesAbertos = false; $('pin').value = ''; $('pin2').value = ''; $('pinErro').textContent = ''; mostrarAjustes(); }

/* ---------- navegação ---------- */
const VIEWS = ['calcular', 'pecas', 'pedidos', 'ajustes'];
function rota() {
  const v = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'calcular';
  if (v !== 'ajustes' && ajustesAbertos) trancar();
  VIEWS.forEach(n => { $('v-' + n).hidden = n !== v; });
  document.querySelectorAll('#tabs a').forEach(a => {
    if (a.dataset.v === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
}

function render() {
  preencherConfig();
  mostrarCalculo();
  renderPecas();
  renderPedidos();
  mostrarAjustes();
}

/* ---------- eventos ---------- */
function ligarEventos() {
  // dinheiro: a máscara roda antes do cálculo (listener registrado primeiro)
  document.querySelectorAll('[data-money]').forEach(i => {
    i.addEventListener('input', () => mascaraDinheiro(i));
    i.addEventListener('focus', () => setTimeout(() => { try { i.setSelectionRange(i.value.length, i.value.length); } catch { /* nada */ } }));
  });
  // números comuns: ao tocar, seleciona tudo para o que for digitado substituir o valor
  document.querySelectorAll('input[type=number]').forEach(i => {
    i.addEventListener('focus', () => { try { i.select(); } catch { /* nada */ } i.dataset.sel = '1'; });
    // o toque/clique que deu foco não pode desfazer a seleção
    i.addEventListener('mouseup', e => { if (i.dataset.sel) { e.preventDefault(); delete i.dataset.sel; } });
    i.addEventListener('input', () => { delete i.dataset.sel; });
  });
  document.querySelectorAll('#v-calcular input').forEach(i => i.addEventListener('input', () => { mostrarCalculo(); if (i.dataset.cfg !== undefined) salvarConfig(); }));
  cfgInputs.forEach(i => { if (!i.closest('#v-calcular')) i.addEventListener('input', () => { mostrarCalculo(); salvarConfig(); }); });
  $('limpar').addEventListener('click', () => { limparCalculadora(); window.scrollTo(0, 0); toast('Campos limpos'); });
  $('home').addEventListener('click', e => {
    if (location.hash === '#calcular' || !location.hash) { e.preventDefault(); rota(); }
  });
  $('who').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { setWho(b.dataset.k); mostrarCalculo(); } });
  $('presets').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; $('lucro').value = b.dataset.v; mostrarCalculo(); salvarConfig(); });

  // Salva a peça calculada; se já existe uma igual (mesmo nome, quem fez e preço), reaproveita.
  function salvarPecaAtual() {
    mostrarCalculo();
    if (!atual.nome) { toast('Dê um nome para a peça'); $('nome').focus(); return null; }
    const igual = st.pecas.find(p => p.nome === atual.nome && p.who === who && Math.abs(p.preco - atual.preco) < 0.005);
    if (igual) return { peca: igual, nova: false };
    const peca = { id: uid(), nome: atual.nome, who, preco: atual.preco, custo: atual.custo, vendidas: 0, criada: Date.now() };
    store.savePeca(peca);
    return { peca, nova: true };
  }
  $('save').addEventListener('click', () => {
    const r = salvarPecaAtual(); if (!r) return;
    toast(r.nova ? 'Salvo no catálogo!' : 'Essa peça já está no catálogo');
  });
  $('orcar').addEventListener('click', () => {
    const r = salvarPecaAtual(); if (!r) return;
    location.hash = 'pedidos';
    abrirForm(null, r.peca.id);
  });

  $('listaPecas').addEventListener('click', async e => {
    const b = e.target.closest('button[data-a]'); if (!b) return;
    const p = st.pecas.find(x => x.id === b.dataset.id); if (!p) return;
    const a = b.dataset.a;
    if (a === 'vendi') { store.contarVenda(p.id, 1); toast('Mais uma venda!'); }
    if (a === 'desfazer' && p.vendidas > 0) store.contarVenda(p.id, -1);
    if (a === 'orcar') { location.hash = 'pedidos'; abrirForm(null, p.id); }
    if (a === 'apagar' && await perguntar(`Apagar “${p.nome}” do catálogo?`, 'Apagar', 'Cancelar')) store.deletePeca(p.id);
  });

  $('copiarCatalogo').addEventListener('click', () => {
    const t = '*DT 3D STUDIO* — Pecinhas à venda\n' + (st.pecas.length ? st.pecas.map(i => `• ${i.nome} — ${brl(i.preco)}`).join('\n') : '(catálogo vazio)') + `\n\nSiga a gente no Instagram: ${INSTAGRAM}`;
    copiar(t, 'Catálogo copiado! Cole no WhatsApp.');
  });
  $('zerar').addEventListener('click', async () => {
    if (!await perguntar('Zerar a contagem de vendas na escola de todas as peças?', 'Zerar', 'Cancelar')) return;
    st.pecas.filter(p => p.vendidas).forEach(p => store.savePeca({ ...p, vendidas: 0 }));
    toast('Vendas zeradas');
  });

  $('novoPedido').addEventListener('click', () => abrirForm());
  $('cancelarPedido').addEventListener('click', fecharForm);
  $('addItem').addEventListener('click', () => { linhaForm(); atualizarTotalForm(); });
  $('itensForm').addEventListener('input', atualizarTotalForm);
  $('desconto').addEventListener('input', atualizarTotalForm);
  $('itensForm').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if ($('itensForm').children.length > 1) { b.parentElement.remove(); atualizarTotalForm(); }
  });
  $('formPedido').addEventListener('submit', async e => {
    e.preventDefault();
    const cliente = $('cliente').value.trim();
    const itens = itensDoForm();
    if (!cliente) { $('formErro').textContent = 'Coloque o nome do cliente.'; $('cliente').focus(); return; }
    if (!itens.length) { $('formErro').textContent = 'Escolha pelo menos uma peça.'; return; }
    const desconto = num('desconto');
    if (desconto > subtotalPedido({ itens })) { $('formErro').textContent = 'O desconto é maior que o valor do pedido.'; $('desconto').focus(); return; }
    const antigo = st.pedidos.find(p => p.id === editando);
    const pedido = {
      ...(antigo || { id: uid(), status: 'aguardando', criada: Date.now() }),
      cliente, fone: $('fone').value.trim(), prazo: Math.round(num('prazo')), itens, desconto,
    };
    const lucro = lucroPedido(pedido);
    if (lucro < -0.004 && !await perguntar(`Com esse desconto vocês PERDEM ${brl(-lucro)}. Salvar mesmo assim?`, 'Salvar assim', 'Voltar')) return;
    store.savePedido(pedido);
    fecharForm();
    if (await perguntar(`Pedido ${antigo ? 'atualizado' : 'salvo'}! Mandar o preço para ${cliente} agora pelo WhatsApp?`, 'Mandar agora', 'Depois')) enviarOrcamento(pedido);
  });

  $('listaPedidos').addEventListener('click', async e => {
    const b = e.target.closest('button[data-a]'); if (!b) return;
    const p = st.pedidos.find(x => x.id === b.dataset.id); if (!p) return;
    const a = b.dataset.a;
    if (a === 'msgOrc') enviarOrcamento(p);
    if (a === 'msgConf') abrirWhatsApp(msgConfirmacao(p), p.fone);
    if (a === 'copiarMsg') copiar(p.status === 'producao' ? msgConfirmacao(p) : msgOrcamento(p), 'Mensagem copiada!');
    if (a === 'sinal' && await perguntar(`${p.cliente} pagou a metade (${brl(sinalPedido(p))})? Confira se o dinheiro caiu no Pix.`, 'Pagou', 'Ainda não')) {
      store.savePedido({ ...p, status: 'producao', sinalEm: Date.now() });
      toast('Hora de imprimir! Toque em “Avisar que vamos fazer”.');
    }
    if (a === 'entregue' && await perguntar(`Entregou a peça e recebeu o resto (${brl(totalPedido(p) - sinalPedido(p))})?`, 'Sim', 'Ainda não')) {
      store.savePedido({ ...p, status: 'entregue', entregueEm: Date.now() });
      toast('Pedido concluído!');
    }
    if (a === 'voltar') store.savePedido({ ...p, status: 'aguardando', sinalEm: null });
    if (a === 'reabrir') store.savePedido({ ...p, status: 'producao', entregueEm: null });
    if (a === 'editar') abrirForm(p);
    if (a === 'apagarPedido' && await perguntar(`Apagar o pedido de ${p.cliente}?`, 'Apagar', 'Cancelar')) store.deletePedido(p.id);
  });

  $('copiarCodigo').addEventListener('click', () => copiar(local.get('p3d-codigo', ''), 'Código copiado!'));
  $('sair').addEventListener('click', async () => {
    if (!await perguntar('Sair deste aparelho? Os dados continuam na nuvem; para voltar, digite o código de novo.', 'Sair', 'Cancelar')) return;
    local.del('p3d-codigo'); location.reload();
  });

  $('pinBox').addEventListener('submit', async e => {
    e.preventDefault();
    const pin = $('pin').value.trim();
    const erro = t => { $('pinErro').textContent = t; };
    if (!/^\d{4,8}$/.test(pin)) return erro('O PIN tem de 4 a 8 números.');
    if (!st.config.pinHash) {
      if (pin !== $('pin2').value.trim()) return erro('Os dois PINs não são iguais.');
      store.saveConfig({ pinHash: await hashPin(pin) });
      toast('PIN criado!');
    } else if (await hashPin(pin) !== st.config.pinHash) {
      $('pin').value = ''; return erro('PIN errado.');
    }
    ajustesAbertos = true; $('pin').value = ''; $('pin2').value = ''; erro('');
    preencherConfig(); mostrarAjustes();
  });
  $('trancar').addEventListener('click', () => { trancar(); toast('Ajustes trancados'); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) trancar(); });

  window.addEventListener('hashchange', rota);
}

/* ---------- início ---------- */
async function iniciar(codigo) {
  $('login').hidden = true;
  $('app').hidden = false; $('tabs').hidden = false;
  const selo = estado => {
    const [texto, classe] = { local: ['Só neste aparelho', ''], nuvem: ['Sincronizado', ' on'], erro: ['Sem conexão', ' err'] }[estado];
    $('sync').textContent = texto; $('sync').className = 'sync' + classe;
  };
  store = await abrirStore(codigo,
    s => { st = s; if (store) selo(store.modo); render(); },
    () => selo('erro'));
  selo(store.modo);
  if (store.modo === 'nuvem') { $('blocoCodigo').hidden = false; $('meuCodigo').textContent = codigo; }
  st = store.estado;
  render(); rota();
}

function telaLogin() {
  $('login').hidden = false;
  const erro = t => { $('loginErro').textContent = t; };
  $('entrar').addEventListener('click', async () => {
    const c = normalizarCodigo($('codigo').value);
    if (!c) return erro('O código tem o formato DT-XXXX-XXXX-XXXX.');
    erro(''); $('entrar').disabled = true; $('entrar').textContent = 'Procurando…';
    try {
      if (!await codigoExiste(c)) { erro('Não achei esse código. Confira as letras e os números.'); return; }
      local.set('p3d-codigo', c); iniciar(c);
    } catch { erro('Sem internet agora. Tente de novo daqui a pouco.'); }
    finally { $('entrar').disabled = false; $('entrar').textContent = 'Entrar'; }
  });
  $('criar').addEventListener('click', async () => {
    const c = novoCodigo();
    $('criar').disabled = true; $('criar').textContent = 'Criando…';
    try {
      await criarFamilia(c, DEFAULTS);
      local.set('p3d-codigo', c);
      await iniciar(c);
      location.hash = 'ajustes';
      toast('Código criado! Anote ele em Ajustes.');
    } catch { erro('Não consegui criar agora. Confira a internet e tente de novo.'); }
    finally { $('criar').disabled = false; $('criar').textContent = 'Criar um código novo'; }
  });
}

ligarEventos();
setWho(who);
limparCalculadora(); // sempre abre limpo, mesmo se o navegador tentar restaurar o que foi digitado antes
const codigo = local.get('p3d-codigo', null);
if (cloudEnabled && !codigo) telaLogin();
else iniciar(cloudEnabled ? codigo : null);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  // Quando sai uma versão nova do app, recarrega uma vez para já mostrar as mudanças.
  const tinhaVersao = !!navigator.serviceWorker.controller;
  let recarregou = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (tinhaVersao && !recarregou) { recarregou = true; location.reload(); }
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then(reg => {
      const conferir = () => reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => { if (!document.hidden) conferir(); });
    })
    .catch(() => {});
}
