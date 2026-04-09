import { isFastPairService } from "@/lib/utils";
import { DeviceData } from "./device";
import { Card } from "./ui/card";

interface ServiceDataProps {
  data: DeviceData["serviceData"];
}

/** Service data view. */
export default function ServiceData({ data }: ServiceDataProps) {
  const nonFastPairServices = data.filter(({ uid }) => !isFastPairService(uid));

  return (
    <Card className="mt-2 py-2 px-3 h-50">
      {!nonFastPairServices.length ? (
        <div className="h-full flex flex-col items-center justify-center">No data available</div>
      ) : (
        <div>
          {nonFastPairServices.map((service) => (
            <div key={service.uid} className="flex flex-col">
              <span>
                <span className="font-medium">{service.type}</span>{" "}
                <span className="text-muted-foreground text-sm">({service.uid})</span>
              </span>
              <span className="font-mono">
                {typeof service.data === "string" ? service.data : service.data.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
