// Camada de dados: guarda configurações, peças e pedidos.
// Modo "local": localStorage deste aparelho (quando o Firebase não está configurado).
// Modo "nuvem": Firestore, sincronizado entre todos os aparelhos com o mesmo código da família.
import { firebaseConfig } from './firebase-config.js';

const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';

export const local = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* nada */ } },
};

export const cloudEnabled = !!(firebaseConfig && firebaseConfig.apiKey);

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function novoCodigo() {
  const n = new Uint32Array(12);
  crypto.getRandomValues(n);
  const c = [...n].map(x => ALFABETO[x % ALFABETO.length]).join('');
  return `DT-${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8, 12)}`;
}
export function normalizarCodigo(s) {
  const c = String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const sem = c.startsWith('DT') ? c.slice(2) : c;
  return sem.length === 12 ? `DT-${sem.slice(0, 4)}-${sem.slice(4, 8)}-${sem.slice(8, 12)}` : null;
}

const ordenar = a => a.sort((x, y) => (y.criada || 0) - (x.criada || 0));
const upsert = (arr, obj) => { const i = arr.findIndex(x => x.id === obj.id); if (i < 0) arr.unshift(obj); else arr[i] = obj; };

function abrirLocal(onChange) {
  const st = { config: local.get('p3d-cfg', {}), pecas: local.get('p3d-pecas', []), pedidos: local.get('p3d-pedidos', []) };
  const salvar = () => {
    local.set('p3d-cfg', st.config); local.set('p3d-pecas', st.pecas); local.set('p3d-pedidos', st.pedidos);
    onChange(st);
  };
  setTimeout(() => onChange(st));
  return {
    modo: 'local',
    estado: st,
    saveConfig(c) { st.config = { ...st.config, ...c }; salvar(); },
    savePeca(p) { upsert(st.pecas, p); salvar(); },
    contarVenda(id, delta) { const p = st.pecas.find(x => x.id === id); if (p) { p.vendidas = Math.max(0, (p.vendidas || 0) + delta); salvar(); } },
    deletePeca(id) { st.pecas = st.pecas.filter(x => x.id !== id); salvar(); },
    savePedido(p) { upsert(st.pedidos, p); salvar(); },
    deletePedido(id) { st.pedidos = st.pedidos.filter(x => x.id !== id); salvar(); },
  };
}

let fbCache = null;
async function carregarFirebase() {
  if (fbCache) return fbCache;
  const [appMod, fs] = await Promise.all([import(FB + 'firebase-app.js'), import(FB + 'firebase-firestore.js')]);
  const app = appMod.initializeApp(firebaseConfig);
  let db;
  try {
    db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
  } catch {
    db = fs.getFirestore(app);
  }
  fbCache = { fs, db };
  return fbCache;
}

// Verifica se um código já existe na nuvem (para não entrar num código digitado errado).
export async function codigoExiste(codigo) {
  const { fs, db } = await carregarFirebase();
  const s = await fs.getDoc(fs.doc(db, 'familias', codigo));
  return s.exists();
}

// Cria a família na nuvem, levando junto o que já estava salvo neste aparelho.
export async function criarFamilia(codigo, configInicial) {
  const { fs, db } = await carregarFirebase();
  const base = fs.doc(db, 'familias', codigo);
  const config = { ...configInicial, ...local.get('p3d-cfg', {}) };
  delete config.pinHash; // o PIN é criado de novo na nuvem
  await fs.setDoc(base, { config, criada: Date.now() });
  for (const p of local.get('p3d-pecas', [])) await fs.setDoc(fs.doc(base, 'pecas', p.id), p);
  for (const p of local.get('p3d-pedidos', [])) await fs.setDoc(fs.doc(base, 'pedidos', p.id), p);
}

async function abrirNuvem(codigo, onChange, onError) {
  const { fs, db } = await carregarFirebase();
  const base = fs.doc(db, 'familias', codigo);
  const st = { config: {}, pecas: [], pedidos: [] };
  const erro = e => onError && onError(e);
  fs.onSnapshot(base, s => { st.config = (s.exists() && s.data().config) || {}; onChange(st); }, erro);
  fs.onSnapshot(fs.collection(base, 'pecas'), q => { st.pecas = ordenar(q.docs.map(d => d.data())); onChange(st); }, erro);
  fs.onSnapshot(fs.collection(base, 'pedidos'), q => { st.pedidos = ordenar(q.docs.map(d => d.data())); onChange(st); }, erro);
  const w = pr => pr.catch(erro);
  return {
    modo: 'nuvem',
    estado: st,
    saveConfig(c) { st.config = { ...st.config, ...c }; return w(fs.setDoc(base, { config: st.config, atualizado: Date.now() }, { merge: true })); },
    // o onSnapshot já avisa a mudança na hora, mesmo sem internet (compensação de latência do Firestore)
    savePeca(p) { return w(fs.setDoc(fs.doc(base, 'pecas', p.id), p)); },
    // increment soma no servidor: dois celulares tocando "Vendi uma!" juntos não perdem venda
    contarVenda(id, delta) { return w(fs.updateDoc(fs.doc(base, 'pecas', id), { vendidas: fs.increment(delta) })); },
    deletePeca(id) { return w(fs.deleteDoc(fs.doc(base, 'pecas', id))); },
    savePedido(p) { return w(fs.setDoc(fs.doc(base, 'pedidos', p.id), p)); },
    deletePedido(id) { return w(fs.deleteDoc(fs.doc(base, 'pedidos', id))); },
  };
}

export function abrirStore(codigo, onChange, onError) {
  return cloudEnabled && codigo ? abrirNuvem(codigo, onChange, onError) : Promise.resolve(abrirLocal(onChange));
}
