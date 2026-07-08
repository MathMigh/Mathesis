import type {
  DictionarySourceId,
  DictionarySourceResult,
} from "@/lib/lookup-types";

export type SourceSearchQueriesState = Partial<Record<DictionarySourceId, string>>;
export type SourceSearchResultsState = Partial<
  Record<DictionarySourceId, DictionarySourceResult>
>;
export type SourceSearchLoadingState = Partial<Record<DictionarySourceId, boolean>>;

export type SourceSearchState = {
  loading: SourceSearchLoadingState;
  queries: SourceSearchQueriesState;
  results: SourceSearchResultsState;
};

export type SourceSearchUpdater<T> = T | ((current: T) => T);

export type SourceSearchAction =
  | { type: "reset" }
  | { type: "replace"; next: SourceSearchState }
  | { type: "queries"; updater: SourceSearchUpdater<SourceSearchQueriesState> }
  | { type: "results"; updater: SourceSearchUpdater<SourceSearchResultsState> }
  | { type: "loading"; updater: SourceSearchUpdater<SourceSearchLoadingState> };

export const EMPTY_SOURCE_SEARCH_STATE: SourceSearchState = {
  loading: {},
  queries: {},
  results: {},
};

function resolveSourceSearchUpdater<T>(
  current: T,
  updater: SourceSearchUpdater<T>,
) {
  return typeof updater === "function"
    ? (updater as (value: T) => T)(current)
    : updater;
}

export function sourceSearchReducer(
  state: SourceSearchState,
  action: SourceSearchAction,
): SourceSearchState {
  if (action.type === "reset") {
    return EMPTY_SOURCE_SEARCH_STATE;
  }

  if (action.type === "replace") {
    return action.next;
  }

  if (action.type === "queries") {
    return {
      ...state,
      queries: resolveSourceSearchUpdater(state.queries, action.updater),
    };
  }

  if (action.type === "results") {
    return {
      ...state,
      results: resolveSourceSearchUpdater(state.results, action.updater),
    };
  }

  return {
    ...state,
    loading: resolveSourceSearchUpdater(state.loading, action.updater),
  };
}
