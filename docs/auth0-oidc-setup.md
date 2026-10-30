# Guia de configuração do Auth0 e OIDC

Este guia descreve os valores necessários para o login Auth0/OIDC da Fase 1 remota, onde encontrá-los e como serão usados. Não configure URLs de callback até a integração web estar implementada.

## Estado atual do projeto

- Auth0 foi escolhido como provedor OIDC; o Google será uma conexão federada dentro do Auth0.
- O verificador da API já valida access tokens destinados à API usando issuer, audience, chaves JWKS e `RS256`.
- O login web, a composição Auth0 no runtime, as guards nas rotas de produto e o bootstrap do usuário piloto ainda não foram implementados. O `AppModule.withPostgres` atual não importa o módulo OIDC.
- O login Auth0 via Google e VPN/source-IP como defesa adicional são requisitos da implantação Docker. O login não habilita cadastro público nem acesso multi-tenant.
- O cliente web atual é estático. O padrão escolhido para IAM-08 é BFF/sessão server-side no NestJS, sem adicionar um serviço Next.js somente para login; as URLs exatas de callback/logout dependem das rotas que serão implementadas.
- A API aceitará apenas tokens emitidos pelo Auth0 para o audience da API. Tokens Google diretos não serão aceitos. Adicionar valores ao `.env.local` não habilita login até a integração ser conectada.
- Não coloque client secrets, tokens, senhas ou `AUTH0_SECRET` neste documento, no Git ou no chat.

## Primeiro: entenda os componentes

Há dois registros diferentes no Auth0:

1. **API (resource server):** representa esta API e define o identificador usado como `audience` nos access tokens.
2. **Application (client):** representa o cliente web/BFF que iniciará login e logout. O tipo de cliente e o uso de `Client Secret` dependem da integração escolhida em IAM-08; qualquer segredo de cliente permanece server-side.

O BFF solicita um access token destinado à API usando Authorization Code + PKCE. O verificador Auth0 valida issuer, audience e assinatura via JWKS antes de criar a sessão local. O `Client ID` não é a `audience`, e o backend não deve receber um ID token ou token Google no lugar do access token Auth0.

## Valores necessários

| Nome | Para que serve | Onde obter | É secreto? |
| --- | --- | --- | --- |
| `OIDC_ISSUER` | Identifica exatamente o Auth0 tenant/custom domain que emitiu o token. A API compara esse valor com o claim `iss`. | No campo `issuer` do documento OIDC Discovery. Copie o valor exato, inclusive a barra final, se houver. | Não |
| `OIDC_AUDIENCE` | Identifica esta API. A API compara esse valor com o claim `aud` do access token. | Auth0 Dashboard → **Applications → APIs** → selecione a API → **Identifier**. O valor é escolhido ao criar a API. | Não |
| `OIDC_JWKS_URI` | Endereço das chaves públicas que a API usa para verificar assinaturas JWT. | No campo `jwks_uri` do documento OIDC Discovery. Copie-o; não construa a URL manualmente. | Não |
| `AUTH0_DOMAIN` | Informa ao cliente web/BFF qual domínio Auth0 usar nos fluxos de login/logout. | Auth0 Dashboard → **Applications → Applications** → selecione o aplicativo → **Settings → Basic Information → Domain**. Use o formato exigido pela integração IAM-08. | Não |
| `AUTH0_CLIENT_ID` | Identifica o cliente web perante o Auth0. Não é a audience da API. | Na mesma tela do aplicativo, campo **Client ID**. | Não |
| `AUTH0_CLIENT_SECRET` | Autentica o BFF server-side perante o Auth0. Nunca é enviada ao navegador. | Credenciais do aplicativo Auth0 confidencial selecionado. | **Sim — Secret Manager somente** |
| `AUTH0_SECRET` | Chave aleatória usada pelo componente server-side para proteger a sessão/cookies. Não é fornecida pelo Auth0. | Gerada localmente; confirme formato/tamanho na documentação da biblioteca escolhida. | **Sim — Secret Manager somente** |
| `APP_BASE_URL` | Origem pública HTTPS do CreatorDesk, usada para construir callbacks, logout e cookies. | Definida pela implantação, por exemplo `https://<APP_DOMAIN>`. | Não |
| Allowed Callback URLs | URLs completas para as quais o Auth0 pode redirecionar após login. O caminho depende da versão e configuração do SDK. | Auth0 Dashboard → **Applications → Applications** → aplicativo → **Settings → Application URIs**. Definir depois de implementar/selecionar o SDK. | Não |
| Allowed Logout URLs | Destinos permitidos para o retorno após logout. | Na mesma seção de URLs do aplicativo. | Não |
| Allowed Web Origins | Origens de navegador permitidas em fluxos que as exigem; origem é esquema + host + porta, sem caminho. | Na mesma seção de URLs do aplicativo, conforme a necessidade do SDK. | Não |
| `PLATFORM_ADMIN` bootstrap | Concede a primeira identidade local de administrador global, separada de qualquer papel de tenant. | Processo operacional controlado; ver a seção de bootstrap abaixo. | Não é uma senha, mas deve ser aprovado e restrito a operadores autorizados |

### Obter `issuer` e `jwks_uri` pelo Discovery

1. No Auth0 Dashboard, localize o Domain do tenant que será usado.
2. Abra o endereço de Discovery desse domínio: `https://<AUTH0_DOMAIN>/.well-known/openid-configuration`.
3. No JSON retornado, copie os valores de `issuer` e `jwks_uri` exatamente.

Também é possível consultá-los no terminal, se `curl` e `jq` estiverem instalados:

```sh
curl -fsS "https://<AUTH0_DOMAIN>/.well-known/openid-configuration" | jq '{issuer, jwks_uri}'
```

Use o mesmo domínio — tenant domain ou custom domain — de forma consistente em Discovery, emissão de tokens e configuração do console. O issuer costuma ter forma `https://<AUTH0_DOMAIN>/`, mas o valor do Discovery é a fonte de verdade.

### Criar a API e escolher a audience

1. No Auth0 Dashboard, vá a **Applications → APIs → Create API**.
2. Escolha um nome descritivo.
3. Defina o **Identifier**. Esse valor será `OIDC_AUDIENCE`; é um identificador, não precisa ser um endpoint acessível. Escolha-o com cuidado: o Auth0 não permite alterá-lo depois da criação.
4. Escolha **RS256** para a assinatura dos access tokens. A implementação atual aceita esse algoritmo.
5. Salve a API e registre o Identifier exatamente como aparece no Dashboard.

O cliente web deverá solicitar access tokens destinados a essa API. Um token destinado a outro audience será rejeitado.

### Criar o aplicativo web

Para a implantação Docker, crie no Auth0 a API e uma aplicação web confidencial para o BFF definido em [ADR-008](../architecture/decisions/ADR-008-phase1-authenticated-session.md). Habilite a conexão Google somente para a aplicação aprovada e restrinja o piloto a identidades explicitamente provisionadas. Guarde `AUTH0_CLIENT_SECRET` e a chave de sessão no secret store server-side.

A URL de callback exata ainda não deve ser inventada: ela depende das rotas BFF que serão implementadas em IAM-08. Depois da implementação, configure no Auth0 as URLs exatas de callback, logout e Web Origins para `APP_BASE_URL`. Use HTTPS, evite curingas e não inclua `localhost` nas configurações de produção.

O `APP_BASE_URL` é a origem do CreatorDesk, por exemplo `http://localhost:3000` em desenvolvimento e `https://<APP_DOMAIN>` na VM. O callback Auth0 é independente dos callbacks dos provedores sociais.

### Segredos

- `AUTH0_CLIENT_SECRET` vem do aplicativo Auth0 confidencial e deve ser armazenado como segredo server-side.
- `AUTH0_SECRET` é uma chave aleatória própria da sessão server-side, se exigida pelo SDK escolhido. Verifique o formato e o tamanho na documentação dessa versão.
- Armazene ambos no Secret Manager do ambiente (local, staging ou produção). Não os envie por chat, não os coloque em arquivos versionados e não os exponha ao JavaScript do navegador.
- `.env.example` deve conter apenas nomes e valores demonstrativos não secretos. O `.env.local` local fica ignorado pelo Git; não reutilize segredos de produção nele.

### Primeiro `PLATFORM_ADMIN`

`PLATFORM_ADMIN` é um grant local global, não um papel definido por e-mail ou por uma claim arbitrária do cliente. O login da Fase 1 exige somente um usuário piloto explicitamente provisionado e uma membership no tenant piloto; esse usuário não precisa ser `PLATFORM_ADMIN`. O sistema associa a identidade OIDC verificada pelo par exato `(issuer, subject)` a um usuário local; a migration atual mantém o grant em `platform_admins`, separado de `tenant_memberships`.

O piloto da Fase 1 precisa de um usuário local ativo com membership no tenant piloto; ele não precisa receber `PLATFORM_ADMIN`. Um operador autorizado deve provisionar esse usuário associando o `issuer` e o `sub` exatos da identidade Auth0/Google federada à identidade local. Não use e-mail como chave de identidade nem aceite um `sub` fornecido pelo cliente. A concessão de `PLATFORM_ADMIN` e o console de administração continuam na Fase 3; o procedimento de bootstrap ainda precisa ser implementado.

O claim `sub` identifica o sujeito do token; para login de usuário, o Auth0 documenta que ele corresponde ao `user_id`. A equipe operadora deve verificar o valor no contexto do tenant e da aplicação corretos. Não compartilhe access tokens para obter esse valor.

## Exemplo demonstrativo — não copie sem substituir

Os valores abaixo são placeholders; não são credenciais reais nem funcionam até configurar seu tenant e API:

```dotenv
OIDC_ISSUER=https://<AUTH0_DOMAIN>/
OIDC_AUDIENCE=<API_IDENTIFIER>
OIDC_JWKS_URI=https://<AUTH0_DOMAIN>/.well-known/jwks.json
AUTH0_DOMAIN=<AUTH0_DOMAIN>
AUTH0_CLIENT_ID=<CLIENT_ID>
APP_BASE_URL=https://<APP_DOMAIN>
```

`AUTH0_CLIENT_SECRET` e `AUTH0_SECRET` foram omitidos deliberadamente. Cadastre apenas os segredos exigidos pela integração IAM-08 diretamente no secret store server-side; nunca os copie para o JavaScript do navegador ou para um arquivo versionado.

## O que fornecer para concluir IAM-07/IAM-08

Quando tiver acesso ao Auth0, compartilhe somente os dados não secretos:

- `issuer`, `jwks_uri` obtido pelo Discovery e Identifier da API (`audience`);
- Domain e Client ID do aplicativo web/BFF;
- a conexão Google habilitada no Auth0 e a lista de identidades piloto aprovadas, sem compartilhar tokens;
- domínio público da aplicação e ambiente VPN/allowlist; as URLs exatas de callback/logout serão fechadas pela implementação IAM-08;
- qual Secret Manager será usado e se os segredos necessários estão guardados nele — sem compartilhar os valores;
- processo aprovado para provisionar o usuário piloto e, posteriormente, o primeiro `PLATFORM_ADMIN`.

## Referências oficiais

- [Auth0 OIDC Discovery](https://auth0.com/docs/get-started/applications/configure-applications-with-oidc-discovery)
- [Auth0: configurar APIs](https://auth0.com/docs/get-started/auth0-overview/set-up-apis)
- [Auth0: configurações de aplicação e URLs](https://auth0.com/docs/get-started/applications/application-settings)
- [Auth0: credenciais de aplicação](https://auth0.com/docs/get-started/applications/credentials)
- [Auth0: quickstart Next.js](https://auth0.com/docs/quickstart/webapp/nextjs) (reference only; Phase 1 uses the NestJS BFF in ADR-008)
- [Auth0: validar access tokens](https://auth0.com/docs/secure/tokens/access-tokens/validate-access-tokens)
