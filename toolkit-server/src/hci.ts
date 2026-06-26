import BluetoothHciSocket from "@stoprocent/bluetooth-hci-socket";
import EventEmitter from "node:events";

import logger from "./logger";

/**
 * A native replacement for the deprecated `hcitool cmd`. Opens a raw HCI socket
 * on the controller and exchanges raw HCI command/event packets directly,
 * coexisting with BlueZ exactly like `hcitool` used to.
 */

/** The HCI device id (hci0). */
const HCI_DEVICE_ID = 0;

/** HCI packet types. */
const HCI_COMMAND_PKT = 0x01;
const HCI_EVENT_PKT = 0x04;

/** HCI event codes. */
const EVT_CMD_COMPLETE = 0x0e;
const EVT_CMD_STATUS = 0x0f;

const EVT_REMOTE_NAME_REQ_COMPLETE = 0x07;
const EVT_DISCONN_COMPLETE = 0x05;
const EVT_LE_META = 0x3e;
const LE_SUBEVT_CONN_COMPLETE = 0x01;
const LE_SUBEVT_ENHANCED_CONN_COMPLETE = 0x0a;

/** OpCode Group Fields. */
const OGF_LINK_CTL = 0x01;
const OGF_LE_CTL = 0x08;
const OGF_INFO_PARAM = 0x04;

/** OpCode Command Fields. */
const OCF_REMOTE_NAME_REQUEST = 0x0019;
const OCF_LE_CREATE_CONN = 0x000d;
const OCF_LE_EXT_CREATE_CONN = 0x0043;
const OCF_READ_LOCAL_SUPPORTED_COMMANDS = 0x0002;

/** Result of an HCI command, parsed from the controller's response event. */
interface HciCommandResult {
  /** The opcode the result is for. */
  opcode: number;
  /** Whether the response was a Command Complete or Command Status event. */
  type: "complete" | "status";
  /** The status byte (Command Status events, and the first return parameter of Command Complete). */
  status: number;
  /** The return parameters (Command Complete events only). */
  returnParams: Buffer;
}

/** Builds an opcode from its group and command fields. */
function opcode(ogf: number, ocf: number) {
  return (ogf << 10) | ocf;
}

/** Encodes a 16-bit value as a little-endian buffer (HCI byte order). */
function u16(value: number) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
}

/** Converts a Bluetooth address to its little-endian 6-byte representation. */
function addressToBytes(address: string) {
  return Buffer.from(
    address
      .split(":")
      .reverse()
      .map((byte) => parseInt(byte, 16)),
  );
}

/** Formats a little-endian 6-byte address buffer as a human-readable address. */
function formatAddress(bytes: Buffer) {
  return Array.from(bytes)
    .reverse()
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(":");
}

/** Maps common HCI connection failure statuses to readable names. */
function connectionErrorName(status: number) {
  switch (status) {
    case 0x02:
      return "unknown connection identifier";
    case 0x04:
      return "page timeout";
    case 0x05:
      return "authentication failure";
    case 0x08:
      return "connection timeout";
    case 0x0c:
      return "command disallowed";
    case 0x3e:
      return "connection failed to be established / LL response timeout";
    default:
      return "see Bluetooth HCI error codes";
  }
}

/** A singleton wrapper around a raw HCI socket. */
class HciSocket {
  private socket: BluetoothHciSocket | undefined;
  private readonly emitter = new EventEmitter();

  /** Lazily opens and binds the raw HCI socket. */
  private ensureOpen() {
    if (this.socket) return this.socket;

    const socket = new BluetoothHciSocket();
    socket.bindRaw(HCI_DEVICE_ID);

    // capture every packet type and event so we can match command responses
    const filter = Buffer.alloc(14);
    filter.writeUInt32LE(0xffffffff, 0); // type mask
    filter.writeUInt32LE(0xffffffff, 4); // event mask (lower)
    filter.writeUInt32LE(0xffffffff, 8); // event mask (upper)
    socket.setFilter(filter);

    socket.on("data", (data: Buffer) => this.onData(data));
    socket.on("error", (err: Error) => logger.error(err, "HCI socket error"));
    socket.start();

    // log link-layer connection/disconnection events for diagnostics
    this.emitter.on("event", ({ eventCode, params }: { eventCode: number; params: Buffer }) => {
      if (eventCode === EVT_LE_META) {
        const subevent = params[0];
        if (subevent === LE_SUBEVT_CONN_COMPLETE || subevent === LE_SUBEVT_ENHANCED_CONN_COMPLETE) {
          const status = params[1]!;
          const peer = formatAddress(params.subarray(6, 12));
          if (status === 0x00) {
            logger.info(`HCI: LE connection established to ${peer}`);
          } else {
            logger.warn(
              `HCI: LE connection to ${peer} failed (status 0x${status.toString(16).padStart(2, "0")} - ${connectionErrorName(status)})`,
            );
          }
        }
      } else if (eventCode === EVT_DISCONN_COMPLETE) {
        const reason = params[3]!;
        logger.info(`HCI: link disconnected (reason 0x${reason.toString(16).padStart(2, "0")})`);
      }
    });

    this.socket = socket;
    return socket;
  }

  /** Parses incoming HCI event packets and emits command results. */
  private onData(data: Buffer) {
    if (data.length < 3 || data[0] !== HCI_EVENT_PKT) return;

    const eventCode = data[1]!;
    const length = data[2]!;
    const params = data.subarray(3, 3 + length);

    // expose every event for callers waiting on a specific one
    this.emitter.emit("event", { eventCode, params });

    if (eventCode === EVT_CMD_COMPLETE) {
      if (params.length < 3) return;
      const op = params.readUInt16LE(1);
      const returnParams = params.subarray(3);
      const result: HciCommandResult = {
        opcode: op,
        type: "complete",
        status: returnParams[0] ?? 0,
        returnParams,
      };
      this.emitter.emit("result", result);
    } else if (eventCode === EVT_CMD_STATUS) {
      if (params.length < 4) return;
      const status = params[0]!;
      const op = params.readUInt16LE(2);
      const result: HciCommandResult = {
        opcode: op,
        type: "status",
        status,
        returnParams: Buffer.alloc(0),
      };
      this.emitter.emit("result", result);
    }
  }

  /**
   * Sends a raw HCI command and resolves with the matching Command
   * Complete/Status event.
   */
  sendCommand(ogf: number, ocf: number, params: Buffer = Buffer.alloc(0), timeoutMs = 2000) {
    const socket = this.ensureOpen();
    const op = opcode(ogf, ocf);

    const header = Buffer.alloc(4);
    header.writeUInt8(HCI_COMMAND_PKT, 0);
    header.writeUInt16LE(op, 1);
    header.writeUInt8(params.length, 3);
    const packet = Buffer.concat([header, params]);

    return new Promise<HciCommandResult>((resolve, reject) => {
      const onResult = (result: HciCommandResult) => {
        if (result.opcode !== op) return;
        cleanup();
        resolve(result);
      };

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("HCI command timed out"));
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        this.emitter.off("result", onResult);
      };

      this.emitter.on("result", onResult);
      socket.write(packet);
    });
  }

  /** Resolves with the parameters of the next matching HCI event. */
  waitForEvent(eventCode: number, match: (params: Buffer) => boolean, timeoutMs = 5000) {
    this.ensureOpen();

    return new Promise<Buffer>((resolve, reject) => {
      const onEvent = ({ eventCode: code, params }: { eventCode: number; params: Buffer }) => {
        if (code !== eventCode || !match(params)) return;
        cleanup();
        resolve(params);
      };

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("HCI event timed out"));
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        this.emitter.off("event", onEvent);
      };

      this.emitter.on("event", onEvent);
    });
  }
}

const hciSocket = new HciSocket();

/**
 * Attempts to open an LE connection to a device.
 * @param address The address of the device.
 */
export async function createLEConnection(address: string) {
  const params = Buffer.concat([
    u16(0x0060), // LE scan interval
    u16(0x0060), // LE scan window
    Buffer.from([0x00]), // initiator filter policy
    Buffer.from([0x01]), // peer address type (random)
    addressToBytes(address), // peer address
    Buffer.from([0x01]), // own address type (random)
    u16(0x0018), // connection interval min
    u16(0x0028), // connection interval max
    u16(0x0000), // connection latency
    u16(0x0064), // supervision timeout
    u16(0x0000), // min CE length
    u16(0x0000), // max CE length
  ]);

  logger.info(`HCI: sending LE Create Connection to ${address}`);
  const result = await hciSocket.sendCommand(OGF_LE_CTL, OCF_LE_CREATE_CONN, params);

  if (result.status === 0x0c) throw new Error("Command disallowed");
  if (result.status !== 0x00)
    throw new Error(`LE Create Connection failed (status 0x${result.status.toString(16)})`);
  logger.info("HCI: LE Create Connection accepted, waiting for connection to complete...");
}

/**
 * Attempts to open an extended LE connection to a device.
 * @param address The address of the device.
 */
export async function createExtendedLEConnection(address: string) {
  const params = Buffer.concat([
    Buffer.from([0x00]), // initiator filter policy
    Buffer.from([0x00]), // own address type (public)
    Buffer.from([0x01]), // peer address type (random)
    addressToBytes(address), // peer address
    Buffer.from([0x01]), // initiating PHYs (LE 1M)
    u16(0x0060), // LE scan interval
    u16(0x0060), // LE scan window
    u16(0x0018), // connection interval min
    u16(0x0028), // connection interval max
    u16(0x0000), // connection latency
    u16(0x0064), // supervision timeout
    u16(0x0000), // min CE length
    u16(0x0000), // max CE length
  ]);

  logger.info(`HCI: sending LE Extended Create Connection to ${address}`);
  const result = await hciSocket.sendCommand(OGF_LE_CTL, OCF_LE_EXT_CREATE_CONN, params);

  // controllers without extended support reply with Unknown HCI Command (0x01)
  if (result.type === "complete" && result.status === 0x01)
    throw new Error("Unknown HCI command");
  if (result.type === "status" && result.status !== 0x00)
    throw new Error(`Extended LE Create Connection failed (status 0x${result.status.toString(16)})`);
  logger.info("HCI: LE Extended Create Connection accepted, waiting for connection to complete...");
}

/**
 * Determines whether the host supports creating extended LE connections.
 * @returns A boolean or undefined.
 */
export async function determineExtendedCreateConnectionSupport() {
  let attempts = 0;
  while (attempts < 3) {
    attempts += 1;

    try {
      const result = await hciSocket.sendCommand(
        OGF_INFO_PARAM,
        OCF_READ_LOCAL_SUPPORTED_COMMANDS,
      );

      // Command Complete return parameters: status (1) + supported commands (64)
      if (result.type !== "complete" || result.returnParams.length < 65) continue;
      if (result.status !== 0x00) continue;

      const supportedCommands = result.returnParams.subarray(1);

      // Supported Commands octet 37, bit 4: LE Extended Create Connection
      return (supportedCommands[37]! & 0x10) !== 0;
    } catch (e) {
      logger.warn(e, "Failed to read local supported commands");
    }
  }

  return undefined;
}

/**
 * Checks whether a BR/EDR device is reachable, replacing the deprecated
 * `l2ping`. Issues an HCI Remote Name Request, which pages the classic radio
 * (waking the device) and works on a raw address without a BlueZ device object.
 * @param address The BR/EDR address of the device.
 */
export async function pingBREDR(address: string, timeoutMs = 5000) {
  const target = addressToBytes(address);

  const params = Buffer.concat([
    target, // BD_ADDR
    Buffer.from([0x01]), // page scan repetition mode (R1)
    Buffer.from([0x00]), // reserved
    u16(0x0000), // clock offset
  ]);

  // start listening for the completion event before issuing the request
  const completion = hciSocket.waitForEvent(
    EVT_REMOTE_NAME_REQ_COMPLETE,
    (p) => p.length >= 7 && p.subarray(1, 7).equals(target),
    timeoutMs,
  );

  const status = await hciSocket.sendCommand(
    OGF_LINK_CTL,
    OCF_REMOTE_NAME_REQUEST,
    params,
    timeoutMs,
  );

  if (status.type === "status" && status.status !== 0x00) {
    throw new Error(`Remote name request rejected (status 0x${status.status.toString(16)})`);
  }

  const result = await completion;
  if (result[0] !== 0x00) {
    throw new Error(`Device unreachable (status 0x${result[0]!.toString(16)})`);
  }
}

const hci = {
  createLEConnection,
  createExtendedLEConnection,
  determineExtendedCreateConnectionSupport,
  pingBREDR,
};

export default hci;
