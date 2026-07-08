function splitKeyList(value: string | undefined) {
  return (value ?? "")
    .split(/[\n,;]+/u)
    .map((key) => key.trim())
    .filter(Boolean);
}

function collectPrefixedKeys(prefixes: string[]) {
  return Object.entries(process.env)
    .filter(([key, value]) =>
      Boolean(value) &&
      prefixes.some((prefix) => key === prefix || key.startsWith(`${prefix}_`)),
    )
    .flatMap(([, value]) => splitKeyList(value));
}

export function getGeminiApiKeys(additionalKeys: Array<string | undefined> = []) {
  return Array.from(
    new Set(
      [
        ...collectPrefixedKeys(["AI_API_KEYS", "GEMINI_API_KEYS"]),
        ...additionalKeys.flatMap(splitKeyList),
        process.env.AI_API_KEY,
        process.env.GEMINI_API_KEY,
        process.env.GOOGLE_GENERATIVE_AI_API_KEY,
        process.env.GOOGLE_AI_API_KEY,
      ]
        .map((key) => key?.trim())
        .filter((key): key is string => Boolean(key)),
    ),
  );
}
