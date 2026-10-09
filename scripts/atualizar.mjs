// Consulta o preço de cada produto no Mercado Livre e grava docs/dados.json.
// Uso: node scripts/atualizar.mjs          (consulta de verdade)
//      node scripts/atualizar.mjs --teste  (usa respostas falsas, para testar sem internet)

import { readFile, writeFile, mkdir } from "node:fs/promises";

const API = "https://api.mercadolibre.com";
const TESTE = process.argv.includes("--teste");
const SAIDA = "docs/dados.json";
const TIPOS = ["tradicional", "pants"];
const TAMANHOS = ["RN", "P", "M", "G", "XG", "XXG"];

// ---------- leitura e validação ----------
const cfg = JSON.parse(await readFile("produtos.json", "utf8"));
const anterior = await readFile(SAIDA, "utf8").then(JSON.parse).catch(() => ({ produtos: [] }));
const antPorId = Object.fromEntries((anterior.produtos || []).map((p) => [p.id, p]));

const problemas = [];
const ids = new Set();
for (const p of cfg.produtos) {
  if (!p.id) problemas.push(`Produto sem "id": ${p.marca} ${p.linha}`);
  if (ids.has(p.id)) problemas.push(`"id" repetido: ${p.id}`);
  ids.add(p.id);
  if (!TIPOS.includes(p.tipo)) problemas.push(`${p.id}: "tipo" deve ser ${TIPOS.join(" ou ")}`);
  if (!TAMANHOS.includes(p.tamanho)) problemas.push(`${p.id}: "tamanho" deve ser um de ${TAMANHOS.join(", ")}`);
  if (!(p.qtd > 0)) problemas.push(`${p.id}: "qtd" precisa ser o número de fraldas no pacote`);
}
// ---------- links de afiliada automáticos ----------
const tagAmazon = String(cfg.site?.amazonTag || "").trim();
if (tagAmazon && !/^[a-z0-9-]+-20$/i.test(tagAmazon)) {
  problemas.push(`"amazonTag" parece errado: "${tagAmazon}". A tag da Amazon Brasil termina em -20 (ex.: seunome-20).`);
}
// Aceita o link de afiliada completo ou só o trecho depois do "?". Usa apenas os parâmetros de afiliada (matt_...).
const paramsML = (() => {
  const bruto = String(cfg.site?.mlParametros || "").trim();
  if (!bruto) return null;
  const q = new URLSearchParams(bruto.includes("?") ? bruto.split("?")[1].split("#")[0] : bruto);
  const so = new URLSearchParams();
  for (const [k, v] of q) if (/^matt_/i.test(k)) so.set(k, v);
  if (![...so.keys()].length) {
    console.warn('Aviso: "mlParametros" não tem os parâmetros de afiliada (matt_tool / matt_word). Links do Mercado Livre não serão montados automaticamente.');
    return null;
  }
  return so;
})();

export function montarLinkML(url, params) {
  if (!params || !/^https:\/\//i.test(url || "")) return "";
  try {
    const u = new URL(url);
    u.hash = "";
    for (const [k, v] of params) u.searchParams.set(k, v);
    return u.toString();
  } catch { return ""; }
}

export function montarLinkAmazon(url, tag) {
  if (!tag) return "";
  const asin = String(url || "").match(/(?:\/dp\/|\/gp\/product\/|\/gp\/aw\/d\/)([A-Z0-9]{10})/i);
  return asin ? `https://www.amazon.com.br/dp/${asin[1].toUpperCase()}?tag=${encodeURIComponent(tag)}` : "";
}

if (problemas.length) {
  console.error("Corrija o produtos.json:\n- " + problemas.join("\n- "));
  process.exit(1);
}

// ---------- acesso à API ----------
let token = null;
async function obterToken() {
  if (token !== null) return token;
  const id = process.env.ML_CLIENT_ID, segredo = process.env.ML_CLIENT_SECRET;
  if (!id || !segredo) return (token = "");
  const r = await fetch(API + "/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: segredo }),
  });
  if (!r.ok) {
    diagnostico.push({ caminho: "/oauth/token", status: r.status, resposta: (await r.text().catch(() => "")).slice(0, 200) });
    console.warn(`Aviso: não consegui gerar o token do Mercado Livre (HTTP ${r.status}). Vou tentar sem token.`);
    return (token = "");
  }
  return (token = (await r.json()).access_token || "");
}

// Registro das consultas (sem chaves), salvo em docs/diagnostico.json para conferência.
const diagnostico = [];
async function api(caminho) {
  if (TESTE) return respostaFalsa(caminho);
  const t = await obterToken();
  const tentativas = t ? [t, ""] : [""];
  let ultimo = 0;
  for (const tk of tentativas) {
    const headers = { accept: "application/json" };
    if (tk) headers.authorization = "Bearer " + tk;
    const r = await fetch(API + caminho, { headers });
    if (r.ok) {
      const j = await r.json();
      diagnostico.push({ caminho, comToken: Boolean(tk), status: r.status, chaves: Object.keys(j || {}).slice(0, 15) });
      return j;
    }
    const corpo = (await r.text().catch(() => "")).slice(0, 200);
    diagnostico.push({ caminho, comToken: Boolean(tk), status: r.status, resposta: corpo });
    ultimo = r.status;
    if (r.status !== 401 && r.status !== 403) break;
  }
  throw new Error(`Mercado Livre respondeu HTTP ${ultimo}`);
}

// Descobre os códigos do anúncio a partir do link colado (catálogo e/ou anúncio específico).
export function lerLink(url) {
  const u = String(url || "");
  const r = {};
  const catalogo = u.match(/\/p\/(MLB\d+)/i);
  if (catalogo) r.catalogo = catalogo[1].toUpperCase();
  const itemNoFiltro = u.match(/item_id(?:%3A|[:=])(MLB\d+)/i);
  if (itemNoFiltro) r.item = itemNoFiltro[1].toUpperCase();
  else if (!catalogo) {
    const item = u.match(/MLB-?(\d{6,})/i);
    if (item) r.item = "MLB" + item[1];
  }
  return r.catalogo || r.item ? r : null;
}

function ativo(it) {
  return it && it.status !== "paused" && it.status !== "closed" && typeof it.price === "number" && it.price > 0 &&
    (it.available_quantity ?? 1) > 0;
}

// Para um produto de catálogo, lista as ofertas ativas, da mais barata para a mais cara.
async function ofertasCatalogo(idCatalogo) {
  const ids = [];
  try {
    const prod = await api(`/products/${idCatalogo}`);
    if (prod.buy_box_winner?.item_id) ids.push(prod.buy_box_winner.item_id);
  } catch (e) { /* segue para a lista de ofertas */ }
  try {
    const lista = await api(`/products/${idCatalogo}/items?limit=20`);
    (lista.results || [])
      .filter((o) => o.item_id && typeof o.price === "number" && o.price > 0)
      .sort((x, y) => x.price - y.price)
      .forEach((o) => ids.push(o.item_id));
  } catch (e) { /* sem lista de ofertas */ }
  return ids;
}

async function consultarML(p) {
  const alvo = lerLink(p.mercadolivre?.url);
  if (!alvo) throw new Error("link do Mercado Livre não reconhecido");
  const candidatos = [];
  if (alvo.catalogo) candidatos.push(...(await ofertasCatalogo(alvo.catalogo)));
  if (alvo.item) candidatos.push(alvo.item);
  if (!candidatos.length) throw new Error("nenhuma oferta ativa encontrada para esse produto agora");

  let item = null, ultimoErro = null;
  for (const id of [...new Set(candidatos)].slice(0, 5)) {
    try {
      const it = await api(`/items/${id}`);
      if (ativo(it)) { item = it; break; }
    } catch (e) { ultimoErro = e; }
  }
  if (!item) throw ultimoErro || new Error("as ofertas desse produto estão pausadas ou sem estoque agora");

  const qtdTitulo = Number((String(item.title).match(/(\d{2,3})\s*(?:fraldas|unidades|un\b|und)/i) || [])[1]) || null;
  return {
    preco: item.price,
    freteGratis: Boolean(item.shipping?.free_shipping),
    disponivel: true,
    titulo: item.title,
    qtdNoTitulo: qtdTitulo,
  };
}

// ---------- execução ----------
const agora = new Date().toISOString();
const saida = { geradoEm: agora, site: cfg.site, produtos: [] };
let ok = 0, falhas = 0;

for (const p of cfg.produtos) {
  const ant = antPorId[p.id]?.mercadolivre || {};
  // Link colado à mão tem prioridade; se não houver, o robô monta com o seu código.
  const linkManualML = /^https:\/\//i.test(p.mercadolivre?.linkAfiliada || "") ? p.mercadolivre.linkAfiliada : "";
  const linkAfiliada = linkManualML || montarLinkML(p.mercadolivre?.url, paramsML);
  let ml = { linkAfiliada, preco: null };

  if (p.mercadolivre?.url && /^https?:\/\//i.test(p.mercadolivre.url)) {
    try {
      const r = await consultarML(p);
      ml = {
        ...ml, ...r,
        consultadoEm: agora,
        precoAnterior: ant.preco ?? null,
      };
      if (r.qtdNoTitulo && r.qtdNoTitulo !== p.qtd) {
        console.warn(`Atenção ${p.id}: o anúncio diz ${r.qtdNoTitulo} unidades, mas o produtos.json diz ${p.qtd}. Confira.`);
      }
      ok++;
      console.log(`OK  ${p.id}: R$ ${r.preco}${r.disponivel ? "" : " (indisponível)"}`);
    } catch (e) {
      falhas++;
      console.warn(`ERRO ${p.id}: ${e.message}. Mantendo o último preço conhecido.`);
      ml = { ...ml, preco: ant.preco ?? null, consultadoEm: ant.consultadoEm || "", disponivel: ant.disponivel ?? false, freteGratis: ant.freteGratis ?? false, precoAnterior: ant.precoAnterior ?? null, erro: true };
    }
  }

  const amz = p.amazon || {};
  const linkManualAmz = /^https:\/\//i.test(amz.linkAfiliada || "") ? amz.linkAfiliada : "";
  const linkAmz = linkManualAmz || montarLinkAmazon(amz.url, tagAmazon);
  if (amz.url && !linkAmz) console.warn(`Atenção ${p.id}: não consegui montar o link da Amazon. Confira o "amazonTag" e o link do produto.`);
  saida.produtos.push({
    id: p.id, marca: p.marca, linha: p.linha, tipo: p.tipo, tamanho: p.tamanho, qtd: p.qtd,
    mercadolivre: ml,
    amazon: {
      preco: typeof amz.preco === "number" ? amz.preco : null,
      conferidoEm: amz.conferidoEm || "",
      linkAfiliada: linkAmz,
    },
  });
}

await mkdir("docs", { recursive: true });
await writeFile(SAIDA, JSON.stringify(saida, null, 2) + "\n");
console.log(`\nPronto: ${ok} atualizados, ${falhas} com erro. Arquivo salvo em ${SAIDA}.`);
await writeFile("docs/diagnostico.json", JSON.stringify({ geradoEm: agora, tokenGerado: Boolean(token), consultas: diagnostico }, null, 2) + "\n");
if (ok === 0 && falhas > 0) console.error("Nenhum preço atualizado. Veja docs/diagnostico.json.");

// ---------- respostas falsas para o modo --teste ----------
function respostaFalsa(caminho) {
  if (/\/products\/[^/]+\/items/.test(caminho)) return { results: [{ item_id: "MLB777", price: 70 }] };
  if (caminho.startsWith("/products/")) return {};
  const n = Number(caminho.replace(/\D/g, "").slice(-3)) || 1;
  return { title: `Fralda Teste ${70 + (n % 20)} Unidades`, price: 60 + (n % 30) + 0.9, status: "active", available_quantity: 5, shipping: { free_shipping: n % 2 === 0 } };
}
