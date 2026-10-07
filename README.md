# Brasa

Aplicativo para gerenciar pedidos, estoque e custos de uma hamburgueria. O Brasa reúne fichas
técnicas, precificação, vendas e resultado mensal em uma janela própria no Windows, com os dados
armazenados no computador.

## Instalação no Windows

O instalador inclui o necessário para executar o aplicativo. Não exige Node.js nem terminal.

1. Acesse **Releases** neste repositório e baixe `Brasa-Instalador-1.3.0-x64.exe`.
2. Execute o arquivo em um computador com Windows de 64 bits.
3. Siga as etapas do instalador e escolha a pasta de instalação.
4. Abra **Brasa Protótipo** pelo atalho da área de trabalho ou pelo menu Iniciar.

Para encerrar, feche a janela pelo **X**. O servidor local também é encerrado. Nas próximas
aberturas, os cadastros e lançamentos permanecem disponíveis.

O ZIP do repositório contém o código-fonte. Para utilizar o programa sem configurar um ambiente de
desenvolvimento, baixe o instalador disponibilizado em Releases.

## Primeiro uso

Os cadastros seguem esta sequência:

1. Em **Configurações**, informe o nome da hamburgueria, a margem desejada, as despesas mensais
   previstas e a quantidade esperada de pedidos.
2. Confira os **canais de venda**. Preencha comissão, taxa de pagamento, taxa fixa por pedido e
   mensalidade conforme as condições contratadas. Confirme as taxas para liberar a sugestão de preço
   daquele canal.
3. Em **Ingredientes e estoque**, cadastre ingredientes e embalagens. Registre a quantidade comprada
   e o valor total pago.
4. Em **Fichas técnicas**, monte cada produto com as quantidades utilizadas por unidade produzida.
5. Confira os preços em **Precificação** e defina os valores de venda dos produtos.
6. Cadastre os pedidos e acompanhe a operação em **Pedidos**.

As taxas dos canais são informadas manualmente. Selecionar iFood, 99Food ou outro canal identifica a
origem da venda e as condições de cálculo; não conecta contas nem recebe pedidos automaticamente.

## Funcionalidades

### Visão geral

Selecione o mês no topo da tela para consultar receitas, custos, taxas, tributos estimados,
despesas, perdas e resultado líquido gerencial. A página também apresenta o desempenho por canal e
os ingredientes que precisam de reposição.

O resultado usa vendas concluídas, custos históricos e despesas efetivamente lançadas. Despesas
mensais previstas e mensalidades configuradas ajudam na precificação, mas não são descontadas
automaticamente do resultado. Registre esses pagamentos em **Despesas** quando ocorrerem.

### Ingredientes e estoque

Cadastre o nome, a unidade de medida e o estoque mínimo de cada item. As unidades disponíveis são
quilograma, grama, litro, mililitro e unidade. A conversão ocorre entre medidas compatíveis: uma
compra em quilogramas pode abastecer uma ficha que utiliza gramas, por exemplo.

Use **Compra** para registrar novas entradas. O custo médio é atualizado a partir do saldo existente
e das novas compras. **Perda / ajuste** permite registrar descartes e corrigir saldos com uma
observação. **Ver movimentações** reúne o histórico das entradas, saídas e ajustes.

A imagem pode ser enviada do computador, informada por link ou escolhida pela busca integrada. A
busca utiliza termos em inglês sem alterar o nome do ingrediente e exige conexão com a internet.

Para excluir um cadastro, use **Excluir** e digite `deletar` na confirmação. Ingredientes vinculados
a fichas ou históricos de uso ficam protegidos. Uma cópia de segurança é salva antes da exclusão.

### Fichas técnicas

Em **Novo produto**, informe o nome, o preço de venda direta e a quantidade de cada ingrediente
necessária para produzir uma unidade. Inclua embalagens na ficha e use o campo de outros custos
quando houver um custo por produto que não consuma estoque.

O custo da ficha acompanha o custo médio atual dos ingredientes. **Editar ficha** permite ajustar a
composição; **Excluir ficha** exige a confirmação `deletar`. Produtos vinculados a pedidos ou vendas
ficam protegidos para preservar o histórico.

Adicionais que consomem estoque devem ter uma ficha própria e entrar como um item separado no
pedido.

### Pedidos

Clique em **Novo pedido**, selecione o canal e informe produtos, quantidades e preços. Acrescente
cliente, telefone, endereço, referência, entrega ou retirada, responsável pela entrega, pagamento,
troco, agendamento e observações, conforme a operação.

O quadro organiza os pedidos em **Recebido**, **Em preparo**, **Pronto** e **Em entrega**. Abra um
pedido para consultar os detalhes e a comanda de preparo, sem o detalhamento financeiro.

Antes de **Iniciar preparo**, confira os itens e as fichas técnicas. Nesse momento, o estoque é
baixado uma única vez e os custos utilizados ficam registrados. Depois, avance pelas etapas até a
conclusão da entrega ou retirada. O pedido concluído entra no histórico de **Vendas**.

Observações como “sem cebola” aparecem para a cozinha, mas não alteram automaticamente o consumo da
ficha padrão. Para um consumo diferente, cadastre uma ficha adequada.

Ao cancelar antes do preparo, o estoque permanece intacto. Depois do preparo, informe se os itens
podem retornar fisicamente ao estoque. Sem devolução, o custo consumido é registrado como perda.
Pedidos cancelados também permanecem no histórico.

O aplicativo registra as etapas informadas pelo operador. Não processa pagamentos nem solicita
entregadores às plataformas.

### Vendas

Consulte os pedidos concluídos e cancelados no mês selecionado, com os valores e custos registrados
na operação. Use **Registrar venda finalizada** para lançar uma venda que já aconteceu fora do
quadro de pedidos. Não registre novamente um pedido que já foi concluído no Brasa.

A situação fiscal e o número ou chave de um documento podem ser informados no registro da venda.
Esses campos documentam a operação; o Brasa não emite, autoriza nem valida notas fiscais.

### Precificação

Selecione uma ficha para comparar o preço sugerido em cada canal. A conta considera ingredientes,
outros custos do produto, comissão, taxa de pagamento, taxa fixa, imposto estimado, margem desejada
e rateio das despesas mensais previstas.

O rateio pressupõe um produto por pedido. Em combos e pedidos com vários itens, confira a composição
do preço: no registro da venda, a taxa fixa do canal é cobrada uma vez por pedido. Descontos e taxas
adicionais também afetam o resultado final.

### Despesas

Registre a descrição, a categoria, a data e o valor de cada despesa. Aluguel, energia, mensalidades
de plataformas e outros pagamentos entram no resultado do mês de sua data. Perdas de ingredientes
devem ser lançadas em **Ingredientes e estoque**, para ajustar também o saldo disponível.

### Configurações

Atualize os dados da operação, os parâmetros de precificação e as condições dos canais. O imposto
sobre a venda é uma estimativa configurada pelo operador, não um cálculo fiscal automático.

Nesta página também estão o backup JSON, a restauração, a exportação financeira CSV e o modo de
demonstração.

## Demonstração

**Entrar na demonstração** abre uma base temporária com ingredientes, fichas, pedidos e vendas
fictícios. O modo permite explorar o fluxo completo sem alterar os registros da operação.

**Sair da demonstração** retorna à base normal. Os exemplos e as alterações continuam disponíveis
enquanto o aplicativo estiver aberto e são descartados ao encerrar a janela. O backup exporta os
dados do modo ativo; saia da demonstração antes de salvar os registros reais.

## Backup e transferência de dados

Em **Configurações**, use **Baixar backup JSON** para salvar os cadastros e históricos. Guarde uma
cópia em outro dispositivo. O aplicativo também cria uma cópia automática antes do primeiro
lançamento de cada dia. O menu **Arquivo → Abrir pasta dos dados** mostra os arquivos locais.

**Restaurar backup** valida o arquivo escolhido e substitui a base do modo ativo. Uma cópia da base
atual é guardada antes da tentativa. Confira o modo aberto e o arquivo antes de confirmar.

Para transferir a operação a outro computador, instale o Brasa, exporte o backup no computador de
origem e restaure no destino. Para compartilhar somente o programa, envie o instalador. Cada
computador e usuário tem uma base independente; os registros não acompanham o instalador e não
existe sincronização pela nuvem. Backups podem conter dados de clientes e devem ser mantidos
privados.

Uma atualização pelo instalador preserva os dados locais. Ainda assim, exporte um backup antes de
atualizar. **Exportar financeiro CSV** gera os dados financeiros do mês selecionado para consulta em
uma planilha.

## Código e desenvolvimento

O projeto utiliza **JavaScript**, **Electron**, **Node.js** e **SQLite**. A interface é construída
com HTML e CSS; o Electron abre a janela e um servidor HTTP restrito ao computador atende as
operações. Os cálculos de custo, precificação e resultado ficam separados da persistência dos dados.

As principais pastas são:

- `public/`: interface, estilos, imagens e fontes.
- `src/`: servidor local, regras de cálculo, armazenamento e dados da demonstração.
- `desktop/`: janela, menus e recursos do aplicativo Windows.
- `tests/`: testes das regras e dos fluxos HTTP com bases isoladas.
- `scripts/`: geração do instalador.
- `Instalador/`: instalador gerado e instruções de instalação.

### Executar a partir do código

É necessário **Node.js 24 ou superior**. Na pasta que contém `package.json`, execute:

```sh
npm ci
npm start
```

`npm ci` instala as dependências e `npm start` abre a janela. Para trabalhar com a interface no
navegador, use `npm run start:web` e acesse `http://127.0.0.1:4310`. Encerre esse processo com
**Ctrl+C** no terminal. Os modos navegador e aplicativo utilizam bases separadas.

### Verificar e gerar o aplicativo

- `npm run format`: aplica a formatação do projeto.
- `npm run verify`: verifica JavaScript, formatação e testes.
- `npm run pack`: gera o aplicativo Windows sem instalador em `dist/`.
- `npm run build`: gera o instalador em `Instalador/` e remove os arquivos temporários de compilação
  após o sucesso.

As regras de manutenção estão em `eslint.config.mjs`, `.prettierrc.json` e `.editorconfig`. O
instalador gerado pode ser distribuído e executado sem ferramentas de desenvolvimento.
