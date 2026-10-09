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
    let r = await fetch(API + caminho, { headers });
    for (let n = 1; r.status === 429 && n <= 4; n++) {
      await new Promise((ok) => setTimeout(ok, 3000 * n));
      r = await fetch(API + caminho, { headers });
    }
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

// O Mercado Livre não libera a consulta direta de anúncios (/items) para aplicativos de terceiros.
// Por isso o preço vem das ofertas do produto de catálogo (/products/{id} e /products/{id}/items).
function precoDe(o) {
  const p = o?.price ?? o?.prices?.price ?? null;
  return typeof p === "number" && p > 0 ? p : null;
}

async function consultarML(p) {
  const alvo = lerLink(p.mercadolivre?.url);
  if (!alvo) throw new Error("link do Mercado Livre não reconhecido");
  if (!alvo.catalogo) {
    throw new Error("use o link da página de catálogo do produto (o endereço que tem /p/MLB...). Anúncios avulsos não podem ser consultados");
  }
  const ofertas = [];
  let nome = "";
  try {
    const prod = await api(`/products/${alvo.catalogo}`);
    nome = prod.name || "";
    if (prod.buy_box_winner && precoDe(prod.buy_box_winner)) ofertas.push({ ...prod.buy_box_winner, destaque: true });
  } catch (e) { /* segue para a lista de ofertas */ }
  try {
    const lista = await api(`/products/${alvo.catalogo}/items?limit=20`);
    const res = lista.results || [];
    if (res[0]) diagnostico.push({ exemploOferta: Object.keys(res[0]).slice(0, 25) });
    ofertas.push(...res);
  } catch (e) { /* sem lista de ofertas */ }

  const validas = ofertas.filter((o) => precoDe(o) && (o.condition ? o.condition === "new" : true));
  if (!validas.length) throw new Error("nenhuma oferta ativa encontrada para esse produto agora");
  // A oferta nova mais barata do produto.
  const escolhida = validas.slice().sort((x, y) => precoDe(x) - precoDe(y))[0];

  const qtdTitulo = Number((String(nome).match(/(\d{2,3})\s*(?:fraldas|unidades|un\b|und)/i) || [])[1]) || null;
  return {
    preco: precoDe(escolhida),
    freteGratis: Boolean(escolhida.shipping?.free_shipping),
    disponivel: true,
    titulo: nome,
    qtdNoTitulo: qtdTitulo,
    ofertaId: escolhida.item_id || "",
  };
}

// ---------- execução ----------
const agora = new Date().toISOString();
const saida = { geradoEm: agora, site: cfg.site, produtos: [] };
let ok = 0, falhas = 0;

for (const p of cfg.produtos) {
  if (!TESTE) await new Promise((ok) => setTimeout(ok, 800));
  const ant = antPorId[p.id]?.mercadolivre || {};
  // Link colado à mão tem prioridade; se não houver, o robô monta com o seu código.
  const linkManualML = /^https:\/\//i.test(p.mercadolivre?.linkAfiliada || "") ? p.mercadolivre.linkAfiliada : "";
  const linkAfiliada = linkManualML || montarLinkML(p.mercadolivre?.url, paramsML);
  let ml = { linkAfiliada, preco: null };

  if (p.mercadolivre?.url && /^https?:\/\//i.test(p.mercadolivre.url)) {
    try {
      const r = await consultarML(p);
      // Link de afiliada apontando para a oferta escolhida (quando não há link manual).
      if (!linkManualML && r.ofertaId && paramsML) {
        try {
          const base = new URL(p.mercadolivre.url);
          base.search = ""; base.hash = "";
          base.searchParams.set("pdp_filters", "item_id:" + r.ofertaId);
          ml.linkAfiliada = montarLinkML(base.toString(), paramsML);
        } catch { /* mantém o link já montado */ }
      }
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
  if (/\/products\/[^/]+\/items/.test(caminho)) return { results: [{ item_id: "MLB777", price: 79.9, condition: "new", shipping: { free_shipping: true } }, { item_id: "MLB4702124885", price: 84.9, condition: "new" }] };
  if (caminho.startsWith("/products/")) return { name: "Fralda Pampers Confort Sec G 60 Unidades", buy_box_winner: null };
  const n = Number(caminho.replace(/\D/g, "").slice(-3)) || 1;
  return { title: `Fralda Teste ${70 + (n % 20)} Unidades`, price: 60 + (n % 30) + 0.9, status: "active", available_quantity: 5, shipping: { free_shipping: n % 2 === 0 } };
}
