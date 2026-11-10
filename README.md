# RBX BOX Server

Servidor independente de ativação e catálogo do RBX BOX. Este projeto não contém as rotas, o checkout, o Pix nem o banco do RBX da Steam.

## 1. Enviar ao GitHub

Extraia `RBX_BOX-Servidor-Independente.zip` e envie o conteúdo para a raiz de `bocaecergin55-hash/rbx-box-server`. O arquivo `package.json` deve ficar na raiz e `box.html` dentro da pasta `public`.

Não envie este pacote ao repositório `rbx-imperio-key-server`. O ZIP anterior `RBX_BOX-Servidor-Atualizacao.zip` foi feito para a arquitetura compartilhada e não deve ser usado aqui.

## 2. Criar os recursos exclusivos do BOX no Render

1. Crie um PostgreSQL novo, com nome que identifique o BOX.
2. Crie um Web Service novo conectado somente a `rbx-box-server`, branch `main`, ambiente Node.
3. Coloque o banco e o serviço na mesma região. Use a URL interna desse banco novo.
4. Build Command: `npm ci`. Start Command: `npm start`. Health Check Path: `/health`.
5. No serviço novo, configure somente as variáveis abaixo. Não copie os valores nem os grupos de variáveis do serviço Steam.

| Variável | Valor a configurar no Render |
| --- | --- |
| `BOX_DATABASE_URL` | URL interna do PostgreSQL exclusivo do BOX |
| `BOX_ADMIN_USER` | Novo usuário administrativo do BOX |
| `BOX_ADMIN_PASSWORD` | Nova senha do BOX, com pelo menos 12 caracteres |
| `BOX_JWT_SECRET` | Segredo aleatório exclusivo, com pelo menos 32 caracteres |

O Render define `PORT` automaticamente. Para usar TLS verificado em conexões que exijam isso, existe a variável opcional `BOX_DATABASE_SSL=true`. Na conexão interna padrão, mantenha essa variável ausente.

Não envie senhas ou URLs com credenciais ao GitHub ou ao chat. Configure-as diretamente no painel do serviço novo. Confirme o plano e o custo dos recursos no Render antes de criar.

O servidor cria automaticamente somente `box_keys` e `box_catalog`, e inclui o catálogo inicial de 31 jogos. As pastas de jogos, BIOS, firmware e saves continuam nos PCs.

## 3. Conectar o aplicativo

Depois que o serviço ficar Live, envie somente seu endereço público `.onrender.com`. O instalador precisa ser reconstruído com esse endereço real; não presuma que o nome do repositório determina a URL disponível.

**O instalador `RBX_BOX-Instalar-com-Key.exe` enviado antes deste pacote aponta para o serviço Steam e ainda não deve ser usado com o servidor separado.** A versão anterior sem key continua independente dessa preparação.

Abra `/box.html` no domínio novo, entre com as credenciais novas e gere uma key. A key completa é mostrada apenas ao gerar; depois o painel lista somente o final. O cliente digita a key no BOX depois que o instalador for atualizado.

## Catálogo

O painel permite cadastrar, editar, remover e publicar jogos, capas, descrições e links. O aplicativo atualizado consulta o catálogo ao abrir e a cada cinco minutos. Adicionar jogos compatíveis com os emuladores existentes não exige novo instalador.

Use os prefixos de ID:

- PS1: `rbx-ps1-`
- PS2: `rbx-drive-ps2-`
- PS3: `rbx-ps3-`
- Switch: `rbx-switch-`
- Xbox 360: `rbx-xbox360-`
- SNES: `rbx-snes-`

Mantenha o ID após publicar para preservar a associação à pasta instalada. Pacotes devem estar em ZIP, RAR ou 7z, com os arquivos corretos do console. Novas capas usam HTTPS. As capas já incluídas no BOX usam `asset:` e não precisam de novo upload.

O servidor não confirma que o pacote corresponde à capa nem que o jogo é compatível. Bloqueios, limites e expiração dos provedores de download continuam possíveis. A biblioteca SNES existente permanece no aplicativo; o painel também permite cadastrar novos pacotes SNES individuais.

## Ativação e testes

As keys vinculam um PC, têm validade contada desde a criação e podem ser revogadas, reativadas ou liberadas para novo vínculo. A aplicação salva a key cifrada com a proteção do Windows e precisa de conexão para revalidar. A administração usa tokens e segredo exclusivos do BOX; tokens Steam, de pagamento ou do cliente BOX não são administrativos.

Execute `npm ci` e `npm test`. Os testes HTTP usam PostgreSQL simulado e verificam login real do painel, vínculo, expiração, revogação, catálogo, conflitos de revisão, isolamento de tokens e inexistência das rotas Steam/Pix. O PostgreSQL real usa `SELECT FOR UPDATE` na primeira ativação.

Publicação real no Render, instalação no Windows e execução dos jogos/controles ainda precisam de validação. Configurar este servidor não corrige problemas gráficos ou de compatibilidade dos emuladores.

Documentação de implantação: https://render.com/docs/deploy-node-express-app e https://render.com/docs/postgresql-creating-connecting
