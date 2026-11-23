# DT 3D STUDIO — Calculadora de Pecinhas

Calculadora de preços e orçamentos da **DT 3D STUDIO**, para peças impressas em 3D.
Instagram: [@dt3dstudio](https://instagram.com/dt3dstudio)

## O que o app faz

- **Calcular**: preço sugerido por peça a partir do peso do filamento, tempo de impressão, extras e lucro desejado.
- **Catálogo**: peças salvas, contador de vendas na escola e catálogo pronto para colar no WhatsApp.
- **Pedidos**: orçamentos com várias peças, sinal de 50% via Pix e dois botões de WhatsApp:
  1. **Mandar preço no WhatsApp** (orçamento com chave Pix e regra do sinal);
  2. **Avisar que vamos fazer** (confirmação, depois que a metade cai no Pix).
  Cada pedido passa por: *Esperando pagar a metade → Imprimindo → Entregue*.
  Atalho: na calculadora, **Mandar o preço para um cliente** salva a peça e abre o pedido.
- **Ajustes**: chave Pix, validade do orçamento, prazo padrão e custos da impressora.
  Trancados pelo **PIN do papai** (só o hash do PIN fica salvo; é uma tranca contra crianças, não uma proteção forte).
- Instalável no Android (Chrome → menu ⋮ → **Instalar app**) e funciona sem internet.

## Onde ficam os dados

| Situação | Onde ficam |
|---|---|
| `firebase-config.js` com `null` | Só no aparelho (localStorage) |
| `firebase-config.js` preenchido | Firebase Firestore, sincronizado entre todos os aparelhos com o mesmo **código da família** |

Ao criar o código da família, o que já estava salvo no aparelho é enviado para a nuvem.

## Como ligar a nuvem (Firebase)

1. Crie um projeto em <https://console.firebase.google.com> (plano gratuito Spark).
2. **Build → Firestore Database → Create database** (região `southamerica-east1`, modo produção).
3. Na aba **Rules**, cole o conteúdo de [`firestore.rules`](firestore.rules) e clique em **Publish**.
4. **Configurações do projeto → Seus apps → Web (`</>`)**, registre o app e copie o objeto `firebaseConfig`.
5. Cole esse objeto em [`firebase-config.js`](firebase-config.js) no lugar de `null` e faça o commit.

## Segurança

- Use uma **chave Pix aleatória**; nunca coloque CPF no app.
- O código da família funciona como senha: quem tem o código vê e edita os dados.
- As regras do Firestore não permitem listar códigos nem apagar uma família inteira.

## Arquivos

| Arquivo | Para que serve |
|---|---|
| `index.html`, `styles.css` | Telas e visual |
| `app.js` | Cálculo, catálogo, pedidos e mensagens do WhatsApp |
| `store.js` | Dados: modo local ou Firebase |
| `firebase-config.js` | Configuração do Firebase |
| `firestore.rules` | Regras de segurança do banco |
| `manifest.webmanifest`, `sw.js`, `icons/` | App instalável e uso offline |
