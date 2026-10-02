# Fralda Certa: passo a passo

Este pacote tem um robô que consulta os preços no Mercado Livre todo dia às 6h e às 18h e um site que mostra o preço por fralda para suas seguidoras. Tudo roda de graça no GitHub. Você só mexe em um arquivo: o `produtos.json`.

O que tem no pacote:

- `produtos.json`: a sua lista de fraldas (é o único arquivo que você edita)
- `scripts/atualizar.mjs`: o robô que busca os preços
- `.github/workflows/atualizar.yml`: o agendamento que roda o robô sozinho
- `docs/index.html`: o site
- `docs/dados.json`: os preços que o robô salva (não precisa mexer)

## 1. Criar a conta e o repositório no GitHub

1. Crie uma conta grátis em github.com.
2. Clique em **New repository**. Dê um nome, por exemplo `fralda-certa`. Marque **Public** e clique em **Create repository**.
3. Na página do repositório, clique em **uploading an existing file**. Arraste os arquivos e as pastas `docs` e `scripts`, além do `produtos.json` e deste `LEIAME.md`. Clique em **Commit changes**.

A pasta `.github` costuma ficar escondida no computador. Por isso, crie esse arquivo direto no site:

1. Clique em **Add file → Create new file**.
2. No nome, digite exatamente `.github/workflows/atualizar.yml`. As barras criam as pastas sozinhas.
3. Abra o arquivo `atualizar.yml` do pacote num editor de texto, copie tudo e cole no GitHub. Clique em **Commit changes**.

## 2. Criar o aplicativo no Mercado Livre

1. Entre em developers.mercadolivre.com.br com a mesma conta do Mercado Livre e vá em **Minhas aplicações → Criar aplicação**.
2. Preencha o nome (ex.: Fralda Certa) e uma descrição curta. Em "URI de redirect", use o endereço do seu site (passo 4). Se ainda não tiver o endereço, use `https://github.com`.
3. Nas permissões, só precisa de leitura de itens e produtos (nada de vendas ou mensagens).
4. Depois de criar, copie o **App ID** (Client ID) e a **Secret Key** (Client Secret).

## 3. Guardar as chaves no GitHub (com segurança)

No repositório, vá em **Settings → Secrets and variables → Actions → New repository secret** e crie dois segredos:

- Nome `ML_CLIENT_ID`, com o valor do App ID
- Nome `ML_CLIENT_SECRET`, com o valor da Secret Key

Nunca cole essas chaves no `produtos.json` nem em nenhum outro arquivo, porque o repositório é público.

## 4. Ligar o site

1. Vá em **Settings → Pages**.
2. Em "Branch", escolha `main` e a pasta `/docs`. Clique em **Save**.
3. Em um ou dois minutos aparece o endereço do seu site, algo como `https://seuusuario.github.io/fralda-certa/`. É esse link que vai na bio.

Também dá para usar um domínio próprio (ex.: `fraldacerta.com.br`) no mesmo menu, em **Custom domain**.

## 5. Colocar seu código de afiliada (uma vez só)

No topo do `produtos.json`, dentro de `"site"`, preencha dois campos. A partir daí, o robô monta o seu link de afiliada sozinho em todos os produtos.

- **amazonTag**: a sua tag do Amazon Associados, que termina em `-20` (ex.: `maedafralda-20`). Ela aparece no canto superior direito do painel do Associados e na barra SiteStripe.
- **mlParametros**: gere um link de afiliada qualquer no painel do Mercado Livre. Abra esse link no navegador, espere a página do produto carregar e copie o endereço completo da barra. Cole esse endereço aqui. O robô aproveita só a parte que identifica você (os trechos que começam com `matt_`).

Para conferir se está funcionando, clique em um botão do seu site e veja, no dia seguinte, se o clique aparece no painel de cada programa. Se o clique não aparecer no Mercado Livre, cole o link gerado no painel direto no campo `linkAfiliada` daquele produto. O link colado à mão sempre tem prioridade sobre o automático.

## 6. Cadastrar suas fraldas

Abra o `produtos.json` no GitHub e clique no lápis para editar. Cada fralda é um bloco assim:

```json
{
  "id": "pampers-confortsec-m",
  "marca": "Pampers",
  "linha": "Confort Sec",
  "tipo": "tradicional",
  "tamanho": "M",
  "qtd": 80,
  "mercadolivre": {
    "url": "https://www.mercadolivre.com.br/...",
    "linkAfiliada": ""
  },
  "amazon": {
    "url": "https://www.amazon.com.br/...",
    "preco": null,
    "conferidoEm": "",
    "linkAfiliada": ""
  }
}
```

O que cada campo significa:

- **id**: um apelido único, sem espaços nem acentos. Não pode repetir.
- **tipo**: `tradicional` (com fita) ou `pants` (calça).
- **tamanho**: `RN`, `P`, `M`, `G`, `XG` ou `XXG`.
- **qtd**: quantas fraldas vêm no pacote. Confira no anúncio, porque é com isso que o preço por fralda é calculado.
- **mercadolivre.url**: o link do anúncio, copiado da barra do navegador.
- **mercadolivre.linkAfiliada**: pode deixar vazio (`""`). O robô monta o link com o seu código. Só preencha se quiser usar um link específico gerado no painel.
- **amazon.url**: o link normal do produto na Amazon, copiado da barra do navegador. O robô transforma em link de afiliada com a sua tag.

Dicas para editar sem erro:

- Separe um bloco do outro com vírgula, mas não coloque vírgula depois do último.
- Textos ficam entre aspas e números ficam sem aspas.
- Se o robô encontrar algum erro no arquivo, ele avisa qual produto corrigir.

Ao salvar o `produtos.json`, o robô roda sozinho e o site atualiza em poucos minutos.

## 7. Rodar o robô na hora

Na aba **Actions**, clique em **Atualizar preços → Run workflow**. Se aparecer um X vermelho, clique nele para ler a mensagem. Os erros vêm em português e dizem o que corrigir.

O robô também confere se a quantidade no título do anúncio bate com a sua `qtd`. Se não bater, ele avisa no registro com a palavra "Atenção".

## Amazon (por enquanto, manual)

Enquanto a API da Amazon não estiver liberada, preencha à mão:

- **preco**: o preço do pacote, com ponto no lugar da vírgula (ex.: `89.90`)
- **conferidoEm**: a data em que você conferiu, no formato `2026-10-01`
- **linkAfiliada**: pode deixar vazio, porque o robô monta a partir do `url` e da sua `amazonTag`

As regras da Amazon não permitem mostrar preço antigo. Por isso o site só exibe o preço da Amazon por 1 dia depois da data em `conferidoEm`. Depois disso, ele mostra apenas o botão "Ver no Amazon" com o seu link, sem o preço. Esse prazo fica em `amazonValidadeDias`, no topo do arquivo.

Quando sua conta liberar a API da Amazon, dá para automatizar essa parte também.

## Se algo der errado

- **"Mercado Livre respondeu HTTP 403"**: confira se os dois segredos foram criados com os nomes exatos. As regras de acesso da API do Mercado Livre mudam de tempos em tempos. Se continuar dando erro, copie a mensagem e peça ajuda para ajustar o robô.
- **"link do Mercado Livre não reconhecido"**: use o link completo do anúncio, que contém `MLB` seguido de números.
- **"produto de catálogo sem vendedor ativo"**: aquele anúncio de catálogo está sem estoque. Escolha outro anúncio do mesmo produto.
- **Site em branco**: confira se o Pages está apontando para a pasta `/docs`.

Quando um preço não pode ser consultado, o site mantém o último preço conhecido até a próxima consulta. Anúncios pausados ou sem estoque somem da comparação sozinhos.
