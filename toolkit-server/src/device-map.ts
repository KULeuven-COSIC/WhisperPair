import type { AbstractDevice } from "./device-manager.js";

export class DeviceMap<T extends AbstractDevice> {
  private readonly pathMap: Map<string, T>;
  private readonly addressMap: Map<string, string>;

  constructor() {
    this.pathMap = new Map();
    this.addressMap = new Map();
  }

  add(device: T) {
    this.pathMap.set(device.path, device);
    this.addressMap.set(device.address, device.path);
  }

  getByPath(path: string) {
    return this.pathMap.get(path);
  }

  getByAddress(address: string) {
    const path = this.addressMap.get(address);
    if (!path) return undefined;
    return this.pathMap.get(path);
  }

  all() {
    return Array.from(this.pathMap.values());
  }

  delete(device: T) {
    this.pathMap.delete(device.path);
    return this.addressMap.delete(device.address);
  }

  clear() {
    this.pathMap.clear();
    this.addressMap.clear();
  }
}
