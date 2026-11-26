# DT 3D STUDIO — Documentação do projeto

App de cálculo de preços, catálogo e pedidos da **DT 3D STUDIO**, uma pequena empresa de impressão 3D.

| | |
|---|---|
| **App** | https://williamsrocha.github.io/dt3dstudio/ |
| **Código** | este repositório, branch `main` (publicado pelo GitHub Pages) |
| **Dados** | Firebase Firestore, projeto `dt3dstudio-b1bc5`, plano Spark (gratuito) |
| **Instagram** | [@dt3dstudio](https://instagram.com/dt3dstudio) |

## O que o app faz

### Quem está vendendo
- No topo do app: **Vendendo agora: Davi / Theo**. Cada celular lembra o seu dono; no celular do papai, troca com um toque.
- As **peças são da loja** (DT 3D STUDIO): não existe mais "quem fez". O que conta é **quem vendeu**.
- Cada venda (Vendi uma!, Vendi várias) e cada pedido guardam **quem vendeu**; na janela do Vendi várias e no pedido dá para trocar na hora.
- Totais **por vendedor** no Catálogo (recebido e quantidade; lucro só com o olho aberto) e nos Pedidos (já recebido).
- Vendas antigas, feitas antes dessa mudança, contam para quem estava marcado na peça.

### Calcular
- Preço sugerido por peça a partir de:
  - **peso** e **tempo** da impressão **inteira** (como no fatiador), divididos pela **quantidade de peças** que saíram;
  - **extras de uma peça** (argola, ímã, tinta…), somados a cada peça;
  - **reserva para falhas** (sobre filamento, energia e desgaste; os extras não se perdem numa falha);
  - **lucro em cima do custo** (botões Metade a mais / O dobro / O triplo, ou porcentagem livre);
  - **arredondamento** para cima (ex.: de R$ 0,50 em R$ 0,50).
- **Lápis na etiqueta**: deixa escolher o preço da peça antes de salvar no catálogo (mostra o sugerido pelo app, recalcula o lucro e avisa se ficar abaixo do custo). Escolher um botão de lucro, tocar em "Usar o sugerido" ou em **Limpar** volta ao preço calculado.
- Sempre abre limpo; botão **Limpar** volta ao começo.
- Atalho **Mandar o preço para um cliente**: salva a peça e abre o pedido.

### Catálogo
- Preço de **tabela** de cada peça e quem fez (cor da borda: Davi azul, Theo verde).
- **Foto** da peça: cortada em quadrado e reduzida a 320×320 (até ~30 KB) no próprio aparelho.
- **Vendi uma!** para vender uma peça na hora (escola), pelo preço do catálogo.
- **Vendi várias**: quantidade e preço de cada (vem do catálogo, pode mudar, por ex. preço de pacote), com total, lucro e aviso se ficar abaixo do custo.
- Cada venda guarda o **valor real recebido**; "Dinheiro recebido" e "Lucro de verdade" usam esses valores. Somas feitas no servidor: dois celulares não perdem venda.
- **Desfazer última venda** desfaz a venda inteira (ex.: as 10 unidades de uma vez).
- **Olho "Ver custo"**: o custo de cada peça e o "Lucro de verdade" ficam **escondidos do cliente** por padrão. Tocar no olho mostra; esconde sozinho ao trocar de aba ou quando a tela apaga. Sem PIN, porque os meninos precisam ver o custo para negociar. Na janela do Vendi várias, com o olho fechado, o aviso de prejuízo continua, mas sem valores.
- **Copiar catálogo para o WhatsApp**.

### Pedidos (encomendas)
- **Nome e WhatsApp do cliente obrigatórios**; número formatado automaticamente, `(19) 99999-9999`.
- **Preço combinado por peça**: vem do catálogo e pode ser mudado para aquele cliente; o catálogo não muda.
- **Desconto** no total do pedido.
- **Avisos de negociação**: ainda ganham / só pagam o custo / prejuízo (com confirmação ao salvar).
- Fluxo: **Esperando pagar a metade → Imprimindo → Entregue**.
- Pagamento: **Cliente pagou a metade** ou **Cliente pagou tudo**; com a metade paga, **Cliente pagou o resto** antes da entrega. Pedido pago mostra a etiqueta **Pago**, "Falta: R$ 0,00" e só o botão **Entreguei**; a confirmação diz "Nada a pagar na entrega!". "Ainda não pagou" desfaz um passo (o resto ou o primeiro pagamento).
- Mensagens prontas pelo WhatsApp: **orçamento** (com Pix e sinal de 50%) e **confirmação** (com data de entrega).
- Totais: para imprimir, já recebido, a receber na entrega, lucro dos entregues.

### Ajustes
- Chave Pix, validade do orçamento, prazo padrão e custos da impressora (rolo, potência, tarifa, desgaste, falhas, arredondamento).
- Trancados por um **PIN** criado no próprio app. Só o *hash* do PIN é salvo. É uma tranca contra crianças, não uma proteção forte.
- Mostra o **código da família** e permite sair do aparelho.

### Geral
- Instalável no celular (PWA), funciona sem internet e se atualiza sozinho quando há versão nova.
- Modo claro e escuro, acompanhando o celular.

## Estrutura técnica

| Arquivo | Para que serve |
|---|---|
| `index.html` | Telas, ícones (sprite SVG) e diálogos |
| `styles.css` | Visual; todas as cores vêm de variáveis em `:root` |
| `app.js` | Cálculo, catálogo, fotos, pedidos, mensagens, PIN e navegação |
| `store.js` | Dados: modo local (`localStorage`) ou nuvem (Firestore) |
| `firebase-config.js` | Configuração pública do Firebase (não é senha) |
| `firestore.rules` | Regras de segurança do banco |
| `manifest.webmanifest`, `sw.js`, `icons/` | App instalável, offline e atualização automática |

**Dados no Firestore:** `familias/{codigo}` guarda a configuração; as subcoleções `pecas` e `pedidos` guardam o resto. As regras só aceitam códigos no formato `DT-XXXX-XXXX-XXXX`, não permitem listar códigos e não permitem apagar uma família inteira.

**Segurança da tela:** todo dado que vem da nuvem passa por `esc()` (texto), `n()` (número) ou `fotoSegura()` (foto) antes de entrar no HTML. Assim, mesmo que alguém com o código da família grave dados estranhos, nada roda como código no app.

**Regras de lucro:** um só lugar decide os avisos (`faixaLucro`: prejuízo, só o custo ou lucro) e as comparações de centavos (`iguais`), usados na etiqueta, nas vendas e nos pedidos.

**Valores de dinheiro:** campos de dinheiro usam digitação estilo app de banco (`8` → `0,08` → `0,80`); campos `type=number` (peso, tempo, quantidade) mantêm o ponto decimal.

## Testes

Na pasta `tests/` (instruções no começo de cada arquivo):

| Arquivo | O que testa |
|---|---|
| `tests/regressao.py` | O app inteiro: calculadora, lápis, olho do custo, vendas e quem vendeu, pedidos (metade, tudo, resto), telefone, foto e PIN |
| `tests/seguranca.py` | Dados maliciosos vindos da nuvem não podem rodar código no app |

## Decisões

- Identidade visual **preto e laranja**, igual ao Instagram; Davi = azul, Theo = verde.
- **As peças são da loja; o que importa é quem vendeu.** Cada celular marca o seu vendedor.
- Textos **simples para as crianças** no app; mensagens ao cliente com termos formais (orçamento, sinal de 50%).
- **Chave Pix aleatória**, nunca CPF: o código é público e as mensagens podem ser encaminhadas.
- O app usa só a marca DT; nenhum personagem ou logo de terceiros.
- Fotos guardadas na própria peça, **sem Firebase Storage** (que exige plano pago).
- **Cada pedido é uma negociação**: o preço combinado vale só para aquele cliente; o catálogo é a tabela.

## Histórico

| Data | Mudança |
|---|---|
| 23/11/2026 | Primeira versão: calculadora, catálogo, pedidos com WhatsApp, PWA |
| 23/11/2026 | Firebase e código da família; PIN dos Ajustes |
| 23/11/2026 | Identidade preto e laranja; ícone DT; textos para crianças; ícones nos botões |
| 23/11/2026 | Campos de dinheiro estilo app de banco; atualização automática do app |
| 23/11/2026 | Revisão de código: peso decimal (12,5 g era lido como 125 g), vendas simultâneas, selo de conexão, limpeza de CSS |
| 24/11/2026 | Calculadora sempre abre limpa |
| 24/11/2026 | Desconto nos pedidos com avisos de lucro e prejuízo |
| 24/11/2026 | Dicas mais claras (peso e tempo da impressão inteira, extras de uma peça) |
| 24/11/2026 | Preço combinado por peça em cada pedido |
| 24/11/2026 | Fotos das peças no catálogo |
| 24/11/2026 | WhatsApp do cliente obrigatório e formatado |
| 24/11/2026 | Documentação do projeto em `docs/PROJETO.md` |
| 26/11/2026 | Lápis na etiqueta para escolher o preço da peça antes de salvar no catálogo |
| 26/11/2026 | **Vendi várias** (quantidade e preço por venda), valores reais recebidos e desfazer a última venda inteira |
| 26/11/2026 | Revisão de código: proteção contra dados maliciosos da nuvem (10 brechas fechadas), regra única de lucro/prejuízo, telefone com uma regra só, CSS sem regra duplicada; testes em `tests/` |
| 26/11/2026 | Vídeo de apresentação **v2** (vertical, 1 min 29 s, trilha original): lápis do preço, fotos, Vendi várias, preço combinado, WhatsApp obrigatório |
| 26/11/2026 | Olho no Catálogo: custo e lucro escondidos do cliente por padrão; testes atualizados (30 verificações) |
| 26/11/2026 | Pagamento total no pedido (**Cliente pagou tudo** e **Cliente pagou o resto**), totais e mensagem de confirmação corrigidos; testes: 41 verificações |
| 26/11/2026 | **Quem vendeu** no lugar de "quem fez": seletor no topo, vendedor em cada venda e pedido, totais por vendedor; peças passam a ser da loja; testes: 47 verificações |

## Pendências e ideias

- [ ] Criar a chave Pix aleatória e cadastrar em Ajustes.
- [x] ~~Avaliar **Vendi mais barato**~~: resolvido pelo **Vendi várias** (26/11/2026).
- [ ] Avaliar **Modo treino** (testes separados dos dados reais).
- [ ] Gerar **imagem do catálogo** com fotos e preços para Instagram e WhatsApp.
- [x] ~~Atualizar o vídeo de apresentação~~: feita a v2 em 26/11/2026.
- [ ] Vídeo: versão narrada pelo Davi ou versão curta de 30 s para Reels.
- [ ] Refazer o vídeo quando entrarem funções novas.
- [ ] Reforçar as regras do Firestore validando os campos gravados (tipos e tamanhos), como segunda camada de segurança.
