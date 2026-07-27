# Vitta Fit Wear — Netlify + Supabase + Mercado Pago

Loja virtual de moda fitness masculina e feminina, com entrega apenas em Rio Verde - GO por R$ 10,00. O projeto possui:

- catálogo público alimentado pelo Supabase;
- estoque separado por tamanho;
- carrinho e checkout;
- Checkout Pro do Mercado Pago;
- confirmação por webhook;
- baixa automática e atômica do estoque após pagamento aprovado;
- área administrativa com login;
- cadastro, upload de foto, pausa, reativação e exclusão de anúncios;
- acompanhamento de pedidos;
- relatório por data de pagamento e exportação CSV;
- atualização de pedidos em tempo real no painel.

## Como o pagamento funciona

1. O cliente monta o carrinho e informa os dados de entrega.
2. A função `create-checkout` valida os preços e o estoque diretamente no Supabase.
3. O pedido é criado como `pending_payment`.
4. A função cria uma preferência no Mercado Pago e redireciona o cliente ao Checkout Pro.
5. O Mercado Pago envia uma notificação para `mercadopago-webhook`.
6. O webhook valida a assinatura, consulta o pagamento na API e chama a função SQL `confirm_order_payment`.
7. O pedido passa para `paid`, recebe a data do pagamento e o estoque é reduzido.
8. O painel e os relatórios são atualizados.

A tela de retorno do cliente nunca é usada como confirmação financeira. Somente o webhook altera um pedido para pago.

## 1. Criar o Supabase

1. Crie um projeto no Supabase.
2. Abra **SQL Editor**.
3. Copie e execute todo o arquivo `supabase/schema.sql`.
4. Em **Authentication > Users**, crie manualmente o usuário do dono da loja.
5. Em **Authentication > Providers > Email**, mantenha o login por e-mail ativo.
6. Para evitar que qualquer pessoa crie conta administrativa, desative cadastros públicos ou mantenha somente o usuário criado manualmente.

O arquivo SQL cria as tabelas, políticas RLS, bucket de imagens, produtos de demonstração e a rotina segura de baixa do estoque.

## 2. Criar a integração no Mercado Pago

1. Entre no painel de desenvolvedores do Mercado Pago.
2. Abra **Suas integrações** e crie uma aplicação para Checkout Pro.
3. Copie o **Access Token** de teste inicialmente.
4. Depois que o site estiver publicado, abra **Webhooks > Configurar notificações**.
5. Use esta URL, trocando pelo domínio real:

```text
https://vittafitwear.netlify.app/api/mercadopago-webhook
```

6. Marque o evento **Pagamentos**.
7. Salve e copie a chave secreta gerada para validar o header `x-signature`.

Para produção, substitua as credenciais de teste pelas credenciais de produção e altere `MP_USE_SANDBOX` para `false`.

## 3. Publicar no GitHub

Envie todos os arquivos deste projeto para um repositório. O `package.json` e o `netlify.toml` devem ficar na raiz do repositório, não dentro de uma segunda pasta.

## 4. Criar o site no Netlify

1. No Netlify, clique em **Add new project > Import an existing project**.
2. Conecte o repositório do GitHub.
3. O Netlify lerá o `netlify.toml` automaticamente:
   - Build command: `npm run build`
   - Publish directory: `public`
   - Functions directory: `netlify/functions`
4. Antes do deploy final, abra **Site configuration > Environment variables** e cadastre:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
MP_ACCESS_TOKEN
MP_WEBHOOK_SECRET
MP_USE_SANDBOX
SITE_URL
```

Exemplo de `SITE_URL`:

```text
https://vitta-fit-wear.netlify.app
```

Nunca coloque `SUPABASE_SERVICE_ROLE_KEY`, `MP_ACCESS_TOKEN` ou `MP_WEBHOOK_SECRET` em arquivos JavaScript da pasta `public`.

A URL e a chave pública do Supabase são usadas pelo navegador, mas continuam protegidas pelas políticas RLS. As chaves secretas ficam somente nas Netlify Functions.

## 5. Fazer o primeiro deploy

Após cadastrar as variáveis, use **Deploys > Trigger deploy > Deploy site**. O build gera automaticamente o arquivo `public/config.js` com apenas a URL e a chave pública do Supabase.

Endereços:

```text
Loja:  https://SEU-SITE.netlify.app
Painel: https://SEU-SITE.netlify.app/admin.html
```

## 6. Testar o pagamento

Use as credenciais e usuários de teste fornecidos pelo Mercado Pago. O Mercado Pago informa que pagamentos feitos com certas credenciais de teste podem não disparar notificações automaticamente; nesse caso, use o simulador de Webhooks em **Suas integrações** para testar o receptor.

Confira os logs em:

```text
Netlify > Functions > mercadopago-webhook
```

O teste está completo quando:

- o pedido aparece no painel;
- o webhook retorna HTTP 200;
- o pedido muda para **Pago**;
- a data de pagamento aparece;
- o estoque do tamanho comprado diminui;
- a venda entra no relatório.

## Desenvolvimento local

Crie um arquivo `.env` com base em `.env.example`, instale as dependências e rode:

```bash
npm install
npm run dev
```

O Netlify CLI simula as Functions localmente. Porém, o Mercado Pago não aceita `localhost` nas URLs de retorno. Para testar o redirecionamento e webhook de ponta a ponta, use um deploy do Netlify ou um endereço HTTPS público.

## Observações de produção

- Comece com Checkout Pro: os dados do cartão não passam pelo site da Vitta.
- Use credenciais de produção somente depois de concluir os testes.
- Faça uma compra real de valor baixo antes do lançamento.
- Configure domínio próprio e políticas de privacidade/troca.
- A baixa acontece após aprovação. Em um volume muito alto, pode ser necessário adicionar reserva temporária de estoque para checkouts ainda não pagos.
- Reembolsos não devolvem estoque automaticamente, porque uma peça devolvida pode precisar de conferência física antes de voltar ao catálogo.
