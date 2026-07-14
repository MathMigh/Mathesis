const BUTTON_ID = "mathesis-selection-action";
const MAX_WORD_LENGTH = 120;

let selectedWord = "";

function normalizeLanguage(language) {
  const value = (language || "").toLocaleLowerCase();

  if (value.startsWith("pt")) return "portuguese";
  if (value.startsWith("en")) return "english";
  if (value.startsWith("la") || value.includes("latin")) return "latin";

  return undefined;
}

function readSelectedWord() {
  const value = window.getSelection()?.toString().normalize("NFC").trim() ?? "";

  if (!value || value.length > MAX_WORD_LENGTH || /[\r\n]/u.test(value)) {
    return "";
  }

  return value;
}

function removeAction() {
  document.getElementById(BUTTON_ID)?.remove();
}

function showAction(word, x, y) {
  removeAction();
  selectedWord = word;

  const button = document.createElement("button");
  button.id = BUTTON_ID;
  button.type = "button";
  button.textContent = "Mathesis";
  button.setAttribute("aria-label", `Consultar ${word} no Mathesis`);
  Object.assign(button.style, {
    background: "#2d2119",
    border: "1px solid rgba(255,255,255,.45)",
    borderRadius: "999px",
    boxShadow: "0 8px 22px rgba(0,0,0,.25)",
    color: "#fffaf2",
    cursor: "pointer",
    fontFamily: "Georgia, serif",
    fontSize: "13px",
    left: `${Math.max(8, x)}px`,
    padding: "7px 12px",
    position: "fixed",
    top: `${Math.max(8, y + 10)}px`,
    zIndex: "2147483647",
  });
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => {
    chrome.runtime.sendMessage({
      language: normalizeLanguage(document.documentElement.lang),
      type: "MATHESIS_OPEN_LOOKUP",
      word: selectedWord,
    });
    removeAction();
  });

  document.documentElement.append(button);
}

document.addEventListener("mouseup", (event) => {
  window.setTimeout(() => {
    const word = readSelectedWord();
    if (!word) {
      removeAction();
      return;
    }

    showAction(word, event.clientX, event.clientY);
  }, 0);
});

document.addEventListener("scroll", removeAction, true);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") removeAction();
});
