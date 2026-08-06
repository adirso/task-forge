import type { RepositorySet, UnitOfWork } from "../application/repositories.js";
import { createRepositories, type DatabasePort } from "./repositories.js";

/** Minimal database surface consumed by repositories; no driver types leak upward. */
export type { DatabasePort };

export function createUnitOfWork(database: DatabasePort, repositories = createRepositories(database)): UnitOfWork {
  return {
    run<T>(work: (set: RepositorySet) => Promise<T>) {
      return database.transaction(() => work(repositories))();
    },
  };
}
