# Checklist de Tarefas: Backend de Autenticação Descentralizada

- [x] Setup do Workspace
- [x] Implementação de `sdk-server-node`
- [x] Implementação de `demo-backend-node`
- [x] Simulador e Validação
- [x] Fase 1: Desacoplamento e Redis
- [x] Fase 2: Integração com Smart Contracts
- [x] Fase 3: Empacotamento e Documentação
- [x] Correções de Qualidade (Pré-produção)
    - [x] Criar `.gitignore` na raiz do projeto
    - [x] Mover `redis` para `peerDependencies` (remover de `dependencies`)
    - [x] Tipar corretamente o `RedisNonceStore` (eliminar `any` → `RedisLikeClient`)
    - [x] Criar `docker-compose.yml`
    - [x] Criar `.env.example` e proteger `.env` no gitignore
    - [x] Implementar 13 testes unitários com Vitest (`npm test`)
    - [x] Adicionar CORS na API demo
    - [x] Validar compilação e testes de integração de ponta a ponta
