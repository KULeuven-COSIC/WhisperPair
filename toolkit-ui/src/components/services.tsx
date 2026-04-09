import { Skeleton } from "./ui/skeleton";
import { DeviceData } from "./device";
import { Button } from "./ui/button";
import { Card } from "./ui/card";

interface ServicesProps {
  connected: boolean;
  services?: DeviceData["services"];
  handleConnect: () => void;
}

/** Services data view. */
export default function Services({ connected, services, handleConnect }: ServicesProps) {
  return (
    <Card className="mt-2 py-2 px-3 min-h-50 flex flex-col">
      {!connected ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          Connection required for services
          <Button onClick={handleConnect}>Connect</Button>
        </div>
      ) : (
        <div>
          {services ? (
            services.toSorted().map((service) => (
              <div key={service.uid} className="space-x-1.5">
                <span className={service.name ? "font-semibold" : ""}>
                  {service.name || "Unknown"}
                </span>
                <span className="text-muted-foreground text-sm">({service.uid})</span>
              </div>
            ))
          ) : (
            <Skeleton />
          )}
        </div>
      )}
    </Card>
  );
}
