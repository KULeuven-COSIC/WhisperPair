import { AbstractDeviceManager } from "./device-manager";
import { promisify } from "node:util";
import { Socket } from "socket.io";

import * as childProcess from "node:child_process";

/** A timeout error. */
export class Timeout extends Error {
  constructor() {
    super("Timeout");
  }
}

/** Creates a timeout promise. */
function createTimeoutPromise(duration: number) {
  return new Promise<never>((_, reject) => setTimeout(() => reject(new Timeout()), duration));
}

/** Await a promise with a timeout. */
export function awaitWithTimeout<T>(promise: Promise<T>, duration: number) {
  return Promise.race([promise, createTimeoutPromise(duration)]);
}

/** XOR operation on two buffers. */
export function xor(buf1: Buffer, buf2: Buffer) {
  if (buf1.length !== buf2.length) throw new Error("Buffers should have the same length.");
  return buf1.map((e, i) => e ^ buf2[i]!);
}

/** Wraps a socket handler, and automatically returns the result using the provided callback function. */
export function wrapSocketHandler(handler: (...args: any[]) => Promise<any>) {
  return async (...args: any[]) => {
    const params = args.slice(0, -1);
    const callback = args[args.length - 1];

    try {
      const result = await handler(...params);
      callback({ ok: true, result });
    } catch (e) {
      if (e instanceof Error) {
        callback({ ok: false, error: e.message });
      } else {
        callback({ ok: false, error: typeof e === "string" ? e : "unknown error" });
      }
    }
  };
}

/**
 * Starts forwarding events from the manager to all sockets.
 * @param param0 A context object containing the manager and a set of sockets.
 * @param eventName The name of the event that should be forwarded.
 * @param handler An optional handler that transforms the event arguments.
 */
export function forwardEvent(
  { manager, sockets }: { manager: AbstractDeviceManager; sockets: Set<Socket> },
  eventName: string,
  handler: (...args: any[]) => any[] = (...args) => args,
) {
  // when the manager emits an event
  manager.on(eventName, (...args) => {
    // transform arguments
    const data = handler(...args);
    // send the event to every socket
    sockets.forEach((socket) => socket.emit(eventName, ...data));
  });
}

// promisified exec
const exec = promisify(childProcess.exec);
export { exec };

/**
 * Checks whether a tool is available in the current environment.
 * @param tool The tool name.
 * @returns A boolean.
 */
function isToolAvailable(tool: string) {
  try {
    childProcess.execSync(`which ${tool}`, { stdio: "ignore" });
    return true;
  } catch {}
}

const utils = {
  awaitWithTimeout,
  xor,
  Timeout,
  wrapSocketHandler,
  forwardEvent,
  exec,
  isToolAvailable,
};

export default utils;
