declare module "@stoprocent/bluetooth-hci-socket" {
  import { EventEmitter } from "node:events";

  /**
   * A raw HCI socket. Replaces the deprecated `hcitool` for sending raw HCI
   * commands and receiving HCI events directly from the controller.
   */
  class BluetoothHciSocket extends EventEmitter {
    /** Bind a raw HCI channel to the given device id (e.g. 0 for hci0). */
    bindRaw(devId?: number): number;
    /** Bind an exclusive user HCI channel (requires the device to be down). */
    bindUser(devId?: number): number;
    /** Bind the control channel. */
    bindControl(): void;
    /** Whether the underlying device is currently up. */
    isDevUp(): boolean;
    /** Apply an HCI filter (struct hci_filter, 14 bytes). */
    setFilter(filter: Buffer): void;
    /** Start delivering `data` events. */
    start(): void;
    /** Stop delivering `data` events. */
    stop(): void;
    /** Write a raw HCI packet (including the leading packet-type byte). */
    write(data: Buffer): void;
  }

  export default BluetoothHciSocket;
}
