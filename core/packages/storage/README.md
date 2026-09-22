# Armazenamento de autenticação

`MemoryAuthStore` atende ao desenvolvimento em um único processo. Por padrão, aceita até 10.000 desafios e 10.000 códigos ativos; `StorageCapacityError` deve produzir uma resposta HTTP 503 genérica. Ao atingir o limite, recupera registros expirados e preserva autenticações ainda válidas. Reiniciar o processo perde esses registros.

`PostgresAuthStore` usa um pool limitado a 10 conexões quando recebe uma URL ou `PoolConfig`. Quando recebe um `Pool` externo, seu chamador mantém a responsabilidade por encerrá-lo. Nenhum adaptador persiste mensagens SIWE, nonces ou códigos em texto puro: o contrato recebe os respectivos hashes.

Todos os tempos do contrato e das tabelas de autenticação usam milissegundos Unix. O campo administrativo `auth_schema_migrations.applied_at` usa `timestamptz` e não participa de decisões de autenticação.

O consumo de um desafio e a emissão do código acontecem em uma única instrução PostgreSQL. As condições incluem validade temporal, cliente, identidade, redirecionamento e desafio PKCE. Uma colisão de código reverte a remoção do desafio. A troca elimina o código somente se todos os seus vínculos forem válidos; tentativas com PKCE ou cliente incorretos não consomem o código legítimo.

Na raiz do projeto, configure `DATABASE_URL` no `.env` e execute `npm run db:migrate`. O executor aplica os arquivos de `core/infra/migrations`, serializa execuções concorrentes com advisory lock e registra o checksum de cada migração. Cada arquivo e sua entrada no registro são confirmados juntos. Arquivos já aplicados não devem ser editados; crie a próxima migração. Use conexão direta ou pool em modo de sessão para o executor, pois seu advisory lock pertence à sessão.

Execute `npm test -- core/packages/storage/test` na raiz para os testes de memória. A mesma suíte de contrato roda sobre PostgreSQL real quando `TEST_DATABASE_URL` estiver definido. Ela cria e remove um schema de teste com nome aleatório e exige permissão de criação de schema. Use uma base dedicada a testes. Sem essa variável, os testes PostgreSQL são explicitamente ignorados; o resultado de memória não comprova a execução do SQL em um servidor PostgreSQL.
