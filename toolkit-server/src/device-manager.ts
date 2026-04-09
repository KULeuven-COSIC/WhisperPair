import dbus, { DBusError, Variant } from "dbus-next";
import childProcess from "node:child_process";
import EventEmitter from "events";
import { promisify } from "util";

import { FastPairService } from "./fast-pair-service";
import { DeviceMap } from "./device-map.js";
import constants from "./constants";
import hcitool from "./hcitool";
import logger from "./logger";

import companyIDs from "./known-identifiers/company_ids.json";
import serviceUUIDs from "./known-identifiers/service_uuids.json";

const serviceUUIDsMap = new Map(serviceUUIDs.map((data) => [data.uuid, data]));

const exec = promisify(childProcess.exec);

const BLUEZ_DEVICE_NAME = "org.bluez.Device1";

interface ManufacturerData {
  identifier: string;
  name?: string;
  value: string;
}

/**
 * Represents service data that is advertised by BLE devices.
 */
export class ServiceData {
  private readonly map = new Map<string, { uid: string; rawValue: Buffer }>();

  /** Parses the service data. */
  private parseServiceData({ uid, rawValue }: { uid: string; rawValue: Buffer }) {
    if (uid !== constants.FAST_PAIR_SERVICE_UUID) return rawValue.toString("hex");

    const hex = rawValue.toString("hex");

    if (rawValue.length === 3) {
      return {
        type: "model-id",
        value: Number("0x" + hex),
      };
    } else {
      return {
        type: "account-key-list",
        value: hex,
      };
    }
  }

  /** Updates the service data. */
  update(serviceData?: Variant) {
    if (!serviceData) return this.map.clear();

    for (const uid of Object.keys(serviceData.value)) {
      const service = { uid, rawValue: serviceData.value[uid].value };
      this.map.set(uid, service);
    }
  }

  /** Gets the model ID stored in the service data. */
  getModelId() {
    const service = this.map.get(constants.FAST_PAIR_SERVICE_UUID);
    if (!service || service.rawValue.length !== 3) return undefined;

    return Number("0x" + service.rawValue.toString("hex"));
  }

  toJSON() {
    return Array.from(this.map.values(), (s) => ({
      uid: s.uid,
      type: s.uid == constants.FAST_PAIR_SERVICE_UUID ? "Fast Pair" : "Unknown Service",
      data: this.parseServiceData(s),
    }));
  }
}

/**
 * Represents a GATT service that is available on a BLE device.
 */
export class Service {
  path: string;
  uid: string;
  characteristics = new Set<string>();

  constructor(path: string, uid: string) {
    this.path = path;
    this.uid = uid;
  }

  toJSON() {
    let meta: any = {};

    if (this.uid.endsWith("0000-1000-8000-00805f9b34fb")) {
      const data =
        serviceUUIDsMap.get(this.uid.substring(4, 8).toUpperCase()) ||
        serviceUUIDsMap.get(this.uid);

      if (data) meta = { name: data.name };
    }

    if (this.uid == constants.FAST_PAIR_SERVICE_UUID) meta = { name: "Fast Pair" };

    return {
      uid: this.uid,
      characteristics: Array.from(this.characteristics.values()),
      ...meta,
    };
  }
}

/** An abstract device class. */
export abstract class AbstractDevice extends EventEmitter {
  /** The BLE address of the device. */
  abstract address: string;
  /** The D-Bus path of the device. */
  abstract path: string;
  /** The name of the device. */
  abstract name: string;
  /** The signal strength to the device. */
  abstract rssi: number;
  /** The manufacturer data that the device is broadcasting. */
  abstract manufacturerData: ManufacturerData[];
  /** The service data that the device is broadcasting. */
  abstract serviceData: ServiceData;
  /** The GATT services that are available on the device. */
  abstract services: Map<string, Service>;
  /** Whether the host is connected to the device or not. */
  abstract connected: boolean;
  /** Whether the host is paired with the device or not. */
  abstract paired: boolean;
  /** Optional metadata of the device's model ID. */
  abstract modelId:
    | undefined
    | {
        from: "advertisement" | "characteristic" | "manual";
        value: number;
      };

  /** Connect to the device. */
  abstract connect(abortSignal?: AbortSignal): Promise<void>;
  /** Disconnect from the device. */
  abstract disconnect(): Promise<void>;
  /** Unpair this device. */
  abstract unpair(): Promise<void>;
  /** Cleanup callbacks registered by this device. */
  abstract cleanup(): void;

  /** Check whether the device is dead. */
  abstract dead(): boolean;

  /** Resolve the name of the device. */
  abstract resolveName(): Promise<void>;
  /** Get the fast pair service object for this device. */
  abstract getFastPairService(): Promise<FastPairService>;
  /** Manually set a model ID. */
  abstract saveModelId(modelId: number): void;
}

/** An abstract device manager. */
export abstract class AbstractDeviceManager<
  T extends AbstractDevice = AbstractDevice,
> extends EventEmitter {
  /** Start discovering fast pair devices. */
  abstract startDiscovery(): Promise<void>;
  /** Stop discovering fast pair devices. */
  abstract stopDiscovery(): Promise<void>;
  /** Get a list of all devices. */
  abstract devices(): AbstractDevice[];
  /** Get a list of all alive devices. */
  abstract aliveDevices(): AbstractDevice[];
  /** Reset the device manager. */
  abstract reset(): Promise<AbstractDeviceManager<T>>;
  /** Wait for the device to connect. */
  abstract waitForDevice(address: string, signal?: AbortSignal): Promise<any>;

  abstract deviceMap: DeviceMap<T>;
}

/** A device for Linux hosts. */
export class LinuxDevice extends AbstractDevice {
  public address: string;
  public path: string;
  public name = "Unknown";
  public rssi = -1;
  public manufacturerData: ManufacturerData[] = [];
  public serviceData: ServiceData;
  public resolvingName = false;
  public connected = false;
  public paired = false;
  public services = new Map<string, Service>();

  private readonly proxy: dbus.ProxyObject;
  private readonly properties: dbus.ClientInterface;
  private readonly cleanups: (() => unknown)[];
  private readonly manager: LinuxDeviceManager;

  /** Cached fast pair service. */
  private _fastPairService: FastPairService | undefined = undefined;
  /** Time this device was last updated. */
  private lastUpdated: number;

  modelId:
    | undefined
    | {
        from: "advertisement" | "characteristic" | "manual";
        value: number;
      } = undefined;

  async getFastPairService() {
    if (this._fastPairService) return this._fastPairService;

    // search for the service
    const service = Array.from(this.services.values()).find(
      (s) => s.uid == constants.FAST_PAIR_SERVICE_UUID,
    );

    if (service) {
      // create it
      const objectManager = this.manager.rootProxy.getInterface(
        "org.freedesktop.DBus.ObjectManager",
      );

      return (this._fastPairService = await FastPairService.fromPath(
        service.path,
        objectManager,
        this.manager.bus,
        this,
        this.manager,
      ));
    }

    throw new Error("Device does not expose the Fast Pair service");
  }

  saveModelId(value: number) {
    this.modelId = { from: "manual", value };
    this.emit("updated", this);
  }

  async unpair() {
    await this.manager.removeDevice(this.path);
  }

  toJSON() {
    return {
      address: this.address,
      name: this.name,
      rssi: this.rssi,
      connected: this.connected,
      paired: this.paired,

      modelId: this.modelId,

      manufacturerData: this.manufacturerData,
      serviceData: this.serviceData,
      services: Array.from(this.services.values()),
    };
  }

  private updateModelId() {
    if (this.modelId?.from == "manual") return;

    const newModelId = this.serviceData.getModelId();
    if (newModelId === undefined) return;

    this.modelId = {
      from: "advertisement",
      value: newModelId,
    };
  }

  private constructor(
    address: string,
    path: string,
    proxy: dbus.ProxyObject,
    properties: dbus.ClientInterface,
    manager: LinuxDeviceManager,
  ) {
    super();

    // set properties
    this.address = address;
    this.path = path;
    this.proxy = proxy;
    this.properties = properties;
    this.lastUpdated = Date.now();
    this.serviceData = new ServiceData();
    this.manager = manager;

    const onPropertiesChanged = (iface: any, changed: any, invalidated: any) => {
      if (changed.RSSI) this.rssi = changed.RSSI.value;
      if (changed.Name) this.name = changed.Name.value;
      if (changed.Connected) this.connected = changed.Connected.value;
      if (changed.Paired) this.paired = changed.Paired.value;

      // updated last seen timestamp
      this.lastUpdated = Date.now();

      // update service data and model ID if needed
      if (changed.ServiceData) {
        this.serviceData.update(changed.ServiceData);
        this.updateModelId();
      }

      // use smaller RSSI update event if possible
      if (Object.keys(changed).length == 1 && Object.keys(changed).includes("RSSI")) {
        this.emit("updatedRssi", this);
      } else {
        this.emit("updated", this);
      }
    };

    properties.on("PropertiesChanged", onPropertiesChanged);

    this.cleanups = [() => properties.off("PropertiesChanged", onPropertiesChanged)];
  }

  /**
   * Create a new device for Linux hosts.
   * @param address The BLE address of the device.
   * @param path The D-Bus path of the device object.
   * @param bus The D-Bus message bus.
   * @param manager The device's manager.
   * @returns A new device object.
   */
  static async create(
    address: string,
    path: string,
    bus: dbus.MessageBus,
    manager: LinuxDeviceManager,
  ) {
    const proxy = await bus.getProxyObject("org.bluez", path);
    const properties = proxy.getInterface("org.freedesktop.DBus.Properties");
    const device = new this(address, path, proxy, properties, manager);

    // try to set properties if they are available
    async function setProperty(name: string, objectName: string) {
      try {
        const property = await properties.Get!(BLUEZ_DEVICE_NAME, name);
        (device as any)[objectName] = property.value;
      } catch {}
    }

    await setProperty("Name", "name");
    await setProperty("RSSI", "rssi");
    await setProperty("Connected", "connected");
    await setProperty("Paired", "paired");

    // handle manufacturer data
    try {
      const manufacturerData = await properties.Get!(BLUEZ_DEVICE_NAME, "ManufacturerData");

      device.manufacturerData = Object.entries(manufacturerData.value).map(
        ([identifier, value]) => ({
          identifier,
          name: companyIDs[+identifier]?.name,
          value: (value as any).value.toString("hex"),
        }),
      );
    } catch {}

    // handle service data
    try {
      const serviceData = await properties.Get!(BLUEZ_DEVICE_NAME, "ServiceData");
      device.serviceData.update(serviceData);
      device.updateModelId();
    } catch {}

    return device;
  }

  async connect(signal?: AbortSignal): Promise<void> {
    return await new Promise<void>((resolve, reject) => {
      const properties = this.properties;

      // detect when services have been resolved
      async function onPropertiesChanged(iface: any, changed: any, invalidated: any) {
        try {
          if (changed.ServicesResolved) {
            properties.off("PropertiesChanged", onPropertiesChanged);
            resolve();
          }
        } catch (e) {
          reject(e);
        }
      }

      signal?.addEventListener("abort", () => {
        properties.off("PropertiesChanged", onPropertiesChanged);
        reject(signal.reason);
      });

      properties.Get!(BLUEZ_DEVICE_NAME, "ServicesResolved")
        .then(async (result: any) => {
          if (!result.value) properties.on("PropertiesChanged", onPropertiesChanged);

          // try based on capabilities
          try {
            if (this.manager.extendedLEConnectionSupport) {
              await hcitool.createExtendedLEConnection(this.address);
            } else {
              await hcitool.createLEConnection(this.address);
            }
          } catch (e) {
            // if that fails, try the other one

            if (signal?.aborted) return reject(signal.reason);

            try {
              if (this.manager.extendedLEConnectionSupport) {
                await hcitool.createLEConnection(this.address);
              } else {
                await hcitool.createExtendedLEConnection(this.address);
              }
            } catch (e) {
              reject(
                new Error(
                  "Could not open BLE connection to device. If the problem persists, try resetting the BLE adapter using the troubleshooting menu.",
                ),
              );
            }
          }

          if (result.value) resolve();
        })
        .catch((e: any) => reject(e));
    });
  }

  async disconnect() {
    this._fastPairService = undefined;
    if (!this.connected) return;

    const device = this.proxy.getInterface(BLUEZ_DEVICE_NAME);
    await device.Disconnect!();
  }

  cleanup(): void {
    this.cleanups.forEach((cleanup) => cleanup());
  }

  dead() {
    // we consider a device dead if it hasn't been updated in 7.5s
    return Date.now() - this.lastUpdated > 7500;
  }

  async resolveName() {
    this.resolvingName = true;
    try {
      // connecting and disconnecting should trigger bluez to resolve the name
      await this.connect();
      await this.disconnect();
    } catch (_) {
    } finally {
      this.resolvingName = false;
    }
  }
}

/** A device manager for Linux hosts. */
export class LinuxDeviceManager extends AbstractDeviceManager<LinuxDevice> {
  public readonly bus: dbus.MessageBus;
  private readonly hciProxy: dbus.ProxyObject;
  readonly rootProxy: dbus.ProxyObject;
  readonly deviceMap: DeviceMap<LinuxDevice>;
  readonly extendedLEConnectionSupport: boolean | undefined;

  private cleanupDiscoveryCallback: (() => void) | undefined = undefined;

  private constructor(
    bus: dbus.MessageBus,
    hciProxy: dbus.ProxyObject,
    rootProxy: dbus.ProxyObject,
    extendedLEConnectionSupport?: boolean,
  ) {
    super();

    this.bus = bus;
    this.hciProxy = hciProxy;
    this.rootProxy = rootProxy;
    this.deviceMap = new DeviceMap();
    this.extendedLEConnectionSupport = extendedLEConnectionSupport;
  }

  async removeDevice(path: string) {
    const adapter = this.hciProxy.getInterface("org.bluez.Adapter1");
    await adapter.RemoveDevice!(path);
  }

  static async create() {
    try {
      const extendedLEConnectionSupport = await hcitool.determineExtendedCreateConnectionSupport();

      const bus = dbus.systemBus();
      const hciProxy = await bus.getProxyObject("org.bluez", "/org/bluez/hci0");
      const rootProxy = await bus.getProxyObject("org.bluez", "/");

      return new this(bus, hciProxy, rootProxy, extendedLEConnectionSupport);
    } catch (e) {
      if (
        e instanceof DBusError &&
        e.reply?.errorName == "org.freedesktop.DBus.Error.ServiceUnknown"
      ) {
        throw new Error(
          "The BlueZ D-Bus service could not be found. Please ensure that BlueZ is installed.",
          { cause: e },
        );
      }

      throw e;
    }
  }

  async startDiscovery(): Promise<void> {
    const adapter = this.hciProxy.getInterface("org.bluez.Adapter1");
    const properties = this.hciProxy.getInterface("org.freedesktop.DBus.Properties");
    const objectManager = this.rootProxy.getInterface("org.freedesktop.DBus.ObjectManager");

    const discovering = await properties.Get!("org.bluez.Adapter1", "Discovering");
    if (discovering.value) return;

    const onInterfacesAdded = (path: any, data: any) => this.onInterfaceAdded(path, data);
    const onInterfacesRemoved = (path: any, data: any) => this.onInterfaceRemoved(path, data);

    objectManager.on("InterfacesAdded", onInterfacesAdded);
    objectManager.on("InterfacesRemoved", onInterfacesRemoved);

    this.cleanupDiscoveryCallback = () => {
      objectManager.off("InterfacesAdded", onInterfacesAdded);
      objectManager.off("InterfacesRemoved", onInterfacesRemoved);
    };

    // make sure bluetooth is powered on
    await this.ensurePoweredOn(properties);

    await adapter.SetDiscoveryFilter!({ Transport: new Variant("s", "le") });
    const objects = await objectManager.GetManagedObjects!();
    await adapter.StartDiscovery!();

    for (const [path, data] of Object.entries(objects)) {
      this.onInterfaceAdded(path, data);
    }
  }

  private async ensurePoweredOn(properties: dbus.ClientInterface) {
    const powered = await properties.Get!("org.bluez.Adapter1", "Powered");
    if (powered.value) return;

    logger.info("Bluetooth adapter is not powered on, attempting to turn it on using rfkill");

    await exec("rfkill unblock bluetooth");

    // wait for bluetooth to be turned on
    await new Promise<void>((resolve, reject) => {
      async function onPropertiesChanged(iface: any, changed: any, invalidated: any) {
        if (changed.Powered) {
          properties.off("PropertiesChanged", onPropertiesChanged);
          resolve();
        }
      }

      properties.on("PropertiesChanged", onPropertiesChanged);

      properties.Get!("org.bluez.Adapter1", "Powered")
        .then((powered: any) => {
          if (powered.value) {
            properties.off("PropertiesChanged", onPropertiesChanged);
            resolve();
          }
        })
        .catch((err: any) => reject(err));
    });

    logger.info("Bluetooth adapter powered on");
  }

  async stopDiscovery(): Promise<void> {
    const adapter = this.hciProxy.getInterface("org.bluez.Adapter1");

    await adapter.StopDiscovery!();
    this.cleanupDiscoveryCallback?.();
  }

  async waitForDevice(address: string, signal?: AbortSignal) {
    const objectManager = this.rootProxy.getInterface("org.freedesktop.DBus.ObjectManager");

    const objects = await objectManager.GetManagedObjects!();

    for (const [path, data] of Object.entries(objects)) {
      const device = (data as any)[BLUEZ_DEVICE_NAME];
      const addr = device?.Address?.value;

      if (addr == address) return [path, data];
    }

    return await new Promise<any>((resolve, reject) => {
      function onDevice(path: any, data: any) {
        const device = data[BLUEZ_DEVICE_NAME];
        const addr = device?.Address?.value;

        if (addr == address) {
          objectManager.off("InterfacesAdded", onDevice);
          resolve([path, data]);
        }
      }

      objectManager.on("InterfacesAdded", onDevice);

      signal?.addEventListener("abort", () => {
        reject(signal.reason);
        objectManager.off("InterfacesAdded", onDevice);
      });
    });
  }

  private queuedServices = new Map<string, Service[]>();
  private queuedCharacteristics = new Map<string, [string, string][]>();

  private async onInterfaceRemoved(path: string, data: any) {
    const device = this.deviceMap.getByPath(path);
    if (!device || !data.includes("org.bluez.Device1")) return;

    device?.cleanup();
    this.deviceMap.delete(device);
    this.emit("deviceRemoved", device.address);
  }

  private async onInterfaceAdded(path: string, data: any) {
    const parts = path.split("/");

    const queuedServices = this.queuedServices;
    const queuedCharacteristics = this.queuedCharacteristics;

    if (parts.length == 6 && parts[5]?.startsWith("service")) {
      // service discovered
      const gattService = data["org.bluez.GattService1"];

      const uuid = gattService.UUID.value;
      const devicePath = gattService.Device.value.trim();

      const device = this.deviceMap.getByPath(devicePath);
      const service = new Service(path, uuid);

      if (device) {
        device.services.set(path, service);
        device.emit("updated", device);
      } else {
        const queued = queuedServices.get(devicePath) || [];
        queued.push(service);
        queuedServices.set(devicePath, queued);
      }

      return;
    } else if (parts.length === 7 && parts[6]?.startsWith("char")) {
      // service discovered
      const gattService = data["org.bluez.GattCharacteristic1"];

      const uuid = gattService.UUID.value;
      const devicePath = parts.slice(0, 5).join("/");

      const device = this.deviceMap.getByPath(devicePath);

      if (device) {
        const service = device.services.get(gattService.Service.value);
        service?.characteristics.add(uuid);
      } else {
        const queued = queuedServices.get(devicePath);
        const service = queued?.find((service) => service.path == gattService.Service.value);

        if (service) {
          service?.characteristics.add(uuid);
        } else {
          const chars = queuedCharacteristics.get(devicePath) || [];
          chars.push([gattService.Service.value, uuid]);
          queuedCharacteristics.set(devicePath, chars);
        }
      }

      return;
    } else if (parts.length !== 5) {
      return;
    }

    const device = data[BLUEZ_DEVICE_NAME];
    const address = device?.Address?.value;

    if (!address) return;

    const linuxDevice = await LinuxDevice.create(address, path, this.bus, this);
    if (queuedServices.has(linuxDevice.path)) {
      queuedServices
        .get(linuxDevice.path)
        ?.forEach((service) => linuxDevice.services.set(service.path, service));
    }

    this.deviceMap.add(linuxDevice);

    this.emit("newDevice", linuxDevice);
    linuxDevice.on("updated", (device) => this.emit("deviceUpdated", device));
    linuxDevice.on("updatedRssi", (device) => this.emit("deviceRssiUpdated", device));
  }

  devices() {
    return this.deviceMap.all();
  }

  aliveDevices() {
    return this.devices().filter((device) => !device.dead());
  }

  async createFastPairService(device: LinuxDevice) {
    const path = device.path;
    const objectManager = this.rootProxy.getInterface("org.freedesktop.DBus.ObjectManager");
    const objects = await objectManager.GetManagedObjects!();

    const services = Object.entries(objects).filter(([p, _]) => {
      if (!p.startsWith(path)) return false;
      const parts = p.substring(path.length + 1).split("/");

      return parts.length === 1 && parts[0] !== "";
    });

    for (const [path, data] of services) {
      const gattService = (data as any)["org.bluez.GattService1"];
      const uuid = gattService.UUID.value;

      if (uuid == constants.FAST_PAIR_SERVICE_UUID) {
        return await FastPairService.fromPath(path, objectManager, this.bus, device, this);
      }
    }

    throw new Error("Fast pair service not found.");
  }

  async ensureDisconnected(path: string) {
    const device = this.deviceMap.getByPath(path);
    if (!device) throw new Error("Unknown device path.");

    await device.disconnect();
  }

  async reset() {
    await this.stopDiscovery();
    this.deviceMap.all().forEach((device) => device.cleanup());
    this.deviceMap.clear();

    this.emit("clear");

    return this;
  }
}
