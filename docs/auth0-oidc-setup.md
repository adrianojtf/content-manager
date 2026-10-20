# Guia de configuração do Auth0 e OIDC

Este guia explica os valores planejados para IAM-07, onde encontrá-los e como serão usados. Ele não exige que você configure tudo agora.

## Estado atual do projeto

- Auth0 foi escolhido como provedor OIDC.
- O verificador da API já valida access tokens destinados à API usando issuer, audience, chaves JWKS e `RS256`.
- O console Next.js e suas rotas de login/logout ainda não foram implementados. Por isso, ainda não é possível definir com segurança as URLs exatas de callback.
- O bootstrap local atual usa Postgres e ainda não compõe o módulo OIDC. A API local pode iniciar sem os valores Auth0; adicioná-los ao `.env.local` não habilitará login até que a composição de autenticação seja conectada.
- Não coloque client secrets, tokens, senhas ou `AUTH0_SECRET` neste documento, no Git ou no chat.

## Primeiro: entenda os componentes

Há dois registros diferentes no Auth0:

1. **API (resource server):** representa esta API e define o identificador usado como `audience` nos access tokens.
2. **Application (client):** representa o futuro console Next.js, que iniciará login e logout. Recebe um `Client ID` e, por ser um aplicativo web executado no servidor, também terá um `Client Secret`.

O console solicita um access token para a API. A API verifica se o token foi emitido pelo issuer esperado, se foi destinado à audience correta e se sua assinatura corresponde a uma chave pública publicada no JWKS. O `Client ID` não é a `audience`, e a API não deve receber um ID token no lugar do access token.

## Valores necessários

| Nome | Para que serve | Onde obter | É secreto? |
| --- | --- | --- | --- |
| `OIDC_ISSUER` | Identifica exatamente o Auth0 tenant/custom domain que emitiu o token. A API compara esse valor com o claim `iss`. | No campo `issuer` do documento OIDC Discovery. Copie o valor exato, inclusive a barra final, se houver. | Não |
| `OIDC_AUDIENCE` | Identifica esta API. A API compara esse valor com o claim `aud` do access token. | Auth0 Dashboard → **Applications → APIs** → selecione a API → **Identifier**. O valor é escolhido ao criar a API. | Não |
| `OIDC_JWKS_URI` | Endereço das chaves públicas que a API usa para verificar assinaturas JWT. | No campo `jwks_uri` do documento OIDC Discovery. Copie-o; não construa a URL manualmente. | Não |
| `AUTH0_DOMAIN` | Informa ao SDK do console qual domínio Auth0 usar nos fluxos de login/logout. | Auth0 Dashboard → **Applications → Applications** → selecione o aplicativo → **Settings → Basic Information → Domain**. Use o formato que o SDK escolhido exigir; o SDK Next.js atual usa o host do domínio. | Não |
| `AUTH0_CLIENT_ID` | Identifica o aplicativo Next.js perante o Auth0. Não é a audience da API. | Na mesma tela do aplicativo, campo **Client ID**. | Não |
| `AUTH0_CLIENT_SECRET` | Autentica o aplicativo web confidencial perante o Auth0. | Credenciais do aplicativo no Auth0 Dashboard. | **Sim — Secret Manager somente** |
| `AUTH0_SECRET` | Chave aleatória usada pelo SDK web para proteger a sessão/cookies locais do console. Não é fornecida pelo Auth0. | Gerada localmente. O quickstart atual do SDK Next.js documenta `openssl rand -hex 32`; confirme o formato ao escolher a versão do SDK. | **Sim — Secret Manager somente** |
| `APP_BASE_URL` | URL pública de origem do console Next.js, usada pelo SDK para construir callbacks e URLs de sessão. Não é necessariamente a URL da API. | Definida pela configuração local/deployment do console. | Não |
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

O cliente Next.js deverá solicitar access tokens destinados a essa API. Um token destinado a outro audience será rejeitado.

### Criar o aplicativo web

Quando o console Next.js for implementado, crie no Auth0 uma aplicação do tipo **Regular Web Application**. O Auth0 fornece `AUTH0_DOMAIN` e `AUTH0_CLIENT_ID`; o `Client Secret` deve ser colocado diretamente no Secret Manager do ambiente servidor.

A URL de callback exata ainda não deve ser inventada: ela depende da versão/configuração do SDK Next.js que será adotada em IAM-06. Depois dessa escolha, configurar no Auth0 as URLs exatas de callback e logout e os Web Origins necessários. Use URLs HTTPS nos ambientes públicos, evite curingas em produção e não inclua `localhost` nas configurações de produção.

O `APP_BASE_URL` é a origem pública do console, por exemplo `http://localhost:<porta-do-console>` em desenvolvimento. O backend atual também usa a porta 3000 por padrão; quando o console for criado, escolha portas/origens que não colidam ou configure um proxy local.

### Segredos

- `AUTH0_CLIENT_SECRET` vem do aplicativo Auth0 e deve ser armazenado como segredo server-side.
- `AUTH0_SECRET` é uma chave aleatória própria do console. O quickstart atual do Auth0 Next.js usa `openssl rand -hex 32`, que produz 64 caracteres hexadecimais; verifique o requisito da versão do SDK escolhida.
- Armazene ambos no Secret Manager do ambiente (local, staging ou produção). Não os envie por chat, não os coloque em arquivos versionados e não os exponha ao JavaScript do navegador.
- `.env.example` deve conter apenas nomes e valores demonstrativos não secretos. O `.env.local` local fica ignorado pelo Git; não reutilize segredos de produção nele.

### Primeiro `PLATFORM_ADMIN`

`PLATFORM_ADMIN` é um grant local global, não um papel definido por e-mail ou por uma claim arbitrária do cliente. O sistema associa uma identidade OIDC verificada pelo par exato `(issuer, subject)` a um usuário local; a migration atual mantém o grant em `platform_admins`, separado de `tenant_memberships`.

O bootstrap inicial precisa ser feito por um operador autorizado e por um processo auditável que associe o `issuer` e o `sub` exatos da identidade Auth0 escolhida à identidade local, e conceda o grant de administrador global. Não use e-mail como chave de identidade, não aceite um `sub` fornecido pelo cliente e não conceda o papel apenas porque o Auth0 autenticou alguém. O console/procedimento operacional para esse bootstrap ainda não está implementado; não há, neste momento, um comando seguro de bootstrap para executar.

O claim `sub` identifica o sujeito do token; para login de usuário, o Auth0 documenta que ele corresponde ao `user_id`. A equipe operadora deve verificar o valor no contexto do tenant e da aplicação corretos. Não compartilhe access tokens para obter esse valor.

## Exemplo demonstrativo — não copie sem substituir

Os valores abaixo são placeholders; não são credenciais reais nem funcionam até configurar seu tenant e API:

```dotenv
OIDC_ISSUER=https://<AUTH0_DOMAIN>/
OIDC_AUDIENCE=<API_IDENTIFIER>
OIDC_JWKS_URI=https://<AUTH0_DOMAIN>/.well-known/jwks.json
AUTH0_DOMAIN=<AUTH0_DOMAIN>
AUTH0_CLIENT_ID=<CLIENT_ID>
APP_BASE_URL=<NEXTJS_APP_ORIGIN>
```

`AUTH0_CLIENT_SECRET` e `AUTH0_SECRET` foram omitidos deliberadamente. Cadastre-os diretamente no Secret Manager quando houver um console Next.js e um ambiente servidor definidos.

## O que fornecer para concluir IAM-07

Quando tiver acesso ao Auth0, compartilhe somente os dados não secretos:

- `issuer`, `jwks_uri` obtido pelo Discovery e Identifier da API (`audience`);
- Domain e Client ID do aplicativo Regular Web;
- origens/ambientes locais e públicos planejados; as URLs exatas de callback/logout serão fechadas após escolher o SDK Next.js;
- qual Secret Manager será usado e se os dois segredos já estão guardados nele — sem compartilhar os valores;
- qual operador/processo aprovado fará o bootstrap do primeiro `PLATFORM_ADMIN`.

## Referências oficiais

- [Auth0 OIDC Discovery](https://auth0.com/docs/get-started/applications/configure-applications-with-oidc-discovery)
- [Auth0: configurar APIs](https://auth0.com/docs/get-started/auth0-overview/set-up-apis)
- [Auth0: configurações de aplicação e URLs](https://auth0.com/docs/get-started/applications/application-settings)
- [Auth0: credenciais de aplicação](https://auth0.com/docs/get-started/applications/credentials)
- [Auth0: quickstart Next.js](https://auth0.com/docs/quickstart/webapp/nextjs)
- [Auth0: validar access tokens](https://auth0.com/docs/secure/tokens/access-tokens/validate-access-tokens)
