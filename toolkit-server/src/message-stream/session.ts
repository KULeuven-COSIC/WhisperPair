import rfcomm from "./rfcomm";
import { Socket } from "node:net";
import logger from "../logger";
import {
  NotifyAudioSwitchCapabilityFromSeekerMessage,
  GetAudioSwitchCapabilityMessage,
  SendableRFCOMMMessage,
  FastPairRFCOMMParser,
  SessionNonceMessage,
  MACConfig,
} from "./parser";

/** A message stream session. */
export class MessageStreamSession {
  private readonly socket: Socket;
  private readonly macConfig: MACConfig;
  private hasAudioSwitch: "yes" | "no" | "unknown";
  private closed = false;

  private constructor(socket: Socket, macConfig: MACConfig) {
    this.socket = socket;
    this.macConfig = macConfig;
    this.hasAudioSwitch = "unknown";
  }

  static async open(devicePath: string, address: string, accountKey: Buffer) {
    // open the RFCOMM socket via BlueZ (handles SDP discovery and binding)
    const socket = await rfcomm.connect(devicePath);

    // start reading
    const parser = socket.pipe(new FastPairRFCOMMParser());

    const macConfig: MACConfig = {
      sessionNonce: Buffer.alloc(0),
      accountKey,
    };

    const instance = new this(socket, macConfig);

    // register data callback
    parser.on("data", (msg) => {
      if (msg instanceof SessionNonceMessage) {
        macConfig.sessionNonce = msg.sessionNonce;
      }

      if (msg instanceof GetAudioSwitchCapabilityMessage) {
        // reply
        const reply = new NotifyAudioSwitchCapabilityFromSeekerMessage();
        const payload = reply.payload(macConfig);
        socket.write(payload);

        instance.hasAudioSwitch = "yes";
      }
    });

    setTimeout(() => {
      if (instance.hasAudioSwitch == "unknown") {
        instance.hasAudioSwitch = "no";
      }
    }, 5000);

    socket.on("close", () => {
      instance.closed = true;
      logger.info(`RFCOMM connection closed on ${address}`);
    });
    socket.on("error", (err) => logger.error(err, `RFCOMM connection error on ${address}`));

    return instance;
  }

  /** Send an RFCOMM message. */
  send(message: SendableRFCOMMMessage) {
    if (this.closed) throw new Error("Tried sending message on a closed RFCOMM connection.");
    const payload = message.payload(this.macConfig);
    this.socket.write(payload);
  }

  /** Send an acknowledgement. */
  async sendAck(message: SendableRFCOMMMessage) {
    this.send(message);
  }

  /** Wait for an audio switch capability message. */
  async waitForAudioSwitch(signal?: AbortSignal) {
    const instance = this;
    if (this.hasAudioSwitch !== "unknown") return this.hasAudioSwitch == "yes";

    return await new Promise<boolean>((resolve, reject) => {
      function check() {
        if (signal?.aborted) return reject(signal.reason);
        if (instance.hasAudioSwitch !== "unknown") return resolve(instance.hasAudioSwitch == "yes");
        if (instance.closed) return reject(new Error("RFCOMM connection has closed."));
        setTimeout(check, 500);
      }

      check();
    });
  }

  close() {
    this.closed = true;
    this.socket.destroy();
  }
}
