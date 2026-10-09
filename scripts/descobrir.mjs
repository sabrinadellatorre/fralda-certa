// Pesquisa no catálogo do Mercado Livre as fraldas das principais marcas e salva sugestoes.json.
// Uso (no GitHub): workflow "Descobrir fraldas". Não altera o site.
import { writeFile } from "node:fs/promises";

const API = "https://api.mercadolibre.com";
const TAMANHOS = ["RN", "P", "M", "G", "XG", "XXG"];
const LINHAS = [
  "Pampers Confort Sec", "Pampers Premium Care", "Pampers Pants",
  "Huggies Tripla Proteção", "Huggies Supreme Care", "Huggies Natural Care", "Huggies Pants",
  "MamyPoko Dia e Noite", "MamyPoko Pants",
  "Turma da Mônica Baby", "Personal Baby",
];

async function obterToken() {
  const r = await fetch(API + "/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: process.env.ML_CLIENT_ID || "", client_secret: process.env.ML_CLIENT_SECRET || "" }),
  });
  if (!r.ok) throw new Error("token HTTP " + r.status);
  return (await r.json()).access_token;
}

const log = [];
let token = "";
async function api(caminho) {
  const r = await fetch(API + caminho, { headers: { accept: "application/json", authorization: "Bearer " + token } });
  if (!r.ok) {
    log.push({ caminho, status: r.status, resposta: (await r.text().catch(() => "")).slice(0, 200) });
    throw new Error("HTTP " + r.status);
  }
  return r.json();
}
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));

token = await obterToken();
const vistos = new Map();

for (const linha of LINHAS) {
  for (const tam of TAMANHOS) {
    const q = `fralda ${linha} ${tam}`;
    let res = [];
    try {
      const d = await api(`/products/search?status=active&site_id=MLB&q=${encodeURIComponent(q)}&limit=10`);
      res = d.results || [];
    } catch { /* registrado no log */ }
    for (const p of res) {
      if (vistos.has(p.id)) continue;
      vistos.set(p.id, { id: p.id, nome: p.name, busca: q, atributos: (p.attributes || []).filter((a) =>
        /BRAND|LINE|SIZE|UNITS|PACKAGE|DIAPER|FORMAT|MODEL/i.test(a.id)).map((a) => [a.id, a.value_name]) });
    }
    await espera(150);
  }
}

// Ofertas ativas de cada produto encontrado.
for (const p of vistos.values()) {
  try {
    const d = await api(`/products/${p.id}/items?limit=20`);
    const precos = (d.results || []).filter((o) => o.condition === "new" && typeof o.price === "number" && o.price > 0)
      .map((o) => o.price).sort((a, b) => a - b);
    p.ofertas = precos.length;
    p.menorPreco = precos[0] ?? null;
  } catch { p.ofertas = 0; p.menorPreco = null; }
  await espera(150);
}

await writeFile("sugestoes.json", JSON.stringify({
  geradoEm: new Date().toISOString(),
  produtos: [...vistos.values()],
  erros: log.slice(0, 30),
}, null, 2) + "\n");
console.log(`Produtos encontrados: ${vistos.size}. Com oferta ativa: ${[...vistos.values()].filter((p) => p.ofertas).length}.`);
