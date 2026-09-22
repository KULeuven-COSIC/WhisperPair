import dbus, { Variant } from "dbus-next";
import { Socket } from "node:net";

const { Interface } = dbus.interface;

/**
 * The Fast Pair Message Stream RFCOMM service UUID. BlueZ uses it to discover
 * the RFCOMM channel via SDP, replacing the deprecated `sdptool`.
 */
const FAST_PAIR_RFCOMM_UUID = "df21fe2c-2515-4fdb-8886-f12c4d67927c";

/** The D-Bus object path our profile is exported on. */
const PROFILE_PATH = "/whisperpair/fastpair";

/** A connection waiting for BlueZ to hand us an RFCOMM file descriptor. */
interface PendingConnection {
  resolve: (socket: Socket) => void;
  reject: (error: Error) => void;
}

/** Connections awaiting `NewConnection`, keyed by device object path. */
const pending = new Map<string, PendingConnection>();

/**
 * An `org.bluez.Profile1` implementation. BlueZ calls `NewConnection` with a
 * connected RFCOMM socket file descriptor once `ConnectProfile` succeeds — this
 * replaces the deprecated `rfcomm bind` and `/dev/rfcommN` serial devices.
 */
class FastPairProfile extends Interface {
  constructor() {
    super("org.bluez.Profile1");
  }

  Release() {}

  NewConnection(device: string, fd: number, _properties: Record<string, Variant>) {
    const waiter = pending.get(device);

    // nobody is waiting for this device; close the fd so it isn't leaked
    if (!waiter) {
      try {
        new Socket({ fd }).destroy();
      } catch {}
      return;
    }

    pending.delete(device);
    waiter.resolve(new Socket({ fd, readable: true, writable: true }));
  }

  RequestDisconnection(_device: string) {}
}

FastPairProfile.configureMembers({
  methods: {
    Release: { inSignature: "", outSignature: "" },
    NewConnection: { inSignature: "oha{sv}", outSignature: "" },
    RequestDisconnection: { inSignature: "o", outSignature: "" },
  },
});

/**
 * A dedicated system bus with UNIX file-descriptor passing enabled, used to
 * receive the RFCOMM socket from BlueZ.
 */
let bus: dbus.MessageBus | undefined;
let registerPromise: Promise<void> | undefined;

function getBus() {
  if (!bus) bus = dbus.systemBus({ negotiateUnixFd: true });
  return bus;
}

/** Exports and registers the Fast Pair profile with BlueZ exactly once. */
function ensureRegistered() {
  if (registerPromise) return registerPromise;

  registerPromise = (async () => {
    const bus = getBus();
    bus.export(PROFILE_PATH, new FastPairProfile());

    const managerObject = await bus.getProxyObject("org.bluez", "/org/bluez");
    const profileManager = managerObject.getInterface("org.bluez.ProfileManager1");

    const options = {
      Role: new Variant("s", "client"),
      RequireAuthentication: new Variant("b", false),
      RequireAuthorization: new Variant("b", false),
    };

    try {
      await profileManager.RegisterProfile!(PROFILE_PATH, FAST_PAIR_RFCOMM_UUID, options);
    } catch (e) {
      // the profile may already be registered (e.g. after a hot reload)
      if (!(e instanceof Error) || !e.message.includes("AlreadyExists")) {
        registerPromise = undefined;
        throw e;
      }
    }
  })();

  return registerPromise;
}

/**
 * Opens a Fast Pair RFCOMM connection to a device using BlueZ's Profile API.
 * BlueZ performs SDP discovery for the Fast Pair UUID, connects the RFCOMM
 * channel, and hands back a socket file descriptor.
 * @param devicePath The BlueZ D-Bus object path of the (BR/EDR) device.
 * @returns A connected socket for the RFCOMM channel.
 */
export async function connect(devicePath: string, timeoutMs = 15000): Promise<Socket> {
  const bus = getBus();
  await ensureRegistered();

  const deviceObject = await bus.getProxyObject("org.bluez", devicePath);
  const device = deviceObject.getInterface("org.bluez.Device1");

  const socketPromise = new Promise<Socket>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(devicePath);
      reject(new Error("Timed out waiting for the RFCOMM connection."));
    }, timeoutMs);

    pending.set(devicePath, {
      resolve: (socket) => {
        clearTimeout(timer);
        resolve(socket);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
  });

  try {
    await device.ConnectProfile!(FAST_PAIR_RFCOMM_UUID);
  } catch (e) {
    // BlueZ delivers the fd via NewConnection before ConnectProfile returns, so
    // only surface the error if we are still waiting for the connection.
    const waiter = pending.get(devicePath);
    if (waiter) {
      pending.delete(devicePath);
      waiter.reject(e instanceof Error ? e : new Error(String(e)));
    }
  }

  return socketPromise;
}

const rfcomm = {
  connect,
};

export default rfcomm;
