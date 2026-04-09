import * as protoLoader from "@grpc/proto-loader";
import * as grpc from "@grpc/grpc-js";
import path from "node:path";

import { Cache, LocalCache } from "../cache";
import logger from "../logger";

// grpc setup
const PROTOS_DIR = process.env.PROTOS_DIR ?? "./protos";
const packageDefinition = protoLoader.loadSync(path.join(PROTOS_DIR, "rpc.proto"), {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const protoDescriptor: any = grpc.loadPackageDefinition(packageDefinition);
const nearby = protoDescriptor.location.nearby.v1 as grpc.GrpcObject;
const NearbyDevicesService = nearby.NearbyDevicesService as grpc.ServiceClientConstructor;

// create a client
const client = new NearbyDevicesService(
  "nearbydevices-pa.googleapis.com",
  grpc.credentials.createSsl(),
);

// add required metadata
const meta = new grpc.Metadata();
meta.add("x-android-package", "com.google.android.gms");
meta.add("x-android-cert", "38918A453D07199354F8B19AF05EC6562CED5788");
meta.add("x-goog-api-key", "AIzaSyAP-gfH3qvi6vgHZbSYwQ_XHqV_mXHhzIk");

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

/** Fetches device information given a model ID. */
export function fetchObservedDevice(model_id: number): Promise<ObservedDevice | undefined> {
  return new Promise((resolve, reject) => {
    (client as any).GetObservedDevice({ model_id, flag: true }, meta, (err: any, response: any) => {
      if (err) {
        reject(err);
      } else if (
        !response.device.name &&
        !response.device.image_url &&
        response.device.device_type == "DEVICE_TYPE_UNSPECIFIED"
      ) {
        resolve(undefined);
      } else {
        resolve({
          name: response.device.name,
          imageUrl: response.device.image_url,
          deviceType: response.device.device_type,
          companyName: response.device.company_name,
          displayName: response.device.display_name,
          features: response.device.features,
          publicKey: response.device.anti_spoofing_key_pair.public_key.toString("hex"),
          image: response.image.toString("base64"),
        });
      }
    });
  });
}

/** A local cache for API requests. */
let cache: LocalCache<string, ObservedDevice> = undefined;

/** Gets device information given a model ID. */
export async function getDeviceInfo(modelId: number) {
  if (!cache) cache = await Cache.open("device-info");
  const cached = cache.get(modelId.toString());
  if (cached) return cached;

  logger.info(`Model information for ${modelId} is not available in the local cache`);
  let device = await fetchObservedDevice(modelId);

  if (!device) {
    logger.info("Automatically retrying gRPC call");
    device = await fetchObservedDevice(modelId);
  }

  if (!device) throw new Error(`No device with model ID ${modelId} was found.`);
  cache.set(modelId.toString(), device);

  return device;
}
