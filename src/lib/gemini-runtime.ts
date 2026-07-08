export type GeminiFailureState = {
  authFailed: boolean;
  badRequest: boolean;
  quotaLimited: boolean;
  serviceUnavailable: boolean;
};

export function createGeminiFailureState(): GeminiFailureState {
  return {
    authFailed: false,
    badRequest: false,
    quotaLimited: false,
    serviceUnavailable: false,
  };
}

export function noteGeminiHttpFailure(
  state: GeminiFailureState,
  status: number,
  detail: string,
) {
  if (status === 429) {
    state.quotaLimited = true;
  }

  if (status === 400) {
    state.badRequest = true;
  }

  if (status === 401 || status === 403) {
    state.authFailed = true;
  }

  if (status === 500 || status === 502 || status === 503 || status === 504) {
    state.serviceUnavailable = true;
  }

  const normalizedDetail = detail.toLocaleLowerCase("en-US");

  if (
    normalizedDetail.includes("quota") ||
    normalizedDetail.includes("rate limit") ||
    normalizedDetail.includes("resource exhausted")
  ) {
    state.quotaLimited = true;
  }

  if (
    normalizedDetail.includes("high demand") ||
    normalizedDetail.includes("temporarily unavailable") ||
    normalizedDetail.includes("try again later") ||
    normalizedDetail.includes("service unavailable") ||
    normalizedDetail.includes("unavailable")
  ) {
    state.serviceUnavailable = true;
  }

  if (
    normalizedDetail.includes("api key not valid") ||
    normalizedDetail.includes("permission denied") ||
    normalizedDetail.includes("forbidden") ||
    normalizedDetail.includes("unauthenticated")
  ) {
    state.authFailed = true;
  }
}

export function buildGeminiUnavailableNote(
  kind: "etimologia" | "gramatica" | "transcricao",
  state: GeminiFailureState,
) {
  const labels = {
    etimologia: "A an\u00e1lise etimol\u00f3gica por IA",
    gramatica: "A an\u00e1lise gramatical por IA",
    transcricao: "A transcri\u00e7\u00e3o por IA",
  } as const;

  const label = labels[kind];

  if (state.quotaLimited) {
    return `${label} esgotou momentaneamente o pool de chaves dispon\u00edvel.`;
  }

  if (state.serviceUnavailable) {
    return `${label} encontrou o servi\u00e7o do Gemini sob alta demanda nesta tentativa.`;
  }

  if (state.authFailed) {
    return `${label} encontrou um problema de autentica\u00e7\u00e3o no pool configurado.`;
  }

  if (state.badRequest) {
    return `${label} n\u00e3o respondeu de forma aproveit\u00e1vel nesta consulta.`;
  }

  return kind === "transcricao"
    ? "N\u00e3o consegui transcrever este \u00e1udio nesta tentativa."
    : `${label} n\u00e3o respondeu nesta consulta.`;
}
