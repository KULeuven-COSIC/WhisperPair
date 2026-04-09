import rfcomm from "./rfcomm";
import { SerialPort } from "serialport";
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
  private readonly port: SerialPort;
  private readonly macConfig: MACConfig;
  private hasAudioSwitch: "yes" | "no" | "unknown";

  private constructor(port: SerialPort, macConfig: MACConfig) {
    this.port = port;
    this.macConfig = macConfig;
    this.hasAudioSwitch = "unknown";
  }

  static async open(address: string, accountKey: Buffer) {
    // find the channel
    const channel = await rfcomm.findFastPairRFCOMMChannel(address);
    // open a socket
    const id = await rfcomm.open(address, channel);

    // start reading
    const port = new SerialPort({
      path: `/dev/${id}`,
      baudRate: 9600,
    });
    const parser = port.pipe(new FastPairRFCOMMParser());

    const macConfig: MACConfig = {
      sessionNonce: Buffer.alloc(0),
      accountKey,
    };

    const instance = new this(port, macConfig);

    // register data callback
    parser.on("data", (msg) => {
      if (msg instanceof SessionNonceMessage) {
        macConfig.sessionNonce = msg.sessionNonce;
      }

      if (msg instanceof GetAudioSwitchCapabilityMessage) {
        // reply
        const reply = new NotifyAudioSwitchCapabilityFromSeekerMessage();
        const payload = reply.payload(macConfig);
        port.write(payload);

        instance.hasAudioSwitch = "yes";
      }
    });

    setTimeout(() => {
      if (instance.hasAudioSwitch == "unknown") {
        instance.hasAudioSwitch = "no";
      }
    }, 5000);

    port.on("close", () => logger.info(`RFCOMM connection closed on ${address}`));

    return instance;
  }

  /** Send an RFCOMM message. */
  send(message: SendableRFCOMMMessage) {
    if (this.port.closed) throw new Error("Tried sending message on a closed RFCOMM connection.");
    const payload = message.payload(this.macConfig);
    this.port.write(payload);
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
        if (instance.port.closed) return reject(new Error("RFCOMM connection has closed."));
        setTimeout(check, 500);
      }

      check();
    });
  }

  close() {
    this.port.close();
  }
}
