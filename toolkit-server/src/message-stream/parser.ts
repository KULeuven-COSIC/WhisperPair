import { Transform, TransformCallback, TransformOptions } from "node:stream";
import crypto from "node:crypto";
import logger from "../logger";
import utils from "../utils";

/** Fast Pair message groups */
const MessageGroups = {
  deviceInformation: 0x03,
  audioSwitch: 0x07,
  acknowledgement: 0xff,
};

/** Fast Pair message codes */
const MessageCodes = {
  deviceInformation: {
    modelId: 0x01,
    bleAddressUpdate: 0x02,
    batteryUpdated: 0x03,
    remainingBatteryTime: 0x04,
    activeComponentsRequest: 0x05,
    activeComponentsResponse: 0x06,
    capabilities: 0x07,
    platformType: 0x08,
    firmwareVersion: 0x09,
    sessionNonce: 0x0a,
    currentFhnEphemeralIdentifier: 0x0b,
  },
  audioSwitch: {
    getCapability: 0x10,
    notifyConnectionStatus: 0x34,
  },
  acknowledgement: {
    ack: 0x01,
    nak: 0x02,
  },
};

/** An RFCOMM Fast Piar message */
class RFCOMMMessage {
  readonly group: number;
  readonly code: number;

  constructor(group: number, code: number) {
    this.group = group;
    this.code = code;
  }

  /** Create a new RFCOMM message given the group, code, and data. */
  static from(group: number, code: number, data: Buffer) {
    switch (group) {
      case MessageGroups.deviceInformation: {
        const codes = MessageCodes.deviceInformation;
        switch (code) {
          case codes.modelId:
            return new ModelIDMessage(data.readUIntBE(0, data.length));
          case codes.bleAddressUpdate:
            return BLEAddressUpdateMessage.fromData(data);
          case codes.batteryUpdated:
            return BatteryUpdatedMessage.fromData(data);
          case codes.firmwareVersion:
            return FirmwareVersionMessage.fromData(data);
          case codes.sessionNonce:
            return new SessionNonceMessage(data);
          case codes.currentFhnEphemeralIdentifier:
            return CurrentFHNEphemeralIdentifierMessage.fromData(data);
        }
        break;
      }
      case MessageGroups.audioSwitch: {
        const codes = MessageCodes.audioSwitch;
        switch (code) {
          case codes.getCapability:
            return new GetAudioSwitchCapabilityMessage();
          case codes.notifyConnectionStatus:
            return NotifyConnectionStatusMessage.fromData(data);
        }
        break;
      }
      case MessageGroups.acknowledgement: {
        const codes = MessageCodes.acknowledgement;
        switch (code) {
          case codes.ack:
            return AckMessage.fromData(data);
          case codes.nak:
            return NakMessage.fromData(data);
        }
      }
    }

    logger.warn(`Unknown message of group: ${group} code: ${code}`);
    return undefined;
  }
}

/** A model ID notification message. */
class ModelIDMessage extends RFCOMMMessage {
  readonly modelId: number;

  constructor(modelId: number) {
    super(0x03, 0x01);
    this.modelId = modelId;
  }
}

/** A BLE address update message. */
class BLEAddressUpdateMessage extends RFCOMMMessage {
  readonly address: string;

  constructor(address: string) {
    super(0x03, 0x02);
    this.address = address;
  }

  static fromData(data: Buffer) {
    const hex = data.toString("hex").toUpperCase();
    return new this(hex.match(/.{2}/g)?.join(":")!);
  }
}

/** A battery updated message. */
class BatteryUpdatedMessage extends RFCOMMMessage {
  readonly leftBudValue: number;
  readonly rightBudValue: number;
  readonly caseValue: number;

  constructor(leftBudValue: number, rightBudValue: number, caseValue: number) {
    super(0x03, 0x03);
    this.leftBudValue = leftBudValue;
    this.rightBudValue = rightBudValue;
    this.caseValue = caseValue;
  }

  static fromData(data: Buffer) {
    new this(data[0]!, data[1]!, data[2]!);
  }
}

/** A firmware version message. */
class FirmwareVersionMessage extends RFCOMMMessage {
  readonly firmwareVersion: string;

  constructor(firmwareVersion: string) {
    super(0x03, 0x09);
    this.firmwareVersion = firmwareVersion;
  }

  static fromData(data: Buffer) {
    new this(data.toString());
  }
}

/** A session nonce message. */
export class SessionNonceMessage extends RFCOMMMessage {
  readonly sessionNonce: Buffer;

  constructor(sessionNonce: Buffer) {
    super(0x03, 0x01);
    this.sessionNonce = sessionNonce;
  }
}

/** An Find Hub current ephemeral identifier message. */
class CurrentFHNEphemeralIdentifierMessage extends RFCOMMMessage {
  readonly currentFHNEphemeralIdentifier: Buffer;

  constructor(currentFHNEphemeralIdentifier: Buffer) {
    super(0x03, 0x0b);
    this.currentFHNEphemeralIdentifier = currentFHNEphemeralIdentifier;
  }

  static fromData(data: Buffer) {
    return new this(data);
  }
}

/** A get audio switch capabilities message. */
export class GetAudioSwitchCapabilityMessage extends RFCOMMMessage {
  constructor() {
    super(0x07, 0x10);
  }
}

/** A notify connection status message. */
export class NotifyConnectionStatusMessage extends RFCOMMMessage {
  constructor(activeDeviceFlag: "passiveActiveSameKey" | "active" | "passiveActiveNonAudioSwitch") {
    super(0x07, 0x34);
  }

  static fromData(data: Buffer) {
    const activeDeviceFlag =
      data[0] == 0x00
        ? "passiveActiveSameKey"
        : data[0] == 0x01
          ? "active"
          : "passiveActiveNonAudioSwitch";

    return new this(activeDeviceFlag);
  }
}

/** A reply. */
export class ReplyMessage extends RFCOMMMessage {
  readonly acknowledgedGroup: number;
  readonly acknowledgedCode: number;
  readonly state: Buffer;

  constructor(code: number, acknowledgedGroup: number, acknowledgedCode: number, state: Buffer) {
    super(0xff, code);
    this.acknowledgedGroup = acknowledgedGroup;
    this.acknowledgedCode = acknowledgedCode;
    this.state = state;
  }
}

/** An acknowledgement message. */
export class AckMessage extends ReplyMessage {
  constructor(acknowledgedGroup: number, acknowledgedCode: number, state: Buffer) {
    super(0x01, acknowledgedGroup, acknowledgedCode, state);
  }

  static fromData(data: Buffer) {
    return new this(data[0]!, data[1]!, data.subarray(2));
  }
}

/** A negative acknowledgement message. */
export class NakMessage extends ReplyMessage {
  constructor(acknowledgedGroup: number, acknowledgedCode: number, state: Buffer) {
    super(0x02, acknowledgedGroup, acknowledgedCode, state);
  }

  static fromData(data: Buffer) {
    return new this(data[0]!, data[1]!, data.subarray(2));
  }
}

/** Message Authentication Code configuration */
export interface MACConfig {
  sessionNonce: Buffer;
  accountKey: Buffer;
}

/** Generate a new message authentication code. */
function generateMAC(additionalData: Buffer, config: MACConfig) {
  const messageNonce = crypto.randomBytes(8);

  const nonce = Buffer.concat([config.sessionNonce, messageNonce]);
  const K = Buffer.concat([config.accountKey, Buffer.alloc(48).fill(0)]);

  const opad = Buffer.alloc(64).fill(0x5c);
  const ipad = Buffer.alloc(64).fill(0x36);

  const m1 = crypto.createHash("sha256");
  const m2 = crypto.createHash("sha256");

  m1.update(Buffer.concat([utils.xor(K, ipad), nonce, additionalData]));
  m2.update(Buffer.concat([utils.xor(K, opad), m1.digest()]));

  const digest = m2.digest().subarray(0, 8);

  return Buffer.concat([messageNonce, digest]);
}

/** A sendable RFCOMM message. */
export abstract class SendableRFCOMMMessage extends RFCOMMMessage {
  readonly macConfig?: MACConfig;
  abstract additionalData(): Buffer;

  payload(macConfig?: MACConfig) {
    const additionalData = this.additionalData();

    const length = additionalData.length + (macConfig ? 16 : 0);
    const lengthBuffer = Buffer.alloc(2);
    lengthBuffer.writeUInt16BE(length);

    return Buffer.concat([
      Buffer.from([this.group]),
      Buffer.from([this.code]),
      lengthBuffer,
      additionalData,
      ...(macConfig ? [generateMAC(additionalData, macConfig)] : []),
    ]);
  }
}

/** A notify audio switch capability message that can be sent by the seeker. */
export class NotifyAudioSwitchCapabilityFromSeekerMessage extends SendableRFCOMMMessage {
  constructor() {
    super(0x07, 0x11);
  }

  additionalData(): Buffer {
    return Buffer.from([0x01, 0x02, 0x00, 0x00]);
  }
}

/** A switch back audio switch message. */
export class SwitchBackAudioSwitchMessage extends SendableRFCOMMMessage {
  constructor() {
    super(0x07, 0x31);
  }

  additionalData(): Buffer {
    return Buffer.from([0x02]);
  }
}

/** A parser for Fast Pair RFCOMM messages. */
export class FastPairRFCOMMParser extends Transform {
  private buffer = Buffer.alloc(0);

  constructor(opts?: TransformOptions) {
    super({ ...opts, readableObjectMode: true });
  }

  _transform(chunk: Buffer, encoding: BufferEncoding, callback: TransformCallback): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    this.readMessages();

    callback();
  }

  readMessages() {
    while (true) {
      if (this.buffer.length < 4) return;

      const group = this.buffer[0]!;
      const code = this.buffer[1]!;
      const length = this.buffer.readUInt16BE(2)!;

      if (this.buffer.length < 4 + length) return;

      const data = this.buffer.subarray(4, 4 + length);
      this.buffer = this.buffer.subarray(4 + length);

      const message = RFCOMMMessage.from(group, code, data);
      if (message) this.push(message);
    }
  }
}
