import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { CandidatePlan, ConfirmationOption, ThreadMessage, TravelPreferenceProfile } from "../types/travel.js";

export type ThreadSnapshot = {
  threadId: string;
  updatedAt: string;
  latestUserRequest: string;
  finalAnswer: string;
  profile: TravelPreferenceProfile | null;
  missingInfo: string[];
  assumptions: string[];
  options: CandidatePlan[];
  comparison: string;
  liveContext?: string;
  routeContext?: string;
  requiresConfirmation?: boolean;
  confirmationMessage?: string;
  confirmationOptions?: ConfirmationOption[];
  confirmationResolved?: boolean;
  messages?: ThreadMessage[];
  archived?: boolean;
};

export type ThreadSummary = {
  threadId: string;
  updatedAt: string;
  latestUserRequest: string;
  requiresConfirmation?: boolean;
  archived?: boolean;
};

export interface ThreadSnapshotStore {
  save(snapshot: ThreadSnapshot): Promise<void>;
  get(threadId: string): Promise<ThreadSnapshot | null>;
  list(options?: { archived?: boolean; query?: string }): Promise<ThreadSummary[]>;
  archive(threadId: string, archived: boolean): Promise<ThreadSnapshot | null>;
}

class FileThreadSnapshotStore implements ThreadSnapshotStore {
  constructor(private readonly baseDir: string) {}

  async save(snapshot: ThreadSnapshot) {
    await mkdir(this.baseDir, { recursive: true });
    const filePath = this.getFilePath(snapshot.threadId);
    await writeFile(filePath, JSON.stringify(snapshot, null, 2), "utf8");
  }

  async get(threadId: string) {
    try {
      const content = await readFile(this.getFilePath(threadId), "utf8");
      return JSON.parse(content) as ThreadSnapshot;
    } catch (error) {
      if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") {
        return null;
      }

      throw error;
    }
  }

  async list(options?: { archived?: boolean; query?: string }) {
    try {
      await mkdir(this.baseDir, { recursive: true });
      const files = await readdir(this.baseDir);
      const snapshots = await Promise.all(
        files
          .filter((file) => file.endsWith(".json"))
          .map(async (file) => {
            const content = await readFile(path.join(this.baseDir, file), "utf8");
            const snapshot = JSON.parse(content) as ThreadSnapshot;
            return {
              threadId: snapshot.threadId,
              updatedAt: snapshot.updatedAt,
              latestUserRequest: snapshot.latestUserRequest,
              requiresConfirmation: snapshot.requiresConfirmation,
              archived: snapshot.archived ?? false
            } satisfies ThreadSummary;
          })
      );

      return snapshots
        .filter((snapshot) => options?.archived === undefined ? true : snapshot.archived === options.archived)
        .filter((snapshot) => {
          if (!options?.query) {
            return true;
          }

          const query = options.query.toLowerCase();
          return snapshot.threadId.toLowerCase().includes(query) || snapshot.latestUserRequest.toLowerCase().includes(query);
        })
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } catch (error) {
      if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") {
        return [];
      }

      throw error;
    }
  }

  async archive(threadId: string, archived: boolean) {
    const snapshot = await this.get(threadId);
    if (!snapshot) {
      return null;
    }

    const updatedSnapshot = {
      ...snapshot,
      archived
    };
    await this.save(updatedSnapshot);
    return updatedSnapshot;
  }

  private getFilePath(threadId: string) {
    return path.join(this.baseDir, `${threadId}.json`);
  }
}

export function createThreadSnapshotStore() {
  const baseDir = process.env.THREAD_SNAPSHOT_DIR || path.resolve(process.cwd(), ".data", "threads");
  return new FileThreadSnapshotStore(baseDir);
}
