import type { LookupContext, LookupPayload } from "@/lib/lookup-types";

const WORD_PATTERN = /[\p{L}\p{M}]+(?:[-'][\p{L}\p{M}]+)*/gu;

export type TooltipPlacement = "bottom" | "inspector" | "left" | "right" | "top";

export type TooltipAnchorRect = {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
};

export type TooltipState = {
  anchorRect: TooltipAnchorRect;
  contextOverrides?: Partial<LookupContext>;
  error?: string;
  expanded?: boolean;
  maxHeight: number;
  manualPosition?: boolean;
  payload?: LookupPayload;
  placement: TooltipPlacement;
  status: "error" | "loading" | "ready";
  width: number;
  word: string;
  x: number;
  y: number;
};

export type WordSelection =
  | { kind: "empty" }
  | { kind: "error"; message: string }
  | { kind: "word"; word: string };

export function clampValue(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function snapshotRect(rect: DOMRect): TooltipAnchorRect {
  return {
    bottom: rect.bottom,
    height: rect.height,
    left: rect.left,
    right: rect.right,
    top: rect.top,
    width: rect.width,
  };
}

export function getTooltipMetrics() {
  const viewportPadding = window.innerWidth <= 720 ? 10 : 18;
  const floatingWidth = Math.min(
    window.innerWidth - viewportPadding * 2,
    window.innerWidth >= 1280 ? 620 : 560,
  );

  return {
    estimatedHeight: Math.min(window.innerHeight * 0.72, 760),
    floatingWidth,
    gap: window.innerWidth <= 720 ? 12 : 20,
    maxHeight: Math.min(window.innerHeight - viewportPadding * 2, 820),
    viewportPadding,
  };
}

export function normalizeWordSelection(rawSelection: string): WordSelection {
  const compactSelection = rawSelection.normalize("NFC").replace(/\s+/g, " ").trim();
  const matches = compactSelection.match(WORD_PATTERN) ?? [];

  if (matches.length === 0) {
    return { kind: "empty" };
  }

  if (
    matches.length > 1 &&
    matches.length <= 3 &&
    compactSelection === matches.join(" ") &&
    matches.some((token) => /^\p{Lu}/u.test(token))
  ) {
    return { kind: "word", word: matches.join(" ") };
  }

  if (matches.length > 1) {
    return {
      kind: "error",
      message: "Selecione apenas uma palavra por vez para consultar os verbetes.",
    };
  }

  return { kind: "word", word: matches[0]! };
}

export function resolveTooltipLayout(
  anchorRect: TooltipAnchorRect,
  measuredHeight?: number,
  isExpanded = false,
) {
  if (isExpanded) {
    return {
      maxHeight: 0,
      placement: "inspector" as const,
      width: 0,
      x: 0,
      y: 0,
    };
  }

  const { estimatedHeight, floatingWidth, gap, maxHeight, viewportPadding } =
    getTooltipMetrics();
  const height = Math.min(measuredHeight ?? estimatedHeight, maxHeight);
  const rightSpace = window.innerWidth - viewportPadding - anchorRect.right;
  const leftSpace = anchorRect.left - viewportPadding;
  const topSpace = anchorRect.top - viewportPadding;
  const bottomSpace = window.innerHeight - viewportPadding - anchorRect.bottom;
  const availableBottomY = window.innerHeight - viewportPadding - height;
  const clampY = (value: number) => clampValue(value, viewportPadding, availableBottomY);

  if (window.innerWidth <= 860) {
    const width = Math.min(window.innerWidth - viewportPadding * 2, 640);
    const centeredX = clampValue(
      anchorRect.left + anchorRect.width / 2 - width / 2,
      viewportPadding,
      window.innerWidth - viewportPadding - width,
    );

    if (bottomSpace >= 200 || bottomSpace >= topSpace) {
      return {
        maxHeight,
        placement: "bottom" as const,
        width,
        x: centeredX,
        y: clampY(anchorRect.bottom + gap),
      };
    }

    return {
      maxHeight,
      placement: "top" as const,
      width,
      x: centeredX,
      y: clampY(anchorRect.top - height - gap),
    };
  }

  const preferredSideWidth = Math.min(floatingWidth, 620);

  if (leftSpace >= 340 || leftSpace >= 280) {
    const width = Math.min(preferredSideWidth, anchorRect.left - viewportPadding - gap);

    if (width >= 320) {
      return {
        maxHeight,
        placement: "left" as const,
        width,
        x: clampValue(
          anchorRect.left - gap - width,
          viewportPadding,
          window.innerWidth - viewportPadding - width,
        ),
        y: clampY(anchorRect.top - 24),
      };
    }
  }

  if (rightSpace >= 340 || (rightSpace >= leftSpace && rightSpace >= 280)) {
    const width = Math.min(
      preferredSideWidth,
      window.innerWidth - viewportPadding - anchorRect.right - gap,
    );

    if (width >= 320) {
      return {
        maxHeight,
        placement: "right" as const,
        width,
        x: clampValue(
          anchorRect.right + gap,
          viewportPadding,
          window.innerWidth - viewportPadding - width,
        ),
        y: clampY(anchorRect.top - 24),
      };
    }
  }

  const centeredWidth = Math.min(floatingWidth, window.innerWidth - viewportPadding * 2);
  const centeredX = clampValue(
    anchorRect.left + anchorRect.width / 2 - centeredWidth / 2,
    viewportPadding,
    window.innerWidth - viewportPadding - centeredWidth,
  );

  if (bottomSpace >= topSpace) {
    return {
      maxHeight,
      placement: "bottom" as const,
      width: centeredWidth,
      x: centeredX,
      y: clampY(anchorRect.bottom + gap),
    };
  }

  return {
    maxHeight,
    placement: "top" as const,
    width: centeredWidth,
    x: centeredX,
    y: clampY(anchorRect.top - height - gap),
  };
}

export function clampTooltipPosition(
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const { viewportPadding } = getTooltipMetrics();

  return {
    x: clampValue(
      x,
      viewportPadding,
      Math.max(viewportPadding, window.innerWidth - viewportPadding - width),
    ),
    y: clampValue(
      y,
      viewportPadding,
      Math.max(viewportPadding, window.innerHeight - viewportPadding - height),
    ),
  };
}

export function mergeLiveTooltipPosition<T extends TooltipState>(
  state: T,
  livePosition: { x: number; y: number } | null,
) {
  if (!state.manualPosition || !livePosition) {
    return state;
  }

  if (
    Math.abs(state.x - livePosition.x) < 1 &&
    Math.abs(state.y - livePosition.y) < 1
  ) {
    return state;
  }

  return {
    ...state,
    x: livePosition.x,
    y: livePosition.y,
  };
}
