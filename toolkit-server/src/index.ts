import { Server, Socket } from "socket.io";
import express from "express";
import http from "node:http";

import utils, { wrapSocketHandler, forwardEvent, exec } from "./utils";
import { LinuxDeviceManager } from "./device-manager";
import { getDeviceInfo } from "./model-id-resolver";
import { DBusError } from "dbus-next";
import { TaskManager } from "./task";
import logger from "./logger";

// express and socket.io setup
const app = express();
const server = http.createServer(app);
const io = new Server(server);

/** Set of connected clients. */
const sockets = new Set<Socket>();

/** Close server. */
async function close() {
  logger.info("Shutting down...");

  // close server as promise because it won't resolve until all connections are closed
  const promise = new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );

  server.closeAllConnections();
  io.close();

  promise.catch((e) => logger.error(e, "Failed to close server"));

  process.exit();
}

/** Start server. */
async function main() {
  logger.info("Starting server...");

  let majorVersion = Number(process.versions.node.split(".")[0]);
  if (Number.isNaN(majorVersion)) {
    logger.warn(
      "Could not determine server Node.js version. Please ensure you are using a supported engine.",
    );
  } else if (majorVersion < 24) {
    logger.warn(
      `The server is running on an outdated Node.js engine (${process.version}). You may encounter crashes, we recommend using Node.js v24 LTS instead.`,
    );
  }

  const manager = await LinuxDeviceManager.create();
  await manager.startDiscovery();

  const taskManager = new TaskManager(sockets);

  /** Get all the nearby devices. */
  app.get("/devices", async (req, res) => {
    res.json(manager.devices());
  });

  app.post("/reset", async (req, res) => {
    await taskManager.run(
      async () => {
        try {
          await manager.reset();
        } catch {}

        await exec(`hciconfig hci0 down`);
        await exec(`hciconfig hci0 reset`);
        await exec(`hciconfig hci0 up`);
        await exec(`systemctl restart bluetooth`);

        while (true) {
          try {
            await manager.startDiscovery();
            break;
          } catch (e) {
            if (e instanceof DBusError) {
              await new Promise((resolve) => setTimeout(resolve, 500));
            } else {
              logger.error(e, "Unexpected error while resetting Bluetooth adapter");
              throw e;
            }
          }
        }
      },
      {
        name: "Resetting adapter",
        description: `Resetting the Bluetooth adapter...`,
        cancellable: false,
      },
    );

    res.status(200).end();
  });

  /** Listen for new socket.io connections. */
  io.on("connection", async (socket) => {
    sockets.add(socket);

    // logger function for attack progress
    const log = (message: string) =>
      socket.emit("attackProgress", { timestamp: Date.now(), message });

    socket.on(
      "cancelCurrentTask",
      wrapSocketHandler(async () => {
        await taskManager.cancelCurrentTask(15000);
      }),
    );

    /** Get the model data given a model ID. */
    socket.on(
      "modelData",
      wrapSocketHandler((id) => getDeviceInfo(id)),
    );

    /** Connect to a device given its address. */
    socket.on(
      "connectToDevice",
      wrapSocketHandler(async (address) => {
        const device = manager.deviceMap.getByAddress(address);
        if (!device) throw new Error("Unknown device");

        await taskManager.run((a) => device.connect(a?.signal), {
          name: "Connecting",
          description: `Connecting to device ${address}...`,
          timeout: 10000,
          cancellable: true,
        });
      }),
    );

    /** Disconnect from a device given its address. */
    socket.on(
      "disconnectFromDevice",
      wrapSocketHandler(async (address) => {
        const device = manager.deviceMap.getByAddress(address);
        if (!device) throw new Error("Unknown device");

        return await taskManager.run(() => device.disconnect(), {
          name: "Disconnecting",
          description: `Disconnecting from device ${address}...`,
          cancellable: false,
        });
      }),
    );

    /** Read the Model ID of a device. */
    socket.on(
      "readModelId",
      wrapSocketHandler(async (address) => {
        const device = manager.deviceMap.getByAddress(address);
        if (!device) throw new Error("Unknown device");

        return await taskManager.run(
          async (controller) => {
            const signal = controller?.signal;

            const fastPairService = await device.getFastPairService();
            signal?.throwIfAborted();
            const modelId = await fastPairService.readModelIdCharacteristic();
            signal?.throwIfAborted();
            const model = await getDeviceInfo(modelId);

            return { modelId, model };
          },
          {
            name: "Reading Model ID",
            description: `Reading Model ID of ${address}...`,
            timeout: 10000,
            cancellable: true,
          },
        );
      }),
    );

    /** Save the model ID for a device. */
    socket.on(
      "saveModelId",
      wrapSocketHandler(async (address, modelId) => {
        const device = manager.deviceMap.getByAddress(address);
        if (!device) throw new Error("Unknown device");

        device.saveModelId(modelId);
      }),
    );

    /** Perform an attack on a device. */
    socket.on(
      "attack",
      wrapSocketHandler(async (address, attack, reconnect, options) => {
        const device = manager.deviceMap.getByAddress(address);
        if (!device) throw new Error("Unknown device");

        const attackText =
          attack == "pairingStatePredicate"
            ? "pairing state predicate"
            : attack == "nonceReuse"
              ? "nonce reuse"
              : "invalid curve";

        const start = performance.now();

        return await taskManager.run(
          async (controller) => {
            const signal = controller?.signal!;

            if (reconnect || !device.connected) {
              if (device.connected) {
                log("disconnecting...");
                await device.disconnect();
              }

              signal.throwIfAborted();

              log("connecting...");
              const timeout = setTimeout(
                () =>
                  log(
                    "Connection is taking long, the address of the target device might have rotated. You might have to cancel the attack and retry.",
                  ),
                7500,
              );
              await device.connect(signal);
              clearTimeout(timeout);
              log("connected!");
            }

            signal.throwIfAborted();

            // create a fast pair service
            const service = await device.getFastPairService();

            signal.throwIfAborted();

            // start the requested attack
            if (attack == "pairingStatePredicate") {
              await service.testPairingStatePredicate(options, log, signal);
            } else if (attack == "nonceReuse") {
              await service.testNonceReuse(log, signal);
            } else if (attack == "invalidCurve") {
              await service.testInvalidCurve(log, signal);
            } else {
              throw new Error("Unknown attack type");
            }

            const duration = performance.now() - start;

            log(`attack completed in ${duration}ms`);

            return duration;
          },
          {
            name: "Running compliance test",
            description: `Running ${attackText} test on device ${device.address}`,
            timeout: 25000,
            cancellable: true,
          },
        );
      }),
    );

    /** Unpair a device. */
    socket.on(
      "unpair",
      wrapSocketHandler(async (address) => {
        const device = manager.deviceMap.getByAddress(address);
        if (!device) throw new Error("Unknown device");

        return await taskManager.run(() => device.unpair(), {
          name: "Unpairing",
          description: `Unpairing from device ${address}...`,
          cancellable: false,
        });
      }),
    );

    /** When a client disconnects. */
    socket.on("disconnect", () => sockets.delete(socket));

    /** Automatically send all nearby devices. */
    socket.emit("devices", manager.devices());
    socket.emit("currentTask", taskManager.currentTask);
  });

  const context = { manager, sockets };

  // forward events emitted by the device manager
  forwardEvent(context, "newDevice");
  forwardEvent(context, "deviceUpdated");
  forwardEvent(context, "deviceRemoved");
  forwardEvent(context, "deviceRssiUpdated", (device) => [device.address, device.rssi]);
  forwardEvent(context, "clear");

  // start listening
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(process.env.PORT || 8000, resolve);
  });

  process.on("SIGINT", close);

  logger.info("Server started");
}

// log fatal errors
function onError(err: Error) {
  logger.fatal({ err }, "A fatal error has occurred");
  process.exit(1);
}

process.on("uncaughtException", onError);
process.on("unhandledRejection", onError);

// required tools
const requirements: [string, string][] = [
  ["hcitool", "Connecting to a device or performing attacks may not be possible."],
  ["l2ping", "Completing a pairing may not be reliable."],
  ["rfkill", "If the Bluetooth adapter is turned off, the server will fail to start."],
  ["hciconfig", "Automatically resetting the Bluetooth adapter may not work."],
  ["systemctl", "Automatically resetting the Bluetooth adapter may not work."],
  ["rfcomm", "Switching back using the Audio Switch extension may not work."],
];

function checkTools() {
  logger.info("Checking if tools are available in this environment...");

  const unavailableTools = requirements
    .map((data) => [...data, utils.isToolAvailable(data[0])])
    .filter((data) => !data[2]);

  if (unavailableTools.length == 0) {
    logger.info("All tools are available!");
  } else {
    logger.info(
      `Some tools are unavailable:\n${unavailableTools.map((data) => ` * ${data[0]}: ${data[1]}`).join("\n")}`,
    );
  }
}

checkTools();
main();
