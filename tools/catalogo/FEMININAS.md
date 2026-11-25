# Camisas femininas da Rainha JIN

A página inicial abre a seção **Femininas** pelo menu de categorias. A vitrine lê os resumos em `catalogos/rainhajin-femininas-5070410/itens` no Firestore do projeto `arquibancada-imports`. Ao abrir uma peça, ela lê a ficha do mesmo ID em `fichas`. A ficha é o cadastro editável. A busca percorre os resumos de toda a seção antes de paginar. A ausência de preço mantém o total do pedido a confirmar.

## Abrir a prévia

Com Node compatível com o Vite do projeto, execute `npm ci` e `npm run dev`. Abra o endereço local exibido no terminal e clique em **Femininas**. `npm run build` gera a loja em `dist/`. A publicação do site e a aplicação de regras no Firebase de produção dependem de aprovação separada.

## Obter a categoria

A fonte é a [categoria feminina da Rainha JIN](https://rainhajin.x.yupoo.com/categories/5070410). Na checagem de 25/11/2026, o arquivo de regras do site incluía `Disallow: /` para `ChatGPT-User`. Para trabalhar agora com o material da fornecedora, use uma exportação autorizada da categoria com as fotos internas em resolução original, títulos, descrições e legendas. O formato de entrada está abaixo. [Regras de acesso do Yupoo](https://rainhajin.x.yupoo.com/robots.txt)

Quando o acesso público para o agente for permitido, salve a referência da autorização de coleta e uso das imagens em `data/catalogo-local/yupoo-femininas/autorizacao.json` com os campos `status: "authorized"` e `evidenceNote` ou `evidenceUrl`. O coletor consulta o robots.txt com a sua identificação, segue os links públicos da categoria, lê a galeria de cada álbum e guarda as fotos em uma pasta local ignorada pelo Git. Respostas de bloqueio interrompem a coleta. Os seletores de HTML precisam ser conferidos no primeiro piloto real.

```sh
npm run catalog:coletar -- --limite 3
npm run catalog:coletar
```

Repita o comando para continuar das páginas e fotos salvas. Para reler os títulos e o conteúdo da fonte, use `npm run catalog:coletar -- --atualizar`. O relatório por álbum fica em `coleta.json` e a última interrupção fica em `interrupcao.json`.

## Conferir a exportação

O importador lê `data/catalogo-local/yupoo-femininas/export.json` e os arquivos de imagem relativos a essa pasta. O exemplo é fictício e ilustra o formato. Use os IDs, originais e autorização da exportação real.

```json
{
  "categoryUrl": "https://rainhajin.x.yupoo.com/categories/5070410",
  "authorization": { "status": "authorized", "evidenceNote": "Referência da autorização da fornecedora" },
  "pages": [{
    "url": "https://rainhajin.x.yupoo.com/categories/5070410",
    "albumUrls": ["https://rainhajin.x.yupoo.com/albums/123"],
    "nextPageUrl": null
  }],
  "albums": [{
    "url": "https://rainhajin.x.yupoo.com/albums/123",
    "title": "Arsenal Women Away Jersey 2024/25",
    "identityVerified": true,
    "coverId": "f1",
    "photos": [
      { "id": "f1", "file": "fotos/123/frente.jpg", "view": "front", "whole": true, "preferred": true, "verified": true },
      { "id": "f2", "file": "fotos/123/costas.jpg", "view": "back", "caption": "Back view", "verified": true }
    ]
  }]
}
```

Cada página registra a URL da próxima. A última usa `null`. Só entram IDs encontrados nessa cadeia. Para a revisão, abra os originais e marque `verified` em cada foto associada à camisa. Use `coverId` para escolher a melhor frente. `preferred` indica a apresentação preferida entre frentes equivalentes. Os valores de `view` incluem `front`, `back`, `side`, `crest`, `collar`, `fabric`, `print` e `detail`. Galerias com uma única frente são válidas.

O título pode ser identificado pela legenda da foto mesmo quando o nome do álbum é numérico. Confira as sugestões com `conferir`. Para traduções livres, registre `nome`, `descriptionPt` e `captionPt` junto ao texto original. Quando a autorização do fornecedor abranger a descrição separada, use `descriptionAuthorized: true` no álbum ou na variante. Aproveite o português existente. Quando a identificação vier do escudo ou de outra inscrição, registre `time`, `evidence` e `tipoLegenda: "gerada"`. Sem identidade confirmada, use um nome factual, como “Camisa feminina azul e branca”, e deixe o time vazio. `identityVerified: true` indica que os dados exibidos foram conferidos, inclusive quando o nome é provisório. O time desconhecido permanece na fila de revisão.

Para um álbum misto, use `variants` com uma `key` estável por modelo, `photoIds` e os campos de identificação e revisão de cada variante. As chaves representam as peças ao longo das reimportações. A mesma foto atribuída a duas variantes bloqueia o álbum. Fotos sem atribuição ficam pendentes.

## Importar e retomar

1. Configure a credencial administrativa do projeto `arquibancada-imports` via Application Default Credentials ou `GOOGLE_APPLICATION_CREDENTIALS` apontando para um arquivo fora do repositório. O bucket esperado é `arquibancada-imports.firebasestorage.app`.
2. Confira as pendências e importe um piloto. Abra a página inicial em duas sessões e confira as fotos e legendas. Para testar com os emuladores use o procedimento abaixo.
3. Após conferir o piloto, rode a carga completa. Repetir o mesmo comando retoma o progresso.

```sh
npm run catalog:femininas -- conferir
npm run catalog:femininas -- importar --limite 3
npm run catalog:femininas -- importar
```

Para reprocessar um álbum específico, execute `npm run catalog:femininas -- importar --album 123 --reprocessar` substituindo 123 pelo ID real. Também é possível passar `--arquivo caminho/export.json`.

O checkpoint fica ao lado da exportação, separado por ambiente. Registra peças preparadas, pendências e falhas por álbum ou foto. A contagem verificada exige a releitura da ficha, do resumo e a confirmação dos arquivos no Storage. As fotos conservam os bytes originais. O hash do conteúdo determina o caminho e elimina duplicação exata dentro da peça. Uma interrupção após o upload permite reutilizar os arquivos já gravados. A transação grava ficha e resumo juntos, depois das fotos.

Para corrigir uma peça, edite a ficha ou a exportação e reprocesse o álbum para atualizar o resumo. As alterações manuais dos campos de identificação, de legenda por ID de foto e dos preços na ficha sobrevivem à reimportação. As coleções antigas, inclusive `produtos`, ficam fora das consultas da nova vitrine.

## Emuladores e testes

Inicie a Firebase CLI com `firebase emulators:start --only firestore,storage --project demo-arquibancada`. Num terminal PowerShell separado, use as variáveis abaixo. A opção `--emulador` exige os dois serviços em endereços locais.

```powershell
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
$env:FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199'
npm run catalog:femininas -- importar --emulador --limite 3
$env:VITE_USE_FIREBASE_EMULATORS = 'true'
npm run dev
```

`npm run catalog:test` valida paginação, busca, preço sob consulta, associação das fotos, retomada e preservação de edições. `npm run catalog:check` audita os arquivos históricos mantidos no repositório. Esses 20 registros estão fora da vitrine da branch.
