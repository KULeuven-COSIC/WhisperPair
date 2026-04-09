import { isFastPairService } from "@/lib/utils";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";

export interface DeviceData {
  address: string;
  name: string;
  rssi: number | undefined;
  connected: boolean;
  paired: boolean;

  modelId:
    | {
        from: "advertisement" | "characteristic" | "manual";
        value: number;
      }
    | undefined;

  manufacturerData: ManufacturerData[];
  serviceData: ServiceData[];
  services: Service[];
}

export interface Service {
  uid: string;
  name?: string;
  characteristics: string[];
}

export interface ManufacturerData {
  identifier: string;
  name?: string;
  value: string;
}

export interface ServiceData {
  uid: string;
  type: string;
  data:
    | string
    | {
        type: "account-key-list";
        value: string;
      }
    | {
        type: "model-id";
        value: number;
      };
}

interface DeviceProps {
  device: DeviceData;
  type?: string;
  onSelect: (address: string) => void;
}

/** Device details. */
export default function Device({ device, type, onSelect }: DeviceProps) {
  return (
    <div className="flex flex-col border shadow-sm px-4 pt-4 pb-3 rounded-xl">
      <div className="flex items-center gap-16 justify-between">
        <div className="flex flex-col">
          <span className={device.name ? "" : "text-muted-foreground"}>
            {device.name || "Unknown"}
          </span>
          <span className="text-sm">{device.address}</span>
        </div>

        <div className="flex items-center gap-4">
          <span>{device.rssi}</span>
          <Button onClick={() => onSelect(device.address)} variant="secondary">
            Select
          </Button>
        </div>
      </div>

      <div className="space-x-2">
        {device.serviceData.find((d) => isFastPairService(d.uid)) && (
          <>
            <Badge>Fast pair</Badge>
            <Badge variant="secondary">
              {type != "serviceData" ? "Model ID available" : "Advertising"}
            </Badge>
          </>
        )}

        {device.connected && <Badge>Connected</Badge>}
        {device.paired && <Badge variant="outline">Paired</Badge>}

        {device.manufacturerData.map((manufacturer) => (
          <Badge variant="secondary" key={manufacturer.identifier}>
            {manufacturer.name || "Unknown company"}
          </Badge>
        ))}
      </div>
    </div>
  );
}
