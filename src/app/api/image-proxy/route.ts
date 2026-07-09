import { NextResponse } from "next/server";
import { consumeRateLimit } from "@/lib/request-security";

export const runtime = "nodejs";
export const maxDuration = 30;

const IMAGE_CACHE_HEADERS = {
  "Cache-Control":
    "public, max-age=0, s-maxage=31536000, stale-while-revalidate=604800",
  "X-Content-Type-Options": "nosniff",
};
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_HOSTS = [
  ".duckduckgo.com",
  ".openverse.engineering",
  ".openverse.org",
  ".pexels.com",
  ".pixabay.com",
  ".unsplash.com",
  ".wikimedia.org",
  ".wikipedia.org",
  "cdn.pixabay.com",
  "duckduckgo.com",
  "external-content.duckduckgo.com",
  "images.openverse.engineering",
  "images.pexels.com",
  "images.unsplash.com",
  "openverse.org",
  "pixabay.com",
  "plus.unsplash.com",
].map((host) => host.toLocaleLowerCase("en-US"));

function isBlockedPrivateHost(hostname: string) {
  const normalized = hostname.trim().toLocaleLowerCase("en-US");

  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local")
  ) {
    return true;
  }

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(normalized)) {
    const [first = 0, second = 0] = normalized.split(".").map(Number);

    if (
      first === 127 ||
      first === 10 ||
      (first === 192 && second === 168) ||
      (first === 172 && second >= 16 && second <= 31)
    ) {
      return true;
    }
  }

  if (
    normalized === "::1" ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd")
  ) {
    return true;
  }

  return false;
}

function isAllowedImageHost(hostname: string) {
  const normalized = hostname.trim().toLocaleLowerCase("en-US");

  return ALLOWED_IMAGE_HOSTS.some((allowedHost) =>
    allowedHost.startsWith(".")
      ? normalized === allowedHost.slice(1) || normalized.endsWith(allowedHost)
      : normalized === allowedHost,
  );
}

async function readImageBufferWithLimit(response: Response) {
  const contentLength = Number(response.headers.get("content-length") ?? 0);

  if (contentLength > MAX_IMAGE_BYTES) {
    throw new Error("image-too-large");
  }

  const reader = response.body?.getReader();

  if (!reader) {
    return Buffer.from(await response.arrayBuffer());
  }

  const chunks: Uint8Array[] = [];
  let size = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    if (value) {
      size += value.byteLength;

      if (size > MAX_IMAGE_BYTES) {
        throw new Error("image-too-large");
      }

      chunks.push(value);
    }
  }

  return Buffer.concat(chunks);
}

export async function GET(request: Request) {
  const rateLimit = await consumeRateLimit(request, "image-proxy", {
    intervalMs: 60_000,
    limit: 180,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { message: "Muitas imagens solicitadas em pouco tempo." },
      {
        headers: {
          "Retry-After": String(rateLimit.retryAfterSeconds),
          "X-Content-Type-Options": "nosniff",
        },
        status: 429,
      },
    );
  }

  const { searchParams } = new URL(request.url);
  const rawSrc = searchParams.get("src")?.trim();

  if (!rawSrc) {
    return NextResponse.json({ message: "Informe a imagem." }, { status: 400 });
  }

  let sourceUrl: URL;

  try {
    sourceUrl = new URL(rawSrc);
  } catch {
    return NextResponse.json(
      { message: "URL de imagem invalida." },
      { status: 400 },
    );
  }

  if (
    !/^https?:$/i.test(sourceUrl.protocol) ||
    isBlockedPrivateHost(sourceUrl.hostname) ||
    !isAllowedImageHost(sourceUrl.hostname)
  ) {
    return NextResponse.json(
      { message: "Host de imagem nao permitido." },
      { status: 400 },
    );
  }

  try {
    const response = await fetch(sourceUrl, {
      cache: "no-store",
      headers: {
        "user-agent": "Mathesis/0.1 image proxy",
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { message: "A imagem remota nao respondeu bem." },
        { status: 502 },
      );
    }

    const finalUrl = new URL(response.url);

    if (
      !/^https?:$/i.test(finalUrl.protocol) ||
      isBlockedPrivateHost(finalUrl.hostname) ||
      !isAllowedImageHost(finalUrl.hostname)
    ) {
      return NextResponse.json(
        { message: "Redirecionamento de imagem nao permitido." },
        { status: 400 },
      );
    }

    const contentType = response.headers.get("content-type") ?? "image/jpeg";

    if (!contentType.toLocaleLowerCase("en-US").startsWith("image/")) {
      return NextResponse.json(
        { message: "A resposta remota nao parece ser uma imagem." },
        { status: 415 },
      );
    }

    const buffer = await readImageBufferWithLimit(response);

    return new NextResponse(buffer, {
      headers: {
        ...IMAGE_CACHE_HEADERS,
        "Content-Type": contentType,
      },
    });
  } catch {
    return NextResponse.json(
      { message: "Nao consegui carregar a imagem." },
      { status: 502 },
    );
  }
}
