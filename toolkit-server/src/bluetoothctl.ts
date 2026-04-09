import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import EventEmitter from "node:events";

/** Represents a `bluetoothctl` session. */
export class BluetoothCtlSession {
  private readonly process: ChildProcessWithoutNullStreams;
  private readonly disconnectedAddresses: Set<string>;
  private readonly eventEmitter: EventEmitter;

  constructor() {
    const disconnectedAddresses = new Set<string>();
    const eventEmitter = new EventEmitter();

    this.process = spawn("bluetoothctl");
    this.disconnectedAddresses = disconnectedAddresses;
    this.eventEmitter = eventEmitter;

    eventEmitter.on("disconnect", (address) => disconnectedAddresses.add(address));

    const regexes: [RegExp, string][] = [
      [/Device (.{2}:.{2}:.{2}:.{2}:.{2}:.{2}) Connected: no/m, "disconnect"],
      [/Failed to pair: ([a-zA-Z.]+)/m, "pairing-failed"],
      [/Confirm passkey (\d+)/m, "confirm-passkey"],
      [/Pairing successful\n/m, "pairing-success"],
      [/Device has been removed\n/m, "device-removed-confirm"],
    ];

    async function handleChunk(chunk: Buffer) {
      const string = chunk.toString();
      const match = regexes.find(([regex, _]) => regex.exec(string) !== null);
      if (!match) return;

      const type = match[1];
      const matches = match[0].exec(string)!;

      eventEmitter.emit(type, matches?.[1]);
    }

    this.process.stdout.on("data", handleChunk);
  }

  private waitForAddressDisconnection(address: string, signal?: AbortSignal) {
    if (this.disconnectedAddresses.has(address)) return Promise.resolve();

    return new Promise<void>((resolve, reject) => {
      const listener = (addr: any) => {
        if (address == addr) {
          resolve();
          this.eventEmitter.removeListener("disconnect", listener);
        }
      };

      this.eventEmitter.addListener("disconnect", listener);
      signal?.addEventListener("abort", () => {
        reject(signal.reason);
        this.eventEmitter.removeListener("disconnect", listener);
      });
    });
  }

  /** Initiates a pairing with a given address. */
  async pair(address: string, signal?: AbortSignal) {
    const p = this.process;

    await this.waitForAddressDisconnection(address);

    return new Promise<number>((resolve, reject) => {
      /** Waits for the confirm passkey message. */
      this.eventEmitter.once("confirm-passkey", (passkey) => resolve(+passkey));
      this.eventEmitter.once("pairing-failed", (err) => reject(new Error(err)));

      signal?.addEventListener("abort", () => {
        reject(signal.reason);
      });

      p.stdin.write(`pair ${address}\n`);
    });
  }

  /** Confirms a pairing. */
  confirm(signal?: AbortSignal) {
    const p = this.process;

    return new Promise<void>((resolve, reject) => {
      this.eventEmitter.once("pairing-success", () => resolve());

      signal?.addEventListener("abort", () => {
        reject(signal.reason);
      });

      p.stdin.write("yes\n");
    });
  }

  /** Closes the session. */
  close() {
    if (this.process.exitCode !== null) return;
    this.process.stdin.write("quit\n");
  }
}
