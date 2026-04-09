"use client";

import TroubleshootingOptions from "@/components/troubleshooting-dialog";
import TaskController from "@/components/task-controller";
import Device, { DeviceData } from "@/components/device";
import { ScrollArea } from "@/components/ui/scroll-area";
import DeviceDetails from "@/components/device-details";
import { ArrowDownUp, InfoIcon } from "lucide-react";
import InfoDialog from "@/components/info-dialog";
import { isFastPairService } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { socket } from "@/lib/socket";
import { toast } from "sonner";
import React from "react";

/** Main page. */
export default function Home() {
  /** Connection state to the backend. */
  const [isConnected, setIsConnected] = React.useState(false);
  /** Detected devices. */
  const [devices, setDevices] = React.useState<DeviceData[]>([]);
  /** The address of the selected device. */
  const [selectedAddress, setSelectedAddressState] = React.useState<string>();
  const selectedAddressRef = React.useRef<string>("");

  const [task, setTask] = React.useState<any>();

  function setSelectedAddress(address: string) {
    setSelectedAddressState(address);
    selectedAddressRef.current = address;
  }

  /** Socket events. */
  React.useEffect(() => {
    const devicesMap = new Map<string, DeviceData>();

    if (socket.connected) {
      setIsConnected(true);
    }

    function onConnect() {
      toast.success("Connected to the server");
      setIsConnected(true);
    }

    function onDisconnect() {
      toast.error("Disconnected from the server");
      setIsConnected(false);
      onClear();
    }

    function onNewDevice(device: DeviceData) {
      const address = device.address;

      if (!devicesMap.has(address)) {
        devicesMap.set(address, device);
        setDevices(devicesMap.values().toArray());
      }
    }

    function onDevices(devices: DeviceData[]) {
      devices.forEach((device) => {
        if (!devicesMap.has(device.address)) devicesMap.set(device.address, device);
      });

      setDevices(devicesMap.values().toArray());
    }

    function onDeviceUpdated(device: DeviceData) {
      devicesMap.set(device.address, device);

      setDevices(devicesMap.values().toArray());
    }

    function onDeviceRemoved(address: string) {
      devicesMap.delete(address);
      setDevices(devicesMap.values().toArray());

      if (selectedAddressRef.current == address)
        toast.warning("The device you selected is no longer discoverable.");
    }

    function onDeviceRssiUpdated(address: string, rssi: number) {
      const device = devicesMap.get(address);
      if (device) device.rssi = rssi;
    }

    function onResort() {
      const devices = devicesMap
        .values()
        .toArray()
        .toSorted((a, b) => (b.rssi || 0) - (a.rssi || 0));

      devicesMap.clear();
      devices.forEach((device) => devicesMap.set(device.address, device));

      setDevices(devices);
    }

    function onClear() {
      devicesMap.clear();
      setDevices([]);
    }

    function onCurrentTask(task: any) {
      setTask(task);
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("devices", onDevices);
    socket.on("newDevice", onNewDevice);
    socket.on("deviceUpdated", onDeviceUpdated);
    socket.on("deviceRemoved", onDeviceRemoved);
    socket.on("deviceRssiUpdated", onDeviceRssiUpdated);
    socket.on("clear", onClear);
    socket.on("currentTask", onCurrentTask);

    socket.on("connect_error", (err) => {
      toast.error(`Failed to connect to the server. (${err.message}) Is the server reachable?`);
    });

    document.addEventListener("resort", onResort);

    socket.connect();

    return () => {
      socket.disconnect();
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("devices", onDevices);
      socket.off("newDevice", onNewDevice);
      socket.off("deviceUpdated", onDeviceUpdated);
      socket.off("deviceRemoved", onDeviceRemoved);
      socket.off("deviceRssiUpdated", onDeviceRssiUpdated);
      socket.off("clear", onClear);
      socket.off("currentTask", onCurrentTask);
      document.removeEventListener("resort", onResort);
    };
  }, []);

  /** Devices that support Fast Pair. */
  const fastPairDevices = React.useMemo(
    () =>
      devices
        .map((data) => ({
          ...data,
          type:
            data.modelId !== undefined
              ? data.modelId.from
              : data.serviceData.find((d) => isFastPairService(d.uid))
                ? "serviceData"
                : undefined,
        }))
        .filter((data) => !!data.type),
    [devices],
  );

  /** Devices that do not support Fast Pair. */
  const nonFastPairDevices = React.useMemo(
    () =>
      devices.filter(
        ({ serviceData, paired, modelId }) =>
          !paired && !modelId && serviceData.every((d) => !isFastPairService(d.uid)),
      ),
    [devices],
  );

  /** Devices that are paired to the host. */
  const pairedDevices = React.useMemo(() => devices.filter(({ paired }) => paired), [devices]);

  return (
    <div className="flex px-4 max-h-screen gap-3">
      <div className="flex flex-col pt-2">
        <div className="mt-2 flex justify-between items-center pr-5">
          <span className="text-2xl">WhisperPair UI</span>
          <Button variant="outline" onClick={() => document.dispatchEvent(new Event("resort"))}>
            <ArrowDownUp />
            Re-sort
          </Button>
        </div>

        <ScrollArea className="flex-1 h-px w-112.5 pr-4 pb-2">
          <h2 className="text-lg font-medium py-2">Fast Pair devices</h2>
          <div className="flex flex-col gap-3">
            {fastPairDevices.map((device) => (
              <Device
                key={device.address}
                device={device}
                type={device.type}
                onSelect={setSelectedAddress}
              />
            ))}
          </div>

          <h2 className="text-lg font-medium py-2">Paired devices</h2>
          <div className="flex flex-col gap-3">
            {pairedDevices.map((device) => (
              <Device key={device.address} device={device} onSelect={setSelectedAddress} />
            ))}
          </div>

          <h2 className="text-lg font-medium py-2">Other devices</h2>
          <div className="flex flex-col gap-3">
            {nonFastPairDevices.map((device) => (
              <Device key={device.address} device={device} onSelect={setSelectedAddress} />
            ))}
          </div>
        </ScrollArea>
      </div>

      <div className="flex flex-col gap-3 w-full h-screen pt-4">
        <div className="absolute right-5 flex items-center gap-3">
          <TaskController currentTask={task} />
          <TroubleshootingOptions />
          <Button
            variant="outline"
            className="rounded-full"
            onClick={() => {
              try {
                document.dispatchEvent(new Event("openInfoDialog"));
              } catch {}
            }}
          >
            <InfoIcon />
          </Button>
        </div>

        <DeviceDetails
          key={devices.find(({ address }) => address == selectedAddress)?.address}
          device={devices.find(({ address }) => address == selectedAddress)}
          isConnected={isConnected}
          hasCurrentTask={!!task}
        />
      </div>

      <InfoDialog />
    </div>
  );
}
