import { exec } from "./utils";

/** Converts an address to an hcitool compatible representation. */
function getAddressAsBytes(address: string) {
  return address
    .split(":")
    .reverse()
    .map((byte) => `0x${byte}`)
    .join(" ");
}

/**
 * Attempts to open an LE connection to a device.
 * @param address The address of the device.
 */
export async function createLEConnection(address: string) {
  const bytes = getAddressAsBytes(address);

  const result = await exec(
    `hcitool cmd 0x08 0x000D 0x60 0x00 0x60 0x00 0x00 0x01 ${bytes} 0x01 0x18 0x00 0x28 0x00 0x00 0x00 0x64 0x00 0x00 0x00 0x00 0x00`,
  );

  if (result.stdout.includes("> HCI Event: 0x0f plen 4\n  0C 01 0D 20 \n"))
    throw new Error("Command disallowed");
}

/**
 * Attempts to open an extended LE connection to a device.
 * @param address The address of the device.
 */
export async function createExtendedLEConnection(address: string) {
  const bytes = getAddressAsBytes(address);

  const result = await exec(
    `hcitool cmd 0x08 0x0043 0x00 0x00 0x01 ${bytes} 0x01 0x60 0x00 0x60 0x00 0x18 0x00 0x28 0x00 0x00 0x00 0x64 0x00 0x00 0x00 0x00 0x00`,
  );

  if (result.stdout.includes("> HCI Event: 0x0e plen 4\n  01 43 20 01 \n"))
    throw new Error("Unknown HCI command");
}

/**
 * Determines whether the host supports creating extended LE connections.
 * @returns A boolean or undefined.
 */
export async function determineExtendedCreateConnectionSupport() {
  let attempts = 0;
  while (attempts < 3) {
    attempts += 1;

    const result = await exec(`hcitool cmd 0x04 0x0002`);

    if (!result.stdout.includes("> HCI Event: 0x0e plen 68")) continue;

    const byte = parseInt(result.stdout.substring(201, 203), 16);
    return (byte & 0x10) !== 0;
  }

  return undefined;
}

const hcitool = {
  createLEConnection,
  createExtendedLEConnection,
  determineExtendedCreateConnectionSupport,
};

export default hcitool;
