# Mathesis Companion para Windows

O companion abre uma consulta do Mathesis quando uma nova palavra aparece na area de transferencia.

1. Execute `npm install` nesta pasta.
2. Execute `npm run dev` para testar.
3. Selecione uma palavra em Telegram, Word, navegador ou outro aplicativo e copie-a. O Mathesis abre sozinho.

O atalho `Ctrl+Shift+M` continua disponivel como fallback. O Windows nao oferece uma interface segura e universal para ler a selecao de qualquer aplicativo sem ela passar pela area de transferencia. Por isso o companion usa o texto copiado: ele nao observa digitacao nem acessa janelas de terceiros.

Para gerar um executavel portatil, execute `npm run package:win`.
