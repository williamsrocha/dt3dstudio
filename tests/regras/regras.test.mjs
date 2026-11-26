// Testa as regras do Firestore (firestore.rules) no emulador, sem tocar nos dados reais.
//
// Como rodar (precisa de Node 20+ e Java 11+):
//   cd tests/regras
//   npm install
//   npm test
//
// Duas partes:
//   1. O que o app faz de verdade (mesmos formatos do store.js e do app.js) PRECISA passar.
//   2. Gravações estranhas (campos a mais, tipos errados, textos gigantes, foto falsa) PRECISAM ser recusadas.
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import {
  doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, increment,
} from 'firebase/firestore';

const COD = 'DT-ABCD-EFGH-JKLM';
const FOTO = 'data:image/jpeg;base64,' + 'A'.repeat(40000) + '==';
const agora = () => Date.now();

let env, db;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-dt3d',
    firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') },
  });
  db = env.unauthenticatedContext().firestore();
});
after(() => env.cleanup());
beforeEach(() => env.clearFirestore());

const fam = (c = COD) => doc(db, 'familias', c);
const peca = (id, c = COD) => doc(db, 'familias', c, 'pecas', id);
const pedido = (id, c = COD) => doc(db, 'familias', c, 'pedidos', id);

const CONFIG = { kg: 100, watts: 120, kwh: 0.95, desg: 0.3, falha: 10, arred: 0.5, lucro: 100, pix: '', validade: 7, prazoPadrao: 3 };
const novaPeca = id => ({ id, nome: 'Chaveiro', preco: 3.5, custo: 1.2, vendidas: 0, criada: agora() });
const novoPedido = id => ({
  id, status: 'aguardando', criada: agora(), cliente: 'Maria', fone: '(19) 99999-9999', prazo: 3,
  itens: [{ pecaId: 'p1', nome: 'Chaveiro', preco: 3, precoCatalogo: 3.5, custo: 1.2, qtd: 2 }],
  desconto: 0, vendedor: 'Davi',
});
// Venda no formato de incrementosVenda() do store.js
const incVenda = (v, s = 1) => {
  const q = s * v.qtd;
  return {
    vendidas: increment(q), recebido: increment(q * v.preco), custoVendido: increment(q * v.custo),
    [`vendas.${v.vendedor}.qtd`]: increment(q),
    [`vendas.${v.vendedor}.recebido`]: increment(q * v.preco),
    [`vendas.${v.vendedor}.custo`]: increment(q * v.custo),
  };
};

/* ---------------- 1. uso normal do app ---------------- */

test('família: criar, ler, salvar configurações e PIN', async () => {
  await assertSucceeds(setDoc(fam(), { config: CONFIG, criada: agora() }));          // criarFamilia
  await assertSucceeds(getDoc(fam()));                                                  // codigoExiste
  await assertSucceeds(setDoc(fam(), { config: { ...CONFIG, lucro: 200, pix: '1234abcd-chave-aleatoria' }, atualizado: agora() }, { merge: true }));
  await assertSucceeds(setDoc(fam(), { config: { ...CONFIG, pinHash: 'a'.repeat(64) }, atualizado: agora() }, { merge: true }));
});

test('família vazia (código sem nada salvo) também pode ser criada', async () => {
  await assertSucceeds(setDoc(fam(), { config: {}, criada: agora() }));
});

test('peça: salvar, foto, remover foto, vender, desfazer, zerar e apagar', async () => {
  await assertSucceeds(setDoc(peca('p1'), novaPeca('p1')));
  await assertSucceeds(getDocs(collection(db, 'familias', COD, 'pecas')));
  await assertSucceeds(setDoc(peca('p1'), { ...novaPeca('p1'), foto: FOTO }));
  await assertSucceeds(setDoc(peca('p1'), novaPeca('p1')));                             // sem foto
  const v = { qtd: 3, preco: 3, custo: 1.2, em: agora(), vendedor: 'Theo' };
  await assertSucceeds(updateDoc(peca('p1'), { ...incVenda(v), ultimaVenda: v }));      // Vendi várias
  await assertSucceeds(updateDoc(peca('p1'), { ...incVenda(v, -1), ultimaVenda: null }));// desfazer
  const s = (await getDoc(peca('p1'))).data();
  await assertSucceeds(setDoc(peca('p1'), { ...s, vendidas: 0, recebido: 0, custoVendido: 0, vendas: {}, ultimaVenda: null }));
  await assertSucceeds(deleteDoc(peca('p1')));
});

test('peça antiga (com "who" e sem vendedor na última venda) continua funcionando', async () => {
  const antiga = { ...novaPeca('p2'), who: 'Davi', vendidas: 4 };
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'familias', COD, 'pecas', 'p2'), antiga));
  await assertSucceeds(setDoc(peca('p2'), { ...antiga, recebido: 14, custoVendido: 4.8 }));
  await assertSucceeds(updateDoc(peca('p2'), { ultimaVenda: { qtd: 1, preco: 3.5, custo: 1.2, em: agora() } }));
});

test('pedido: criar, sinal, pagou tudo, pagou o resto, entregar, voltar, reabrir e apagar', async () => {
  const p = novoPedido('o1');
  await assertSucceeds(setDoc(pedido('o1'), p));
  await assertSucceeds(getDocs(collection(db, 'familias', COD, 'pedidos')));
  await assertSucceeds(setDoc(pedido('o1'), { ...p, status: 'producao', pago: 'metade', restoAntes: false, sinalEm: agora() }));
  await assertSucceeds(setDoc(pedido('o1'), { ...p, status: 'producao', pago: 'total', restoAntes: false, sinalEm: agora() }));
  await assertSucceeds(setDoc(pedido('o1'), { ...p, status: 'producao', pago: 'total', restoAntes: true, sinalEm: agora() }));
  await assertSucceeds(setDoc(pedido('o1'), { ...p, status: 'entregue', pago: 'total', entregueEm: agora(), sinalEm: agora() }));
  await assertSucceeds(setDoc(pedido('o1'), { ...p, status: 'producao', entregueEm: null, sinalEm: agora() }));
  await assertSucceeds(setDoc(pedido('o1'), { ...p, status: 'aguardando', pago: null, restoAntes: false, sinalEm: null }));
  await assertSucceeds(deleteDoc(pedido('o1')));
});

test('pedido antigo (sem desconto e sem vendedor) continua funcionando', async () => {
  const { desconto, vendedor, ...antigo } = novoPedido('o2');
  await assertSucceeds(setDoc(pedido('o2'), antigo));
  await assertSucceeds(setDoc(pedido('o2'), { ...antigo, status: 'producao', sinalEm: agora() }));
});

/* ---------------- 2. gravações que precisam ser recusadas ---------------- */

test('continua proibido: listar códigos, apagar família, código inválido, outra coleção', async () => {
  await assertSucceeds(setDoc(fam(), { config: CONFIG, criada: agora() }));
  await assertFails(getDocs(collection(db, 'familias')));
  await assertFails(deleteDoc(fam()));
  await assertFails(setDoc(fam('qualquer-coisa'), { config: CONFIG }));
  await assertFails(getDoc(fam('DT-abcd-EFGH-JKLM')));
  await assertFails(setDoc(doc(db, 'familias', COD, 'outra', 'x'), { a: 1 }));
  await assertFails(setDoc(doc(db, 'lixo', 'x'), { a: 1 }));
});

test('família: campos a mais, tipos errados e textos grandes são recusados', async () => {
  await assertFails(setDoc(fam(), { config: CONFIG, criada: agora(), lixo: 'x' }));
  await assertFails(setDoc(fam(), { config: { ...CONFIG, hack: 1 } }));
  await assertFails(setDoc(fam(), { config: { ...CONFIG, lucro: '100' } }));
  await assertFails(setDoc(fam(), { config: { ...CONFIG, pix: 'x'.repeat(101) } }));
  await assertFails(setDoc(fam(), { config: { ...CONFIG, pinHash: 'x'.repeat(65) } }));
  await assertFails(setDoc(fam(), { config: 'texto' }));
  await assertFails(setDoc(fam(), { config: CONFIG, criada: 'ontem' }));
});

test('peça: campos a mais, id trocado, tipos errados, nome gigante e foto falsa são recusados', async () => {
  await assertFails(setDoc(peca('p1'), { ...novaPeca('p1'), lixo: 'x' }));
  await assertFails(setDoc(peca('p1'), { ...novaPeca('outro') }));
  await assertFails(setDoc(peca('p1'), { ...novaPeca('p1'), nome: 'x'.repeat(101) }));
  await assertFails(setDoc(peca('p1'), { ...novaPeca('p1'), nome: 123 }));
  await assertFails(setDoc(peca('p1'), { ...novaPeca('p1'), preco: '3,50' }));
  await assertFails(setDoc(peca('p1'), { ...novaPeca('p1'), who: 'Hacker' }));
  await assertFails(setDoc(peca('p1'), { ...novaPeca('p1'), foto: 'javascript:alert(1)' }));
  await assertFails(setDoc(peca('p1'), { ...novaPeca('p1'), foto: 'data:image/svg+xml;base64,PHN2Zz4=' }));
  await assertFails(setDoc(peca('p1'), { ...novaPeca('p1'), foto: 'data:image/jpeg;base64,' + 'A'.repeat(100001) }));
  await assertFails(setDoc(peca('p1'), { ...novaPeca('p1'), vendas: { Hacker: { qtd: 1 } } }));
  await assertFails(setDoc(peca('p1'), { ...novaPeca('p1'), vendas: { Davi: { qtd: 1, x: '<img>' } } }));
  await assertFails(setDoc(peca('p1'), { ...novaPeca('p1'), ultimaVenda: { qtd: 1, vendedor: 'Hacker' } }));
  const { nome, ...semNome } = novaPeca('p1');
  await assertFails(setDoc(peca('p1'), semNome));
});

test('pedido: campos a mais, status inválido, cliente gigante e itens demais são recusados', async () => {
  const p = novoPedido('o1');
  await assertFails(setDoc(pedido('o1'), { ...p, lixo: 'x' }));
  await assertFails(setDoc(pedido('o1'), { ...p, id: 'outro' }));
  await assertFails(setDoc(pedido('o1'), { ...p, status: 'pago' }));
  await assertFails(setDoc(pedido('o1'), { ...p, cliente: 'x'.repeat(101) }));
  await assertFails(setDoc(pedido('o1'), { ...p, fone: '9'.repeat(31) }));
  await assertFails(setDoc(pedido('o1'), { ...p, itens: 'tudo' }));
  await assertFails(setDoc(pedido('o1'), { ...p, itens: Array(51).fill(p.itens[0]) }));
  await assertFails(setDoc(pedido('o1'), { ...p, pago: 'quase' }));
  await assertFails(setDoc(pedido('o1'), { ...p, restoAntes: 'sim' }));
  await assertFails(setDoc(pedido('o1'), { ...p, vendedor: 'Hacker' }));
  await assertFails(setDoc(pedido('o1'), { ...p, sinalEm: 'amanhã' }));
});
