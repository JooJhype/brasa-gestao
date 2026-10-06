# Brasa — gestão da hamburgueria

Programa local em **JavaScript**, com interface em português e banco **SQLite**, para controlar estoque, fichas técnicas, custos e resultado de uma hamburgueria. Requer Node.js 24 ou superior. Não precisa instalar dependências npm: usa os recursos nativos do Node.js.

## Abrir e fechar

1. Abra a pasta em que você extraiu ou clonou o programa.
2. Dê dois cliques em **Iniciar Brasa.cmd**.
3. O navegador abrirá `http://127.0.0.1:4310`.
4. Para encerrar o servidor, dê dois cliques em **Parar Brasa.cmd**. Fechar apenas o navegador mantém o servidor funcionando.

Também pode iniciar pelo terminal, na pasta do programa: `npm start`. Nesse caso, encerre com Ctrl+C. O servidor aceita somente conexões do próprio computador. A operação não exige internet; a busca e as imagens externas exigem conexão. Não há sincronização com celular, nuvem ou plataformas de delivery.

## Primeiros passos

1. Em **Configurações**, informe nome, margem desejada, despesas previstas e previsão de pedidos. Confira as taxas e marque a confirmação de cada contrato.
2. Em **Ingredientes e estoque**, cadastre a quantidade comprada e o valor total pago. Cadastre também caixas, papel, sacolas e outras embalagens usando a unidade `un`.
3. Monte as **Fichas técnicas**: quanto de cada ingrediente e embalagem vai em uma unidade do produto.
4. Use **Precificação** para consultar o preço sugerido por canal.
5. Registre **Vendas**, incluindo produtos, quantidades, preço unitário, desconto pago pela loja e canal. A baixa do estoque é automática e vendas sem estoque são bloqueadas.
6. Lance **Despesas** e **Perdas / ajustes** para que o resultado represente sua operação.
7. Leia o **Guia de abertura**: ele contém a pesquisa fiscal, sanitária e de plataformas com links oficiais.

O botão **Explorar com exemplos** carrega ingredientes e receitas fictícios somente em base vazia. Esses preços servem para testar. Se quiser experimentar sem misturar com os dados reais, faça antes um backup da base vazia; restaure-o depois. Uma nova instalação começa com os cadastros e movimentações vazios.

## Como os cálculos funcionam

**Unidades:** kg ↔ g e l ↔ ml são convertidos automaticamente. Peso, volume e unidades são dimensões distintas: o programa impede misturar gramas com litros na mesma ficha.

**Exemplo:** 2 kg de queijo por R$80 dão R$40/kg e R$0,04/g. Uma porção de 50 g custa R$2. Vender duas unidades consome 100 g e registra R$4 de custo do queijo.

**Custo médio:** cada nova compra pondera o custo pelo saldo que ainda existe. Os custos de vendas já registradas ficam preservados; mudanças posteriores nas compras, fichas ou taxas não reescrevem o passado. Registre compras e vendas em ordem sempre que possível: lançar uma compra retroativa não recalcula vendas antigas.

**Preço sugerido:** `(ingredientes + outros custos do produto + taxa fixa por pedido + rateio mensal) / (1 − comissão − pagamento − imposto − margem desejada)`. As porcentagens entram como frações. A margem é percentual do preço de venda, não um acréscimo sobre o custo. A soma das taxas, imposto e margem precisa ser menor que 100%.

O rateio considera um produto por pedido e usa despesas mensais previstas mais a mensalidade prevista daquele canal, divididas pela previsão total de pedidos. Se usar vários canais, esse rateio é uma aproximação conservadora, não uma alocação exata por canal. No registro de uma venda com vários itens, a taxa fixa é cobrada uma única vez por pedido. Descontos, bases diferentes de comissão e cobranças variáveis devem ser conferidos no extrato; informe a **taxa total real** quando a estimativa não corresponder. Esse campo substitui todas as taxas da plataforma do pedido, inclusive logística adicional.

**Resultado mensal gerencial:** vendas após desconto, menos ingredientes e embalagens vendidos, outros custos de produção, taxas de plataformas, tributo percentual configurado, despesas efetivamente lançadas e perdas. Previsões mensais e mensalidades dos canais não são despesas automáticas; lance os valores cobrados em Despesas. O resultado depende da completude dos seus lançamentos. O programa não faz apuração tributária oficial, fluxo de caixa ou depreciação automática.

Compras de ingredientes aumentam o estoque; não são deduzidas integralmente como despesa no ato da compra. O custo entra no resultado quando o ingrediente é vendido ou perdido. Evite duplicar gás/embalagens ou outro custo na ficha e em Despesas. Se for MEI, confirme com contador o tratamento do DAS como despesa mensal e não use uma alíquota percentual fictícia por pedido.

Cancelamento com devolução recupera quantidade e custo histórico no estoque. Sem devolução física, mantém a baixa e registra ingredientes e custos de preparo como perda. O resultado é por mês de data informada; uma venda cancelada deixa de compor seu mês original, e a perda entra na data do cancelamento. Taxas não reembolsadas devem ser lançadas como despesas.

## Imagens

Ao digitar um novo ingrediente, o programa consulta o **Wikimedia Commons**, apresenta sugestões e seleciona uma imagem automática quando encontra. Confira se a imagem representa seu ingrediente. Autoria, licença e origem ficam guardadas. A busca por nome em português pode trazer resultados aproximados; use **Buscar imagem** ou um nome mais específico.

Também pode enviar PNG/JPG/WebP/GIF de até **4 MB** ou informar uma URL HTTPS. Imagens enviadas ficam no computador; o backup JSON inclui essas imagens para permitir restauração em outro diretório. Imagens externas continuam dependendo do site de origem. Confira os direitos de uso dos arquivos que você enviar ou vincular.

## Backup

- **Fazer backup** baixa um JSON com os cadastros, históricos e imagens enviadas.
- **Restaurar backup**, em Configurações, valida os dados antes de substituir a base. Uma cópia da base anterior é guardada automaticamente antes da tentativa.
- Há um backup automático antes do primeiro lançamento de cada dia, em `data\backups`. Ele representa o estado anterior aos lançamentos do dia, não o fechamento atualizado.
- Guarde regularmente uma cópia em outro dispositivo. O botão de exportação captura os dados atuais.
- O limite para restauração pelo navegador é 64 MB. Para bases maiores, ou para uma cópia completa do programa, encerre o servidor e copie a pasta inteira, incluindo `data` (SQLite, uploads e backups).

## Plataformas e obrigações — pesquisa em 06/10/2026

**iFood Entrega:** referência pública 23% de comissão, 3,2% para pagamento via iFood e R$150/mês quando faturamento mensal supera R$1.800. Disponibilidade, promoções e condições precisam ser confirmadas no contrato. O cadastro inicia sem confirmação. Ajuste a mensalidade prevista para zero quando ela não for cobrada. [Planos oficiais](https://parceiros.ifood.com.br/restaurante/planos-ifood).

**99Food:** não foi aplicada uma taxa universal. Os campos começam zerados e pendentes; isso **não indica isenção**. Verifique comissão, pagamento, logística, mensalidade e subsídios de frete em seu contrato. [Cobranças oficiais](https://99app.com/99food/restaurantes/guias/entendendo-as-cobrancas-da-99food/).

**Documento fiscal:** notas dos serviços do iFood e da 99 não substituem a nota do alimento. Este programa registra situação fiscal e referência, mas **não emite NF-e/NFC-e autorizada**. Para alimentação no RJ, confirme documento, dispensa aplicável e emissor com contador/SEFAZ-RJ. [Manual Nota Fiscal Fácil MEI](https://portal.fazenda.rj.gov.br/dfe/wp-content/uploads/sites/17/2024/01/DF-e_NFF-MEI-e_12_01_2024.pdf), [Manual NFC-e RJ](https://portal.fazenda.rj.gov.br/dfe/wp-content/uploads/sites/17/2023/01/DF-e_NFC-e.pdf).

**Exemplo municipal do RJ:** valide endereço, atividade/CNAE, uso do imóvel e regras sanitárias antes de operar. A pesquisa usa São João de Meriti como exemplo público: o município prevê ALFAE; MEI pode ter dispensa do procedimento de alvará, mas deve cumprir as normas. Confirme as exigências da sua própria localidade; este exemplo não configura a cidade da instalação. [Código de Posturas de Meriti](https://transparencia.meriti.rj.gov.br/diario_oficial_get_anexo.php?codigo=10733&ocr=s), [Dispensa MEI e obrigações preservadas](https://www.gov.br/empresas-e-negocios/pt-br/empreendedor/itens-inativo/copy_of_servicos-para-mei/dispensa-de-alvara-e-licenca/o-que-voce-precisa-saber-sobre-a-dispensa-de-alvara), [CBMERJ](https://www.cbmerj.rj.gov.br/para-o-cidadao/regularizacao/).

**Vigilância Sanitária:** organize Manual de Boas Práticas/POP, higiene, validade e identificação após fracionamento/abertura, armazenamento e controles de temperatura. Não defina validade universal. [RDC 216/2004 — Anvisa](https://anvisalegis.datalegis.net/action/ActionDatalegis.php?acao=abrirTextoAto&cod_menu=8542&cod_modulo=310&link=S&numeroAto=00000216&orgao=RDC%2FDC%2FANVISA%2FMS&seqAto=000&tipo=RDC&valorAno=2004).

## Publicar ou compartilhar o código

- Publique apenas código, testes, documentação e assets. A pasta `data/` contém banco, uploads, backups e logs locais e deve permanecer privada.
- O `.gitignore` exclui dados locais, exportações padrão do Brasa, credenciais e certificados privados. Ele atua ao usar Git; ao enviar arquivos manualmente ou criar um ZIP, exclua esses arquivos da seleção.
- Não inclua backups JSON, exportações financeiras CSV, capturas com dados reais ou arquivos de configuração com credenciais.
- Uma cópia distribuída sem `data/` cria um banco independente no primeiro início. Os cadastros demonstrativos do código são fictícios.
- Antes de criar um commit, confira os arquivos preparados com `git diff --cached --name-only`. Preserve as licenças das fontes em `public/assets/fonts`.
- O guia usa exemplos públicos do RJ, sem definir a cidade do estabelecimento. Configure a localidade no programa após a instalação.

## Sugestões de evolução

- Integração com emissor fiscal autorizado e conciliação dos extratos.
- Importação oficial de pedidos do iFood/99, quando houver acesso à integração contratada.
- Saldo por lote e alertas de validade original e após abertura. Nesta versão, validade fica no histórico da compra e o saldo é por ingrediente.
- Checklist sanitário, temperaturas, responsável e vencimento de documentos.
- Receita bruta anual e alertas do limite MEI, conforme enquadramento e mês de abertura.
- Contas a pagar/receber e permissões por usuário, se houver equipe.

## Para você que conhece JavaScript

A interface usa fontes locais IBM Plex Sans e Barlow Condensed, com licenças OFL na pasta `public/assets/fonts`. A logo transparente fica em `public/assets/brand/brasa-logo.png`. Títulos e controles usam famílias distintas; o resultado mensal recebe prioridade visual. O layout adapta a navegação para telas menores.

- `public/app.js`: interface e formulários, sem framework.
- `public/styles.css`: aparência e adaptação para telas pequenas.
- `src/domain.mjs`: conversões, cálculo de preço e relatório.
- `src/store.mjs`: banco SQLite e regras transacionais.
- `src/server.mjs`: servidor HTTP local, busca Commons, uploads e backup.
- `public/guide.json`: conteúdo da pesquisa e links.
- `tests/`: testes dos cálculos, integridade e API.

Execute `npm test` para validar. O banco é `data\brasa.sqlite`. Não exponha este servidor à internet. Para usar outra porta ou pasta em testes, defina `BRASA_PORT` e `BRASA_DATA_DIR` antes de `npm start`; o atalho normal usa 4310 e a pasta data do programa.
