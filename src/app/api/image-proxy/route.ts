import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const IMAGE_CACHE_HEADERS = {
  "Cache-Control":
    "public, max-age=0, s-maxage=31536000, stale-while-revalidate=604800",
};

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

export async function GET(request: Request) {
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
    isBlockedPrivateHost(sourceUrl.hostname)
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

    const contentType = response.headers.get("content-type") ?? "image/jpeg";

    if (!contentType.toLocaleLowerCase("en-US").startsWith("image/")) {
      return NextResponse.json(
        { message: "A resposta remota nao parece ser uma imagem." },
        { status: 415 },
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());

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
