import logger from "./logger";
import fs from "fs/promises";
import { join } from "path";

/** A local cache with key value pairs. */
export type LocalCache<K, V> = Cache<K, V> | undefined;

/** A key value cache. */
export class Cache<K, V> {
  /** Name of the cache. */
  readonly name: string;
  /** Path where the cache should be stored. */
  readonly path: string;
  /** An internal map representing the cache. */
  private readonly map: Map<K, V>;

  private constructor(name: string, path: string, map: Map<K, V>) {
    this.name = name;
    this.path = path;
    this.map = map;
  }

  /** Open a cache by reading it from the filesystem. */
  static async open(name: string) {
    const path = join(process.env.CACHE_PATH ?? ".", `${name}.json`);

    try {
      const contents = await fs.readFile(path);
      const data = await JSON.parse(contents.toString());
      const map = new Map(Object.entries(data));

      return new this(name, path, map);
    } catch {
      return new this(name, path, new Map());
    }
  }

  /** Save a cache to the filesystem. */
  private save() {
    fs.writeFile(this.path, JSON.stringify(Object.fromEntries(this.map))).catch((error) => {
      logger.error(error, `Failed to save the ${this.name} cache`);
    });
  }

  /** Get the value of a key. */
  get(key: K) {
    return this.map.get(key);
  }

  /** Set the value of a key. */
  set(key: K, value: V) {
    this.map.set(key, value);
    this.save();
  }
}
