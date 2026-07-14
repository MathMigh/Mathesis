# Mathesis Companion para Windows

O companion abre uma consulta do Mathesis sobre o texto atualmente copiado.

1. Instale as dependencias desta pasta com `npm install`.
2. Execute `npm run dev` para testar.
3. Selecione uma palavra em Telegram, Word, navegador ou outro aplicativo, copie-a e pressione `Ctrl+Shift+M`.

O Windows nao oferece uma interface segura e universal para ler a selecao de qualquer aplicativo sem ela passar pela area de transferencia. Por isso o companion usa o texto copiado: ele nao observa digitacao nem acessa janelas de terceiros.

Para gerar um executavel portatil, execute `npm run package:win`.
