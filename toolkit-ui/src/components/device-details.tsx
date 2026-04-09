import { CircleDashed, LoaderCircle, LoaderCircleIcon } from "lucide-react";
import ModelData, { ObservedDevice } from "./model-data";
import ManufacturerData from "./manufacturer-data";
import { isFastPairService } from "@/lib/utils";
import Characteristics from "./characteristics";
import LoadingDialog from "./loading-dialog";
import FastPairData from "./fast-pair-data";
import ServiceData from "./service-data";
import SetModelId from "./set-model-id";
import { DeviceData } from "./device";
import { socket } from "@/lib/socket";
import { Button } from "./ui/button";
import Services from "./services";
import { toast } from "sonner";
import Attack from "./attack";
import React from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";

interface DeviceDetailsProps {
  device?: DeviceData;
  isConnected?: boolean;
  hasCurrentTask?: boolean;
}

interface ModelIdResponse {
  modelId: number;
  model: ObservedDevice;
}

/** Device details view. */
export default function DeviceDetails({ device, isConnected, hasCurrentTask }: DeviceDetailsProps) {
  /** Device connection state. */
  const [isConnecting, setIsConnecting] = React.useState(false);
  /** Device disconnection state. */
  const [isDisconnecting, setIsDisconnecting] = React.useState(false);
  /** Model ID selection dialog state. */
  const [showReadModelId, setShowReadModelId] = React.useState(false);
  /** Model ID response state. */
  const [modelIdResponse, setModelIdResponse] = React.useState<ModelIdResponse | undefined>();
  /** Model ID saving state. */
  const [isSavingModelId, setIsSavingModelId] = React.useState(false);
  /** Uppairing state. */
  const [isUnpairing, setIsUnpairing] = React.useState(false);

  /** Characteristics of the Fast Pair service. */
  const fastPairCharacteristics = React.useMemo(
    () => device?.services.find((s) => isFastPairService(s.uid))?.characteristics,
    [device?.services],
  );

  /** Connect to device action. */
  function handleConnect() {
    if (!device) return;

    setIsConnecting(true);
    socket.emit("connectToDevice", device.address, (result: any) => {
      if (result.ok) {
        toast.success("Connected to device");
      } else {
        toast.error(`Could not connect to device: ${result.error}`);
      }

      setIsConnecting(false);
    });
  }

  function handleCancel() {
    return new Promise<void>((resolve) => {
      try {
        socket.emit("cancelCurrentTask", (result: any) => {
          if (result.ok) {
            toast.info("Task cancelled successfully!");
            resolve();
          } else {
            toast.error(`Could not cancel task: ${result.error}`);
            resolve();
          }
        });
      } catch (e) {
        toast.error(`Could not cancel task: ${e}`);
        resolve();
      }
    });
  }

  /** Disconnect from device action. */
  function handleDisconnect() {
    if (!device) return;

    setIsDisconnecting(true);
    socket.emit("disconnectFromDevice", device.address, (result: any) => {
      if (result.ok) {
        toast.success("Disconnected from device");
      } else {
        toast.error(`Could not disconnect from device: ${result.error}`);
      }

      setIsDisconnecting(false);
    });
  }

  /** Read model ID action. */
  function onReadModelId() {
    if (!device) return;

    setShowReadModelId(true);
    setModelIdResponse(undefined);

    socket.emit("readModelId", device.address, (response: any) => {
      if (!response.ok) {
        setShowReadModelId(false);
        if (response.error !== "cancelled")
          toast.error(`Could not read Model ID: ${response.error}`);
      } else {
        setModelIdResponse(response.result);
      }
    });
  }

  /** Save model ID device action. */
  function onSaveModelId() {
    if (!device || !modelIdResponse) return;

    setIsSavingModelId(true);

    socket.emit("saveModelId", device.address, modelIdResponse.modelId, () => {
      setIsSavingModelId(false);
      setShowReadModelId(false);
    });
  }

  /** Unpair device action. */
  function handleUnpair() {
    if (!device) return;

    setIsUnpairing(true);

    socket.emit("unpair", device.address, () => {
      setIsUnpairing(false);
    });
  }

  /** Fast Pair service data. */
  const fastPairData = React.useMemo(
    () => device?.serviceData.find((d) => isFastPairService(d.uid)),
    [device?.serviceData],
  );

  if (!isConnected)
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-2 pb-12">
        <LoaderCircleIcon className="animate-spin size-10 text-muted-foreground" />
        <div className="text-center">
          <p className="text-lg font-semibold">Attempting to connect to the server...</p>
          <p className="flex flex-col text-muted-foreground">
            <span>This could take a couple of seconds.</span>
            <span>If it takes longer, ensure that the server is reachable.</span>
          </p>
        </div>
      </div>
    );

  if (!device)
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-2 pb-12">
        <CircleDashed className="size-10 text-muted-foreground" />
        <div className="text-center">
          <p className="text-lg font-semibold">Select a device to start</p>
          <p className="flex flex-col text-muted-foreground">
            <span>Nearby Bluetooth Low Energy devices are shown on the left.</span>
            <span>Select a Fast Pair-compatible device to start.</span>
          </p>
        </div>
      </div>
    );

  return (
    <div className="pb-4">
      <LoadingDialog open={isConnecting} title="Connecting to device..." onCancel={handleCancel} />

      <div>
        <h2 className="text-2xl font-medium">{device.name || "Unknown device"}</h2>

        <span className="text-muted-foreground">{device.address || "Unknown address"}</span>
      </div>

      <div className="pt-2 pb-1 flex items-center gap-3">
        <Button
          size="sm"
          disabled={socket.disconnected || isConnecting || isDisconnecting || hasCurrentTask}
          onClick={device.connected ? handleDisconnect : handleConnect}
        >
          {device.connected ? "Disconnect" : "Connect"}
          {((device.connected && isDisconnecting) || (!device.connected && isConnecting)) && (
            <LoaderCircle className="animate-spin" />
          )}
        </Button>

        {device.paired && (
          <Button
            size="sm"
            disabled={socket.disconnected || isConnecting || isDisconnecting || isUnpairing}
            onClick={handleUnpair}
          >
            {isUnpairing && <LoaderCircle className="animate-spin" />}
            Unpair
          </Button>
        )}

        <Attack device={device} hasCurrentTask={hasCurrentTask} />

        <SetModelId address={device.address} hasCurrentTask={hasCurrentTask} />
      </div>

      <div>
        <div className="flex flex-col mt-2">
          <span className="font-medium text-sm">Connected</span>
          <span className="font-mono">{device.connected ? "true" : "false"}</span>
        </div>

        <div className="flex flex-col mt-2">
          <span className="font-medium text-sm">Paired</span>
          <span className="font-mono">{device.paired ? "true" : "false"}</span>
        </div>
      </div>

      <div className="flex flex-col mt-2">
        <span className="font-medium text-sm">Manufacturer</span>
        <ManufacturerData data={device.manufacturerData} />
      </div>

      {fastPairData && (
        <div className="flex flex-col mt-2">
          <span className="font-medium text-sm">Fast Pair Data</span>

          {fastPairData && <FastPairData data={fastPairData} />}
        </div>
      )}

      {device.modelId && <ModelData data={device.modelId} />}

      {device.connected && device.services.find((s) => isFastPairService(s.uid)) && (
        <div className="flex flex-col mt-2">
          <span className="font-medium text-sm">Fast Pair GATT Characteristics</span>

          <div className="mt-1">
            <Button
              variant="outline"
              className="mt-1"
              onClick={onReadModelId}
              disabled={hasCurrentTask}
            >
              Read Model ID
            </Button>

            <AlertDialog open={showReadModelId}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Save Model ID</AlertDialogTitle>

                  <AlertDialogDescription className="text-primary space-y-1">
                    {modelIdResponse && (
                      <>
                        {" "}
                        <span className="flex flex-col">
                          <span className="font-medium">Model ID</span>
                          <span className="text-base">{modelIdResponse.modelId}</span>
                        </span>
                        <span className="flex flex-col">
                          <span className="font-medium">Name</span>
                          <span className="text-base">{modelIdResponse.model.name}</span>
                        </span>
                        <span className="flex flex-col">
                          <span className="font-medium">Manufacturer</span>
                          <span className="text-base">{modelIdResponse.model.companyName}</span>
                        </span>
                      </>
                    )}
                  </AlertDialogDescription>
                </AlertDialogHeader>

                <AlertDialogFooter>
                  <AlertDialogCancel
                    onClick={() => setShowReadModelId(false)}
                    disabled={isSavingModelId}
                  >
                    Close
                  </AlertDialogCancel>
                  <AlertDialogAction onClick={onSaveModelId} disabled={isSavingModelId}>
                    {isSavingModelId && <LoaderCircle className="animate-spin" />}
                    Save
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          <LoadingDialog
            open={showReadModelId && !modelIdResponse}
            title="Reading Model ID..."
            onCancel={handleCancel}
          />

          <Characteristics characteristics={fastPairCharacteristics} />
        </div>
      )}

      <div className="flex flex-col mt-2">
        <span className="font-medium text-sm">GATT Services</span>

        <Services
          connected={device.connected}
          services={device.services}
          handleConnect={handleConnect}
        />
      </div>

      <div className="flex flex-col mt-2">
        <span className="font-medium text-sm">Service Data</span>

        <ServiceData data={device.serviceData} />
      </div>
    </div>
  );
}
