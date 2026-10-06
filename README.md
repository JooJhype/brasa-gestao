# Brasa

O Brasa foi feito para ajudar no controle de uma hamburgueria. A ideia é reunir estoque, receitas, custos e vendas no mesmo lugar, para acompanhar o que está disponível e quanto sobra depois dos gastos.

## Como abrir

O jeito mais simples no Windows é usar o **instalador**, sem terminal ou Node.js. Na versão distribuída, ele fica em `Instalador/Brasa-Instalador-1.2.0-dev.2-x64.exe`.

No GitHub, procure o instalador em **Releases**, quando estiver disponível. O ZIP de código contém apenas os fontes, sem o executável.

Abra o `.exe`, siga as etapas da instalação e depois abra **Brasa** pelo atalho da área de trabalho ou pelo menu Iniciar. Ao fechar a janela pelo **X**, o programa encerra automaticamente.

O instalador também serve para atualizar o aplicativo, mantendo os dados locais.

## Como funciona

Em **Ingredientes e estoque**, entram as compras, com quantidade e valor total pago. Também dá para cadastrar embalagens. As medidas podem ser kg, g, l, ml ou unidade; o programa converte medidas compatíveis e calcula o custo médio das compras.

As **Fichas técnicas** mostram quanto de cada ingrediente e embalagem vai em um produto. Ao registrar uma **Venda**, o estoque é baixado automaticamente e os custos ficam guardados no histórico. No cancelamento, dá para informar se houve devolução ao estoque.

A **Precificação** usa os custos, a margem desejada e as taxas de cada plataforma para sugerir um preço. As taxas precisam ser conferidas no contrato. **Despesas e perdas** completam o cálculo do resultado mensal, então os lançamentos precisam estar em dia.

Na escolha das **Imagens**, a busca usa termos em inglês sem mudar o nome cadastrado em português. O termo da foto pode ser ajustado, e também dá para escolher outra sugestão, enviar uma imagem ou usar um link. A busca precisa de internet.

O **Guia de abertura** reúne orientações e referências para preparar a operação. O Brasa faz o controle gerencial, mas não emite nota fiscal.

## Corrigir e testar

Os botões **Excluir** e **Excluir ficha** pedem **deletar** para confirmar. Ingredientes ligados a receitas ou históricos de uso ficam protegidos. Uma ficha sem vendas pode ser excluída sem alterar o estoque; produtos presentes em vendas, inclusive canceladas, ficam protegidos pelo histórico.

Por enquanto, existe um reset em **Configurações → Restaurar padrão vazio**. Digitar **resetar** confirma a limpeza dos cadastros e lançamentos, voltando aos padrões iniciais. Esse botão é temporário. Antes de excluir ou resetar, o programa guarda um backup.

Para conhecer as telas sem preencher tudo do zero, **Explorar com exemplos** carrega dados fictícios quando a base está vazia.

## Backup e outros computadores

**Fazer backup** exporta os dados; **Restaurar backup** substitui a base atual pelo arquivo escolhido. Na versão com janela, cada computador e usuário tem sua própria base local, sem sincronização pela nuvem.

O modo navegador e a janela usam bancos separados. Para levar registros de um para o outro, o caminho é exportar o backup na origem e restaurar no destino.

## Rodar pelo código

Para rodar os fontes no Windows, precisa ter **Node.js 24 ou superior**. Extraia o ZIP mantendo as pastas juntas e abra um terminal na pasta do `package.json`:

```sh
npm ci
npm start
```

O primeiro comando instala as dependências. Depois, é só `npm start` para abrir a janela.

Também dá para usar no navegador com `npm run start:web`, em `http://127.0.0.1:4310`. **Ctrl+C** no terminal encerra esse modo. Se abriu pelo **Iniciar Brasa.cmd**, use **Parar Brasa.cmd**.

Para gerar outro instalador, `npm run build` deixa o arquivo pronto em `Instalador`, automaticamente, e limpa os resultados temporários depois do sucesso. Esse arquivo pode ser aberto ou compartilhado sem terminal.
