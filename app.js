import { abrirStore, cloudEnabled, local, uid, novoCodigo, normalizarCodigo, codigoExiste, criarFamilia } from './store.js';

const INSTAGRAM = '@dt3dstudio';
const DEFAULTS = { kg: 100, watts: 120, kwh: 0.95, desg: 0.30, falha: 10, arred: 0.5, lucro: 100, pix: '', validade: 7, prazoPadrao: 3,
  // Mercado Livre (anúncio Clássico) — valores aproximados; conferir no Simulador de Custos do Mercado Livre
  mlComissao: 12, mlCustoUnid: 6.75, mlLimite: 79, mlFrete: 0, mlMetade: 'sim' };
const ML_METADE_ATE = 12.5;   // abaixo desse preço o Mercado Livre cobra metade do valor como custo por unidade
const QUEM = { Davi: 'var(--davi)', Theo: 'var(--theo)' };
const VENDEDORES = Object.keys(QUEM);
const vendedorValido = v => VENDEDORES.includes(v) ? v : null;
const STATUS = {
  aguardando: { nome: 'Esperando pagar a metade', cor: 'var(--st-agu)' },
  producao: { nome: 'Imprimindo', cor: 'var(--st-pro)' },
  entregue: { nome: 'Entregue', cor: 'var(--st-ent)' },
};

const $ = id => document.getElementById(id);
// Campos de dinheiro estilo app de banco: só números, a vírgula se ajusta sozinha (8 → 0,08 → 0,80).
const fmtMoney = v => (Math.round((+v || 0) * 100) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const brl = v => 'R$\u00a0' + fmtMoney(v);   // espaço que não quebra: o R$ nunca fica sozinho na linha
const ehDinheiro = el => el.dataset.money !== undefined;
// Campo de dinheiro vem como "1.234,56"; campo type=number já vem com ponto decimal ("12.5").
const lerDinheiro = txt => { const v = parseFloat(String(txt).replace(/\./g, '').replace(',', '.')); return isFinite(v) && v >= 0 ? v : 0; };
function num(id) {
  const el = $(id);
  if (ehDinheiro(el)) return lerDinheiro(el.value);
  const v = parseFloat(el.value);
  return isFinite(v) && v >= 0 ? v : 0;
}
function mascaraDinheiro(i) {
  const centavos = parseInt(i.value.replace(/\D/g, '') || '0', 10);
  i.value = fmtMoney(centavos / 100);
  try { i.setSelectionRange(i.value.length, i.value.length); } catch { /* sem cursor */ }
}
// Comparações de dinheiro: diferenças menores que meio centavo contam como iguais.
const CENTAVO = 0.005;
const iguais = (a, b) => Math.abs(a - b) < CENTAVO;
// Faixa do lucro, usada em todos os avisos: 'neg' (prejuízo), 'zero' (só paga o custo) ou 'ok'.
const faixaLucro = l => l <= -CENTAVO ? 'neg' : l < CENTAVO ? 'zero' : 'ok';
// Dados que vêm da nuvem nunca entram crus no HTML: texto passa por esc(), número por n(), foto por fotoSegura().
const n = v => Number(v) || 0;
const fotoSegura = u => /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(u || '') ? u : '';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dataBR = t => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const DIA = 86400000;
const ico = n => `<svg class="ic" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const cfgInputs = [...document.querySelectorAll('[data-cfg]')];

let store = null;
let st = { config: {}, pecas: [], pedidos: [] };
// Quem está vendendo neste celular (cada aparelho lembra o seu dono). Antes se chamava "quem fez".
let vendedor = vendedorValido(local.get('p3d-vendedor', null)) || vendedorValido(local.get('p3d-who', null)) || 'Davi';
let atual = null;          // resultado do último cálculo
let editando = null;       // id do pedido em edição
let precoManual = null;    // preço escolhido pelo lápis (null = usa o sugerido)
let verCusto = false;      // olho do Catálogo: custo e lucro ficam escondidos do cliente até tocar no olho

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

// Telefone do cliente: só os números (DDD + número), formatado como (19) 99999-9999.
function digitosFone(txt) {
  let d = String(txt || '').replace(/\D/g, '');
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);   // colou com +55
  return d.slice(0, 11);
}
function formatarFone(txt) {
  const d = digitosFone(txt);
  if (d.length <= 2) return d ? `(${d}` : '';
  const meio = d.length === 11 ? 7 : 6;
  return `(${d.slice(0, 2)}) ${d.slice(2, meio)}${d.length > meio ? '-' + d.slice(meio) : ''}`;
}
const foneValido = txt => /^[1-9]\d9?\d{8}$/.test(digitosFone(txt));   // DDD + 8 ou 9 dígitos

function abrirWhatsApp(texto, fone) {
  const d = digitosFone(fone);
  const url = (foneValido(d) ? `https://wa.me/55${d}` : 'https://wa.me/') + '?text=' + encodeURIComponent(texto);
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
// Grupo de botões Davi/Theo: marca o escolhido.
const marcarQuem = (grupo, k) => document.querySelectorAll(`#${grupo} button`).forEach(b => b.setAttribute('aria-pressed', b.dataset.k === k));
const quemMarcado = grupo => vendedorValido(document.querySelector(`#${grupo} button[aria-pressed=true]`)?.dataset.k) || vendedor;
function setVendedor(k) {
  vendedor = k; local.set('p3d-vendedor', k); marcarQuem('vendedor', k);
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
  precoManual = null; fecharEdicaoPreco();
  mostrarCalculo();
}

// Lápis da etiqueta: deixa escolher o preço antes de salvar a peça no catálogo.
function abrirEdicaoPreco() {
  $('precoLinha').hidden = true; $('precoEdit').hidden = false;
  $('precoManual').value = fmtMoney(atual.preco);
  $('precoManual').focus();
}
function fecharEdicaoPreco() { $('precoLinha').hidden = false; $('precoEdit').hidden = true; }
function confirmarPreco() {
  const v = lerDinheiro($('precoManual').value);
  if (v > 0) precoManual = iguais(v, atual.sugerido) ? null : v;   // igual ao sugerido = volta ao automático
  fecharEdicaoPreco(); mostrarCalculo();
}

function mostrarCalculo() {
  const sug = calcular();
  // com preço escolhido no lápis, o lucro passa a ser preço escolhido − custo
  const preco = precoManual ?? sug.preco;
  const r = { ...sug, sugerido: sug.preco, preco, lucro: Math.max(0, preco - sug.custo) };
  const nm = $('nome').value.trim();
  const manual = precoManual !== null;
  $('precoLbl').textContent = manual ? 'Seu preço por peça' : 'Preço sugerido por peça';
  $('price').textContent = brl(r.preco);
  $('sugerido').hidden = !manual;
  $('sugeridoTxt').textContent = `Sugerido pelo app: ${brl(r.sugerido)}.`;
  const margem = preco - sug.custo, faixa = faixaLucro(margem);
  $('alertaTag').hidden = !(manual && faixa !== 'ok');
  $('alertaTag').textContent = faixa === 'neg' ? `Abaixo do custo: vocês perdem ${brl(-margem)} em cada peça!` : 'Assim vocês só pagam o custo, sem lucro.';
  $('cost').textContent = brl(r.custo);
  $('profit').textContent = brl(r.lucro);
  $('pieceName').textContent = nm || 'Dê um nome para a peça';
  const partes = [['Filamento', r.fil, 'var(--c-fil)'], ['Energia', r.ene, 'var(--c-ene)'], ['Desgaste', r.des, 'var(--c-des)'],
    ['Extras', r.ext, 'var(--c-ext)'], ['Falhas', r.falha, 'var(--c-fal)'], ['Seu lucro', r.lucro, 'var(--c-luc)', 'luc']];
  const tot = partes.reduce((s, p) => s + p[1], 0) || 1;
  $('bar').innerHTML = partes.map(p => `<i style="width:${p[1] / tot * 100}%;background:${p[2]}" title="${p[0]}"></i>`).join('');
  $('legend').innerHTML = partes.filter(p => p[1] >= CENTAVO).map(p => `<span class="${p[3] || ''}" style="--d:${p[2]}">${p[0]} ${brl(p[1])}</span>`).join('');
  syncPresets();
  atual = { ...r, nome: nm };
}

/* ---------- catálogo e vendas na hora (escola) ---------- */
// Cada venda guarda o valor real recebido; peças antigas (só com a contagem) usam o preço do catálogo.
const recebidoPeca = p => n(p.recebido ?? n(p.vendidas) * n(p.preco));
const custoVendidoPeca = p => n(p.custoVendido ?? n(p.vendidas) * n(p.custo));
// Totais de cada vendedor numa peça. Vendas antigas (sem vendedor) contam para quem estava marcado na peça.
function vendasDaPeca(p) {
  const r = {};
  for (const v of VENDEDORES) { const x = p.vendas?.[v] || {}; r[v] = { qtd: n(x.qtd), recebido: n(x.recebido), custo: n(x.custo) }; }
  const dono = vendedorValido(p.who);
  if (dono) {
    const soma = k => VENDEDORES.reduce((s, v) => s + r[v][k], 0);
    r[dono].qtd += Math.max(0, n(p.vendidas) - soma('qtd'));
    r[dono].recebido += Math.max(0, recebidoPeca(p) - soma('recebido'));
    r[dono].custo += Math.max(0, custoVendidoPeca(p) - soma('custo'));
  }
  return r;
}
function vender(p, qtd, preco, quem) {
  const v = { qtd, preco, custo: p.custo, em: Date.now(), vendedor: quem };
  // peça antiga: primeiro grava o que já tinha sido vendido, para o increment somar certo
  if (p.vendidas && p.recebido === undefined) store.savePeca({ ...p, recebido: recebidoPeca(p), custoVendido: custoVendidoPeca(p) });
  store.registrarVenda(p.id, v);
}
let vendaPeca = null;
function abrirVenda(p) {
  vendaPeca = p;
  $('vendaTitulo').textContent = 'Vender ' + p.nome;
  marcarQuem('vendaQuem', vendedor);
  $('vendaQtd').value = 1; $('vendaPreco').value = fmtMoney(p.preco);
  $('vendaCatalogo').textContent = `Preço do catálogo: ${brl(p.preco)}` + (verCusto ? ` · custo de cada: ${brl(p.custo)}` : '');
  atualizarVenda(); $('dlgVenda').showModal();
}
function dadosVenda() { return { qtd: Math.max(1, Math.round(num('vendaQtd')) || 1), preco: num('vendaPreco') }; }
function atualizarVenda() {
  const { qtd, preco } = dadosVenda(); const lucro = qtd * (preco - vendaPeca.custo);
  $('vendaTotal').textContent = brl(qtd * preco);
  const faixa = faixaLucro(lucro);
  // com o olho fechado o cliente pode estar vendo: o aviso de prejuízo continua, mas sem números
  const textos = verCusto
    ? { neg: `Abaixo do custo: vocês PERDEM ${brl(-lucro)} nesta venda!`, zero: 'Assim vocês só pagam o custo, sem lucro.', ok: `Vocês ganham ${brl(lucro)} nesta venda.` }
    : { neg: 'Atenção: esse preço é menor que o custo!', zero: 'Atenção: esse preço só paga o custo.', ok: '' };
  $('vendaAviso').textContent = textos[faixa];
  $('vendaAviso').className = 'aviso ' + faixa;
}

function renderPecas() {
  const ps = st.pecas;
  const vendidas = ps.reduce((s, i) => s + n(i.vendidas), 0);
  const ganho = ps.reduce((s, i) => s + recebidoPeca(i), 0);
  const lucro = ps.reduce((s, i) => s + recebidoPeca(i) - custoVendidoPeca(i), 0);
  const OCULTO = 'R$\u00a0••••';
  const porVend = VENDEDORES.map(v => {
    const t = ps.reduce((a, p) => { const x = vendasDaPeca(p)[v]; return { qtd: a.qtd + x.qtd, recebido: a.recebido + x.recebido, custo: a.custo + x.custo }; }, { qtd: 0, recebido: 0, custo: 0 });
    return `<div class="vend" style="--c:${QUEM[v]}">${v}<b>${brl(t.recebido)}</b><small>${t.qtd} vendida${t.qtd === 1 ? '' : 's'}${verCusto ? ` · lucro ${brl(t.recebido - t.custo)}` : ''}</small></div>`;
  }).join('');
  $('totPecas').innerHTML = `<div>Vendidas na escola<b>${vendidas}</b></div><div>Dinheiro recebido<b>${brl(ganho)}</b></div><div>Lucro de verdade<b>${verCusto ? brl(lucro) : OCULTO}</b></div><i class="quebra"></i>${porVend}`;
  $('olho').setAttribute('aria-pressed', verCusto);
  $('olho').setAttribute('aria-label', verCusto ? 'Esconder custo' : 'Ver custo');
  $('olho').innerHTML = `${ico(verCusto ? 'olho' : 'olho-fechado')}<span>${verCusto ? 'Esconder' : 'Ver custo'}</span>`;
  $('listaPecas').innerHTML = ps.length ? ps.map(i => { const id = esc(i.id), foto = fotoSegura(i.foto); return `<li>
      <button class="foto" data-a="foto" data-id="${id}" style="--c:var(--brand)"
        aria-label="${foto ? 'Ver foto de' : 'Colocar foto em'} ${esc(i.nome)}">${foto ? `<img src="${foto}" alt="">` : ico('camera')}</button>
      <div><div class="nm">${esc(i.nome)}</div>
      <div class="meta">${verCusto ? `custo ${brl(i.custo)} · ` : ''}vendidas: ${n(i.vendidas)}</div></div>
      <div class="pr">${brl(i.preco)}</div>
      <div class="acts">
        <button class="sold" data-a="vendi" data-id="${id}">${ico('moeda')}Vendi uma!</button>
        <button class="varias" data-a="varias" data-id="${id}">${ico('moedas')}Vendi várias</button>
        ${i.ultimaVenda ? `<button data-a="desfazer" data-id="${id}">Desfazer última venda (${n(i.ultimaVenda.qtd)} un)</button>` : ''}
        <button class="go" data-a="orcar" data-id="${id}">${ico('aviao')}Mandar o preço</button>
        <button data-a="apagar" data-id="${id}">${ico('lixeira')}Apagar</button>
      </div></li>`; }).join('')
    : '<li class="empty">Nenhuma peça no catálogo ainda. Calcule o preço e toque em “Salvar no catálogo”.</li>';
}

function esconderCusto() { verCusto = false; renderPecas(); }

/* ---------- fotos das peças ---------- */
// A foto é reduzida para um quadrado pequeno (vitrine) e guardada junto com a peça,
// para caber no plano gratuito do Firebase sem precisar do Storage (que é pago).
const FOTO_LADO = 320;
const fotoDaPeca = id => fotoSegura(st.pecas.find(p => p.id === id)?.foto);
async function reduzirFoto(arquivo) {
  const img = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
  const lado = Math.min(img.width, img.height);
  const c = document.createElement('canvas'); c.width = c.height = FOTO_LADO;
  c.getContext('2d').drawImage(img, (img.width - lado) / 2, (img.height - lado) / 2, lado, lado, 0, 0, FOTO_LADO, FOTO_LADO);
  img.close?.();
  let q = 0.75, url = c.toDataURL('image/jpeg', q);
  while (url.length > 45000 && q > 0.4) { q -= 0.1; url = c.toDataURL('image/jpeg', q); }  // ~30 KB no máximo
  return url;
}
let fotoPecaId = null;
function escolherFoto(id) { fotoPecaId = id; $('fotoInput').value = ''; $('fotoInput').click(); }
function verFoto(p) {
  fotoPecaId = p.id;
  $('fotoGrande').src = fotoSegura(p.foto); $('fotoGrande').alt = 'Foto de ' + p.nome; $('fotoNome').textContent = p.nome;
  $('dlgFoto').showModal();
}

/* ---------- pedidos ---------- */
// Valores do pedido: o desconto sai do subtotal; a metade e o lucro já consideram o desconto.
const subtotalPedido = p => p.itens.reduce((s, i) => s + n(i.qtd) * n(i.preco), 0);
const descontoPedido = p => Math.min(n(p.desconto), subtotalPedido(p));
const totalPedido = p => subtotalPedido(p) - descontoPedido(p);
const custoPedido = p => p.itens.reduce((s, i) => s + n(i.qtd) * n(i.custo), 0);
const lucroPedido = p => totalPedido(p) - custoPedido(p);
const sinalPedido = p => Math.round(totalPedido(p) * 50) / 100;
// Pagamento: em produção o cliente pagou a metade (padrão) ou tudo; entregue = tudo pago.
const pagouTudo = p => p.status === 'entregue' || (p.status === 'producao' && p.pago === 'total');
const pagoPedido = p => p.status === 'aguardando' ? 0 : pagouTudo(p) ? totalPedido(p) : sinalPedido(p);
const faltaPedido = p => p.status === 'producao' ? totalPedido(p) - pagoPedido(p) : 0;

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
  const tudo = pagouTudo(p);
  return [
    '*DT 3D STUDIO* — Pedido confirmado! ✅',
    tudo ? `Oi, ${p.cliente}! Recebemos o pagamento total de ${brl(totalPedido(p))}.` : `Oi, ${p.cliente}! Recebemos seu sinal de ${brl(sinalPedido(p))}.`,
    'Já vamos começar a imprimir suas peças.',
    `Previsão de entrega: ${dataBR(p.sinalEm + p.prazo * DIA)}`,
    tudo ? 'Nada a pagar na entrega!' : `Restante a pagar na entrega: ${brl(faltaPedido(p))}`,
    'Obrigado pela confiança!',
    INSTAGRAM,
  ].join('\n');
}

function renderPedidos() {
  const ps = st.pedidos;
  const recebido = ps.reduce((s, p) => s + pagoPedido(p), 0);
  const aReceber = ps.reduce((s, p) => s + faltaPedido(p), 0);
  const emProd = ps.filter(p => p.status === 'producao').length;
  const lucro = ps.filter(p => p.status === 'entregue').reduce((s, p) => s + lucroPedido(p), 0);
  const porVend = VENDEDORES.map(v => {
    const meus = ps.filter(p => vendedorValido(p.vendedor) === v);
    return `<div class="vend" style="--c:${QUEM[v]}">${v}<b>${brl(meus.reduce((s, p) => s + pagoPedido(p), 0))}</b><small>${meus.length} pedido${meus.length === 1 ? '' : 's'} · já recebido</small></div>`;
  }).join('');
  $('totPedidos').innerHTML = `<div>Para imprimir<b>${emProd}</b></div><div>Já recebido<b>${brl(recebido)}</b></div><div>A receber na entrega<b>${brl(aReceber)}</b></div><div>Lucro dos entregues<b>${brl(lucro)}</b></div><i class="quebra"></i>${porVend}`;
  $('listaPedidos').innerHTML = ps.length ? ps.map(p => {
    const s = STATUS[p.status] || STATUS.aguardando, id = esc(p.id);
    const total = totalPedido(p), sinal = sinalPedido(p);
    const info = p.status === 'aguardando'
      ? `<span>Metade: <b>${brl(sinal)}</b></span><span>Preço vale até <b>${dataBR(p.criada + cfg('validade') * DIA)}</b></span>`
      : p.status === 'producao'
        ? `<span>${pagouTudo(p) ? 'Pago' : 'Metade paga'}: <b>${brl(pagoPedido(p))}</b></span><span>Falta: <b>${brl(faltaPedido(p))}</b></span><span>Entrega: <b>${dataBR(p.sinalEm + p.prazo * DIA)}</b></span>`
        : `<span>Pago: <b>${brl(total)}</b></span><span>Entregue em <b>${dataBR(p.entregueEm)}</b></span>`;
    const bts = {
      aguardando: `<button class="wa" data-a="msgOrc" data-id="${id}">${ico('aviao')}Mandar preço no WhatsApp</button>
        <button class="go" data-a="sinal" data-id="${id}">${ico('metade')}Cliente pagou a metade</button>
        <button class="go" data-a="tudo" data-id="${id}">${ico('moeda')}Cliente pagou tudo</button>
        <button data-a="editar" data-id="${id}">${ico('lapis')}Editar</button>`,
      producao: `<button class="wa" data-a="msgConf" data-id="${id}">${ico('aviao')}Avisar que vamos fazer</button>
        ${pagouTudo(p) ? '' : `<button class="go" data-a="resto" data-id="${id}">${ico('moeda')}Cliente pagou o resto</button>`}
        <button class="go" data-a="entregue" data-id="${id}">${ico('caixa')}${pagouTudo(p) ? 'Entreguei' : 'Entreguei e recebi o resto'}</button>
        <button data-a="voltar" data-id="${id}">${p.restoAntes ? 'Desfazer pagamento do resto' : 'Ainda não pagou'}</button>`,
      entregue: `<button data-a="reabrir" data-id="${id}">Desfazer entrega</button>`,
    }[p.status] || '';
    return `<li>
      <div class="ph"><div><div class="nm">${esc(p.cliente)}</div><div class="meta">Pedido de ${dataBR(p.criada)}${vendedorValido(p.vendedor) ? ` · vendido por ${p.vendedor}` : ''}</div></div>
      <div class="sts"><span class="st" style="--s:${s.cor}">${s.nome}</span>${p.status === 'producao' && pagouTudo(p) ? '<span class="st pago">Pago</span>' : ''}</div></div>
      <ul class="pl">${p.itens.map(i => { const f = fotoDaPeca(i.pecaId); return `<li><span>${f ? `<img class="mf" src="${f}" alt="">` : ''}${n(i.qtd)}x ${esc(i.nome)}</span><span>${brl(i.qtd * i.preco)}</span></li>`; }).join('')}
      ${descontoPedido(p) > 0 ? `<li class="desc"><span>Desconto</span><span>− ${brl(descontoPedido(p))}</span></li>` : ''}
      <li><b>Total</b><b>${brl(total)}</b></li></ul>
      <div class="pv">${info}</div>
      <div class="acts">${bts}
        <button data-a="copiarMsg" data-id="${id}">${ico('copiar')}Copiar mensagem</button>
        <button data-a="apagarPedido" data-id="${id}">${ico('lixeira')}Apagar</button></div></li>`;
  }).join('') : '<li class="empty">Nenhum pedido ainda. Toque em “Novo pedido” ou em “Mandar o preço” no catálogo.</li>';
}

async function enviarOrcamento(p) {
  if (!cfg('pix') && !await perguntar('A chave Pix ainda não foi cadastrada em Ajustes (peça ao papai). Mandar mesmo assim?', 'Mandar', 'Voltar')) return;
  abrirWhatsApp(msgOrcamento(p), p.fone);
}

/* formulário de pedido */
function opcoesPecas(sel) {
  return st.pecas.map(p => `<option value="${esc(p.id)}"${p.id === sel ? ' selected' : ''}>${esc(p.nome)}</option>`).join('');
}
// Cada linha do pedido: peça do catálogo, quantidade e preço combinado com ESTE cliente.
// O preço vem do catálogo, mas pode ser mudado; o catálogo continua como está.
const pecaDaLinha = div => st.pecas.find(p => p.id === div.querySelector('select').value);
function infoLinha(div) {
  const peca = pecaDaLinha(div); if (!peca) return;
  const preco = lerDinheiro(div.querySelector('.preco').value);
  const dif = preco - peca.preco;
  const txt = iguais(dif, 0) ? `Preço do catálogo: ${brl(peca.preco)}`
    : `Catálogo: ${brl(peca.preco)} · combinado ${dif > 0 ? 'acima' : 'abaixo'} (${dif > 0 ? '+' : '−'}\u00a0${brl(Math.abs(dif))})`;
  div.querySelector('.info').textContent = txt;
}
function linhaForm(item = {}) {
  const div = document.createElement('div');
  div.className = 'it';
  const pecaId = item.pecaId || st.pecas[0]?.id;
  const preco = item.preco ?? st.pecas.find(p => p.id === pecaId)?.preco ?? 0;
  div.innerHTML = `<select class="peca" aria-label="Peça">${opcoesPecas(pecaId)}</select>
    <button type="button" class="tirar" aria-label="Tirar peça">×</button>
    <div class="unit q"><input class="qtd" type="number" inputmode="numeric" min="1" step="1" value="${n(item.qtd) || 1}" aria-label="Quantidade"><span>un</span></div>
    <div class="unit v"><input class="preco" type="text" inputmode="numeric" data-money value="${fmtMoney(preco)}" aria-label="Preço combinado de cada uma"><span>R$ cada</span></div>
    <small class="info"></small>`;
  $('itensForm').appendChild(div);
  infoLinha(div);
}
function itensDoForm() {
  return [...$('itensForm').children].map(div => {
    const peca = pecaDaLinha(div);
    const qtd = Math.max(1, Math.round(parseFloat(div.querySelector('.qtd').value)) || 1);
    const preco = lerDinheiro(div.querySelector('.preco').value);
    return peca && { pecaId: peca.id, nome: peca.nome, preco, precoCatalogo: peca.preco, custo: peca.custo, qtd };
  }).filter(Boolean).reduce((lista, i) => {   // mesma peça pelo mesmo preço vira uma linha só
    const j = lista.find(x => x.pecaId === i.pecaId && iguais(x.preco, i.preco));
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
  // o aviso aparece quando o preço foi negociado (desconto ou preço diferente do catálogo)
  const av = $('formLucro');
  const mudou = p.itens.filter(i => !iguais(i.preco, i.precoCatalogo));
  if (!(p.desconto > 0) && !mudou.length) { av.textContent = ''; av.className = 'aviso'; return; }
  if (p.desconto > subtotalPedido(p)) { av.textContent = 'O desconto é maior que o valor do pedido.'; av.className = 'aviso neg'; return; }
  const abaixoCusto = p.itens.find(i => faixaLucro(i.preco - i.custo) === 'neg');
  const subiu = !(p.desconto > 0) && mudou.every(i => i.preco > i.precoCatalogo);
  const faixa = faixaLucro(lucro);
  const [classe, texto] = faixa === 'neg' ? ['neg', `Com esse preço vocês PERDEM ${brl(-lucro)}!`]
    : abaixoCusto ? ['neg', `“${abaixoCusto.nome}” por ${brl(abaixoCusto.preco)} sai mais barato que o custo (${brl(abaixoCusto.custo)}).`]
    : faixa === 'zero' ? ['zero', 'Cuidado: assim vocês só pagam o custo, sem lucro nenhum.']
    : subiu ? ['ok', `Boa negociação! Vocês ganham ${brl(lucro)} neste pedido.`]
    : ['ok', `Com esse preço vocês ainda ganham ${brl(lucro)}.`];
  av.textContent = texto; av.className = 'aviso ' + classe;
}
function abrirForm(pedido, pecaId) {
  if (!st.pecas.length) { toast('Primeiro salve uma peça no catálogo'); location.hash = 'calcular'; return; }
  editando = pedido ? pedido.id : null;
  $('formTitulo').textContent = pedido ? 'Editar pedido' : 'Novo pedido';
  $('cliente').value = pedido ? pedido.cliente : '';
  $('fone').value = pedido ? formatarFone(pedido.fone) : '';
  $('prazo').value = pedido ? pedido.prazo : cfg('prazoPadrao');
  $('desconto').value = fmtMoney(pedido ? pedido.desconto || 0 : 0);
  marcarQuem('pedidoQuem', vendedorValido(pedido?.vendedor) || vendedor);
  $('itensForm').innerHTML = '';
  (pedido ? pedido.itens : [{ pecaId: pecaId || st.pecas[0].id, qtd: 1 }]).forEach(i => linhaForm(i));
  $('formErro').textContent = '';
  $('formPedido').hidden = false;
  atualizarTotalForm();
  $('cliente').focus();
}
function fecharForm() { $('formPedido').hidden = true; editando = null; }

/* ---------- Marketplace (Mercado Livre) ---------- */
// Tarifas de um anúncio vendido por P reais.
function tarifasML(P) {
  const comissao = P * n(cfg('mlComissao')) / 100;
  const unidade = P >= n(cfg('mlLimite')) ? 0 : (cfg('mlMetade') === 'sim' && P < ML_METADE_ATE ? P * 0.5 : n(cfg('mlCustoUnid')));
  const frete = n(cfg('mlFrete'));
  return { comissao, unidade, frete, recebe: P - comissao - unidade - frete };
}
// Menor preço de anúncio (arredondado para cima) para receber pelo menos `alvo` reais.
// O custo por unidade muda por faixa de preço, então resolve a conta em cada faixa e fica com o menor preço que serve.
function precoML(alvo) {
  if (!(alvo > 0)) return 0;
  const pct = n(cfg('mlComissao')) / 100, lim = n(cfg('mlLimite')), fixo = n(cfg('mlCustoUnid')), frete = n(cfg('mlFrete'));
  const faixas = cfg('mlMetade') === 'sim'
    ? [[0, Math.min(ML_METADE_ATE, lim), 0.5, 0], [ML_METADE_ATE, lim, 0, fixo], [lim, Infinity, 0, 0]]
    : [[0, lim, 0, fixo], [lim, Infinity, 0, 0]];
  const candidatos = faixas.map(([de, ate, pctUnid, fixoUnid]) => {
    const div = 1 - pct - pctUnid; if (div <= 0 || de >= ate) return Infinity;
    const P = Math.max(de, (alvo + frete + fixoUnid) / div);
    return P < ate ? P : Infinity;
  });
  const passo = n(cfg('arred')) || 0.01;
  let P = Math.ceil(Math.min(...candidatos) / passo - 1e-9) * passo;
  for (let i = 0; i < 100000 && tarifasML(P).recebe < alvo - CENTAVO; i++) P += passo;   // o arredondamento pode cruzar uma faixa
  return P;
}
function cartaoML(p) {
  const kit = Math.max(1, Math.round(n(p.mlKit)) || 1);
  const alvo = kit * n(p.preco), P = precoML(alvo), t = tarifasML(P), lucro = t.recebe - kit * n(p.custo);
  const lim = n(cfg('mlLimite')), pct = n(cfg('mlComissao')) / 100;
  // quantas unidades o kit precisa para passar do limite e não pagar custo por unidade
  const kitLivre = n(p.preco) > 0 && pct < 1 ? Math.ceil((lim * (1 - pct) - n(cfg('mlFrete'))) / n(p.preco) - 1e-9) : 0;
  const avisos = [];
  if (cfg('mlMetade') === 'sim' && P < ML_METADE_ATE) avisos.push(['zero', `Abaixo de ${brl(ML_METADE_ATE)} o Mercado Livre fica com metade do preço. Vale montar um kit.`]);
  if (P < lim && kitLivre > kit) avisos.push(['zero', `Com ${kitLivre} unidades no kit, o anúncio passa de ${brl(lim)} e não paga custo por unidade.`]);
  if (P >= lim) avisos.push(['ok', `A partir de ${brl(lim)} não tem custo por unidade.`]);
  const foto = fotoSegura(p.foto);
  return `<li data-id="${esc(p.id)}">
    <div class="ml-top">
      <span class="mf">${foto ? `<img class="mf" src="${foto}" alt="">` : ico('camera')}</span>
      <div><div class="nm">${esc(p.nome)}</div><div class="meta">Na escola: ${brl(p.preco)} cada</div></div>
      <div class="ml-kit"><label for="kit-${esc(p.id)}">Unidades no anúncio</label><div class="unit"><input id="kit-${esc(p.id)}" class="kit" type="number" inputmode="numeric" min="1" step="1" value="${kit}"><span>un</span></div></div>
    </div>
    <div class="ml-preco"><small>Anunciar por</small><b>${brl(P)}</b>${kit > 1 ? `<small>${brl(P / kit)} cada</small>` : ''}</div>
    <ul class="ml-conta">
      <li><span>Comissão (${n(cfg('mlComissao')).toLocaleString('pt-BR')}%)</span><span>− ${brl(t.comissao)}</span></li>
      <li><span>Custo por unidade do Mercado Livre</span><span>− ${brl(t.unidade)}</span></li>
      ${t.frete > 0 ? `<li><span>Frete</span><span>− ${brl(t.frete)}</span></li>` : ''}
      <li class="tot"><span>Vocês recebem</span><span>${brl(t.recebe)}</span></li>
      <li><span>Na escola, ${kit} un daria</span><span>${brl(alvo)}</span></li>
      <li><span>Lucro (tirando o custo de fazer)</span><span>${brl(lucro)}</span></li>
    </ul>
    ${avisos.map(([c, txt]) => `<p class="aviso ${c}">${txt}</p>`).join('')}
  </li>`;
}
function renderMercado() {
  $('mlResumo').textContent = `Mercado Livre · Clássico ${n(cfg('mlComissao')).toLocaleString('pt-BR')}%`;
  if ($('listaML').contains(document.activeElement)) return;   // não refaz a lista enquanto digitam o kit
  $('listaML').innerHTML = st.pecas.length ? st.pecas.map(cartaoML).join('')
    : '<li class="empty">Nenhuma peça no catálogo ainda. Calcule o preço e salve no catálogo.</li>';
}

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
const VIEWS = ['calcular', 'pecas', 'pedidos', 'mercado', 'ajustes'];
function rota() {
  const v = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'calcular';
  if (v !== 'ajustes' && ajustesAbertos) trancar();
  if (v !== 'pecas' && verCusto) esconderCusto();
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
  renderMercado();
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
  document.querySelectorAll('#v-calcular input:not(#precoManual)').forEach(i => i.addEventListener('input', () => { mostrarCalculo(); if (i.dataset.cfg !== undefined) salvarConfig(); }));
  $('editarPreco').addEventListener('click', abrirEdicaoPreco);
  $('precoEdit').addEventListener('submit', e => { e.preventDefault(); confirmarPreco(); });
  $('precoManual').addEventListener('blur', () => { if (!$('precoEdit').hidden) confirmarPreco(); });
  $('voltarSugerido').addEventListener('click', () => { precoManual = null; mostrarCalculo(); toast('Voltou ao preço sugerido'); });
  cfgInputs.forEach(i => { if (!i.closest('#v-calcular')) i.addEventListener('input', () => { mostrarCalculo(); renderMercado(); salvarConfig(); }); });
  // Marketplace: kit de cada peça (atualiza o cartão na hora e salva na peça)
  const tKit = {};
  $('listaML').addEventListener('input', e => {
    if (!e.target.classList.contains('kit')) return;
    const li = e.target.closest('li[data-id]'); const p = st.pecas.find(x => x.id === li.dataset.id); if (!p) return;
    const kit = Math.max(1, Math.round(n(e.target.value)) || 1);
    const tmp = document.createElement('ul'); tmp.innerHTML = cartaoML({ ...p, mlKit: kit });
    for (const sel of ['.ml-preco', '.ml-conta']) li.querySelector(sel).replaceWith(tmp.querySelector(sel));
    li.querySelectorAll('.aviso').forEach(a => a.remove()); tmp.querySelectorAll('.aviso').forEach(a => li.appendChild(a));
    clearTimeout(tKit[p.id]); tKit[p.id] = setTimeout(() => store.savePeca({ ...p, mlKit: kit }), 600);
  });
  $('listaML').addEventListener('focusout', () => setTimeout(renderMercado, 700));
  $('limpar').addEventListener('click', () => { limparCalculadora(); window.scrollTo(0, 0); toast('Campos limpos'); });
  $('home').addEventListener('click', e => {
    if (location.hash === '#calcular' || !location.hash) { e.preventDefault(); rota(); }
  });
  $('vendedor').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { setVendedor(b.dataset.k); toast(`Agora vendendo: ${b.dataset.k}`); } });
  for (const g of ['vendaQuem', 'pedidoQuem']) $(g).addEventListener('click', e => { const b = e.target.closest('button'); if (b) marcarQuem(g, b.dataset.k); });
  // escolher um botão de lucro volta ao preço calculado pelo app
  $('presets').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; $('lucro').value = b.dataset.v; precoManual = null; mostrarCalculo(); salvarConfig(); });

  // Salva a peça calculada (as peças são da loja); se já existe uma igual (mesmo nome e preço), reaproveita.
  function salvarPecaAtual() {
    mostrarCalculo();
    if (!atual.nome) { toast('Dê um nome para a peça'); $('nome').focus(); return null; }
    const igual = st.pecas.find(p => p.nome === atual.nome && iguais(p.preco, atual.preco));
    if (igual) return { peca: igual, nova: false };
    const peca = { id: uid(), nome: atual.nome, preco: atual.preco, custo: atual.custo, vendidas: 0, criada: Date.now() };
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
    if (a === 'foto') { if (p.foto) verFoto(p); else escolherFoto(p.id); }
    if (a === 'vendi') { vender(p, 1, p.preco, vendedor); toast(`Mais uma venda do ${vendedor}!`); }
    if (a === 'varias') abrirVenda(p);
    if (a === 'desfazer' && p.ultimaVenda) {
      const v = p.ultimaVenda;
      if (v.qtd === 1 || await perguntar(`Desfazer a venda de ${v.qtd} un de “${p.nome}” (${brl(v.qtd * v.preco)})?`, 'Desfazer', 'Cancelar')) {
        store.desfazerVenda(p.id); toast('Venda desfeita');
      }
    }
    if (a === 'orcar') { location.hash = 'pedidos'; abrirForm(null, p.id); }
    if (a === 'apagar' && await perguntar(`Apagar “${p.nome}” do catálogo?`, 'Apagar', 'Cancelar')) store.deletePeca(p.id);
  });

  $('fotoInput').addEventListener('change', async () => {
    const arq = $('fotoInput').files[0]; const p = st.pecas.find(x => x.id === fotoPecaId);
    if (!arq || !p) return;
    try { store.savePeca({ ...p, foto: await reduzirFoto(arq) }); toast('Foto salva!'); }
    catch { toast('Não consegui abrir essa foto. Tente outra.'); }
  });
  $('fotoTrocar').addEventListener('click', () => { $('dlgFoto').close(); escolherFoto(fotoPecaId); });
  $('fotoFechar').addEventListener('click', () => $('dlgFoto').close());
  $('fotoRemover').addEventListener('click', async () => {
    $('dlgFoto').close();
    const p = st.pecas.find(x => x.id === fotoPecaId);
    if (p && await perguntar(`Remover a foto de “${p.nome}”?`, 'Remover', 'Cancelar')) { const { foto, ...sem } = p; store.savePeca(sem); }
  });

  $('formVenda').addEventListener('input', atualizarVenda);
  $('vendaCancelar').addEventListener('click', () => $('dlgVenda').close());
  $('formVenda').addEventListener('submit', async e => {
    e.preventDefault();
    const { qtd, preco } = dadosVenda(); const p = vendaPeca;
    if (!(preco > 0)) { $('vendaPreco').focus(); return; }
    const lucro = qtd * (preco - p.custo);
    $('dlgVenda').close();
    if (faixaLucro(lucro) === 'neg' && !await perguntar(`Vendendo assim vocês PERDEM ${brl(-lucro)}. Registrar mesmo assim?`, 'Registrar', 'Voltar')) { $('dlgVenda').showModal(); return; }
    const quem = quemMarcado('vendaQuem');
    vender(p, qtd, preco, quem);
    toast(`${qtd === 1 ? 'Venda registrada' : `${qtd} vendas registradas`} para o ${quem}: ${brl(qtd * preco)}`);
  });

  $('copiarCatalogo').addEventListener('click', () => {
    const t = '*DT 3D STUDIO* — Pecinhas à venda\n' + (st.pecas.length ? st.pecas.map(i => `• ${i.nome} — ${brl(i.preco)}`).join('\n') : '(catálogo vazio)') + `\n\nSiga a gente no Instagram: ${INSTAGRAM}`;
    copiar(t, 'Catálogo copiado! Cole no WhatsApp.');
  });
  $('zerar').addEventListener('click', async () => {
    if (!await perguntar('Zerar a contagem de vendas na escola de todas as peças?', 'Zerar', 'Cancelar')) return;
    st.pecas.filter(p => p.vendidas || p.recebido).forEach(p => store.savePeca({ ...p, vendidas: 0, recebido: 0, custoVendido: 0, vendas: {}, ultimaVenda: null }));
    toast('Vendas zeradas');
  });

  $('novoPedido').addEventListener('click', () => abrirForm());
  $('cancelarPedido').addEventListener('click', fecharForm);
  $('addItem').addEventListener('click', () => { linhaForm(); atualizarTotalForm(); });  // nova linha com a 1ª peça e seu preço
  $('itensForm').addEventListener('input', e => {
    const linha = e.target.closest('.it');
    if (e.target.classList.contains('preco')) mascaraDinheiro(e.target);
    if (e.target.classList.contains('peca')) {   // trocou a peça: o preço volta para o do catálogo
      const peca = pecaDaLinha(linha); if (peca) linha.querySelector('.preco').value = fmtMoney(peca.preco);
    }
    if (linha) infoLinha(linha);
    atualizarTotalForm();
  });
  $('desconto').addEventListener('input', atualizarTotalForm);
  $('fone').addEventListener('input', () => { const el = $('fone'); el.value = formatarFone(el.value); });
  $('itensForm').addEventListener('click', e => {
    const b = e.target.closest('button.tirar'); if (!b) return;
    if ($('itensForm').children.length > 1) { b.closest('.it').remove(); atualizarTotalForm(); }
  });
  $('formPedido').addEventListener('submit', async e => {
    e.preventDefault();
    const cliente = $('cliente').value.trim();
    const itens = itensDoForm();
    if (!cliente) { $('formErro').textContent = 'Coloque o nome do cliente.'; $('cliente').focus(); return; }
    if (!digitosFone($('fone').value)) { $('formErro').textContent = 'Coloque o WhatsApp do cliente, com DDD.'; $('fone').focus(); return; }
    if (!foneValido($('fone').value)) { $('formErro').textContent = 'O WhatsApp precisa ter DDD + número, ex.: (19) 99999-9999.'; $('fone').focus(); return; }
    if (!itens.length) { $('formErro').textContent = 'Escolha pelo menos uma peça.'; return; }
    const desconto = num('desconto');
    if (desconto > subtotalPedido({ itens })) { $('formErro').textContent = 'O desconto é maior que o valor do pedido.'; $('desconto').focus(); return; }
    const antigo = st.pedidos.find(p => p.id === editando);
    const pedido = {
      ...(antigo || { id: uid(), status: 'aguardando', criada: Date.now() }),
      cliente, fone: formatarFone($('fone').value), prazo: Math.round(num('prazo')), itens, desconto, vendedor: quemMarcado('pedidoQuem'),
    };
    const lucro = lucroPedido(pedido);
    if (faixaLucro(lucro) === 'neg' && !await perguntar(`Com esse preço vocês PERDEM ${brl(-lucro)}. Salvar mesmo assim?`, 'Salvar assim', 'Voltar')) return;
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
      store.savePedido({ ...p, status: 'producao', pago: 'metade', restoAntes: false, sinalEm: Date.now() });
      toast('Hora de imprimir! Toque em “Avisar que vamos fazer”.');
    }
    if (a === 'tudo' && await perguntar(`${p.cliente} pagou tudo (${brl(totalPedido(p))})? Confira se o dinheiro caiu no Pix.`, 'Pagou tudo', 'Ainda não')) {
      store.savePedido({ ...p, status: 'producao', pago: 'total', restoAntes: false, sinalEm: Date.now() });
      toast('Pago! Hora de imprimir. Toque em “Avisar que vamos fazer”.');
    }
    if (a === 'resto' && await perguntar(`${p.cliente} pagou o resto (${brl(faltaPedido(p))}) antes da entrega? Confira se o dinheiro caiu no Pix.`, 'Pagou', 'Ainda não')) {
      store.savePedido({ ...p, pago: 'total', restoAntes: true });
      toast('Pedido pago! Na entrega não precisa cobrar nada.');
    }
    if (a === 'entregue' && await perguntar(pagouTudo(p) ? `Entregou as peças para ${p.cliente}?` : `Entregou a peça e recebeu o resto (${brl(faltaPedido(p))})?`, 'Sim', 'Ainda não')) {
      store.savePedido({ ...p, status: 'entregue', entregueEm: Date.now() });
      toast('Pedido concluído!');
    }
    // desfaz um passo: o pagamento do resto (volta a metade) ou o primeiro pagamento (volta a esperar)
    if (a === 'voltar') store.savePedido(p.restoAntes ? { ...p, pago: 'metade', restoAntes: false } : { ...p, status: 'aguardando', pago: null, restoAntes: false, sinalEm: null });
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
  document.addEventListener('visibilitychange', () => { if (document.hidden) { trancar(); if (verCusto) esconderCusto(); } });
  $('olho').addEventListener('click', () => { verCusto = !verCusto; renderPecas(); });

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
setVendedor(vendedor);
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
