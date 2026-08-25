import type { RepositorySet, UnitOfWork } from "../application/repositories.js";
import { createRepositories, type DatabasePort } from "./repositories.js";

/** Minimal database surface consumed by repositories; no driver types leak upward. */
export type { DatabasePort };

export function createUnitOfWork(database: DatabasePort, repositories = createRepositories(database)): UnitOfWork {
  return {
    async run<T>(work: (set: RepositorySet) => Promise<T>, onError?: (error: unknown) => Promise<void> | void) {
      try {
        return await database.transaction(() => work(repositories))();
      } catch (error) {
        if (onError) await onError(error);
        throw error;
      }
    },
  };
}
