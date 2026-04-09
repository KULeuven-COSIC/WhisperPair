import { isFastPairService } from "@/lib/utils";
import { DeviceData } from "./device";
import React from "react";

/** Props for the FastPairData component. */
interface FastPairDataProps {
  data: DeviceData["serviceData"][0];
}

/** Device Fast Pair data. */
export default function FastPairData({ data: { uid, data } }: FastPairDataProps) {
  return (
    <div>
      {!isFastPairService(uid) ? (
        <div>No data available</div>
      ) : (
        <>
          <span>
            {typeof data === "string"
              ? "Raw data:"
              : data.type === "account-key-list"
                ? "Account Key List:"
                : "Model ID:"}{" "}
            <span className="font-mono">{typeof data === "string" ? data : data.value}</span>
          </span>
        </>
      )}
    </div>
  );
}
