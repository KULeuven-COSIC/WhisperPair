import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { InfoIcon, TriangleAlert } from "lucide-react";
import { Skeleton } from "./ui/skeleton";
import { socket } from "@/lib/socket";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Card } from "./ui/card";
import React from "react";

interface ModelDataProps {
  data: {
    from: "advertisement" | "characteristic" | "manual";
    value: number;
  };
}

export interface ObservedDevice {
  name: string;
  imageUrl: string;
  deviceType: string;
  companyName: string;
  displayName: string;
  features: (number | string)[];
  publicKey: string;
  image: string;
}

/** Model data view. */
export default function ModelData({ data: { from, value } }: ModelDataProps) {
  const [isLoading, setIsLoading] = React.useState(true);
  const [data, setData] = React.useState<ObservedDevice>();
  const [error, setError] = React.useState<string>();

  const fetchingRef = React.useRef<boolean>(null);

  function fetchModelData() {
    if (fetchingRef.current) return;
    fetchingRef.current = true;

    setIsLoading(true);
    setData(undefined);
    setError("");

    if (socket.connected) {
      socket.emit("modelData", value, (result: any) => {
        setError(result.error);
        setData(result.error ? undefined : result.result);
        setIsLoading(false);
        fetchingRef.current = false;
      });
    }
  }

  React.useEffect(() => {
    fetchModelData();
  }, [socket.connected, value]);

  return (
    <Card className="mt-2 relative">
      {!error && (
        <Badge className="absolute -right-2 -top-2" variant="secondary">
          {!data ? (
            <Skeleton className="h-4 w-24" />
          ) : from == "advertisement" ? (
            <>From advertisement</>
          ) : from == "characteristic" ? (
            <>From characteristic</>
          ) : (
            <>Manual</>
          )}
        </Badge>
      )}

      <div className="flex gap-2 items-center">
        {isLoading ? (
          <Skeleton className="size-60 rounded-md mx-8 p-2 border" />
        ) : data ? (
          <img
            src={`data:image/png;base64,${data.image}`}
            className="size-60 mx-8 border p-2 rounded-md aspect-square"
          />
        ) : (
          <></>
        )}

        {error ? (
          <div className="flex flex-col items-center w-full gap-3">
            <TriangleAlert className="size-12" />
            <span>{error}</span>

            <Alert className="max-w-xl">
              <InfoIcon />
              <AlertTitle>Fast Pair gRPC API rate limiting</AlertTitle>
              <AlertDescription>
                The Fast Pair gRPC API sometimes returns succesful but empty requests, likely due to
                rate limiting. If you are certain this Model ID is correct, try waiting a couple of
                minutes and retry.
              </AlertDescription>
            </Alert>

            <Button variant="outline" onClick={fetchModelData}>
              Retry
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-col flex-1">
              <div className="flex flex-col">
                <span className="font-medium text-sm">Model ID</span>
                <span>
                  {value} <span className="text-muted-foreground">({value.toString(16)})</span>
                </span>
              </div>

              {isLoading ? (
                <div className="space-y-1 mt-1">
                  {[...Array(5).keys()].map((i) => (
                    <div key={i} className="space-y-1">
                      <Skeleton className="w-36 h-3" />
                      <Skeleton className="w-36 h-6" />
                    </div>
                  ))}
                </div>
              ) : data ? (
                <>
                  <div className="flex flex-col">
                    <span className="font-medium text-sm">Name</span>
                    <span>{data.name}</span>
                  </div>

                  <div className="flex flex-col">
                    <span className="font-medium text-sm">Company name</span>
                    <span>{data.companyName}</span>
                  </div>

                  <div className="flex flex-col">
                    <span className="font-medium text-sm">Device type</span>
                    <span>{data.deviceType}</span>
                  </div>

                  <div className="flex flex-col">
                    <span className="font-medium text-sm">Features</span>
                    <span>{data.features.join(", ")}</span>
                  </div>

                  <div className="flex flex-col">
                    <span className="font-medium text-sm">Internal name</span>
                    <span>{data.displayName}</span>
                  </div>
                </>
              ) : (
                <></>
              )}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
